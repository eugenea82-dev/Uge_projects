"""Yard tractor ECU network simulator.

Emits a realistic J1939 frame stream for a diesel terminal tractor working a
yard duty cycle: waiting at idle, coupling a trailer (fifth wheel lift),
hauling loaded, dropping, running bobtail, and occasional key-off breaks.
Optional fault injection exercises DM1 (single-frame and BAM multi-packet)
and the dashboard alerting.

Used to develop and demo the gateway without a vehicle; frames are encoded
with the same signal catalog the decoder uses, so the encoding paths are
exercised end to end.
"""

from __future__ import annotations

import random
import time
from typing import Iterator

from .j1939 import PGN_DM1, PGN_TP_CM, PGN_TP_DT, Dtc, build_can_id, encode_dm1, split_bam
from .signals import SignalCatalog
from .sources import Frame

SA_ENGINE = 0x00
SA_TRANSMISSION = 0x03
SA_INSTRUMENT_CLUSTER = 0x17
SA_BODY_CONTROLLER = 0x21
SA_AFTERTREATMENT = 0x3D

TICK_S = 0.1
FUEL_TANK_L = 200.0

# phase: (min duration s, max duration s, rpm, speed km/h, load %)
PHASES = {
    "idle_wait": (40, 120, 700, 0, 12),
    "couple": (15, 25, 950, 3, 30),
    "haul_loaded": (60, 180, 1600, 20, 70),
    "drop": (15, 25, 900, 2, 25),
    "bobtail": (40, 90, 1400, 24, 35),
    "key_off": (45, 75, 0, 0, 0),
}
CYCLE = ["idle_wait", "couple", "haul_loaded", "drop", "bobtail"]


