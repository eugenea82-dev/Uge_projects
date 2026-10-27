"""SQLite time-series store for decoded signals and DTC history.

Raw buses produce hundreds of frames per second; the store keeps one sample
per signal per `sample_interval_s`, which is plenty for dashboards and trend
analysis while staying small on an SD card or edge gateway.
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (ts REAL NOT NULL, key TEXT NOT NULL, value REAL NOT NULL);
CREATE INDEX IF NOT EXISTS samples_key_ts ON samples (key, ts);
CREATE TABLE IF NOT EXISTS dtc_events (
    id INTEGER PRIMARY KEY,
    source_address INTEGER NOT NULL, spn INTEGER NOT NULL, fmi INTEGER NOT NULL,
    occurrences INTEGER, first_seen REAL NOT NULL, last_seen REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS dtc_active ON dtc_events (active, source_address, spn, fmi);
"""


class Store:
    def __init__(self, path: str | Path, sample_interval_s: float = 1.0,
                 retention_days: float = 30):
        self.path = str(path)
        self.sample_interval_s = sample_interval_s
        self.retention_s = retention_days * 86400
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.executescript(SCHEMA)
        self._lock = threading.Lock()
        self._last_written: dict[str, float] = {}
        self._pending: list[tuple[float, str, float]] = []
        self._last_purge = 0.0

    def add_sample(self, ts: float, key: str, value: float) -> None:
        if ts - self._last_written.get(key, 0.0) < self.sample_interval_s:
            return
        self._last_written[key] = ts
        self._pending.append((ts, key, value))

    def flush(self, now: float) -> None:
        with self._lock:
            if self._pending:
                self._db.executemany("INSERT INTO samples VALUES (?, ?, ?)", self._pending)
                self._pending.clear()
            if now - self._last_purge > 3600:
                self._db.execute("DELETE FROM samples WHERE ts < ?", (now - self.retention_s,))
                self._last_purge = now
            self._db.commit()

    def sync_dtcs(self, source_address: int, active: list[tuple[int, int, int]], ts: float) -> None:
        """Reconcile the active DTC set reported by one ECU's DM1."""
        with self._lock:
            rows = self._db.execute(
                "SELECT id, spn, fmi FROM dtc_events WHERE active = 1 AND source_address = ?",
                (source_address,)).fetchall()
            open_ = {(spn, fmi): rid for rid, spn, fmi in rows}
            for spn, fmi, oc in active:
                rid = open_.pop((spn, fmi), None)
                if rid is None:
                    self._db.execute(
                        "INSERT INTO dtc_events (source_address, spn, fmi, occurrences, first_seen,"
                        " last_seen) VALUES (?, ?, ?, ?, ?, ?)", (source_address, spn, fmi, oc, ts, ts))
                else:
                    self._db.execute("UPDATE dtc_events SET last_seen = ?, occurrences = ? WHERE id = ?",
                                     (ts, oc, rid))
            for rid in open_.values():  # no longer reported -> cleared
                self._db.execute("UPDATE dtc_events SET active = 0, last_seen = ? WHERE id = ?", (ts, rid))

    def deactivate_all(self, ts: float) -> None:
        """Called when the bus goes silent (key off): DM1 stops, so nothing is 'active'."""
        with self._lock:
            self._db.execute("UPDATE dtc_events SET active = 0, last_seen = ? WHERE active = 1", (ts,))

    def dtc_events(self, limit: int = 50) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT source_address, spn, fmi, occurrences, first_seen, last_seen, active "
                "FROM dtc_events ORDER BY active DESC, last_seen DESC LIMIT ?", (limit,)).fetchall()
        keys = ("source_address", "spn", "fmi", "occurrences", "first_seen", "last_seen", "active")
        return [dict(zip(keys, r)) for r in rows]

    def history(self, keys: list[str], since: float, max_points: int = 600) -> dict[str, list]:
        out = {}
        with self._lock:
            for key in keys:
                rows = self._db.execute(
                    "SELECT ts, value FROM samples WHERE key = ? AND ts >= ? ORDER BY ts",
                    (key, since)).fetchall()
                step = max(1, len(rows) // max_points)
                out[key] = [[round(t, 3), round(v, 3)] for t, v in rows[::step]]
        return out

    def export_rows(self, since: float) -> list[tuple[float, str, float]]:
        with self._lock:
            return self._db.execute(
                "SELECT ts, key, value FROM samples WHERE ts >= ? ORDER BY ts, key", (since,)).fetchall()

    def close(self) -> None:
        with self._lock:
            self._db.commit()
            self._db.close()
