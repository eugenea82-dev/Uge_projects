"""SAE J1939 primitives: 29-bit identifier parsing, signal (SPN) bit extraction,
transport-protocol (BAM / RTS-CTS) reassembly and DM1 diagnostic decoding.

Everything here is pure Python with no I/O so it can be unit-tested and reused
regardless of whether frames come from a live CAN adapter, a log file or the
simulator.
"""

from __future__ import annotations

from dataclasses import dataclass, field

PGN_REQUEST = 0xEA00  # 59904
PGN_TP_CM = 0xEC00  # 60416 transport protocol - connection management
PGN_TP_DT = 0xEB00  # 60160 transport protocol - data transfer
PGN_DM1 = 0xFECA  # 65226 active diagnostic trouble codes

TP_CM_RTS = 16
TP_CM_CTS = 17
TP_CM_EOM_ACK = 19
TP_CM_BAM = 32
TP_CM_ABORT = 255

GLOBAL_ADDRESS = 0xFF


@dataclass(frozen=True)
class CanId:
    priority: int
    pgn: int
    source_address: int
    destination_address: int  # 0xFF (global) for PDU2 messages


def parse_can_id(arbitration_id: int) -> CanId:
    """Split a 29-bit extended CAN identifier into its J1939 fields."""
    priority = (arbitration_id >> 26) & 0x7
    pdu_format = (arbitration_id >> 16) & 0xFF
    pdu_specific = (arbitration_id >> 8) & 0xFF
    source = arbitration_id & 0xFF
    pgn = (arbitration_id >> 8) & 0x3FFFF
    if pdu_format < 240:  # PDU1: PS is a destination address, not part of the PGN
        pgn &= 0x3FF00
        dest = pdu_specific
    else:
        dest = GLOBAL_ADDRESS
    return CanId(priority, pgn, source, dest)


def build_can_id(pgn: int, source_address: int, priority: int = 6,
                 destination_address: int = GLOBAL_ADDRESS) -> int:
    """Inverse of parse_can_id (used by the simulator and for PGN requests)."""
    pdu_format = (pgn >> 8) & 0xFF
    if pdu_format < 240:
        pgn = (pgn & 0x3FF00) | (destination_address & 0xFF)
    return ((priority & 0x7) << 26) | ((pgn & 0x3FFFF) << 8) | (source_address & 0xFF)


# --------------------------------------------------------------------------
# Signal (SPN) definitions
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class SignalSpec:
    key: str  # stable identifier used by storage / API / dashboard
    name: str
    pgn: int
    start_bit: int  # 0-based, little-endian (Intel) bit position in the payload
    length: int  # bits
    resolution: float = 1.0
    offset: float = 0.0
    unit: str = ""
    spn: int | None = None  # None for OEM proprietary signals without an SPN
    source_address: int | None = None  # restrict to one ECU when PGN is shared
    states: dict[int, str] | None = None  # enumerations for discrete signals

    def max_valid_raw(self) -> int:
        """Largest raw value that still means 'valid data' (J1939-71 ranges).

        Above it the value encodes 'error' or 'not available', which must not
        be shown as a reading.
        """
        if self.length < 8:
            return (1 << self.length) - 3  # e.g. 2-bit: 0,1 valid; 2 error; 3 n/a
        extra = self.length - 8
        return (0xFA << extra) | ((1 << extra) - 1)  # 0xFA, 0xFAFF, 0xFAFFFFFF

    def decode(self, data: bytes) -> float | None:
        if (self.start_bit + self.length + 7) // 8 > len(data):
            return None
        raw = (int.from_bytes(data, "little") >> self.start_bit) & ((1 << self.length) - 1)
        if raw > self.max_valid_raw():
            return None
        return raw * self.resolution + self.offset

    def encode(self, value: float | None, payload: bytearray) -> None:
        """Write a physical value into payload (simulator / tests)."""
        mask = (1 << self.length) - 1
        if value is None:
            raw = mask  # all ones = not available
        else:
            raw = int(round((value - self.offset) / self.resolution))
            raw = max(0, min(raw, self.max_valid_raw()))
        whole = int.from_bytes(payload, "little")
        whole &= ~(mask << self.start_bit)
        whole |= raw << self.start_bit
        payload[:] = whole.to_bytes(len(payload), "little")


# --------------------------------------------------------------------------
# Transport protocol reassembly (multi-packet messages up to 1785 bytes)
# --------------------------------------------------------------------------


@dataclass
class _Session:
    pgn: int
    size: int
    packets: int
    started: float
    chunks: dict[int, bytes] = field(default_factory=dict)


