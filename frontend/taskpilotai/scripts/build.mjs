import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHtml } from "./render-html.mjs";
import "./sync-datasets.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = join(root, "dist");
try {
  if (existsSync(dist)) {
    rmSync(dist, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
} catch (e) {
  // ignore ENOTEMPTY if folder is being locked by serve script
}
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "index.html"), renderHtml(root));
cpSync(join(root, "src"), join(dist, "app"), { recursive: true });
if (existsSync(join(root, "public"))) {
  cpSync(join(root, "public"), join(dist, "public"), { recursive: true });
}
console.log("Built static TaskPilot AI app into dist/");
