"""CAN frame sources: live adapter (python-can), candump log replay, simulator.

All sources yield `Frame` objects with a timestamp, so the rest of the
pipeline behaves identically whether it is connected to a truck or replaying
a capture from one.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Protocol, TextIO


@dataclass(frozen=True)
class Frame:
    ts: float
    arbitration_id: int
    data: bytes
    is_extended: bool = True


class FrameSource(Protocol):
    description: str

    def frames(self) -> Iterator[Frame]: ...

    def close(self) -> None: ...


class PythonCanSource:
    """Live bus via python-can (SocketCAN, PCAN, Kvaser, slcan/CANable, ...).

    The gateway is passive by default: it never transmits, so it cannot
    disturb the vehicle network. Also put the adapter itself in listen-only
    (silent) mode where the hardware supports it - see README.
    """

    def __init__(self, interface: str, channel: str, bitrate: int = 250_000,
                 allow_transmit: bool = False):
        try:
            import can  # type: ignore
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise SystemExit("python-can is required for live CAN: pip install python-can") from exc
        self._can = can
        self.allow_transmit = allow_transmit
        kwargs = {"interface": interface, "channel": channel, "receive_own_messages": False}
        if interface != "socketcan":  # socketcan bitrate is set with `ip link`
            kwargs["bitrate"] = bitrate
        self.bus = can.Bus(**kwargs)
        self.description = f"{interface}:{channel} @ {bitrate // 1000} kbit/s"

    def frames(self) -> Iterator[Frame]:
        while True:
            msg = self.bus.recv(timeout=1.0)
            if msg is None or msg.is_error_frame or msg.is_remote_frame:
                continue
            yield Frame(msg.timestamp or time.time(), msg.arbitration_id, bytes(msg.data),
                        msg.is_extended_id)

    def send(self, arbitration_id: int, data: bytes) -> None:
        if not self.allow_transmit:
            raise PermissionError("transmit disabled (gateway is in listen-only mode)")
        self.bus.send(self._can.Message(arbitration_id=arbitration_id, data=data,
                                        is_extended_id=True))

    def close(self) -> None:
        self.bus.shutdown()


# `candump -L` / `candump -l` format: (1698400000.123456) can0 18FEF100#FF00FA
_CANDUMP = re.compile(r"^\((?P<ts>[\d.]+)\)\s+\S+\s+(?P<id>[0-9A-Fa-f]+)#(?P<data>[0-9A-Fa-f]*)")


class CandumpReplaySource:
    """Replays a candump log, optionally paced at (a multiple of) real time."""

    def __init__(self, path: str | Path, speed: float = 1.0, loop: bool = False):
        self.path = Path(path)
        self.speed = speed
        self.loop = loop
        self.description = f"replay:{self.path.name} x{speed:g}"

    def frames(self) -> Iterator[Frame]:
        while True:
            offset = None
            start_wall = time.monotonic()
            first_ts = None
            with self.path.open() as fh:
                for line in fh:
                    m = _CANDUMP.match(line.strip())
                    if not m:
                        continue
                    ts = float(m["ts"])
                    if first_ts is None:
                        first_ts = ts
                        # Re-base onto the current clock so dashboards show "now".
                        offset = time.time() - ts
                    if self.speed > 0:
                        due = (ts - first_ts) / self.speed
                        delay = due - (time.monotonic() - start_wall)
                        if delay > 0:
                            time.sleep(delay)
                    ident = m["id"]
                    yield Frame(ts + offset, int(ident, 16), bytes.fromhex(m["data"]),
                                is_extended=len(ident) > 3)
            if not self.loop:
                return

    def close(self) -> None:
        pass


class CandumpWriter:
    """Records raw frames in candump -L format (replayable, Wireshark/SavvyCAN friendly)."""

    def __init__(self, path: str | Path, channel: str = "can0"):
        self._fh: TextIO = open(path, "a", buffering=1)
        self._channel = channel

    def write(self, frame: Frame) -> None:
        ident = f"{frame.arbitration_id:08X}" if frame.is_extended else f"{frame.arbitration_id:03X}"
        self._fh.write(f"({frame.ts:.6f}) {self._channel} {ident}#{frame.data.hex().upper()}\n")

    def close(self) -> None:
        self._fh.close()
