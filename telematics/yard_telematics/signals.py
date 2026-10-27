"""Signal catalog: standard SAE J1939-71 parameters a yard tractor's engine,
transmission and aftertreatment ECUs broadcast, plus loader for OEM
proprietary signals defined in JSON (fifth wheel, hydraulics, etc.).

Bit positions follow J1939-71 (byte N, bit M -> start_bit = (N-1)*8 + (M-1)).
"""

from __future__ import annotations

import json
from pathlib import Path

from .j1939 import SignalSpec

PGN_NAMES = {
    0xF003: "EEC2 - Electronic Engine Controller 2",
    0xF004: "EEC1 - Electronic Engine Controller 1",
    0xF005: "ETC2 - Electronic Transmission Controller 2",
    0xFE56: "AT1T1I - Aftertreatment 1 DEF Tank",
    0xFECA: "DM1 - Active Diagnostic Trouble Codes",
    0xFEE5: "HOURS - Engine Hours, Revolutions",
    0xFEE9: "LFC1 - Fuel Consumption (Liquid)",
    0xFEEE: "ET1 - Engine Temperature 1",
    0xFEEF: "EFL/P1 - Engine Fluid Level/Pressure 1",
    0xFEF1: "CCVS1 - Cruise Control/Vehicle Speed 1",
    0xFEF2: "LFE1 - Fuel Economy (Liquid)",
    0xFEF5: "AMB - Ambient Conditions",
    0xFEF6: "IC1 - Inlet/Exhaust Conditions 1",
    0xFEF7: "VEP1 - Vehicle Electrical Power 1",
    0xFEF8: "TRF1 - Transmission Fluids 1",
    0xFEFC: "DD1 - Dash Display 1",
    0xEA00: "Request",
    0xEC00: "TP.CM - Transport Protocol Connection Mgmt",
    0xEB00: "TP.DT - Transport Protocol Data Transfer",
}

TWO_BIT_STATES = {0: "off", 1: "on"}

STANDARD_SIGNALS: list[SignalSpec] = [
    # EEC1
    SignalSpec("engine_speed", "Engine speed", 0xF004, 24, 16, 0.125, 0, "rpm", spn=190),
    SignalSpec("engine_torque", "Actual engine torque", 0xF004, 16, 8, 1, -125, "%", spn=513),
    # EEC2
    SignalSpec("accel_pedal", "Accelerator pedal position", 0xF003, 8, 8, 0.4, 0, "%", spn=91),
    SignalSpec("engine_load", "Engine load at current speed", 0xF003, 16, 8, 1, 0, "%", spn=92),
    # ETC2
    SignalSpec("current_gear", "Transmission current gear", 0xF005, 24, 8, 1, -125, "", spn=523),
    # ET1
    SignalSpec("coolant_temp", "Engine coolant temperature", 0xFEEE, 0, 8, 1, -40, "°C", spn=110),
    SignalSpec("engine_oil_temp", "Engine oil temperature", 0xFEEE, 16, 16, 0.03125, -273, "°C", spn=175),
    # EFL/P1
    SignalSpec("engine_oil_level", "Engine oil level", 0xFEEF, 16, 8, 0.4, 0, "%", spn=98),
    SignalSpec("engine_oil_pressure", "Engine oil pressure", 0xFEEF, 24, 8, 4, 0, "kPa", spn=100),
    # CCVS1
    SignalSpec("parking_brake", "Parking brake switch", 0xFEF1, 2, 2, 1, 0, "", spn=70, states=TWO_BIT_STATES),
    SignalSpec("vehicle_speed", "Wheel-based vehicle speed", 0xFEF1, 8, 16, 1 / 256, 0, "km/h", spn=84),
    SignalSpec("brake_switch", "Brake switch", 0xFEF1, 28, 2, 1, 0, "", spn=597, states=TWO_BIT_STATES),
    # LFE1
    SignalSpec("fuel_rate", "Engine fuel rate", 0xFEF2, 0, 16, 0.05, 0, "L/h", spn=183),
    # DD1
    SignalSpec("fuel_level", "Fuel level", 0xFEFC, 8, 8, 0.4, 0, "%", spn=96),
    # VEP1
    SignalSpec("battery_voltage", "Battery potential (power input)", 0xFEF7, 32, 16, 0.05, 0, "V", spn=168),
    # HOURS
    SignalSpec("engine_hours", "Engine total hours of operation", 0xFEE5, 0, 32, 0.05, 0, "h", spn=247),
    # LFC1
    SignalSpec("total_fuel_used", "Engine total fuel used", 0xFEE9, 32, 32, 0.5, 0, "L", spn=250),
    # IC1
    SignalSpec("boost_pressure", "Intake manifold boost pressure", 0xFEF6, 8, 8, 2, 0, "kPa", spn=102),
    SignalSpec("intake_temp", "Intake manifold temperature", 0xFEF6, 16, 8, 1, -40, "°C", spn=105),
    # AMB
    SignalSpec("ambient_temp", "Ambient air temperature", 0xFEF5, 24, 16, 0.03125, -273, "°C", spn=171),
    # TRF1
    SignalSpec("trans_oil_temp", "Transmission oil temperature", 0xFEF8, 32, 16, 0.03125, -273, "°C", spn=177),
    # AT1T1I
    SignalSpec("def_level", "DEF (AdBlue) tank level", 0xFE56, 0, 8, 0.4, 0, "%", spn=1761),
]


