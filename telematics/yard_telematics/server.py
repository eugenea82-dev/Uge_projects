"""Minimal HTTP API + dashboard host (standard library only, so it runs on a
small Linux gateway without internet access).

GET /                     dashboard
GET /api/snapshot         latest values, machine state, KPIs, alerts, DTCs, bus stats
GET /api/history?keys=a,b&minutes=15
GET /api/pgns             bus discovery inventory
GET /api/dtc-history      DTC events (active + cleared)
GET /api/alerts           alert raise/clear log
GET /api/stream           Server-Sent Events: snapshot every second
GET /api/export.csv?minutes=60
"""

from __future__ import annotations

import csv
import io
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .gateway import Gateway

STATIC = Path(__file__).parent / "static"


def make_handler(gw: Gateway):
    class Handler(BaseHTTPRequestHandler):
        server_version = "YardTelematics/0.1"

        def log_message(self, fmt, *args):  # keep the console for gateway output
            pass

        def _send(self, body: bytes, ctype: str, status: int = 200, extra: dict | None = None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, status: int = 200):
            self._send(json.dumps(obj).encode(), "application/json", status)

        def do_GET(self):
            url = urlparse(self.path)
            q = parse_qs(url.query)
            minutes = float(q.get("minutes", ["15"])[0])
            if url.path in ("/", "/index.html"):
                self._send((STATIC / "index.html").read_bytes(), "text/html; charset=utf-8")
            elif url.path == "/api/snapshot":
                self._json(gw.snapshot())
            elif url.path == "/api/history":
                keys = [k for k in q.get("keys", [""])[0].split(",") if k in gw.catalog.specs]
                since = gw.now() - minutes * 60
                self._json({"now": gw.now(), "series": gw.store.history(keys, since)})
            elif url.path == "/api/pgns":
                self._json(gw.pgn_inventory())
            elif url.path == "/api/dtc-history":
                rows = gw.store.dtc_events()
                for r in rows:
                    r["spn_name"] = gw.spn_name(r["spn"])
                self._json(rows)
            elif url.path == "/api/alerts":
                self._json(gw.alert_log())
            elif url.path == "/api/export.csv":
                buf = io.StringIO()
                w = csv.writer(buf)
                w.writerow(["timestamp_utc", "signal", "value", "unit"])
                for ts, key, value in gw.store.export_rows(gw.now() - minutes * 60):
                    w.writerow([time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts)), key, value,
                                gw.catalog.specs[key].unit if key in gw.catalog.specs else ""])
                self._send(buf.getvalue().encode(), "text/csv",
                           extra={"Content-Disposition": f'attachment; filename="{gw.vehicle_id}.csv"'})
            elif url.path == "/api/stream":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                try:
                    while True:
                        self.wfile.write(b"data: " + json.dumps(gw.snapshot()).encode() + b"\n\n")
                        self.wfile.flush()
                        time.sleep(1.0)
                except (BrokenPipeError, ConnectionResetError):
                    return
            else:
                self._json({"error": "not found"}, 404)

    return Handler


def serve(gw: Gateway, host: str, port: int) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer((host, port), make_handler(gw))
    httpd.daemon_threads = True
    return httpd
