import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const htmlPath = resolve("dist/index.html");
const html = readFileSync(htmlPath, "utf8");

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
const js = scriptMatch[1];
const lines = js.split("\n");

console.log("Line 15270 to 15290:");
for (let i = 15265; i < 15295; i++) {
  console.log(`${i + 1}: ${lines[i]}`);
}