def load_oem_signals(path: str | Path) -> tuple[list[SignalSpec], dict[int, str]]:
    """Load proprietary signal definitions from a JSON file.

    Format: {"pgns": {"0xFF10": "name"}, "signals": [{key, name, pgn, start_bit,
    length, resolution, offset, unit, source_address, states}]}.
    """
    doc = json.loads(Path(path).read_text())
    pgn_names = {int(k, 0): v for k, v in doc.get("pgns", {}).items()}
    specs = []
    for s in doc.get("signals", []):
        specs.append(SignalSpec(
            key=s["key"], name=s["name"], pgn=_int(s["pgn"]),
            start_bit=int(s["start_bit"]), length=int(s["length"]),
            resolution=float(s.get("resolution", 1)), offset=float(s.get("offset", 0)),
            unit=s.get("unit", ""), spn=s.get("spn"),
            source_address=_int(s["source_address"]) if "source_address" in s else None,
            states={int(k): v for k, v in s["states"].items()} if "states" in s else None,
        ))
    return specs, pgn_names


def _int(v: int | str) -> int:
    return int(v, 0) if isinstance(v, str) else int(v)


class SignalCatalog:
    """Index of signal specs by PGN for fast per-frame decoding."""

    def __init__(self, specs: list[SignalSpec], pgn_names: dict[int, str] | None = None):
        keys = [s.key for s in specs]
        dupes = {k for k in keys if keys.count(k) > 1}
        if dupes:
            raise ValueError(f"duplicate signal keys: {sorted(dupes)}")
        self.specs = {s.key: s for s in specs}
        self.by_pgn: dict[int, list[SignalSpec]] = {}
        for s in specs:
            self.by_pgn.setdefault(s.pgn, []).append(s)
        self.pgn_names = {**PGN_NAMES, **(pgn_names or {})}
        self.spn_names = {s.spn: s.name for s in specs if s.spn is not None}

    @classmethod
    def build(cls, oem_files: list[str | Path] = ()) -> "SignalCatalog":
        specs = list(STANDARD_SIGNALS)
        names: dict[int, str] = {}
        for f in oem_files:
            extra, extra_names = load_oem_signals(f)
            specs += extra
            names.update(extra_names)
        return cls(specs, names)

    def decode(self, pgn: int, source_address: int, data: bytes) -> dict[str, float]:
        out = {}
        for spec in self.by_pgn.get(pgn, ()):
            if spec.source_address is not None and spec.source_address != source_address:
                continue
            value = spec.decode(data)
            if value is not None:
                out[spec.key] = value
        return out
