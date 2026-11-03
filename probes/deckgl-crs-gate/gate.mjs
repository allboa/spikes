// The decision 0012 gate, checked: is there a deck.gl release that can draw
// lon/lat data in an EPSG:3031 view by itself, within 1 px of PROJ?
//
//   node gate.mjs            check npm, run the baseline, and run v10 if found
//   node gate.mjs 10.0.0-beta.1   run v10 at that version, whatever npm says
//
// Gate 1: a deck.gl v10 version (release or prerelease) is on npm. Whether
//         it has PROJJSON coordinateSystem (deck.gl#10894) is tested by gate 2,
//         since the page uses it.
// Gate 2: the v10 page draws, by the 0001 probe's rule: 90 percent or more of
//         sample points on the reference data have ink (within 1 px).
// Gate 3: tolerance: symmetric distance between the v10 drawing and the
//         reference drawing (PROJ, densified) is at most 1 px, for lines,
//         polygon rings and points together.
//
// The baseline runs every time on deck.gl 9.4 and proves the harness: PROJ's
// reference against proj4js on densified vertices must pass the tolerance, and
// proj4js on sparse vertices (no subdivision) is expected to fail it.
//
// Writes results/ (screenshots, gate.json, summary.md). Exits 1 when the
// harness itself is broken (the baseline does not behave as above), and 3 when
// a gate's state differs from expect-gate.json, so CI goes red the week a gate
// opens (or closes again). Updating expect-gate.json acknowledges it.
//
// Needs: node 20+, python3 with pyproj, and Chromium (CHROMIUM=path, or the
// playwright package's own).
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sh = (cmd, cwd, quiet) => String(execSync(cmd, { cwd, stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit" }) || "");
const SIZE = 900;
const BASELINE = "9.4.1";

// ---- data ----
const dataDir = path.join(here, "data");
if (!fs.existsSync(path.join(dataDir, "lines.json"))) sh(`python3 make_ref.py ${JSON.stringify(dataDir)}`, here);

// ---- gate 1: what is on npm ----
const major = (v) => Number(String(v).split(".")[0]);
let v10 = process.argv[2] || null;
let npmNote = "";
if (!v10) {
  const versions = JSON.parse(sh("npm view @deck.gl/core versions --json", here, true));
  const tags = JSON.parse(sh("npm view @deck.gl/core dist-tags --json", here, true));
  const candidates = versions.filter((v) => major(v) >= 10);
  v10 = candidates.length ? candidates[candidates.length - 1] : null;
  npmNote = `dist-tags ${JSON.stringify(tags)}; ${candidates.length} version(s) 10 or later`;
} else {
  npmNote = `version ${v10} given on the command line`;
  if (major(v10) < 10) npmNote += " (not a 10.x version: a test of the v10 path only)";
}

// ---- install and bundle one page against one deck.gl version ----
function prepare(name, deckVersion, entry) {
  const dir = path.join(here, ".runs", name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: `gate-${name}`, private: true, type: "module",
    dependencies: {
      "@deck.gl/core": deckVersion, "@deck.gl/layers": deckVersion,
      "proj4": "^2.22.0", "esbuild": "^0.28.0", "playwright-core": "1.63.0", "pngjs": "^7.0.0",
    },
  }, null, 2));
  sh("npm install --no-audit --no-fund --loglevel=error", dir);
  for (const f of ["index.html", "serve.mjs"]) fs.copyFileSync(path.join(here, f), path.join(dir, f));
  fs.cpSync(path.join(here, "src"), path.join(dir, "src"), { recursive: true });
  fs.symlinkSync(dataDir, path.join(dir, "data"));
  sh(`npx esbuild src/${entry} --bundle --format=esm --target=es2022 --outfile=dist/app.js --log-level=warning`, dir);
  return dir;
}

async function render(dir, queries, out) {
  const req = createRequire(path.join(dir, "package.json"));
  const { chromium } = req("playwright-core");
  const { PNG } = req("pngjs");
  const port = 9431 + Math.floor(Math.random() * 500);
  const server = spawn("node", [path.join(dir, "serve.mjs"), String(port), dir], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 500));
  let exe = process.env.CHROMIUM;
  if (!exe) { try { exe = createRequire(import.meta.url)("playwright").chromium.executablePath(); } catch { exe = undefined; } }
  const browser = await chromium.launch({
    executablePath: exe,
    args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const res = {};
  try {
    for (const [name, qs] of queries) {
      const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://localhost:${port}/index.html?${qs}`);
      try { await page.waitForSelector("body[data-ready='1']", { timeout: 120000 }); }
      catch { errors.push("timed out waiting for the page"); }
      const buf = await page.screenshot({ path: path.join(out, `${name}.png`) });
      const r = await page.evaluate(() => window.__probe || {}).catch(() => ({}));
      await page.close();
      const png = PNG.sync.read(buf);
      const mask = new Uint8Array(SIZE * SIZE);
      for (let i = 0; i < SIZE * SIZE; i++) {
        const lum = 0.299 * png.data[4 * i] + 0.587 * png.data[4 * i + 1] + 0.114 * png.data[4 * i + 2];
        mask[i] = lum < 160 ? 1 : 0;
      }
      res[name] = { mask, error: r.error || (errors.length ? errors.join("; ") : null), info: r.info || {} };
    }
  } finally {
    await browser.close();
    server.kill();
  }
  return res;
}

// Distance (Chebyshev, pixels, capped at R) from each ink pixel of a to the
// nearest ink pixel of b. Returns the share within 1 px and the largest seen.
function oneWay(a, b, R = 10) {
  let n = 0, within1 = 0, maxd = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (!a[y * SIZE + x]) continue;
    n++;
    let d = R + 1;
    for (let r = 0; r <= R && d > R; r++) {
      for (let dy = -r; dy <= r && d > R; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE) continue;
        if (b[yy * SIZE + xx]) { d = r; break; }
      }
    }
    if (d <= 1) within1++;
    if (d > maxd) maxd = d;
  }
  return { ink: n, within1: n ? within1 / n : 0, max: maxd, capped: maxd > R };
}
function compare(a, ref) {
  const fwd = oneWay(a, ref), back = oneWay(ref, a);
  const pass = fwd.ink > 0 && fwd.within1 === 1 && back.within1 === 1;
  const capped = fwd.capped || back.capped;
  return { ink: fwd.ink, drawn: drawnShare(a), toRef: fwd, fromRef: back,
    maxPx: capped ? ">10" : Math.max(fwd.max, back.max), pass };
}

