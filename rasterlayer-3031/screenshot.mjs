// Headless screenshots of each case. Starts the Range server itself.
// Usage: node screenshot.mjs            (writes screenshots/*.png, results.json)
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";

const PORT = 8931;
const here = new URL(".", import.meta.url).pathname;
const server = spawn("node", [here + "serve.mjs", String(PORT), here], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 500));

const shots = [
  // stock deck.gl-raster 0.8.1
  ["stock_4326", "case=4326"],
  ["stock_4326_mesh", "case=4326&debug=1&overview=3"],
  ["stock_4326-90-270", "case=4326-90-270"],
  ["stock_3031", "case=3031"],
  ["stock_3031_pole", "case=3031&focus=pole"],
  ["stock_3031_antimeridian", "case=3031&focus=antimeridian"],
  // with the forward error metric patch (src/forward-metric.js)
  ["forward_4326", "case=4326&metric=forward"],
  ["forward_4326_pole", "case=4326&metric=forward&focus=pole"],
  ["forward_4326_antimeridian", "case=4326&metric=forward&focus=antimeridian"],
  ["forward_4326_mesh", "case=4326&metric=forward&debug=1&overview=3"],
  ["forward_4326-90-270", "case=4326-90-270&metric=forward"],
  ["forward_4326-90-270_nowrap", "case=4326-90-270&metric=forward&wrap=0"],
];
const only = process.argv[2];
fs.mkdirSync(here + "screenshots", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const results = {};
for (const [name, qs] of shots) {
  if (only && !name.startsWith(only)) continue;
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`[${name}] ${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => console.log(`[${name}] pageerror: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/index.html?${qs}`);
  await page.waitForSelector("body[data-ready='1']", { timeout: 120000 });
  await page.screenshot({ path: `${here}screenshots/${name}.png` });
  results[name] = await page.evaluate(() => { const r = { ...window.__spike }; r.warnings = r.warnings.length; return r; });
  console.log(name, JSON.stringify(results[name]));
  await page.close();
}
await browser.close();
server.kill();
if (!only) fs.writeFileSync(here + "screenshots/results.json", JSON.stringify(results, null, 2) + "\n");
