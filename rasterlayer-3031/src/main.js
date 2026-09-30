// Spike allboa/spikes#3: deck.gl-raster's RasterLayer drawing one untiled COG
// into an EPSG:3031 OrthographicView, with a custom (proj4) reprojection.
//
// URL parameters:
//   case=4326 | 4326-90-270 | 3031   which COG (see make_cogs.py)
//   wrap=1 | 0                       wrap inverse longitudes into the image's
//                                    longitude range (the fix) or not (naive)
//   focus=all | pole | antimeridian  initial camera
//   debug=1                          draw the adaptive mesh triangles
//   overview=<n>                     COG level to read (0 = full resolution, n = 1/2^n)
//   metric=inverse | forward         mesh error metric: stock (inverse) or the
//                                    patched forward metric (src/forward-metric.js)
import { Deck, OrthographicView, COORDINATE_SYSTEM } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { RasterLayer } from "@developmentseed/deck.gl-raster";
import { RasterReprojector } from "@developmentseed/raster-reproject";
import { GeoTIFF } from "@developmentseed/geotiff";
import proj4 from "proj4";
import { useForwardMetric } from "./forward-metric.js";

const q = new URLSearchParams(location.search);
const CASE = q.get("case") || "4326";
const WRAP = q.get("wrap") !== "0";
const FOCUS = q.get("focus") || "all";
const DEBUG = q.get("debug") === "1";
const OVERVIEW = Number(q.get("overview") || 0);
const METRIC = q.get("metric") || "inverse";
useForwardMetric(METRIC === "forward");

const FILES = { "4326": "data/polar_4326.tif", "4326-90-270": "data/polar_4326_90_270.tif", "3031": "data/polar_3031.tif" };
const EPSG3031 = "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
const to3031 = proj4("EPSG:4326", EPSG3031);

const statusEl = document.getElementById("status");
const log = (s) => { statusEl.textContent += s + "\n"; };
const result = { case: CASE, wrap: WRAP, metric: METRIC, warnings: [] };
window.__spike = result;

// Capture the reprojector's non-convergence warning so the page can report it.
const origWarn = console.warn;
console.warn = (...a) => { result.warnings.push(a.join(" ")); origWarn(...a); };

// ---- colour ramp, as in the probe ----
const ramp = [[8, 29, 88], [37, 52, 148], [34, 94, 168], [29, 145, 192], [65, 182, 196], [127, 205, 187], [199, 233, 180], [237, 248, 177]];
function rampColor(t) {
  t = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(t)), f = t - i, a = ramp[i], b = ramp[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

async function readCog(url, level) {
  const tiff = await GeoTIFF.fromUrl(new URL(url, location.href).href);
  // In this API `overviews` holds only the reduced levels, finest first, so
  // level n (n >= 1) is overviews[n - 1]; level 0 is the full-resolution image.
  const img = level === 0 ? tiff : (tiff.overviews[level - 1] || tiff);
  const { x: nx, y: ny } = img.tileCount;
  const xy = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) xy.push([x, y]);
  const tiles = await img.fetchTiles(xy, { boundless: false });
  // Paste tiles into one band (assembleTiles wants whole tiles; edge tiles are clipped here).
  const W = img.width, H = img.height, TW = img.tileWidth, TH = img.tileHeight;
  const data = new Float32Array(W * H);
  for (const t of tiles) {
    const a = t.array, src = a.layout === "band-separate" ? a.bands[0] : a.data, step = a.layout === "band-separate" ? 1 : a.count;
    for (let r = 0; r < a.height; r++) for (let c = 0; c < a.width; c++) {
      const X = t.x * TW + c, Y = t.y * TH + r;
      if (X < W && Y < H) data[Y * W + X] = src[(r * a.width + c) * step];
    }
  }
  const arr = { width: W, height: H, data };
  return { tiff, img, arr };
}

function toImageData(arr, nodata, lo, hi) {
  const w = arr.width, h = arr.height;
  const band = arr.data;
  const out = new ImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    const v = band[p];
    if (nodata !== null && v === nodata) continue;
    const c = rampColor((v - lo) / (hi - lo));
    out.data[p * 4] = c[0]; out.data[p * 4 + 1] = c[1]; out.data[p * 4 + 2] = c[2]; out.data[p * 4 + 3] = 255;
  }
  return out;
}

function makeReprojectionFns(transform, crsIs3031, lonMin) {
  const [a, b, c, d, e, f] = transform;
  const det = a * e - b * d;
  const forwardTransform = (px, py) => [a * px + b * py + c, d * px + e * py + f];
  const inverseTransform = (x, y) => {
    const dx = x - c, dy = y - f;
    return [(e * dx - b * dy) / det, (-d * dx + a * dy) / det];
  };
  if (crsIs3031) {
    // Source is already in the view CRS: identity reprojection.
    const id = (x, y) => [x, y];
    return { forwardTransform, inverseTransform, forwardReproject: id, inverseReproject: id };
  }
  return {
    forwardTransform,
    inverseTransform,
    forwardReproject: (lon, lat) => to3031.forward([lon, lat]),
    inverseReproject: (x, y) => {
      const ll = to3031.inverse([x, y]);
      // proj4 returns lon in (-180, 180]. An image whose columns run past 180
      // (e.g. 90..270) needs lon wrapped into its own range, or every sample
      // east of the antimeridian maps to a pixel column far outside the image.
      if (WRAP) ll[0] = lonMin + (((ll[0] - lonMin) % 360) + 360) % 360;
      return ll;
    }
  };
}

