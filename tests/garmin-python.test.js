// Les peces de Python de Garmin (scripts/) es proven aquí perquè `npm test` ho cobreixi tot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WELLNESS_FIELDS } from "../worker/src/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const py = spawnSync("python3", ["--version"], { encoding: "utf8" });
const skip = py.status !== 0 && "python3 no és instal·lat";

test("Python: extracció de Garmin i garmin_sync de punta a punta", { skip }, () => {
  const r = spawnSync("python3", ["-m", "unittest", "discover", "-s", "tests", "-p", "garmin_*_test.py"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("Python i Worker parlen dels mateixos camps de benestar", { skip }, () => {
  const code = `
import sys, json; sys.path.insert(0, "scripts")
sys.path.insert(0, "tests")
from garmin_extract_test import FULL
from garmin_extract import extract_day
print(json.dumps(sorted(set(extract_day(FULL)) | {"weight", "lt2hr"})))`;
  const r = spawnSync("python3", ["-c", code], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const fields = JSON.parse(r.stdout);
  for (const f of fields) assert.ok(f in WELLNESS_FIELDS, `el Worker descartaria el camp «${f}»`);
  for (const f of Object.keys(WELLNESS_FIELDS)) assert.ok(fields.includes(f), `cap script no produeix «${f}»`);
});
