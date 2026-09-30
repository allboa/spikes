// Serve this folder's parent, open index.html in headless Chromium, print what
// the browser saw in the Arrow schema, and save screenshot.png (light and dark).
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".arrows": "application/vnd.apache.arrow.stream" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const executablePath = process.env.CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let failed = false;
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, colorScheme: scheme });
  page.on("console", (m) => console.log("[console]", m.text()));
  await page.goto(`http://127.0.0.1:${port}/web/index.html`);
  await page.waitForFunction(() => window.__spike && (window.__spike.rendered || window.__spike.error), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const report = await page.evaluate(() => window.__spike);
  console.log(scheme, JSON.stringify(report));
  if (report.error || report.extension !== "geoarrow.linestring" || !report.vertexIsFixedSizeList2) failed = true;
  await page.screenshot({ path: path.join(root, scheme === "light" ? "screenshot.png" : "screenshot-dark.png") });
  await page.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
