// Inlines the engine modules into the single-file prototype (artifacts must be one file).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const root = new URL("..", import.meta.url).pathname;
const engine = ["js/engine/strength.js", "js/engine/body.js"]
  .map(f => `// ── ${f} ──\n` + readFileSync(root + f, "utf8").replace(/^export\s+/gm, ""))
  .join("\n");
const src = readFileSync(root + "prototype/app.src.html", "utf8");
if (!src.includes("/*ENGINE*/")) throw new Error("Falta el marcador /*ENGINE*/");
mkdirSync(root + "dist", { recursive: true });
writeFileSync(root + "dist/forca-cos.html", src.replace("/*ENGINE*/", () => engine));
console.log("dist/forca-cos.html", (readFileSync(root + "dist/forca-cos.html").length / 1024).toFixed(1), "KB");
