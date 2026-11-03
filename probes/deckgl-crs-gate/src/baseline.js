// deck.gl 9.4 today: an OrthographicView in EPSG:3031 metres with CARTESIAN
// positions, as aobcore's renderer draws (decision 0001).
//   mode=ref         PROJ's densified positions (make_ref.py): the reference
//   mode=proj4       proj4js on the sparse vertices only (no subdivision)
//   mode=proj4dense  proj4js on vertices densified in lon/lat (0.05 degrees)
import { Deck, OrthographicView, COORDINATE_SYSTEM } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import proj4 from "proj4";
import { ZOOM, INK, loadLines, done, fail } from "./common.js";

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
  const { lonlat, ref } = await loadLines();
  let paths;
  if (MODE === "ref") paths = ref;
  else if (MODE === "proj4") paths = lonlat.map((l) => l.map((p) => P.forward(p)));
  else paths = lonlat.map((l) => densify(l, 0.05).map((p) => P.forward(p)));
  new Deck({
    parent: document.getElementById("deck"),
    views: new OrthographicView({ id: "v", flipY: false }),
    initialViewState: { target: [0, 0, 0], zoom: ZOOM },
    layers: [new PathLayer({
      id: "lines", data: paths, getPath: (d) => d, getColor: INK, getWidth: 1, widthUnits: "pixels",
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN
    })],
    onAfterRender: () => setTimeout(() => done({ mode: MODE, vertices: paths.reduce((a, p) => a + p.length, 0) }), 300),
    onError: fail
  });
}
main().catch(fail);