// The 0001 rule: sample points on the reference data (every 40th vertex of
// lines and rings, and the right edge of each point's circle), mapped to the
// screen with the pages' camera; the share that have ink within 1 px.
const lines = JSON.parse(fs.readFileSync(path.join(dataDir, "lines.json"), "utf8"));
const SCALE = (SIZE * 0.95) / 12e6;   // as src/common.js: SIZE * 0.95 / EXTENT
const toScreen = ([x, y]) => [Math.round(SIZE / 2 + x * SCALE), Math.round(SIZE / 2 - y * SCALE)];
const SAMPLES = [
  ...lines.ref.flatMap((l) => l.filter((_, i) => i % 40 === 20)).map(toScreen),
  ...lines.refRings.flatMap((l) => l.filter((_, i) => i % 40 === 20)).map(toScreen),
  ...lines.refPoints.map(toScreen).map(([x, y]) => [x + 4, y]),
].filter(([x, y]) => x >= 1 && y >= 1 && x < SIZE - 1 && y < SIZE - 1);
function drawnShare(mask) {
  let hit = 0;
  for (const [x, y] of SAMPLES) {
    let ink = false;
    for (let dy = -1; dy <= 1 && !ink; dy++) for (let dx = -1; dx <= 1; dx++) if (mask[(y + dy) * SIZE + x + dx]) { ink = true; break; }
    if (ink) hit++;
  }
  return SAMPLES.length ? hit / SAMPLES.length : 0;
}

// ---- run ----
const out = path.join(here, "results");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const baseDir = prepare("baseline", BASELINE, "baseline.js");
const base = await render(baseDir, [["ref", "mode=ref"], ["proj4", "mode=proj4"], ["proj4dense", "mode=proj4dense"]], out);
const ref = base.ref.mask;
const report = {
  date: new Date().toISOString().slice(0, 10),
  npm: npmNote,
  baseline: { deckgl: BASELINE },
  gate: {
    1: !v10 ? "closed: no deck.gl 10 on npm" : process.argv[2] ? `given: ${v10}` : `open: ${v10}`,
    2: "not run", 3: "not run",
  },
};
for (const k of ["proj4", "proj4dense"]) {
  const c = compare(base[k].mask, ref);
  report.baseline[k] = { error: base[k].error, drawn: c.drawn, maxPx: c.maxPx, within1: [c.toRef.within1, c.fromRef.within1], pass: c.pass };
}
const refInk = oneWay(ref, ref).ink;
const refDrawn = drawnShare(ref);
const harnessOk = !base.ref.error && !base.proj4.error && !base.proj4dense.error && refInk > 1000 && refDrawn >= 0.99 &&
  report.baseline.proj4dense.pass && !report.baseline.proj4.pass && report.baseline.proj4.drawn > 0.3;
