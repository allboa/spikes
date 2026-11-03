// Run the 0001 polar probe against one or more deck.gl-raster versions.
//
//   node run.mjs                 every entry in versions.json
//   node run.mjs 0.9.0 next      just those entries
//
// For each entry: install the pinned packages into .runs/<entry>/, bundle
// src/ against them, render each case in headless Chromium, sample pixels
// where the data must be, and compare with expect.json. Writes
// results/<entry>/ (screenshots and results.json) and results/summary.md.
// Exits 1 when a version not marked watch differs from its expectations.
//
// Needs: node 20+, python3 with numpy, rasterio and pyproj (for the COGs),
// and Chromium (CHROMIUM=path, or the playwright package's own).
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const here = path.dirname(new URL(import.meta.url).pathname);
const versions = JSON.parse(fs.readFileSync(path.join(here, "versions.json"), "utf8"));
const expect = JSON.parse(fs.readFileSync(path.join(here, "expect.json"), "utf8"));
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(versions).filter((k) => !k.startsWith("_"));
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });

// ---- data: the spike's synthetic polar COGs (not committed) ----
const dataDir = path.join(here, "data");
if (!fs.existsSync(path.join(dataDir, "polar_3031.tif"))) {
  sh(`python3 ${JSON.stringify(path.join(here, "../../rasterlayer-3031/make_cogs.py"))} ${JSON.stringify(dataDir)}`, here);
}

// ---- cases ----
// focus sets the camera as src/main.js does; pts are [lon, lat] that lie on
// data in that view (off the graticule lines), checked in the screenshot.
const grid = (lats, lons) => lats.flatMap((lat) => lons.map((lon) => [lon, lat]));
const every = (step, off) => Array.from({ length: 360 / step }, (_, i) => -180 + off + i * step);
const ALL = grid([-45, -55, -65, -75, -85], every(15, 7.5));
const POLE = grid([-88.5, -89.5], every(30, 15));
const SEAM = grid([-63, -67, -73], [176, 178.5, -178.5, -176]);
const in90270 = ([lon]) => lon >= 90 || lon <= -90;
const CASES = [
  { name: "3031", qs: "case=3031", focus: "all", pts: ALL },
  { name: "3031_pole", qs: "case=3031&focus=pole", focus: "pole", pts: POLE },
  { name: "3031_antimeridian", qs: "case=3031&focus=antimeridian", focus: "antimeridian", pts: SEAM },
  { name: "4326", qs: "case=4326", focus: "all", pts: ALL },
  { name: "4326_pole", qs: "case=4326&focus=pole", focus: "pole", pts: POLE },
  { name: "4326_antimeridian", qs: "case=4326&focus=antimeridian", focus: "antimeridian", pts: SEAM },
  { name: "4326-90-270", qs: "case=4326-90-270", focus: "all", pts: ALL.filter(in90270) },
  { name: "4326_mesh", qs: "case=4326&debug=1&overview=3", focus: "all", pts: null },
  // the spike's forward-metric patch: only meaningful on 0.8.x, whose layer has no output-space metric
  { name: "4326_forward", qs: "case=4326&metric=forward", focus: "all", pts: ALL, only: /^0\.8\./ },
  { name: "4326_forward_pole", qs: "case=4326&metric=forward&focus=pole", focus: "pole", pts: POLE, only: /^0\.8\./ },
  { name: "4326_forward_antimeridian", qs: "case=4326&metric=forward&focus=antimeridian", focus: "antimeridian", pts: SEAM, only: /^0\.8\./ },
];
const VIEW = { all: { t: [0, 0], extent: 12.8e6 }, pole: { t: [0, 0], extent: 1.2e6 }, antimeridian: { t: [0, -2.6e6], extent: 1.6e6 } };
const SIZE = 900, BG = [223, 231, 235];