function graticule() {
  const lines = [];
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = []; for (let lat = -90; lat <= -40; lat += 0.5) pts.push(to3031.forward([lon, lat]));
    lines.push({ path: pts, color: lon === 180 || lon === -180 ? [220, 40, 40, 255] : [90, 100, 110, 160], w: lon === -180 ? 2.5 : 1 });
  }
  for (const lat of [-40, -50, -60, -70, -80]) {
    const pts = []; for (let lon = -180; lon <= 180; lon += 0.5) pts.push(to3031.forward([lon, lat]));
    lines.push({ path: pts, color: [90, 100, 110, 160], w: 1 });
  }
  return lines;
}

async function main() {
  const t0 = performance.now();
  const { tiff, img, arr } = await readCog(FILES[CASE], OVERVIEW);
  const tRead = performance.now() - t0;
  const crs = img.crs;
  const is3031 = crs === 3031 || (typeof crs === "object" && JSON.stringify(crs).includes("3031"));
  const transform = img.transform;
  const lonMin = transform[2];
  log(`error metric: ${METRIC === "forward" ? "forward (patched)" : "inverse (stock deck.gl-raster 0.8.1)"}, lon wrap ${WRAP ? "on" : "off"}`);
  log(`COG ${FILES[CASE]} level ${OVERVIEW}: ${img.width} x ${img.height}, crs ${typeof crs === "object" ? "projjson" : crs}, read ${tRead.toFixed(0)} ms`);
  const image = toImageData(arr, tiff.nodata, -2, 16);
  const fns = makeReprojectionFns(transform, is3031, lonMin);

  // Run the same reprojector the layer runs, to report its behaviour.
  const t1 = performance.now();
  const rp = new RasterReprojector(fns, img.width + 1, img.height + 1, {});
  const warnBefore = result.warnings.length;
  rp.run(0.125);
  const tMesh = performance.now() - t1;
  Object.assign(result, {
    width: img.width, height: img.height, readMs: tRead, meshMs: tMesh,
    vertices: rp.uvs.length / 2, triangles: rp.triangles.length / 3,
    finalMaxError: rp.getMaxError(), converged: result.warnings.length === warnBefore
  });
  log(`mesh: ${result.vertices} vertices, ${result.triangles} triangles, ${tMesh.toFixed(0)} ms`);
  log(`refinement ${result.converged ? "converged" : "did NOT converge"}; max error left ${result.finalMaxError.toFixed(3)} px (target 0.125)`);

  const R = 6.4e6;
  const host = document.getElementById("deck");
  const w = host.clientWidth, h = host.clientHeight;
  let target = [0, 0, 0], extent = 2 * R;
  if (FOCUS === "pole") { target = [0, 0, 0]; extent = 1.2e6; }
  if (FOCUS === "antimeridian") { target = [0, -2.6e6, 0]; extent = 1.6e6; }  // lon 180 is -y in 3031 (lon 0 is +y)
  const zoom = Math.log2(Math.min(w, h) * 0.95 / extent);

  const layers = [
    new RasterLayer({
      id: "cog", image, width: img.width, height: img.height,
      reprojectionFns: fns, debug: DEBUG, debugOpacity: 0.25,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    }),
    new PathLayer({
      id: "graticule", data: graticule(), getPath: (d) => d.path, getColor: (d) => d.color,
      getWidth: (d) => d.w, widthUnits: "pixels", coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    }),
    new ScatterplotLayer({
      id: "pole", data: [[0, 0]], getPosition: (d) => d, getRadius: 4, radiusUnits: "pixels",
      getFillColor: [0, 0, 0, 0], stroked: true, getLineColor: [220, 40, 40, 255], lineWidthUnits: "pixels", getLineWidth: 1.5,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    })
  ];
  const deck = new Deck({
    parent: host,
    views: new OrthographicView({ id: "polar", flipY: false, controller: true }),
    initialViewState: { target, zoom, minZoom: zoom - 3, maxZoom: zoom + 12 },
    layers,
    onError: (err) => { result.error = String(err && err.message || err); log("ERROR " + result.error); }
  });
  // Mark ready once the async image prop has been turned into a texture and drawn.
  const poll = setInterval(() => {
    const lm = deck.layerManager;
    if (!lm) return;
    const loaded = lm.getLayers().every((l) => l.isLoaded);
    if (loaded) { clearInterval(poll); setTimeout(() => { result.ready = true; document.body.dataset.ready = "1"; }, 400); }
  }, 100);
  window.__deck = deck;
}

main().catch((e) => { result.error = String(e && e.stack || e); log("ERROR " + result.error); document.body.dataset.ready = "1"; });
