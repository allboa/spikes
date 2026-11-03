// deck.gl 9.4 today: an OrthographicView in EPSG:3031 metres with CARTESIAN
// positions, as aobcore's renderer draws (decision 0001).
//   mode=ref         PROJ's densified positions (make_ref.py): the reference
//   mode=proj4       proj4js on the sparse vertices only (no subdivision)
//   mode=proj4dense  proj4js on vertices densified in lon/lat (0.05 degrees)
import { Deck, OrthographicView, COORDINATE_SYSTEM } from "@deck.gl/core";
import * as L from "@deck.gl/layers";
import proj4 from "proj4";
import { ZOOM, loadLines, layersFor, done, fail } from "./common.js";

const MODE = new URLSearchParams(location.search).get("mode") || "ref";
const P = proj4("EPSG:4326", "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs");

function densify(line, step) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i];
    const n = Math.max(1, Math.floor(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / step));
    for (let k = 1; k <= n; k++) out.push([x0 + (k / n) * (x1 - x0), y0 + (k / n) * (y1 - y0)]);
  }
  return out;
}

async function main() {
  const d = await loadLines();
  const fwd = (l) => l.map((p) => P.forward(p));
  let paths, rings, points;
  if (MODE === "ref") { paths = d.ref; rings = d.refRings; points = d.refPoints; }
  else if (MODE === "proj4") { paths = d.lonlat.map(fwd); rings = d.rings.map(fwd); points = fwd(d.points); }
  else { paths = d.lonlat.map((l) => fwd(densify(l, 0.05))); rings = d.rings.map((r) => fwd(densify(r, 0.05))); points = fwd(d.points); }
  new Deck({
    parent: document.getElementById("deck"),
    views: new OrthographicView({ id: "v", flipY: false }),
    initialViewState: { target: [0, 0, 0], zoom: ZOOM },
    layers: layersFor(L, { paths, rings: rings.map((r) => [r]), points, coordinateSystem: COORDINATE_SYSTEM.CARTESIAN }),
    onAfterRender: () => setTimeout(() => done({ mode: MODE, vertices: paths.reduce((a, p) => a + p.length, 0) }), 300),
    onError: fail
  });
}
main().catch(fail);
