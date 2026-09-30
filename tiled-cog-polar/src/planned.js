// Approach (a): R-planned tiles. The browser asks the planner (the R side)
// for a plan for the current view, then fetches each tile's bytes with an
// HTTP Range request, inflates them, colours them and draws each tile as a
// textured mesh that was projected by the planner. No TIFF parsing and no
// projection code runs in the browser.
//
// URL parameters:
//   cog=polar_3031 | polar_4326     which COG
//   view=all | far | pole | antimeridian | coast   initial camera
//   outlines=1                      draw tile footprints and z/x/y labels
import { Deck, OrthographicView, COORDINATE_SYSTEM } from "@deck.gl/core";
import { PathLayer, TextLayer, ScatterplotLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { graticule, rampColor, VIEWS, fitZoom, viewExtent } from "./common.js";

const q = new URLSearchParams(location.search);
const COG = q.get("cog") || "polar_3031";
const VIEW = q.get("view") || "all";
const OUTLINES = q.get("outlines") === "1";

const statusEl = document.getElementById("status");
const result = { approach: "r-planned", cog: COG, view: VIEW, plans: 0, fetchedBytes: 0, fetchedTiles: 0 };
window.__spike = result;
const LEVEL_COLORS = [[230, 60, 60], [240, 150, 30], [40, 160, 70], [60, 110, 230], [160, 70, 200]];

const tileCache = new Map();   // id -> Promise<{canvas, mesh, outline, label}>
let current = null;            // latest plan
let deck;

async function inflate(buf) {
  const ds = new DecompressionStream("deflate");       // TIFF DEFLATE is zlib-wrapped
  const out = await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer();
  return new Float32Array(out);                        // little-endian COG, no predictor
}

function loadTile(plan, t) {
  if (tileCache.has(t.id)) return tileCache.get(t.id);
  const p = (async () => {
    const r = await fetch(plan.url, { headers: { Range: `bytes=${t.offset}-${t.offset + t.length - 1}` } });
    const buf = await r.arrayBuffer();
    result.fetchedBytes += buf.byteLength; result.fetchedTiles++;
    const vals = await inflate(buf);
    const canvas = document.createElement("canvas");
    canvas.width = t.tw; canvas.height = t.th;
    const ctx = canvas.getContext("2d"), img = ctx.createImageData(t.tw, t.th);
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (plan.nodata !== null && v === plan.nodata) continue;
      const c = rampColor((v + 2) / 18);
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const mesh = {
      attributes: {
        positions: { value: new Float32Array(t.positions), size: 3 },
        texCoords: { value: new Float32Array(t.uvs), size: 2 },
      },
      indices: { value: new Uint32Array(t.indices), size: 1 },
    };
    // outline: boundary of the (u, v) grid, from the mesh vertices
    const P = t.positions, n = P.length / 3;
    const ring = boundaryRing(t);
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    return { id: t.id, z: t.z, canvas, mesh, ring, center: [cx, cy], nverts: n };
  })();
  tileCache.set(t.id, p);
  return p;
}

// The planner's grid is (nu+1) x (nv+1) vertices, row-major; recover nu from uvs.
function boundaryRing(t) {
  const P = t.positions, U = t.uvs, n = P.length / 3;
  let nu = 1; while (nu + 1 < n && U[2 * (nu + 1) + 1] === U[1]) nu++;
  const cols = nu + 1, rows = n / cols, pt = (i) => [P[3 * i], P[3 * i + 1]];
  const ring = [];
  for (let i = 0; i < cols; i++) ring.push(pt(i));
  for (let j = 1; j < rows; j++) ring.push(pt(j * cols + cols - 1));
  for (let i = cols - 2; i >= 0; i--) ring.push(pt((rows - 1) * cols + i));
  for (let j = rows - 2; j >= 0; j--) ring.push(pt(j * cols));
  return ring;
}

let planSeq = 0;
async function requestPlan(viewState) {
  const host = document.getElementById("deck");
  const w = host.clientWidth, h = host.clientHeight, dpr = window.devicePixelRatio || 1;
  const ext = viewExtent(viewState, w, h);
  const mpp = Math.pow(2, -viewState.zoom) / dpr;                  // metres per device pixel
  const seq = ++planSeq;
  const t0 = performance.now();
  const r = await fetch(`/plan?cog=${COG}&view=${ext.map((v) => v.toFixed(0)).join(",")}&mpp=${mpp.toFixed(2)}`);
  const text = await r.text();
  const plan = JSON.parse(text);
  if (seq !== planSeq) return;                                     // superseded
  result.plans++;
  const tiles = await Promise.all(plan.tiles.map((t) => loadTile(plan, t)));
  if (seq !== planSeq) return;
  current = { plan, tiles, planBytes: text.length, roundTripMs: performance.now() - t0 };
  Object.assign(result, {
    level: plan.level, levels: plan.levels, levelSize: plan.level_size, sourcePixelM: plan.pixel_m,
    mPerDevicePx: mpp, tiles: tiles.length, planBytes: text.length, planMs: plan.plan_ms,
    roundTripMs: Math.round(current.roundTripMs), meshVertices: tiles.reduce((s, t) => s + t.nverts, 0),
  });
  statusEl.textContent =
    `R-planned tiles  cog ${COG}  (source EPSG:${plan.source_epsg}, view ${plan.view_crs})\n` +
    `level ${plan.level} of ${plan.levels - 1} (${plan.level_size.join(" x ")}, ${(plan.pixel_m / 1000).toFixed(1)} km/px source, ${(mpp / 1000).toFixed(2)} km/px screen)\n` +
    `${tiles.length} tiles, ${result.meshVertices} mesh vertices, plan ${(text.length / 1024).toFixed(0)} KiB in ${plan.plan_ms} ms\n` +
    `fetched so far: ${result.fetchedTiles} tiles, ${(result.fetchedBytes / 1024).toFixed(0)} KiB by Range`;
  render();
}

function render() {
  if (!current) return;
  const layers = current.tiles.map((t) => new SimpleMeshLayer({
    id: `tile-${t.id}`, data: [0], mesh: t.mesh, texture: t.canvas, coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    getPosition: [0, 0, 0], getColor: [255, 255, 255, 255],
    material: { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] },   // unlit (material: false still lights in 9.4)
    textureParameters: { minFilter: "nearest", magFilter: "nearest", mipmapFilter: "none" },
  }));
  layers.push(new PathLayer({ id: "graticule", data: graticule(), getPath: (d) => d.path, getColor: (d) => d.color,
    getWidth: (d) => d.w, widthUnits: "pixels", coordinateSystem: COORDINATE_SYSTEM.CARTESIAN }));
  layers.push(new ScatterplotLayer({ id: "pole", data: [[0, 0]], getPosition: (d) => d, getRadius: 4, radiusUnits: "pixels",
    filled: false, stroked: true, getLineColor: [220, 40, 40, 255], lineWidthUnits: "pixels", getLineWidth: 1.5,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN }));
  if (OUTLINES) {
    layers.push(new PathLayer({ id: "outlines", data: current.tiles, getPath: (t) => [...t.ring, t.ring[0]],
      getColor: (t) => [...LEVEL_COLORS[t.z % 5], 255], getWidth: 1.5, widthUnits: "pixels", coordinateSystem: COORDINATE_SYSTEM.CARTESIAN }));
    layers.push(new TextLayer({ id: "labels", data: current.tiles, getPosition: (t) => t.center, getText: (t) => t.id,
      getSize: 12, getColor: [20, 20, 20, 255], background: true, getBackgroundColor: [255, 255, 255, 200],
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN }));
  }
  deck.setProps({ layers });
}

function main() {
  const host = document.getElementById("deck");
  const v = VIEWS[VIEW];
  const initialViewState = { target: [v.target[0], v.target[1], 0], zoom: fitZoom(v.extent, host.clientWidth, host.clientHeight), minZoom: -16, maxZoom: -2 };
  let timer = null;
  deck = new Deck({
    parent: host,
    views: new OrthographicView({ id: "polar", flipY: false, controller: true }),
    initialViewState,
    layers: [],
    onViewStateChange: ({ viewState }) => { clearTimeout(timer); timer = setTimeout(() => requestPlan(viewState), 150); return viewState; },
    onError: (e) => { result.error = String(e && e.message || e); },
  });
  requestPlan(initialViewState).then(() => {
    const poll = setInterval(() => {
      if (deck.layerManager && deck.layerManager.getLayers().every((l) => l.isLoaded)) {
        clearInterval(poll); setTimeout(() => { document.body.dataset.ready = "1"; }, 400);
      }
    }, 100);
  }).catch((e) => { result.error = String(e && e.stack || e); statusEl.textContent = "ERROR " + result.error; document.body.dataset.ready = "1"; });
  window.__deck = deck;
}
main();
