import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { renderHtml } from "./render-html.mjs";

const root = resolve(process.argv[2] || ".");
const preferredPort = Number(process.env.PORT || 5173);
const host = "127.0.0.1";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (url.pathname === "/" || url.pathname === "/index.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderHtml(root));
    return;
  }
  const cleanPath = decodeURIComponent(url.pathname).replace(/^\/+/, "").replace(/^app\//, "src/");
  let filePath = join(root, cleanPath || "index.html");
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, "index.html");
  }
  response.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(response);
});

listen(preferredPort);

function listen(port, attempts = 0) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && !process.env.PORT && attempts < 10) {
      const nextPort = port + 1;
      console.log(`Port ${port} is busy. Trying ${nextPort}...`);
      listen(nextPort, attempts + 1);
      return;
    }
    throw error;
  });

  server.listen(port, host, () => {
    console.log(`TaskPilot AI running at http://${host}:${port}`);
  });
}
