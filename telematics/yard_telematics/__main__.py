"""Command line entry point.

  python -m yard_telematics                                   # simulator demo
  python -m yard_telematics --source socketcan:can0           # live truck (listen-only)
  python -m yard_telematics --source pcan:PCAN_USBBUS1 --bitrate 250000
  python -m yard_telematics --source replay:samples/shift.candump --speed 5
"""

from __future__ import annotations

import argparse
import threading
import time
from pathlib import Path

from .gateway import Gateway
from .j1939 import PGN_REQUEST, build_can_id, request_payload
from .server import serve
from .signals import SignalCatalog
from .simulator import YardTractorSimulator
from .sources import CandumpReplaySource, CandumpWriter, PythonCanSource

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE_OEM = ROOT / "config" / "oem_signals.example.json"
SA_OFFBOARD_DIAG = 0xF9
ON_REQUEST_PGNS = (0xFEE5, 0xFEE9)  # engine hours, total fuel: often only sent when requested


def build_source(spec: str, catalog: SignalCatalog, args):
    kind, _, target = spec.partition(":")
    if kind == "sim":
        return YardTractorSimulator(catalog, speed=args.speed, faults=not args.no_faults), args.speed
    if kind == "replay":
        return CandumpReplaySource(target, speed=args.speed, loop=args.loop), max(args.speed, 1e-9)
    if not target:
        raise SystemExit(f"--source {spec!r}: expected <interface>:<channel>, e.g. socketcan:can0")
    return PythonCanSource(kind, target, args.bitrate, allow_transmit=args.allow_transmit), 1.0


def request_loop(source: PythonCanSource, interval_s: float) -> None:
    """Periodically ask ECUs for on-request PGNs (only with --allow-transmit)."""
    while True:
        for pgn in ON_REQUEST_PGNS:
            source.send(build_can_id(PGN_REQUEST, SA_OFFBOARD_DIAG, 6), request_payload(pgn))
            time.sleep(0.05)
        time.sleep(interval_s)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="yard_telematics", description="Yard tractor J1939 telematics gateway")
    p.add_argument("--source", default="sim",
                   help="sim | replay:<file> | <python-can interface>:<channel> (socketcan:can0, "
                        "pcan:PCAN_USBBUS1, kvaser:0, slcan:/dev/ttyACM0)")
    p.add_argument("--bitrate", type=int, default=250_000, help="250000 (J1939) or 500000 (J1939-14)")
    p.add_argument("--speed", type=float, default=1.0, help="sim/replay time multiplier (0 = as fast as possible)")
    p.add_argument("--loop", action="store_true", help="loop the replay file")
    p.add_argument("--no-faults", action="store_true", help="simulator: disable fault injection")
    p.add_argument("--oem", action="append", default=None,
                   help="OEM proprietary signal JSON (repeatable). The simulator loads the example by default.")
    p.add_argument("--db", default="telematics.db", help="SQLite file for history")
    p.add_argument("--record", help="also write raw frames to this candump file")
    p.add_argument("--vehicle-id", default="YT-01")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--allow-transmit", action="store_true",
                   help="permit sending PGN requests (engine hours / total fuel). Off = strictly passive.")
    p.add_argument("--request-interval", type=float, default=60.0)
    args = p.parse_args(argv)

    oem = args.oem if args.oem is not None else ([EXAMPLE_OEM] if args.source == "sim" else [])
    catalog = SignalCatalog.build(oem)
    source, time_scale = build_source(args.source, catalog, args)

    from .store import Store
    gw = Gateway(source, catalog, Store(args.db), vehicle_id=args.vehicle_id, time_scale=time_scale,
                 recorder=CandumpWriter(args.record) if args.record else None)
    if args.allow_transmit and isinstance(source, PythonCanSource):
        threading.Thread(target=request_loop, args=(source, args.request_interval), daemon=True).start()

    httpd = serve(gw, args.host, args.port)
    threading.Thread(target=httpd.serve_forever, daemon=True, name="http").start()
    print(f"[yard-telematics] source: {source.description}")
    print(f"[yard-telematics] signals: {len(catalog.specs)} ({len(oem)} OEM file(s))  db: {args.db}")
    print(f"[yard-telematics] dashboard: http://{args.host}:{args.port}/")
    try:
        gw.run()
        print("[yard-telematics] source finished; dashboard stays up (Ctrl+C to exit)")
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        gw.stop()
        gw.tick()
        httpd.shutdown()
        gw.store.close()


if __name__ == "__main__":
    main()
