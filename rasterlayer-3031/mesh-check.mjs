// Headless check of RasterReprojector (the mesh builder inside RasterLayer)
// on lon/lat polar images, stock inverse metric vs the forward-metric patch.
// No browser, no COG: the reprojection functions are all that matter.
// Usage: node mesh-check.mjs > mesh-check.txt
import { RasterReprojector } from "@developmentseed/raster-reproject";
import { useForwardMetric } from "./src/forward-metric.js";
import proj4 from "proj4";

const P = proj4("EPSG:4326", "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs");
const RES = 0.1;
const cases = [
  // [label, lonMin, lonMax, latMin]
  ["lon -180..180, lat -40..-90 (seam at image edge, pole row)", -180, 180, -90],
  ["lon 90..270,  lat -40..-90 (seam inside image, pole row)", 90, 270, -90],
  ["lon 90..270,  lat -40..-89.9 (seam inside, stops short of pole)", 90, 270, -89.9],
  ["lon 90..270,  lat -40..-80 (seam inside, no pole)", 90, 270, -80],
];
console.log("metric   wrap  converged  maxErr(px)  vertices  triangles  ms  case");
for (const [label, lonMin, lonMax, latMin] of cases) {
  const W = Math.round((lonMax - lonMin) / RES), H = Math.round((-40 - latMin) / RES);
  for (const metric of ["inverse", "forward"]) for (const wrap of [false, true]) {
    if (metric === "forward" && wrap) continue;   // forward metric never calls the inverse
    useForwardMetric(metric === "forward");
    const fns = {
      forwardTransform: (px, py) => [lonMin + px * RES, -40 - py * RES],
      inverseTransform: (x, y) => [(x - lonMin) / RES, (-40 - y) / RES],
      forwardReproject: (x, y) => P.forward([x, y]),
      inverseReproject: (x, y) => { const ll = P.inverse([x, y]); if (wrap) ll[0] = lonMin + (((ll[0] - lonMin) % 360) + 360) % 360; return ll; },
    };
    const warn = console.warn; let warned = false; console.warn = () => { warned = true; };
    const t0 = performance.now();
    const rp = new RasterReprojector(fns, W + 1, H + 1);   // +1 as RasterLayer does
    rp.run(0.125);
    const ms = performance.now() - t0;
    console.warn = warn;
    const o = rp.exactOutputPositions, T = rp.triangles; let degenerate = 0;
    for (let i = 0; i < T.length; i += 3) {
      const a = 2 * T[i], b = 2 * T[i + 1], c = 2 * T[i + 2];
      if (Math.abs((o[b] - o[a]) * (o[c + 1] - o[a + 1]) - (o[b + 1] - o[a + 1]) * (o[c] - o[a])) < 1) degenerate++;
    }
    console.log(`${metric.padEnd(8)} ${String(metric === "forward" ? "-" : wrap).padEnd(5)} ${String(!warned).padEnd(10)} ${rp.getMaxError().toFixed(3).padStart(10)} ${String(rp.uvs.length / 2).padStart(9)} ${String(T.length / 3).padStart(10)} ${ms.toFixed(0).padStart(4)}  ${label}  (${degenerate} zero-area tris)`);
  }
}
useForwardMetric(false);
