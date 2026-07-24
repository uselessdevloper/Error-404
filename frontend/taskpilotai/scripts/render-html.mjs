import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(__dirname, "..");

// Strip only top-level ES import statements (lines starting with "import ")
// The greedy regex /import .*?;\n/g incorrectly matches @import url() inside CSS strings
function stripImports(src) {
  return src
    .split("\n")
    .filter(line => !line.match(/^import\s+/))
    .join("\n");
}

export function renderHtml(root = defaultRoot) {
  const css = readFileSync(join(root, "src/styles.css"), "utf8");
  const generated = readFileSync(join(root, "src/generated/backendData.js"), "utf8")
    .replace("export const backendData", "const backendData");
  const data = stripImports(readFileSync(join(root, "src/data.js"), "utf8"))
    .replaceAll("export const", "const");
  const engine = readFileSync(join(root, "src/taskEngine.js"), "utf8")
    .replaceAll("export function", "function");
  const tee = readFileSync(join(root, "src/teeTrust.js"), "utf8")
    .replaceAll("export function", "function");
  const client = stripImports(readFileSync(join(root, "src/geminiClient.js"), "utf8"))
    .replaceAll("export async function", "async function")
    .replaceAll("export function", "function");
  const supabase = stripImports(readFileSync(join(root, "src/supabaseClient.js"), "utf8"))
    .replaceAll("export async function", "async function")
    .replaceAll("export function", "function");
  const main = stripImports(readFileSync(join(root, "src/main.js"), "utf8"));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#f7f4ee" />
    <title>TaskPilot AI</title>
    <script>
      (function() {
        const theme = localStorage.getItem("taskpilot:theme") || "light";
        document.documentElement.setAttribute("data-theme", theme);
      })();
    </script>
    <style>${css}</style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  </head>
  <body>
    <div id="app"></div>
    <script>
      window.jsPDF = window.jspdf?.jsPDF || window.jsPDF;
${[generated, data, engine, tee, supabase, client, main]
  .join("\n")
  // Prevent the HTML parser from seeing </script> inside string/template literals
  .replace(/<\/script>/gi, "<\\/script>")}
    </script>
  </body>
</html>`;
}