// ---- one version ----
async function runVersion(key) {
  const v = versions[key];
  if (!v) throw new Error(`no entry ${key} in versions.json`);
  const dir = path.join(here, ".runs", key);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const dv = v.devseed, gl = v.deckgl;
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: `probe-${key}`, private: true, type: "module",
    dependencies: {
      "@deck.gl/core": gl, "@deck.gl/layers": gl, "@deck.gl/geo-layers": gl, "@deck.gl/mesh-layers": gl,
      "@luma.gl/core": "^9.4.0", "@luma.gl/shadertools": "^9.4.0", "@luma.gl/webgl": "^9.4.0",
      "@developmentseed/deck.gl-raster": dv, "@developmentseed/geotiff": dv,
      "@developmentseed/morecantile": dv, "@developmentseed/raster-reproject": dv,
      "proj4": "^2.22.0", "esbuild": "^0.28.0", "playwright-core": "^1.63.0", "pngjs": "^7.0.0",
    },
  }, null, 2));
  sh("npm install --no-audit --no-fund --loglevel=error", dir);
  for (const f of ["index.html", "serve.mjs"]) fs.copyFileSync(path.join(here, f), path.join(dir, f));
  fs.cpSync(path.join(here, "src"), path.join(dir, "src"), { recursive: true });
  fs.symlinkSync(dataDir, path.join(dir, "data"));
  sh("npx esbuild src/main.js --bundle --format=esm --target=es2022 --external:module --outfile=dist/app.js --log-level=warning", dir);

  const req = createRequire(path.join(dir, "package.json"));
  const installed = JSON.parse(fs.readFileSync(path.join(dir, "node_modules/@developmentseed/deck.gl-raster/package.json"), "utf8")).version;
  const proj4 = req("proj4");
  const { PNG } = req("pngjs");
  const { chromium } = req("playwright-core");
  const P = proj4("EPSG:4326", "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs");

  const out = path.join(here, "results", key);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const port = 8931 + Math.floor(Math.random() * 500);
  const server = spawn("node", [path.join(dir, "serve.mjs"), String(port), dir], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 500));
  let exe = process.env.CHROMIUM;
  if (!exe) { try { exe = createRequire(import.meta.url)("playwright").chromium.executablePath(); } catch { exe = undefined; } }
  const browser = await chromium.launch({
    executablePath: exe,
    args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const results = { version: key, installed, deckgl: gl, cases: {} };
  for (const c of CASES) {
    if (c.only && !c.only.test(installed)) continue;
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://localhost:${port}/index.html?${c.qs}&v=${installed}`);
    await page.waitForSelector("body[data-ready='1']", { timeout: 180000 });
    const file = path.join(out, `${c.name}.png`);
    const buf = await page.screenshot({ path: file });
    const r = await page.evaluate(() => { const r = { ...window.__spike }; r.warnings = r.warnings.length; return r; });
    await page.close();
    let outcome = "picture only", share = null;
    if (c.pts) {
      const png = PNG.sync.read(buf);
      const vw = VIEW[c.focus], s = (SIZE * 0.95) / vw.extent;
      let hit = 0, n = 0;
      for (const [lon, lat] of c.pts) {
        const [x, y] = P.forward([lon, lat]);
        const sx = Math.round(SIZE / 2 + (x - vw.t[0]) * s), sy = Math.round(SIZE / 2 - (y - vw.t[1]) * s);
        if (sx < 2 || sy < 2 || sx >= SIZE - 2 || sy >= SIZE - 2) continue;
        if (sx < 560 && sy < 100) continue; // the status box
        const i = (sy * SIZE + sx) * 4, px = [png.data[i], png.data[i + 1], png.data[i + 2]];
        n++;
        if (Math.abs(px[0] - BG[0]) + Math.abs(px[1] - BG[1]) + Math.abs(px[2] - BG[2]) > 12) hit++;
      }
      share = n ? hit / n : 0;
      outcome = share >= 0.9 ? "draws" : share <= 0.1 ? "blank" : "partial";
    }
    const want = c.pts ? ((expect[key] || {})[c.name] || (expect[installed] || {})[c.name] || expect.default[c.name]) : null;
    results.cases[c.name] = { outcome, expected: want, ok: want ? outcome === want : null, share, ...r, pageErrors: errors };
    console.log(`${key} ${c.name}: ${outcome}${want ? (outcome === want ? "" : `  (expected ${want})`) : ""}`);
  }
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2) + "\n");
  return results;
}

const all = [];
for (const key of wanted) all.push(await runVersion(key));

// ---- summary across every results/<entry>/results.json present ----
const resDir = path.join(here, "results");
const runs = fs.readdirSync(resDir).filter((d) => fs.existsSync(path.join(resDir, d, "results.json")))
  .map((d) => JSON.parse(fs.readFileSync(path.join(resDir, d, "results.json"), "utf8")));
const names = CASES.map((c) => c.name);
let md = "# Probe results: RasterLayer in EPSG:3031\n\n";
md += "Written by `run.mjs`. Each cell is the outcome (draws, blank or partial: the share of sample points over the data that are not background), marked with `!` where it differs from `expect.json`. Mesh is the layer's own: vertices and the error left, in the layer's metric.\n\n";
md += "| case | " + runs.map((r) => `${r.version} (${r.installed})`).join(" | ") + " |\n";
md += "| --- | " + runs.map(() => "---").join(" | ") + " |\n";
for (const n of names) {
  md += `| ${n} | ` + runs.map((r) => {
    const c = r.cases[n];
    if (!c) return "";
    const mesh = c.vertices != null ? `, ${c.vertices} v, ${c.finalMaxError.toFixed(3)} px` : "";
    return `${c.outcome}${c.ok === false ? " !" : ""}${mesh}`;
  }).join(" | ") + " |\n";
}
fs.writeFileSync(path.join(resDir, "summary.md"), md);
console.log("\n" + md);

const failed = all.filter((r) => !versions[r.version].watch && Object.values(r.cases).some((c) => c.ok === false));
if (failed.length) { console.error(`expectations not met: ${failed.map((r) => r.version).join(", ")}`); process.exit(1); }
