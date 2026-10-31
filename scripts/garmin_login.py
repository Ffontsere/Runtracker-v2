#!/usr/bin/env python3
"""Inicia sessió a Garmin una sola vegada (amb el codi de verificació, si el tens activat) i deixa els tokens al Worker.

Cal Python 3.12 o superior:
    python3 -m venv .venv && source .venv/bin/activate        (a Windows: .venv\\Scripts\\activate)
    pip install "garminconnect==0.3.20" curl_cffi
    python scripts/garmin_login.py

La contrasenya de Garmin només es fa servir en aquesta execució: no es desa a cap fitxer ni al Worker ni a GitHub.
Al Worker només hi queden els tokens (que Garmin pot revocar quan vulguis des del teu compte).
"""
from __future__ import annotations

import getpass
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
WORKER_TOML = HERE / "worker" / "wrangler.toml"


def default_worker_url() -> str:
    return os.environ.get("RT_WORKER_URL", "").strip()


def default_push_key() -> str:
    env = os.environ.get("GARMIN_PUSH_KEY", "").strip()
    if env:
        return env
    f = HERE / "worker" / ".garmin-push-key"
    return f.read_text().strip() if f.exists() else ""


def main() -> int:
    from garminconnect import Garmin

    url = default_worker_url() or input("Adreça del Worker (https://ff-runtracker.xxxx.workers.dev): ").strip()
    key = default_push_key() or getpass.getpass("Clau de l'Action (worker/.garmin-push-key): ").strip()
    if not url.startswith("https://") or not key:
        print("Falten l'adreça del Worker o la clau de l'Action.", file=sys.stderr)
        return 1

    email = input("Correu de Garmin: ").strip()
    password = getpass.getpass("Contrasenya de Garmin (no es veurà ni es desarà): ")
    g = Garmin(email, password, prompt_mfa=lambda: input("Codi de verificació de Garmin: ").strip())
    g.login()
    tokens = g.client.dumps()
    del password

    req = urllib.request.Request(
        url.rstrip("/") + "/garmin/tokens", method="PUT", data=json.dumps({"tokens": tokens}).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
    except urllib.error.HTTPError as e:
        print(f"El Worker ha respost {e.code}. Comprova l'adreça i la clau de l'Action.", file=sys.stderr)
        return 1
    print("Fet: els tokens de Garmin són al Worker. Ja pots executar l'Action «Garmin sync» a GitHub.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