class YardTractorSimulator:
    def __init__(self, catalog: SignalCatalog, speed: float = 1.0, seed: int | None = 7,
                 faults: bool = True, start_ts: float | None = None):
        self.catalog = catalog
        self.speed = speed
        self.faults = faults
        self.rng = random.Random(seed)
        self.description = f"simulator x{speed:g}" + (" (fault injection)" if faults else "")
        self.t = start_ts if start_ts is not None else time.time()
        self.t0 = self.t
        self.phase = "idle_wait"
        self.phase_end = self.t + 30
        self.cycles = 0
        s = self.state = {
            "engine_speed": 700.0, "vehicle_speed": 0.0, "engine_load": 12.0,
            "coolant_temp": 48.0, "engine_oil_temp": 45.0, "trans_oil_temp": 38.0,
            "hydraulic_oil_temp": 34.0, "fifth_wheel_height": 1050.0, "hydraulic_pressure": 15.0,
            "fuel_level": 68.0, "def_level": 74.0, "engine_hours": 12345.6,
            "total_fuel_used": 98765.0, "battery_voltage": 27.6, "ambient_temp": 30.0,
        }
        s["fifth_wheel_raised"] = 0
        s["kingpin_locked"] = 0
        self.occurrences: dict[tuple[int, int], int] = {}
        self.prev_active: set[tuple[int, int]] = set()

    # ---------------------------------------------------------------- physics
    def _lag(self, key: str, target: float, tau_s: float) -> float:
        cur = self.state[key]
        cur += (target - cur) * min(1.0, TICK_S / tau_s)
        self.state[key] = cur
        return cur

    def _next_phase(self) -> None:
        if self.phase == "bobtail":
            self.cycles += 1
        if self.phase == "key_off":
            nxt = "idle_wait"
        elif self.phase == "bobtail" and self.cycles % 6 == 0:
            nxt = "key_off"
        else:
            nxt = CYCLE[(CYCLE.index(self.phase) + 1) % len(CYCLE)]
        self.phase = nxt
        lo, hi, *_ = PHASES[nxt]
        self.phase_end = self.t + self.rng.uniform(lo, hi)

    def _active_faults(self) -> list[tuple[int, int]]:
        """(SPN, FMI) pairs currently active; episodes repeat every 40 minutes."""
        if not self.faults:
            return []
        minutes = (self.t - self.t0) / 60 % 40
        out = []
        if 12 <= minutes < 20 and self.state["coolant_temp"] > 102:
            out.append((110, 16))  # coolant overheat (e.g. sticking thermostat)
        if 25 <= minutes < 32 and self.state["engine_speed"] > 400:
            out.append((168, 18))  # weak alternator -> low system voltage
            if 27 <= minutes < 30:
                out.append((3251, 0))  # DPF differential pressure high
        return out

    def _step(self) -> None:
        self.t += TICK_S
        if self.t >= self.phase_end:
            self._next_phase()
        s, rng = self.state, self.rng
        _, _, rpm_t, spd_t, load_t = PHASES[self.phase]
        running = self.phase != "key_off"
        minutes = (self.t - self.t0) / 60 % 40
        overheat = self.faults and 12 <= minutes < 20

        rpm = self._lag("engine_speed", rpm_t + (rng.uniform(-40, 40) if running else 0), 1.2)
        spd = self._lag("vehicle_speed", spd_t + (rng.uniform(-2, 2) if spd_t else 0), 4.0)
        s["vehicle_speed"] = max(0.0, spd)
        load = self._lag("engine_load", load_t + (rng.uniform(-5, 5) if running else 0), 1.5)
        s["engine_load"] = max(0.0, min(100.0, load))
        coolant_t = (108 if overheat else 87) if running else s["ambient_temp"]
        self._lag("coolant_temp", coolant_t, 160 if running else 900)
        self._lag("engine_oil_temp", (96 if running else s["ambient_temp"]), 300 if running else 1200)
        self._lag("trans_oil_temp", (82 + load * 0.15) if running else s["ambient_temp"], 400)
        lifting = self.phase in ("couple", "drop")
        self._lag("hydraulic_oil_temp", (60 + (8 if lifting else 0)) if running else s["ambient_temp"], 500)
        self._lag("hydraulic_pressure", 165 if lifting else (15 if running else 0), 0.8)

        if self.phase == "couple":
            s["kingpin_locked"] = 1
            s["fifth_wheel_raised"] = 1
        elif self.phase == "drop":
            s["fifth_wheel_raised"] = 0
            s["kingpin_locked"] = 0
        self._lag("fifth_wheel_height", 1450 if s["fifth_wheel_raised"] else 1050, 3.0)

        alt_weak = self.faults and 25 <= minutes < 32
        vbat = (25.1 if alt_weak else 27.7) if running else 24.6
        self._lag("battery_voltage", vbat + rng.uniform(-0.05, 0.05), 5.0)

        fuel_rate = (2.4 + 0.19 * s["engine_load"] + rpm * 0.0012) if running else 0.0
        s["fuel_rate"] = fuel_rate
        burned = fuel_rate * TICK_S / 3600
        s["total_fuel_used"] += burned
        s["fuel_level"] = max(0.0, s["fuel_level"] - burned / FUEL_TANK_L * 100)
        s["def_level"] = max(0.0, s["def_level"] - burned * 0.03 / 30 * 100)
        if running:
            s["engine_hours"] += TICK_S / 3600

    # ---------------------------------------------------------------- encoding
    def _encode(self, pgn: int, values: dict[str, float | None]) -> bytes:
        payload = bytearray(b"\xFF" * 8)
        for spec in self.catalog.by_pgn.get(pgn, ()):
            if spec.key in values:
                spec.encode(values[spec.key], payload)
        return bytes(payload)

    def _frame(self, pgn: int, sa: int, values: dict, prio: int = 6, dt: float = 0.0) -> Frame:
        return Frame(self.t + dt, build_can_id(pgn, sa, prio), self._encode(pgn, values))

    def _dm1_frames(self, sa: int, dtcs: list[Dtc], amber: bool, red: bool) -> list[Frame]:
        payload = encode_dm1(dtcs, amber=amber, red=red)
        if len(payload) <= 8:
            return [Frame(self.t, build_can_id(PGN_DM1, sa, 6), payload)]
        announce, chunks = split_bam(PGN_DM1, payload)
        frames = [Frame(self.t, build_can_id(PGN_TP_CM, sa, 7), announce)]
        for i, c in enumerate(chunks, 1):
            frames.append(Frame(self.t + i * 0.05, build_can_id(PGN_TP_DT, sa, 7), c))
        return frames

    def _emit(self, tick: int) -> list[Frame]:
        s = self.state
        if self.phase == "key_off":
            return []  # ignition off: bus is silent
        rpm, spd = s["engine_speed"], s["vehicle_speed"]
        gear = 0 if spd < 0.5 else min(6, 1 + int(spd // 7))
        decel = self.phase in ("idle_wait", "couple", "drop") and spd > 1
        out = [
            self._frame(0xF004, SA_ENGINE, {"engine_speed": rpm,
                                             "engine_torque": s["engine_load"] * 0.9}, prio=3),
            self._frame(0xF003, SA_ENGINE, {"accel_pedal": max(0, s["engine_load"] - 10) * 1.2,
                                             "engine_load": s["engine_load"]}, prio=3),
            self._frame(0xF005, SA_TRANSMISSION, {"current_gear": gear}),
            self._frame(0xFEF1, SA_ENGINE, {"vehicle_speed": spd,
                                             "parking_brake": int(self.phase == "idle_wait" and spd < 0.3),
                                             "brake_switch": int(decel)}),
            self._frame(0xFF10, SA_BODY_CONTROLLER, {k: s[k] for k in (
                "fifth_wheel_height", "hydraulic_oil_temp", "hydraulic_pressure",
                "fifth_wheel_raised", "kingpin_locked")}),
        ]
        if tick % 10 == 0:  # 1 Hz group
            out += [
                self._frame(0xFEEE, SA_ENGINE, {"coolant_temp": s["coolant_temp"],
                                                 "engine_oil_temp": s["engine_oil_temp"]}),
                self._frame(0xFEEF, SA_ENGINE, {"engine_oil_level": 82,
                                                 "engine_oil_pressure": 95 + rpm * 0.18}),
                self._frame(0xFEF2, SA_ENGINE, {"fuel_rate": s["fuel_rate"]}),
                self._frame(0xFEFC, SA_INSTRUMENT_CLUSTER, {"fuel_level": s["fuel_level"]}),
                self._frame(0xFEF7, SA_ENGINE, {"battery_voltage": s["battery_voltage"]}),
                self._frame(0xFEF6, SA_ENGINE, {"boost_pressure": s["engine_load"] * 1.9,
                                                 "intake_temp": s["ambient_temp"] + 8 + s["engine_load"] * 0.15}),
                self._frame(0xFEF5, SA_ENGINE, {"ambient_temp": s["ambient_temp"]}),
                self._frame(0xFEF8, SA_TRANSMISSION, {"trans_oil_temp": s["trans_oil_temp"]}),
                self._frame(0xFE56, SA_AFTERTREATMENT, {"def_level": s["def_level"]}),
                self._frame(0xFEE5, SA_ENGINE, {"engine_hours": s["engine_hours"]}),
                self._frame(0xFEE9, SA_ENGINE, {"total_fuel_used": s["total_fuel_used"]}),
            ]
            active = self._active_faults()
            for key in active:
                if key not in self.prev_active:
                    self.occurrences[key] = self.occurrences.get(key, 0) + 1
            self.prev_active = set(active)
            dtcs = [Dtc(spn, fmi, self.occurrences[(spn, fmi)]) for spn, fmi in active]
            out += self._dm1_frames(SA_ENGINE, dtcs, amber=bool(dtcs),
                                    red=any(d.spn == 110 for d in dtcs))
        return out

    def frames(self) -> Iterator[Frame]:
        tick = 0
        while True:
            self._step()
            yield from self._emit(tick)
            tick += 1
            if self.speed > 0:
                time.sleep(TICK_S / self.speed)

    def close(self) -> None:
        pass
