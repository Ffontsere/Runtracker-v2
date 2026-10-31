"""Converteix les respostes de Garmin Connect als camps de benestar de RunTracker (vegeu WELLNESS_FIELDS al Worker).

Totes les funcions són tolerants: si Garmin canvia o no envia un camp, simplement no surt (mai trenquen).
No fan cap crida de xarxa ni escriuen res, per poder-se provar amb respostes d'exemple.
"""
from __future__ import annotations

from typing import Any


def dig(obj: Any, *path: Any) -> Any:
    """obj[path[0]][path[1]]... retornant None si falta qualsevol pas (admet claus de diccionari i índexs)."""
    cur = obj
    for p in path:
        try:
            cur = cur[p]
        except (KeyError, IndexError, TypeError):
            return None
    return cur


def num(v: Any) -> float | int | None:
    """Nombre vàlid o None (descarta text, booleans, NaN, infinits i zeros d'un sensor que no ha mesurat)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if v != v or v in (float("inf"), float("-inf")):
        return None
    return v


def positive(v: Any) -> float | int | None:
    n = num(v)
    return n if n is not None and n > 0 else None


def first(lst: Any) -> Any:
    """Primer element d'una llista, o el mateix diccionari si Garmin n'envia un de sol."""
    if isinstance(lst, list):
        return lst[0] if lst else None
    return lst


def extract_day(raw: dict[str, Any]) -> dict[str, Any]:
    """raw = { sleep, hrv, rhr, stats, readiness, maxmetrics } (cada clau pot faltar o ser None)."""
    out: dict[str, Any] = {}

    # FC en repòs: la d'aquell dia; si no, la del resum del dia.
    rhr = positive(dig(raw.get("rhr"), "allMetrics", "metricsMap", "WELLNESS_RESTING_HEART_RATE", 0, "value"))
    if rhr is None:
        rhr = positive(dig(raw.get("stats"), "restingHeartRate"))
    if rhr is not None:
        out["rhr"] = rhr

    # HRV de la nit.
    hs = dig(raw.get("hrv"), "hrvSummary")
    if isinstance(hs, dict):
        for src, dst in (("lastNightAvg", "hrvLast"), ("weeklyAvg", "hrvWeekly")):
            v = positive(hs.get(src))
            if v is not None:
                out[dst] = v
        st = hs.get("status")
        if isinstance(st, str) and st:
            out["hrvStatus"] = st[:40]

    # Son.
    sl = dig(raw.get("sleep"), "dailySleepDTO")
    if isinstance(sl, dict):
        v = positive(sl.get("sleepTimeSeconds"))
        if v is not None:
            out["sleepSec"] = v
        v = positive(dig(sl, "sleepScores", "overall", "value"))
        if v is not None:
            out["sleepScore"] = v

    # Resum del dia: Body Battery, estrès, passos.
    stt = raw.get("stats")
    if isinstance(stt, dict):
        for src, dst in (("bodyBatteryHighestValue", "bbHigh"), ("bodyBatteryLowestValue", "bbLow"),
                         ("bodyBatteryAtWakeTime", "bbWake"), ("averageStressLevel", "stressAvg")):
            v = num(stt.get(src))
            if v is not None and v >= 0:
                out[dst] = v
        v = num(stt.get("totalSteps"))
        if v is not None and v >= 0:
            out["steps"] = v

    # Disposició per entrenar.
    r = first(raw.get("readiness"))
    if isinstance(r, dict):
        v = positive(r.get("score"))
        if v is not None:
            out["readiness"] = v
        lv = r.get("level")
        if isinstance(lv, str) and lv:
            out["readinessLevel"] = lv[:40]

    # VO2max (Garmin el dona en llista o en diccionari segons el rellotge).
    mm = first(raw.get("maxmetrics"))
    v = positive(dig(mm, "generic", "vo2MaxPreciseValue")) or positive(dig(mm, "generic", "vo2MaxValue"))
    if v is not None:
        out["vo2max"] = v
    return out


def extract_weights(weigh_ins: Any) -> dict[str, float]:
    """{ 'AAAA-MM-DD': kg } a partir de get_weigh_ins (Garmin dona el pes en grams)."""
    out: dict[str, float] = {}
    for d in dig(weigh_ins, "dailyWeightSummaries") or []:
        day = d.get("summaryDate") if isinstance(d, dict) else None
        grams = positive(dig(d, "latestWeight", "weight"))
        if isinstance(day, str) and len(day) == 10 and grams is not None and 20000 < grams < 300000:
            out[day] = round(grams / 1000, 2)
    return out


def extract_lt2hr(lactate: Any) -> int | None:
    """FC del llindar de lactat (la més recent), si el rellotge la dona."""
    v = positive(dig(lactate, "speed_and_heart_rate", "heartRate"))
    if v is None:
        v = positive(dig(lactate, "heartRate"))
    return int(v) if v is not None and 80 < v < 230 else None