class TransportReassembler:
    """Passively reassembles BAM broadcasts and RTS/CTS transfers.

    The gateway never answers CTS itself (it listens only); it simply captures
    transfers negotiated between other ECUs, plus BAMs which is how DM1 with
    more than one DTC is normally broadcast.
    """

    TIMEOUT_S = 2.0

    def __init__(self) -> None:
        self._sessions: dict[tuple[int, int], _Session] = {}
        self.aborted = 0

    def feed(self, can_id: CanId, data: bytes, ts: float) -> tuple[int, int, bytes] | None:
        """Returns (pgn, source_address, payload) once a message completes."""
        key = (can_id.source_address, can_id.destination_address)
        if can_id.pgn == PGN_TP_CM and len(data) >= 8:
            control = data[0]
            if control in (TP_CM_BAM, TP_CM_RTS):
                size = data[1] | (data[2] << 8)
                pgn = data[5] | (data[6] << 8) | (data[7] << 16)
                self._sessions[key] = _Session(pgn, size, data[3], ts)
            elif control == TP_CM_ABORT and key in self._sessions:
                del self._sessions[key]
                self.aborted += 1
            return None
        if can_id.pgn == PGN_TP_DT and len(data) >= 2:
            session = self._sessions.get(key)
            if session is None:
                return None
            if ts - session.started > self.TIMEOUT_S:
                del self._sessions[key]
                self.aborted += 1
                return None
            session.chunks[data[0]] = bytes(data[1:8])
            if len(session.chunks) >= session.packets:
                del self._sessions[key]
                payload = b"".join(session.chunks[i] for i in sorted(session.chunks))
                return session.pgn, can_id.source_address, payload[: session.size]
        return None


def split_bam(pgn: int, payload: bytes) -> tuple[bytes, list[bytes]]:
    """Encode a long payload as a BAM announce frame + TP.DT frames."""
    packets = (len(payload) + 6) // 7
    announce = bytes([
        TP_CM_BAM, len(payload) & 0xFF, len(payload) >> 8, packets, 0xFF,
        pgn & 0xFF, (pgn >> 8) & 0xFF, (pgn >> 16) & 0xFF,
    ])
    frames = []
    for seq in range(packets):
        chunk = payload[seq * 7:(seq + 1) * 7]
        frames.append(bytes([seq + 1]) + chunk + b"\xFF" * (7 - len(chunk)))
    return announce, frames


# --------------------------------------------------------------------------
# DM1 - active diagnostic trouble codes
# --------------------------------------------------------------------------

FMI_TEXT = {
    0: "Data valid but above normal operating range - most severe",
    1: "Data valid but below normal operating range - most severe",
    2: "Data erratic, intermittent or incorrect",
    3: "Voltage above normal, or shorted to high source",
    4: "Voltage below normal, or shorted to low source",
    5: "Current below normal or open circuit",
    6: "Current above normal or grounded circuit",
    7: "Mechanical system not responding or out of adjustment",
    8: "Abnormal frequency or pulse width or period",
    9: "Abnormal update rate",
    10: "Abnormal rate of change",
    11: "Root cause not known",
    12: "Bad intelligent device or component",
    13: "Out of calibration",
    14: "Special instructions",
    15: "Data valid but above normal operating range - least severe",
    16: "Data valid but above normal operating range - moderately severe",
    17: "Data valid but below normal operating range - least severe",
    18: "Data valid but below normal operating range - moderately severe",
    19: "Received network data in error",
    31: "Condition exists",
}

LAMP_STATES = {0: "off", 1: "on", 2: "error", 3: "n/a"}


@dataclass(frozen=True)
class Dtc:
    spn: int
    fmi: int
    occurrences: int


@dataclass(frozen=True)
class Dm1:
    source_address: int
    malfunction_lamp: str
    red_stop_lamp: str
    amber_warning_lamp: str
    protect_lamp: str
    dtcs: tuple[Dtc, ...]


def decode_dm1(source_address: int, data: bytes) -> Dm1:
    lamps = data[0] if data else 0xFF
    dtcs = []
    for i in range(2, len(data) - 3, 4):
        b0, b1, b2, b3 = data[i:i + 4]
        spn = b0 | (b1 << 8) | ((b2 & 0xE0) << 11)
        fmi = b2 & 0x1F
        if spn == 0 or (b0, b1, b2, b3) == (0xFF, 0xFF, 0xFF, 0xFF):
            continue  # "no active DTC" filler
        dtcs.append(Dtc(spn, fmi, b3 & 0x7F))
    return Dm1(
        source_address,
        malfunction_lamp=LAMP_STATES[(lamps >> 6) & 3],
        red_stop_lamp=LAMP_STATES[(lamps >> 4) & 3],
        amber_warning_lamp=LAMP_STATES[(lamps >> 2) & 3],
        protect_lamp=LAMP_STATES[lamps & 3],
        dtcs=tuple(dtcs),
    )


def encode_dm1(dtcs: list[Dtc], amber: bool = False, red: bool = False,
               mil: bool = False) -> bytes:
    lamps = (int(mil) << 6) | (int(red) << 4) | (int(amber) << 2)
    out = bytearray([lamps, 0xFF])
    for d in dtcs or [Dtc(0, 0, 0)]:
        out += bytes([d.spn & 0xFF, (d.spn >> 8) & 0xFF,
                      ((d.spn >> 11) & 0xE0) | (d.fmi & 0x1F), d.occurrences & 0x7F])
    while len(out) < 8:
        out.append(0xFF)
    return bytes(out)


def request_payload(pgn: int) -> bytes:
    """Payload for PGN 59904 'Request' asking an ECU to send `pgn`."""
    return bytes([pgn & 0xFF, (pgn >> 8) & 0xFF, (pgn >> 16) & 0xFF])
