// deck.gl v10: the same sparse lon/lat lines, declared as EPSG:4326 PROJJSON
// through the layer's coordinateSystem, drawn in a view whose CRS is
// EPSG:3031, with the renderer reprojecting (decision 0012).
//
// v10's API is not on npm yet, so this page looks for it rather than assuming
// it: it records which of the candidate exports exist and reports any error,
// and the gate counts an error as "not ready". When v10 settles, fix this page
// to its real API; nothing else in the probe needs to change.
import * as core from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import { ZOOM, INK, loadLines, done, fail, result } from "./common.js";

const EPSG4326 = { type: "GeographicCRS", name: "WGS 84", id: { authority: "EPSG", code: 4326 } };
const EPSG3031 = { type: "ProjectedCRS", name: "WGS 84 / Antarctic Polar Stereographic", id: { authority: "EPSG", code: 3031 } };
const CANDIDATES = ["_CustomProjectionView", "CustomProjectionView", "ProjectedView", "OrthographicView"];

async function main() {
  const { lonlat } = await loadLines();
  result.info.version = core.VERSION;
  result.info.exports = CANDIDATES.filter((k) => k in core);
  const View = core._CustomProjectionView || core.CustomProjectionView || core.ProjectedView;
  if (!View) throw new Error(`no custom projection view export (looked for ${CANDIDATES.slice(0, 3).join(", ")})`);
  new core.Deck({
    parent: document.getElementById("deck"),
    views: new View({ id: "v", toCrs: EPSG3031, crs: EPSG3031 }),
    initialViewState: { target: [0, 0, 0], zoom: ZOOM },
    layers: [new PathLayer({
      id: "lines", data: lonlat, getPath: (d) => d, getColor: INK, getWidth: 1, widthUnits: "pixels",
      coordinateSystem: EPSG4326
    })],
    onAfterRender: () => setTimeout(() => done({ mode: "v10" }), 300),
    onError: fail
  });
}
main().catch(fail);
