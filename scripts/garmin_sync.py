#!/usr/bin/env python3
"""Baixa les dades de benestar de Garmin Connect i les envia al Worker de RunTracker (privat).

Corre dins de l'Action de GitHub (.github/workflows/garmin.yml). Els tokens de Garmin viuen al Worker: aquí es
llegeixen, es fan servir (i es renoven sols) i es tornen a desar. La contrasenya de Garmin no hi és enlloc.

IMPORTANT: el repositori és públic i els registres de l'Action també. Aquest script no imprimeix mai dades de
salut ni tokens: només recomptes.

Variables d'entorn: RT_WORKER_URL, GARMIN_PUSH_KEY, i opcionalment DAYS (per defecte 3).
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from garmin_extract import extract_day, extract_lt2hr, extract_weights  # noqa: E402

PAUSE = 0.6  # segons entre crides, per no esgotar el límit de Garmin


def worker(method: str, path: str, body: dict | None = None) -> dict:
    url = os.environ["RT_WORKER_URL"].rstrip("/") + path
    req = urllib.request.Request(
        url, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + os.environ["GARMIN_PUSH_KEY"], "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        # El cos de l'error del Worker no porta secrets; només en mostrem el codi.
        raise SystemExit(f"El Worker ha respost {e.code} a {method} {path}.") from None


def safe(label: str, fn, errors: dict[str, Any]):
    """Una crida a Garmin que pot fallar sense aturar la resta. Es compta, no es mostra el detall."""
    try:
        out = fn()
        time.sleep(PAUSE)
        return out
    except Exception as e:  # noqa: BLE001 — qualsevol error de xarxa o de format és per recompte
        errors[label] = errors.get(label, 0) + 1
        errors.setdefault("_last_" + label, type(e).__name__)  # 0 → només el tipus d'error
        time.sleep(PAUSE)
        return None


def main() -> int:
    from garminconnect import Garmin  # importat aquí perquè els tests d'extracció no el necessiten

    if not os.environ.get("RT_WORKER_URL") or not os.environ.get("GARMIN_PUSH_KEY"):
        # Estat "encara no configurat": no és un error (així l'Action no avisa cada dia abans d'hora). Vegeu worker/README.md.
        print("Garmin encara no està configurat: falten els secrets RT_WORKER_URL i GARMIN_PUSH_KEY al repositori.")
        return 0

    try:
        days_n = max(1, min(int(os.environ.get("DAYS", "3") or 3), 400))
    except ValueError:
        print("DAYS ha de ser un nombre.", file=sys.stderr)
        return 1
    stored = worker("GET", "/garmin/tokens")
    g = Garmin()
    g.login(tokenstore=stored["tokens"])  # tokens com a JSON: no escriu res a disc

    today = date.today()
    days = [(today - timedelta(days=i)).isoformat() for i in range(days_n)]
    errors: dict[str, Any] = {}
    result: dict[str, dict] = {}

    for d in days:
        raw = {
            "sleep": safe("sleep", lambda: g.get_sleep_data(d), errors),
            "hrv": safe("hrv", lambda: g.get_hrv_data(d), errors),
            "rhr": safe("rhr", lambda: g.get_rhr_day(d), errors),
            "stats": safe("stats", lambda: g.get_stats(d), errors),
            "readiness": safe("readiness", lambda: g.get_training_readiness(d), errors),
            "maxmetrics": safe("maxmetrics", lambda: g.get_max_metrics(d), errors),
        }
        vals = extract_day(raw)
        if vals:
            result[d] = vals

    weights = extract_weights(safe("weight", lambda: g.get_weigh_ins(days[-1], days[0]), errors))
    for d, kg in weights.items():
        result.setdefault(d, {})["weight"] = kg
    lt2 = extract_lt2hr(safe("lactate", lambda: g.get_lactate_threshold(latest=True), errors))
    if lt2 and days[0] in result:
        result[days[0]]["lt2hr"] = lt2

    # Els tokens es renoven sols: es tornen a desar sempre que hagin canviat.
    fresh = g.client.dumps()
    if fresh != stored["tokens"]:
        worker("PUT", "/garmin/tokens", {"tokens": fresh})

    # Resum sense dades de salut: quants dies tenen cada camp.
    coverage: dict[str, int] = {}
    for vals in result.values():
        for k in vals:
            coverage[k] = coverage.get(k, 0) + 1
    print(f"Dies demanats: {len(days)} · dies amb dades: {len(result)}")
    print("Camps trobats (dies): " + (", ".join(f"{k}={v}" for k, v in sorted(coverage.items())) or "cap"))
    fails = {k: v for k, v in errors.items() if not k.startswith("_")}
    if fails:
        print("Crides que han fallat: " + ", ".join(f"{k}={v} ({errors.get('_last_' + k)})" for k, v in sorted(fails.items())))

    if not result:
        print("No s'ha pogut llegir cap dada: pot ser que Garmin hagi canviat el format o que els tokens no valguin.", file=sys.stderr)
        return 1
    print("Enviat al Worker:", worker("PUT", "/garmin/wellness", {"days": result}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