report.baseline.refDrawn = refDrawn;
report.baseline.refInk = refInk;
report.baseline.harnessOk = harnessOk;

if (v10) {
  let stage = "install or build";
  try {
    const dir = prepare("v10", v10, "v10.js");
    stage = "render";
    const r = (await render(dir, [["v10", "mode=v10"]], out)).v10;
    stage = "compare";
    const c = compare(r.mask, ref);
    report.v10 = { version: v10, error: r.error, info: r.info, drawn: c.drawn, maxPx: c.maxPx, within1: [c.toRef.within1, c.fromRef.within1] };
    const draws = !r.error && c.drawn >= 0.9;
    report.gate[2] = draws ? "open" : `closed: ${r.error ? "page error: " + r.error.split("\n")[0] : `only ${(100 * c.drawn).toFixed(0)} percent of the reference drawn`}`;
    report.gate[3] = !draws ? "not run (gate 2 closed)" : c.pass ? "open" : `closed: up to ${c.maxPx} px from PROJ`;
  } catch (e) {
    report.v10 = { version: v10, error: String(e.message || e) };
    report.gate[2] = `closed: ${stage} failed: ${String(e.message || e).split("\n")[0]}`;
  }
}

fs.writeFileSync(path.join(out, "gate.json"), JSON.stringify(report, null, 2) + "\n");
const pct = (x) => `${(100 * x).toFixed(1)}%`;
let md = `# Decision 0012 gate, ${report.date}\n\n`;
md += `npm: ${report.npm}\n\n`;
md += "| gate | state |\n| --- | --- |\n";
md += `| 1. deck.gl 10 on npm | ${report.gate[1]} |\n| 2. draws lon/lat in an EPSG:3031 view | ${report.gate[2]} |\n| 3. within 1 px of PROJ | ${report.gate[3]} |\n\n`;
md += `Baseline on deck.gl ${BASELINE} (OrthographicView, CARTESIAN), against PROJ's densified reference (${refInk} ink pixels):\n\n`;
md += "| drawing | within 1 px (to ref, from ref) | largest gap px | passes |\n| --- | --- | --- | --- |\n";
md += `| proj4js, sparse vertices | ${pct(report.baseline.proj4.within1[0])}, ${pct(report.baseline.proj4.within1[1])} | ${report.baseline.proj4.maxPx} | ${report.baseline.proj4.pass ? "yes" : "no (expected: no subdivision)"} |\n`;
md += `| proj4js, densified 0.05 deg | ${pct(report.baseline.proj4dense.within1[0])}, ${pct(report.baseline.proj4dense.within1[1])} | ${report.baseline.proj4dense.maxPx} | ${report.baseline.proj4dense.pass ? "yes" : "no"} |\n`;
if (report.v10 && report.v10.within1) md += `| deck.gl ${v10}, renderer reprojection | ${pct(report.v10.within1[0])}, ${pct(report.v10.within1[1])} | ${report.v10.maxPx} | ${report.gate[3] === "open" ? "yes" : "no"} |\n`;
md += `\nHarness ${harnessOk ? "ok" : "BROKEN: the baseline did not behave as expected"}.\n`;

// Has a gate changed state since expect-gate.json was last updated?
const expected = JSON.parse(fs.readFileSync(path.join(here, "expect-gate.json"), "utf8"));
const stateOf = (s) => String(s).split(":")[0];   // open, closed, given or not run
const changed = process.argv[2] ? [] : ["1", "2", "3"].filter((g) => stateOf(report.gate[g]) !== expected[g]);
if (changed.length) md += `\nGate state changed (${changed.map((g) => `${g}: ${expected[g]} to ${stateOf(report.gate[g])}`).join(", ")}). Act on decision 0012, then update expect-gate.json.\n`;
fs.writeFileSync(path.join(out, "summary.md"), md);
console.log("\n" + md);
if (!harnessOk) process.exit(1);
if (changed.length) process.exit(3);
