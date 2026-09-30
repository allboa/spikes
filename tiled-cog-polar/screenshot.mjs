// Headless screenshots of both approaches. Starts server.py itself.
// Usage: node screenshot.mjs [name-prefix]   (writes screenshots/*.png, results.json)
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";

const PORT = 8941;
const here = new URL(".", import.meta.url).pathname;
const py = process.env.PYTHON || "python3";
const server = spawn(py, [here + "server.py", String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));

const shots = [
  // (a) R-planned tiles
  ["a_3031_far", "planned.html?cog=polar_3031&view=far&outlines=1"],
  ["a_3031_all", "planned.html?cog=polar_3031&view=all&outlines=1"],
  ["a_3031_coast", "planned.html?cog=polar_3031&view=coast&outlines=1"],
  ["a_3031_pole", "planned.html?cog=polar_3031&view=pole&outlines=1"],
  ["a_3031_all_clean", "planned.html?cog=polar_3031&view=all"],
  ["a_4326_far", "planned.html?cog=polar_4326&view=far&outlines=1"],
  ["a_4326_all", "planned.html?cog=polar_4326&view=all&outlines=1"],
  ["a_4326_pole", "planned.html?cog=polar_4326&view=pole&outlines=1"],
  ["a_4326_antimeridian", "planned.html?cog=polar_4326&view=antimeridian&outlines=1"],
  // (b) browser-side traversal prototype
  ["b_3031_far", "traversal.html?cog=polar_3031&view=far&outlines=1"],
  ["b_3031_all", "traversal.html?cog=polar_3031&view=all&outlines=1"],
  ["b_3031_pole", "traversal.html?cog=polar_3031&view=pole&outlines=1"],
  ["b_4326_all_stock", "traversal.html?cog=polar_4326&view=all&outlines=1"],
  ["b_4326_all_forward", "traversal.html?cog=polar_4326&view=all&outlines=1&metric=forward"],
];
const only = process.argv[2];
fs.mkdirSync(here + "screenshots", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const results = {};
for (const [name, path] of shots) {
  if (only && !name.startsWith(only)) continue;
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") console.log(`[${name}] ${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => console.log(`[${name}] pageerror: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/${path}`);
  await page.waitForSelector("body[data-ready='1']", { timeout: 180000 });
  await page.screenshot({ path: `${here}screenshots/${name}.png` });
  results[name] = await page.evaluate(() => { const r = { ...window.__spike }; delete r._outlined; return r; });
  console.log(name, JSON.stringify(results[name]));
  await page.close();
}
// Interactive check: one page, zoom in with the mouse wheel, the planner re-plans.
if (!only || "a_3031_wheel".startsWith(only) || only === "a_3031_wheel") {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto(`http://localhost:${PORT}/planned.html?cog=polar_3031&view=far&outlines=1`);
  await page.waitForSelector("body[data-ready='1']", { timeout: 180000 });
  const steps = [];
  steps.push(await page.evaluate(() => ({ level: window.__spike.level, tiles: window.__spike.tiles, plans: window.__spike.plans })));
  await page.mouse.move(450, 450);
  for (let k = 0; k < 4; k++) {
    await page.mouse.wheel(0, -150);
    await page.waitForTimeout(2500);
    steps.push(await page.evaluate(() => ({ level: window.__spike.level, tiles: window.__spike.tiles, plans: window.__spike.plans })));
    await page.screenshot({ path: `${here}screenshots/a_3031_wheel_${k + 1}.png` });
  }
  results.a_3031_wheel = { steps };
  console.log("a_3031_wheel", JSON.stringify(steps));
  await page.close();
}
await browser.close();
server.kill();
if (!only) fs.writeFileSync(here + "screenshots/results.json", JSON.stringify(results, null, 2) + "\n");
