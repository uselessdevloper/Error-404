import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const htmlPath = resolve("dist/index.html");
const html = readFileSync(htmlPath, "utf8");

// Extract the script tag content
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error("No script tag found!");
  process.exit(1);
}

const js = scriptMatch[1];

try {
  console.log("Checking syntax of bundled JavaScript...");
  new vm.Script(js);
  console.log("Syntax check passed! No syntax errors.");
} catch (err) {
  console.error("Syntax Error found:");
  console.error(err.stack);
  process.exit(1);
}
