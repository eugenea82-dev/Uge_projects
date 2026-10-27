"""The telematics pipeline: frames -> J1939 decode -> latest values / storage
-> analytics, with a thread-safe snapshot for the dashboard API.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass

from .analytics import ShiftTracker
from .j1939 import FMI_TEXT, PGN_DM1, PGN_TP_CM, PGN_TP_DT, decode_dm1, parse_can_id, TransportReassembler
from .signals import SignalCatalog
from .sources import CandumpWriter, Frame
from .store import Store

STALE_AFTER_S = 10.0  # a value older than this is not shown as "live"
ENGINE_TIMEOUT_S = 5.0  # no EEC1 for this long -> engine considered off / bus asleep

# Common aftertreatment/engine DTC SPNs that are not in the signal catalog.
EXTRA_SPN_NAMES = {
    3251: "DPF differential pressure",
    3216: "Aftertreatment intake NOx",
    3226: "Aftertreatment outlet NOx",
    3364: "DEF quality",
    1569: "Engine torque derate",
    5246: "SCR operator inducement severity",
    629: "Controller #1",
    639: "J1939 network #1",
}

SOURCE_ADDRESS_NAMES = {
    0x00: "Engine #1", 0x03: "Transmission #1", 0x0B: "Brakes - system controller",
    0x17: "Instrument cluster", 0x21: "Body controller", 0x27: "Management computer",
    0x3D: "Exhaust emission controller", 0xF9: "Off-board diagnostics #1",
}


@dataclass
class _PgnStat:
    pgn: int
    sa: int
    count: int
    first: float
    last: float
    data: bytes


class Gateway:
    def __init__(self, source, catalog: SignalCatalog, store: Store, vehicle_id: str = "YT-01",
                 time_scale: float = 1.0, recorder: CandumpWriter | None = None):
        self.source = source
        self.catalog = catalog
        self.store = store
        self.vehicle_id = vehicle_id
        self.time_scale = time_scale  # simulated/replayed seconds per wall second
        self.recorder = recorder
        self.tp = TransportReassembler()
        self.tracker = ShiftTracker()
        self._lock = threading.Lock()
        self.latest: dict[str, tuple[float, float, int]] = {}  # key -> (value, ts, sa)
        self.pgn_stats: dict[tuple[int, int], _PgnStat] = {}
        self.dm1: dict[int, dict] = {}
        self.frames_total = 0
        self.frames_unparsed = 0
        self._rate_window: deque[tuple[float, int]] = deque(maxlen=20)
        self._last_frame_ts: float | None = None
        self._last_frame_mono = time.monotonic()
        self._last_engine_ts: float | None = None
        self._last_tick_now: float | None = None
        self.started_wall = time.time()
        self.error: str | None = None
        self._stop = threading.Event()

    # --------------------------------------------------------------- clock
    def now(self) -> float:
        """Vehicle-time 'now': last frame time advanced by elapsed wall time."""
        if self._last_frame_ts is None:
            return time.time()
        return self._last_frame_ts + (time.monotonic() - self._last_frame_mono) * self.time_scale

    # --------------------------------------------------------------- ingest
    def process(self, frame: Frame) -> None:
        if self.recorder:
            self.recorder.write(frame)
        with self._lock:
            self.frames_total += 1
            self._last_frame_ts = frame.ts
            self._last_frame_mono = time.monotonic()
            if self._last_tick_now is None or frame.ts - self._last_tick_now >= 1.0:
                # keeps KPIs exact when replaying faster than real time
                self._tick_locked(frame.ts)
            if not frame.is_extended:
                self.frames_unparsed += 1  # 11-bit frames are not J1939
                return
            cid = parse_can_id(frame.arbitration_id)
            key = (cid.pgn, cid.source_address)
            st = self.pgn_stats.get(key)
            if st is None:
                self.pgn_stats[key] = _PgnStat(cid.pgn, cid.source_address, 1, frame.ts, frame.ts, frame.data)
            else:
                st.count += 1
                st.last = frame.ts
                st.data = frame.data
            if cid.pgn in (PGN_TP_CM, PGN_TP_DT):
                done = self.tp.feed(cid, frame.data, frame.ts)
                if done:
                    self._handle_message(done[0], done[1], done[2], frame.ts)
                return
            self._handle_message(cid.pgn, cid.source_address, frame.data, frame.ts)

    def _handle_message(self, pgn: int, sa: int, data: bytes, ts: float) -> None:
        if pgn == PGN_DM1:
            dm1 = decode_dm1(sa, data)
            self.dm1[sa] = {"ts": ts, "lamps": {"mil": dm1.malfunction_lamp, "red": dm1.red_stop_lamp,
                                                "amber": dm1.amber_warning_lamp, "protect": dm1.protect_lamp},
                            "dtcs": [(d.spn, d.fmi, d.occurrences) for d in dm1.dtcs]}
            self.store.sync_dtcs(sa, self.dm1[sa]["dtcs"], ts)
            return
        if pgn == 0xF004 and sa == 0x00:
            self._last_engine_ts = ts
        for k, v in self.catalog.decode(pgn, sa, data).items():
            self.latest[k] = (v, ts, sa)
            self.store.add_sample(ts, k, v)

    # --------------------------------------------------------------- periodic
    def tick(self) -> None:
        """Runs ~1/s on wall time: state machine, KPIs, alerts, flush, bus-off detection."""
        with self._lock:
            self._tick_locked(self.now())
            self._rate_window.append((time.monotonic(), self.frames_total))

    def _tick_locked(self, now: float) -> None:
        dt = 0.0 if self._last_tick_now is None else now - self._last_tick_now
        self._last_tick_now = now
        fresh = self._fresh_values(now)
        engine_seen = self._last_engine_ts is not None and now - self._last_engine_ts < ENGINE_TIMEOUT_S
        if not engine_seen and self.dm1:
            self.dm1.clear()  # bus asleep: DM1 no longer broadcast
            self.store.deactivate_all(now)
        lamps = {"red": any(d["lamps"]["red"] == "on" for d in self.dm1.values()),
                 "amber": any(d["lamps"]["amber"] == "on" for d in self.dm1.values())}
        self.tracker.update(fresh, engine_seen, now, dt, lamps)
        self.store.flush(now)

    def _fresh_values(self, now: float) -> dict[str, float]:
        return {k: v for k, (v, ts, _) in self.latest.items() if now - ts < STALE_AFTER_S}

    # --------------------------------------------------------------- run
    def run(self) -> None:
        ticker = threading.Thread(target=self._tick_loop, daemon=True, name="gateway-tick")
        ticker.start()
        try:
            for frame in self.source.frames():
                if self._stop.is_set():
                    break
                self.process(frame)
        except Exception as exc:  # surface adapter failures on the dashboard
            self.error = f"{type(exc).__name__}: {exc}"
            raise
        finally:
            self.source.close()

    def _tick_loop(self) -> None:
        while not self._stop.wait(1.0):
            self.tick()

    def stop(self) -> None:
        self._stop.set()

    # --------------------------------------------------------------- API views
    def snapshot(self) -> dict:
        with self._lock:
            now = self.now()
            fresh = self._fresh_values(now)
            signals = {}
            for key, spec in self.catalog.specs.items():
                v = self.latest.get(key)
                entry = {"name": spec.name, "unit": spec.unit, "spn": spec.spn, "pgn": spec.pgn,
                         "value": None, "ts": None, "stale": True}
                if v is not None:
                    value, ts, sa = v
                    entry.update(value=round(value, 3), ts=ts, sa=sa, stale=key not in fresh)
                    if spec.states:
                        entry["text"] = spec.states.get(int(value), str(int(value)))
                signals[key] = entry
            fps = None
            if len(self._rate_window) >= 2:
                (t0, n0), (t1, n1) = self._rate_window[0], self._rate_window[-1]
                fps = round((n1 - n0) / (t1 - t0), 1) if t1 > t0 else None
            dtcs = []
            for sa, d in self.dm1.items():
                for spn, fmi, oc in d["dtcs"]:
                    dtcs.append({"sa": sa, "ecu": SOURCE_ADDRESS_NAMES.get(sa, f"SA 0x{sa:02X}"),
                                 "spn": spn, "spn_name": self.spn_name(spn), "fmi": fmi,
                                 "fmi_text": FMI_TEXT.get(fmi, "Reserved"), "occurrences": oc})
            return {
                "vehicle_id": self.vehicle_id,
                "source": self.source.description,
                "error": self.error,
                "now": now,
                "state": self.tracker.state,
                "signals": signals,
                "kpis": self.tracker.kpis(fresh),
                "alerts": sorted(self.tracker.active_alerts.values(),
                                 key=lambda a: -{"critical": 3, "serious": 2, "warning": 1}[a["severity"]]),
                "dtcs": dtcs,
                "lamps": {sa: d["lamps"] for sa, d in self.dm1.items()},
                "bus": {"frames_total": self.frames_total, "frames_per_s": fps,
                        "non_j1939_frames": self.frames_unparsed, "tp_aborted": self.tp.aborted,
                        "last_frame_age_s": round(now - self._last_frame_ts, 1) if self._last_frame_ts else None,
                        "pgns_seen": len(self.pgn_stats)},
            }

    def spn_name(self, spn: int) -> str:
        return self.catalog.spn_names.get(spn) or EXTRA_SPN_NAMES.get(spn) or f"SPN {spn}"

    def pgn_inventory(self) -> list[dict]:
        """Bus discovery: every (PGN, source) seen, its rate and whether we decode it."""
        with self._lock:
            out = []
            for (pgn, sa), st in sorted(self.pgn_stats.items()):
                span = st.last - st.first
                out.append({
                    "pgn": pgn, "pgn_hex": f"0x{pgn:04X}", "sa": sa,
                    "ecu": SOURCE_ADDRESS_NAMES.get(sa, f"SA 0x{sa:02X}"),
                    "name": self.catalog.pgn_names.get(pgn, "Proprietary" if pgn >= 0xFF00 else "Unknown"),
                    "decoded": pgn in self.catalog.by_pgn or pgn in (PGN_DM1, PGN_TP_CM, PGN_TP_DT),
                    "count": st.count, "rate_hz": round((st.count - 1) / span, 2) if span > 0 else None,
                    "last_data": st.data.hex(" ").upper(),
                })
            return out

    def alert_log(self, limit: int = 50) -> list[dict]:
        with self._lock:
            return list(self.tracker.alert_log)[:limit]
