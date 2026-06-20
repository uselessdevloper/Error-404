import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderHtml } from "./render-html.mjs";
import "./sync-datasets.mjs";

const root = resolve(".");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "index.html"), renderHtml(root));
cpSync(join(root, "src"), join(dist, "app"), { recursive: true });
cpSync(join(root, "public"), join(dist, "public"), { recursive: true });
console.log("Built static TaskPilot AI app into dist/");
