"""garmin_sync.main() de punta a punta amb un Garmin i un Worker de mentida."""
import contextlib
import io
import os
import sys
import types
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import garmin_sync  # noqa: E402

SECRET_SLEEP = 27123  # un valor que no ha d'aparèixer mai als registres


class FakeClient:
    def __init__(self):
        self.tokens = '{"di_token":"vell","di_refresh_token":"r","di_client_id":"c"}'

    def dumps(self):
        return self.tokens


class FakeGarmin:
    instances = []
    fail_all = False

    def __init__(self, *a, **k):
        self.client = FakeClient()
        FakeGarmin.instances.append(self)

    def login(self, tokenstore=None):
        self.seen = tokenstore
        self.client.tokens = '{"di_token":"nou","di_refresh_token":"r2","di_client_id":"c"}'  # s'ha renovat

    def _maybe(self, v):
        if FakeGarmin.fail_all:
            raise RuntimeError("Garmin ha canviat el format amb dades privades 12345")
        return v

    def get_sleep_data(self, d): return self._maybe({"dailySleepDTO": {"sleepTimeSeconds": SECRET_SLEEP, "sleepScores": {"overall": {"value": 80}}}})
    def get_hrv_data(self, d): return self._maybe({"hrvSummary": {"lastNightAvg": 61, "status": "BALANCED"}})
    def get_rhr_day(self, d): return self._maybe(None)
    def get_stats(self, d): return self._maybe({"restingHeartRate": 47, "bodyBatteryHighestValue": 90})
    def get_training_readiness(self, d): return self._maybe([{"score": 70, "level": "MODERATE"}])
    def get_max_metrics(self, d): return self._maybe([{"generic": {"vo2MaxValue": 52}}])
    def get_weigh_ins(self, a, b): return self._maybe({"dailyWeightSummaries": [{"summaryDate": b, "latestWeight": {"weight": 70100}}]})
    def get_lactate_threshold(self, latest=True): return self._maybe({"speed_and_heart_rate": {"heartRate": 164}})


class SyncMain(unittest.TestCase):
    def setUp(self):
        FakeGarmin.instances = []
        FakeGarmin.fail_all = False
        self.calls = []
        mod = types.ModuleType("garminconnect")
        mod.Garmin = FakeGarmin
        sys.modules["garminconnect"] = mod
        garmin_sync.PAUSE = 0
        self.stored = '{"di_token":"vell","di_refresh_token":"r","di_client_id":"c"}'

        def fake_worker(method, path, body=None):
            self.calls.append((method, path, body))
            if (method, path) == ("GET", "/garmin/tokens"):
                return {"tokens": self.stored, "updatedAt": 1}
            return {"ok": True}
        garmin_sync.worker = fake_worker
        os.environ["DAYS"] = "2"
        os.environ["RT_WORKER_URL"] = "https://w.example"
        os.environ["GARMIN_PUSH_KEY"] = "k" * 64

    def run_main(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = garmin_sync.main()
        return code, out.getvalue() + err.getvalue()

    def test_happy_path(self):
        code, log = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(FakeGarmin.instances[0].seen, self.stored, "fa servir els tokens del Worker com a JSON")
        puts = {p: b for m, p, b in self.calls if m == "PUT"}
        self.assertIn("nou", puts["/garmin/tokens"]["tokens"], "desa els tokens renovats")
        days = puts["/garmin/wellness"]["days"]
        self.assertEqual(len(days), 2)
        today = max(days)
        self.assertEqual(days[today]["sleepSec"], SECRET_SLEEP)
        self.assertEqual(days[today]["rhr"], 47, "FC en repòs del resum quan el detall no hi és")
        self.assertEqual(days[today]["lt2hr"], 164)
        self.assertEqual(days[today]["weight"], 70.1)
        self.assertNotIn(str(SECRET_SLEEP), log, "els registres (públics) no porten dades de salut")
        self.assertNotIn("nou", log)
        self.assertIn("dies amb dades: 2", log)

    def test_not_configured_is_not_an_error(self):
        del os.environ["GARMIN_PUSH_KEY"]
        code, log = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn("encara no està configurat", log)
        self.assertEqual(self.calls, [])

    def test_bad_days_value(self):
        os.environ["DAYS"] = "molts"
        code, _ = self.run_main()
        self.assertEqual(code, 1)

    def test_unchanged_tokens_are_not_written_back(self):
        self.stored = '{"di_token":"nou","di_refresh_token":"r2","di_client_id":"c"}'
        self.run_main()
        self.assertFalse([c for c in self.calls if c[:2] == ("PUT", "/garmin/tokens")])

    def test_format_change_fails_loudly_without_leaking(self):
        FakeGarmin.fail_all = True
        code, log = self.run_main()
        self.assertEqual(code, 1)
        self.assertNotIn("12345", log, "no s'hi copia el text de l'error de Garmin")
        self.assertIn("RuntimeError", log)
        self.assertFalse([c for c in self.calls if c[:2] == ("PUT", "/garmin/wellness")])


if __name__ == "__main__":
    unittest.main()
