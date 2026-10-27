import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

from yard_telematics.gateway import Gateway
from yard_telematics.j1939 import (PGN_DM1, PGN_TP_CM, PGN_TP_DT, Dtc, TransportReassembler, build_can_id,
                                   decode_dm1, encode_dm1, parse_can_id, split_bam)
from yard_telematics.server import serve
from yard_telematics.signals import SignalCatalog
from yard_telematics.simulator import YardTractorSimulator
from yard_telematics.sources import CandumpReplaySource, CandumpWriter, Frame
from yard_telematics.store import Store

ROOT = Path(__file__).resolve().parent.parent
OEM = ROOT / "config" / "oem_signals.example.json"


class CanIdTests(unittest.TestCase):
    def test_pdu2_eec1(self):
        cid = parse_can_id(0x0CF00400)
        self.assertEqual((cid.priority, cid.pgn, cid.source_address, cid.destination_address), (3, 0xF004, 0x00, 0xFF))

    def test_pdu1_request_has_destination(self):
        cid = parse_can_id(0x18EA00F9)
        self.assertEqual((cid.pgn, cid.destination_address, cid.source_address), (0xEA00, 0x00, 0xF9))

    def test_build_roundtrip(self):
        for pgn, sa in [(0xFEF1, 0x00), (0xEC00, 0x3D), (0xFF10, 0x21)]:
            cid = parse_can_id(build_can_id(pgn, sa))
            self.assertEqual((cid.pgn, cid.source_address), (pgn, sa))


class DecodeTests(unittest.TestCase):
    cat = SignalCatalog.build([OEM])

    def test_eec1_known_bytes(self):
        # torque 0x7D -> 0 %, engine speed 0x1F40 * 0.125 = 1000 rpm
        out = self.cat.decode(0xF004, 0x00, bytes.fromhex("F07D7D401FFFFFFF"))
        self.assertEqual(out["engine_speed"], 1000.0)
        self.assertEqual(out["engine_torque"], 0.0)

    def test_et1_and_not_available(self):
        out = self.cat.decode(0xFEEE, 0x00, bytes.fromhex("7AFFFFFFFFFFFFFF"))
        self.assertEqual(out["coolant_temp"], 82)
        self.assertNotIn("engine_oil_temp", out)  # 0xFFFF = not available

    def test_vehicle_speed_and_two_bit_states(self):
        payload = bytearray(b"\xFF" * 8)
        self.cat.specs["vehicle_speed"].encode(18.5, payload)
        self.cat.specs["parking_brake"].encode(1, payload)
        out = self.cat.decode(0xFEF1, 0x00, bytes(payload))
        self.assertAlmostEqual(out["vehicle_speed"], 18.5, places=2)
        self.assertEqual(out["parking_brake"], 1)

    def test_oem_signal_filtered_by_source_address(self):
        payload = bytearray(b"\xFF" * 8)
        self.cat.specs["fifth_wheel_height"].encode(1450, payload)
        self.assertEqual(self.cat.decode(0xFF10, 0x21, bytes(payload))["fifth_wheel_height"], 1450)
        self.assertEqual(self.cat.decode(0xFF10, 0x05, bytes(payload)), {})


class Dm1Tests(unittest.TestCase):
    def test_single_dtc_known_bytes(self):
        dm1 = decode_dm1(0, bytes.fromhex("04FF6E001003FFFF"))
        self.assertEqual(dm1.amber_warning_lamp, "on")
        self.assertEqual(dm1.dtcs, (Dtc(110, 16, 3),))

    def test_no_dtc(self):
        self.assertEqual(decode_dm1(0, encode_dm1([])).dtcs, ())

    def test_high_spn_bits(self):
        payload = encode_dm1([Dtc(520192, 31, 1)])  # max 19-bit SPN range
        self.assertEqual(decode_dm1(0, payload).dtcs[0].spn, 520192)

    def test_bam_reassembly(self):
        dtcs = [Dtc(168, 18, 1), Dtc(3251, 0, 2), Dtc(110, 16, 4)]
        payload = encode_dm1(dtcs, amber=True)
        announce, chunks = split_bam(PGN_DM1, payload)
        tp = TransportReassembler()
        self.assertIsNone(tp.feed(parse_can_id(build_can_id(PGN_TP_CM, 0)), announce, 0.0))
        result = None
        for i, c in enumerate(chunks):
            result = tp.feed(parse_can_id(build_can_id(PGN_TP_DT, 0)), c, 0.05 * (i + 1))
        pgn, sa, data = result
        self.assertEqual((pgn, sa), (PGN_DM1, 0))
        self.assertEqual(decode_dm1(sa, data).dtcs, tuple(dtcs))


