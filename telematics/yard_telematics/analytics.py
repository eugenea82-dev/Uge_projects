"""Turns decoded signals into operational information: machine state
(off / idle / working), shift KPIs, and threshold alerts.

Thresholds are generic diesel-engine defaults for a 24 V yard tractor; tune
them per OEM/engine model (they live in DEFAULT_RULES).
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

DIESEL_CO2_KG_PER_L = 2.68
RUNNING_RPM = 400


@dataclass(frozen=True)
class AlertRule:
    id: str
    key: str
    op: str  # ">" or "<"
    threshold: float
    severity: str  # warning | serious | critical
    message: str
    only_when_running: bool = False
    only_when_stopped: bool = False

    def triggered(self, values: dict[str, float], running: bool) -> bool:
        if self.only_when_running and not running:
            return False
        if self.only_when_stopped and running:
            return False
        v = values.get(self.key)
        if v is None:
            return False
        return v > self.threshold if self.op == ">" else v < self.threshold


DEFAULT_RULES = [
    AlertRule("coolant_critical", "coolant_temp", ">", 105, "critical", "Engine overheating - stop and investigate"),
    AlertRule("coolant_high", "coolant_temp", ">", 100, "warning", "Coolant temperature high"),
    AlertRule("oil_pressure_low", "engine_oil_pressure", "<", 100, "critical", "Engine oil pressure low",
              only_when_running=True),
    AlertRule("charging_low", "battery_voltage", "<", 25.5, "serious",
              "Charging voltage low - check alternator/belt", only_when_running=True),
    AlertRule("battery_low", "battery_voltage", "<", 24.0, "warning", "Battery voltage low (engine off)",
              only_when_stopped=True),
    AlertRule("fuel_critical", "fuel_level", "<", 8, "critical", "Fuel critically low - refuel now"),
    AlertRule("fuel_low", "fuel_level", "<", 15, "warning", "Fuel low - schedule refuel"),
    AlertRule("def_low", "def_level", "<", 10, "warning", "DEF/AdBlue low - engine derate risk"),
    AlertRule("trans_hot", "trans_oil_temp", ">", 120, "serious", "Transmission oil temperature high"),
    AlertRule("hyd_hot", "hydraulic_oil_temp", ">", 85, "warning", "Hydraulic oil temperature high"),
    AlertRule("overspeed", "vehicle_speed", ">", 30, "warning", "Yard speed limit (30 km/h) exceeded"),
]

SEVERITY_RANK = {"critical": 3, "serious": 2, "warning": 1}


def _suppress_lesser(active: dict[str, AlertRule]) -> dict[str, AlertRule]:
    """If 'coolant_critical' fires, don't also show 'coolant_high' for the same signal."""
    best: dict[str, AlertRule] = {}
    for rule in active.values():
        cur = best.get(rule.key)
        if cur is None or SEVERITY_RANK[rule.severity] > SEVERITY_RANK[cur.severity]:
            best[rule.key] = rule
    return {r.id: r for r in best.values()}


