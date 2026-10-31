import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from garmin_extract import dig, extract_day, extract_lt2hr, extract_weights, num  # noqa: E402

FULL = {
    "rhr": {"allMetrics": {"metricsMap": {"WELLNESS_RESTING_HEART_RATE": [{"value": 46.0, "calendarDate": "2026-10-30"}]}}},
    "hrv": {"hrvSummary": {"weeklyAvg": 55, "lastNightAvg": 62, "status": "BALANCED"}},
    "sleep": {"dailySleepDTO": {"sleepTimeSeconds": 27000, "sleepScores": {"overall": {"value": 81}}}},
    "stats": {"restingHeartRate": 48, "bodyBatteryHighestValue": 95, "bodyBatteryLowestValue": 14,
              "bodyBatteryAtWakeTime": 88, "averageStressLevel": 27, "totalSteps": 9012},
    "readiness": [{"score": 72, "level": "MODERATE"}],
    "maxmetrics": [{"generic": {"vo2MaxPreciseValue": 52.4, "vo2MaxValue": 52}}],
}


class Extract(unittest.TestCase):
    def test_full_day(self):
        self.assertEqual(extract_day(FULL), {
            "rhr": 46.0, "hrvLast": 62, "hrvWeekly": 55, "hrvStatus": "BALANCED", "sleepSec": 27000, "sleepScore": 81,
            "bbHigh": 95, "bbLow": 14, "bbWake": 88, "stressAvg": 27, "steps": 9012,
            "readiness": 72, "readinessLevel": "MODERATE", "vo2max": 52.4})

    def test_missing_everything_never_raises(self):
        self.assertEqual(extract_day({}), {})
        self.assertEqual(extract_day({k: None for k in FULL}), {})
        self.assertEqual(extract_day({"hrv": {"hrvSummary": None}, "sleep": {"dailySleepDTO": None}, "readiness": []}), {})

    def test_rhr_falls_back_to_daily_summary(self):
        d = dict(FULL, rhr=None)
        self.assertEqual(extract_day(d)["rhr"], 48)

    def test_garbage_values_are_dropped(self):
        d = extract_day({"stats": {"restingHeartRate": "46", "totalSteps": True, "bodyBatteryHighestValue": float("nan")},
                         "sleep": {"dailySleepDTO": {"sleepTimeSeconds": 0}}})
        self.assertEqual(d, {})

    def test_readiness_as_single_dict_and_vo2_as_dict(self):
        d = extract_day({"readiness": {"score": 40, "level": "LOW"}, "maxmetrics": {"generic": {"vo2MaxValue": 50}}})
        self.assertEqual(d, {"readiness": 40, "readinessLevel": "LOW", "vo2max": 50})

    def test_weights_grams_to_kg(self):
        w = extract_weights({"dailyWeightSummaries": [
            {"summaryDate": "2026-10-30", "latestWeight": {"weight": 70234.0}},
            {"summaryDate": "2026-10-29", "latestWeight": {"weight": 70.2}},       # ja en kg: es descarta, no s'inventa
            {"summaryDate": "2026-10-28", "latestWeight": None}]})
        self.assertEqual(w, {"2026-10-30": 70.23})
        self.assertEqual(extract_weights(None), {})

    def test_lt2(self):
        self.assertEqual(extract_lt2hr({"speed_and_heart_rate": {"heartRate": 163}}), 163)
        self.assertIsNone(extract_lt2hr({"speed_and_heart_rate": {"heartRate": 12}}))
        self.assertIsNone(extract_lt2hr(None))

    def test_helpers(self):
        self.assertIsNone(dig({"a": [1]}, "a", 3))
        self.assertIsNone(num("3"))
        self.assertEqual(dig({"a": [{"b": 2}]}, "a", 0, "b"), 2)


if __name__ == "__main__":
    unittest.main()