def run_sim(minutes: float, db: str, faults: bool = True) -> Gateway:
    cat = SignalCatalog.build([OEM])
    sim = YardTractorSimulator(cat, speed=0, faults=faults, start_ts=1_700_000_000.0)
    gw = Gateway(sim, cat, Store(db), time_scale=0)
    last_tick = None
    for frame in sim.frames():
        gw.process(frame)
        if last_tick is None or frame.ts - last_tick >= 1.0:
            gw.tick()
            last_tick = frame.ts
        if frame.ts - 1_700_000_000.0 > minutes * 60:
            break
    gw.tick()
    return gw


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.tmp.name) / "t.db")

    def tearDown(self):
        self.tmp.cleanup()

    def test_simulated_shift_end_to_end(self):
        gw = run_sim(19, self.db)
        snap = gw.snapshot()
        s = snap["signals"]
        self.assertIn(snap["state"], ("idle", "working"))
        self.assertTrue(500 < s["engine_speed"]["value"] < 2000)
        self.assertGreater(s["coolant_temp"]["value"], 100)  # overheat episode injected from minute 12
        self.assertTrue(any(d["spn"] == 110 and d["fmi"] == 16 for d in snap["dtcs"]))
        self.assertTrue(any(a["id"] == "coolant_critical" for a in snap["alerts"]))
        k = snap["kpis"]
        self.assertGreater(k["fuel_used_l"], 0.5)
        self.assertGreater(k["trailer_lifts"], 0)
        self.assertGreater(sum(k["state_seconds"].values()), 15 * 60)
        hist = gw.store.history(["engine_speed"], 0)
        self.assertGreater(len(hist["engine_speed"]), 100)
        self.assertTrue(all(p["decoded"] for p in gw.pgn_inventory()))

    def test_bam_dm1_and_clear(self):
        gw = run_sim(29, self.db)
        codes = {(d["spn"], d["fmi"]) for d in gw.snapshot()["dtcs"]}
        self.assertEqual(codes, {(168, 18), (3251, 0)})  # 2 DTCs -> multi-packet BAM
        hist = gw.store.dtc_events()
        self.assertTrue(any(r["spn"] == 110 and not r["active"] for r in hist))  # overheat cleared

    def test_engine_off_detected_when_bus_silent(self):
        cat = SignalCatalog.build()
        gw = Gateway(iter(()), cat, Store(self.db), time_scale=1)
        gw.process(Frame(1000.0, build_can_id(0xF004, 0, 3), bytes.fromhex("F07D7D401FFFFFFF")))
        gw.tick()
        self.assertEqual(gw.tracker.state, "idle")
        gw._last_frame_mono -= 30  # 30 s of wall time pass with no frames
        gw.tick()
        self.assertEqual(gw.tracker.state, "off")


class ReplayAndServerTests(unittest.TestCase):
    def test_candump_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "x.candump"
            frames = [Frame(10.0 + i, build_can_id(0xFEEE, 0), bytes([0x7A] + [0xFF] * 7)) for i in range(3)]
            w = CandumpWriter(path)
            for f in frames:
                w.write(f)
            w.close()
            got = list(CandumpReplaySource(path, speed=0).frames())
            self.assertEqual([(f.arbitration_id, f.data) for f in got], [(f.arbitration_id, f.data) for f in frames])
            self.assertAlmostEqual(got[2].ts - got[0].ts, 2.0, places=5)

    def test_http_api(self):
        with tempfile.TemporaryDirectory() as d:
            gw = run_sim(2, str(Path(d) / "t.db"), faults=False)
            httpd = serve(gw, "127.0.0.1", 0)
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            base = f"http://127.0.0.1:{httpd.server_address[1]}"
            try:
                snap = json.load(urllib.request.urlopen(base + "/api/snapshot"))
                self.assertEqual(snap["vehicle_id"], "YT-01")
                hist = json.load(urllib.request.urlopen(base + "/api/history?keys=engine_speed,bogus&minutes=5"))
                self.assertEqual(list(hist["series"]), ["engine_speed"])
                self.assertIn(b"<title>Yard Tractor Telematics</title>", urllib.request.urlopen(base + "/").read())
                csv_text = urllib.request.urlopen(base + "/api/export.csv?minutes=5").read().decode()
                self.assertTrue(csv_text.startswith("timestamp_utc,signal,value,unit"))
                pgns = json.load(urllib.request.urlopen(base + "/api/pgns"))
                self.assertTrue(any(p["pgn"] == 0xF004 and p["rate_hz"] for p in pgns))
            finally:
                httpd.shutdown()


if __name__ == "__main__":
    unittest.main()
