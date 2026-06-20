import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function renderHtml(root = resolve(".")) {
  const css = readFileSync(join(root, "src/styles.css"), "utf8");
  const generated = readFileSync(join(root, "src/generated/backendData.js"), "utf8")
    .replace("export const backendData", "const backendData");
  const data = readFileSync(join(root, "src/data.js"), "utf8").replace(/import .*?;\n/g, "").replaceAll("export const", "const");
  const engine = readFileSync(join(root, "src/taskEngine.js"), "utf8").replaceAll("export function", "function");
  const tee = readFileSync(join(root, "src/teeTrust.js"), "utf8").replaceAll("export function", "function");
  const client = readFileSync(join(root, "src/geminiClient.js"), "utf8")
    .replace(/import .*?;\n/g, "")
    .replaceAll("export async function", "async function")
    .replaceAll("export function", "function");
  const main = readFileSync(join(root, "src/main.js"), "utf8")
    .replace(/import .*?;\n/g, "")
    .replaceAll("const app = document.querySelector(\"#app\");", "const app = document.querySelector(\"#app\");");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f7f4ee" />
    <title>TaskPilot AI</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="app"></div>
    <script>
${generated}
${data}
${engine}
${tee}
${client}
${main}
    </script>
  </body>
</html>`;
}