@dataclass
class ShiftTracker:
    """Accumulates KPIs over the gateway session (treat a restart as a new shift)."""

    rules: list[AlertRule] = field(default_factory=lambda: list(DEFAULT_RULES))
    state: str = "off"
    state_seconds: dict[str, float] = field(default_factory=lambda: {"off": 0.0, "idle": 0.0, "working": 0.0})
    distance_km: float = 0.0
    fuel_integrated_l: float = 0.0
    idle_fuel_l: float = 0.0
    trailer_lifts: int = 0
    alert_events: int = 0
    first_total_fuel: float | None = None
    first_hours: float | None = None
    active_alerts: dict[str, dict] = field(default_factory=dict)
    alert_log: deque = field(default_factory=lambda: deque(maxlen=200))
    _last_lift_state: float | None = None

    def classify(self, values: dict[str, float], engine_seen: bool) -> str:
        rpm = values.get("engine_speed")
        if not engine_seen or rpm is None or rpm < RUNNING_RPM:
            return "off"
        if values.get("vehicle_speed", 0) < 1.0 and values.get("accel_pedal", 0) < 5:
            return "idle"
        return "working"

    def update(self, values: dict[str, float], engine_seen: bool, now: float, dt: float,
               dtc_lamps: dict[str, bool]) -> None:
        self.state = self.classify(values, engine_seen)
        dt = max(0.0, min(dt, 60.0))  # guard against clock jumps
        self.state_seconds[self.state] += dt
        if self.state != "off":
            self.distance_km += values.get("vehicle_speed", 0) * dt / 3600
            rate = values.get("fuel_rate", 0) * dt / 3600
            self.fuel_integrated_l += rate
            if self.state == "idle":
                self.idle_fuel_l += rate
        if "total_fuel_used" in values and self.first_total_fuel is None:
            self.first_total_fuel = values["total_fuel_used"]
        if "engine_hours" in values and self.first_hours is None:
            self.first_hours = values["engine_hours"]
        lift = values.get("fifth_wheel_raised")
        if lift is not None:
            if self._last_lift_state == 0 and lift == 1:
                self.trailer_lifts += 1
            self._last_lift_state = lift
        self._evaluate_alerts(values, now, dtc_lamps)

    def _evaluate_alerts(self, values: dict[str, float], now: float, lamps: dict[str, bool]) -> None:
        running = self.state != "off"
        fired = _suppress_lesser({r.id: r for r in self.rules if r.triggered(values, running)})
        current: dict[str, dict] = {}
        for rid, rule in fired.items():
            current[rid] = {"id": rid, "severity": rule.severity, "message": rule.message,
                            "key": rule.key, "value": round(values[rule.key], 2), "threshold": rule.threshold}
        if lamps.get("red"):
            current["dtc_red"] = {"id": "dtc_red", "severity": "critical", "message":
                                  "ECU red STOP lamp active - see diagnostic codes", "key": None}
        elif lamps.get("amber"):
            current["dtc_amber"] = {"id": "dtc_amber", "severity": "warning", "message":
                                    "ECU amber warning lamp active - see diagnostic codes", "key": None}
        for rid, alert in current.items():
            if rid not in self.active_alerts:
                alert["since"] = now
                self.alert_events += 1
                self.alert_log.appendleft({**alert, "event": "raised", "ts": now})
            else:
                alert["since"] = self.active_alerts[rid]["since"]
        for rid, alert in self.active_alerts.items():
            if rid not in current:
                self.alert_log.appendleft({**alert, "event": "cleared", "ts": now})
        self.active_alerts = current

    def kpis(self, values: dict[str, float]) -> dict:
        on = self.state_seconds["idle"] + self.state_seconds["working"]
        total = on + self.state_seconds["off"]
        if self.first_total_fuel is not None and "total_fuel_used" in values:
            fuel = values["total_fuel_used"] - self.first_total_fuel
            # ECU counter has 0.5 L resolution; prefer integrated rate while small
            fuel = fuel if fuel >= 5 else self.fuel_integrated_l
        else:
            fuel = self.fuel_integrated_l
        hours = (values["engine_hours"] - self.first_hours
                 if self.first_hours is not None and "engine_hours" in values else on / 3600)
        return {
            "observed_hours": round(total / 3600, 3),
            "engine_on_hours": round(on / 3600, 3),
            "engine_hours_delta": round(hours, 3),
            "state_seconds": {k: round(v, 1) for k, v in self.state_seconds.items()},
            "utilization_pct": round(100 * self.state_seconds["working"] / total, 1) if total else None,
            "idle_pct_of_engine_on": round(100 * self.state_seconds["idle"] / on, 1) if on else None,
            "fuel_used_l": round(fuel, 2),
            "idle_fuel_l": round(self.idle_fuel_l, 2),
            "avg_fuel_rate_lph": round(fuel / (on / 3600), 2) if on > 60 else None,
            "co2_kg": round(fuel * DIESEL_CO2_KG_PER_L, 1),
            "distance_km": round(self.distance_km, 2),
            "trailer_lifts": self.trailer_lifts if self._last_lift_state is not None else None,
            "alert_events": self.alert_events,
        }
