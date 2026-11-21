// deck.gl v10: the same sparse lon/lat lines, declared as EPSG:4326 PROJJSON
// through the layer's coordinateSystem, drawn in a view whose CRS is
// EPSG:3031, with the renderer reprojecting (decision 0012).
//
// Written to the API of deck.gl 10.0.0-alpha.1 (npm, 2026-11-12): the view is
// the experimental `_CustomProjectionView`, which takes the target CRS as
// `crs` and a view state of `center` (WGS84 lon/lat) and `zoom`. The page
// still records which candidate exports exist and reports any error, and the
// gate counts an error as "not ready". If a later prerelease renames things,
// this is the only file that should need to change.
import * as core from "@deck.gl/core";
import * as L from "@deck.gl/layers";
import { SIZE, EXTENT, loadLines, layersFor, done, fail, result } from "./common.js";

const CANDIDATES = ["_CustomProjectionView", "CustomProjectionView", "ProjectedView", "OrthographicView"];

// The view's common space is target-CRS metres times 512 / 40075016.6855 (the
// Web Mercator world scale), and a pixel is a common unit times 2^zoom. This
// zoom gives the same metres per pixel as the baseline pages' camera, centred
// on the pole, which is the EPSG:3031 origin.
const NORMALIZATION_SCALE = 512 / 40075016.6855;
const ZOOM = Math.log2((SIZE * 0.95) / EXTENT / NORMALIZATION_SCALE);
const CENTER = [0, -90, 0];

async function main() {
  // PROJJSON for both CRSs, written by PROJ in make_ref.py
  const d = await loadLines();
  const EPSG4326 = d.crs4326, EPSG3031 = d.crs3031;
  // ?bbox=0 is a diagnostic: the same view CRS without PROJ's area of use
  // (60 S for EPSG:3031), to tell clamping to that area from anything else.
  if (new URLSearchParams(location.search).get("bbox") === "0") {
    delete EPSG3031.bbox; delete EPSG3031.area; delete EPSG3031.id;
  }
  result.info.version = core.VERSION;
  result.info.exports = CANDIDATES.filter((k) => k in core);
  const View = core._CustomProjectionView || core.CustomProjectionView || core.ProjectedView;
  if (!View) throw new Error(`no custom projection view export (looked for ${CANDIDATES.slice(0, 3).join(", ")})`);
  new core.Deck({
    parent: document.getElementById("deck"),
    views: new View({ id: "v", crs: EPSG3031, orthographic: true }),
    initialViewState: { center: CENTER, zoom: ZOOM },
    layers: layersFor(L, { paths: d.lonlat, rings: d.rings.map((r) => [r]), points: d.points, coordinateSystem: EPSG4326 }),
    onAfterRender: () => setTimeout(() => done({ mode: "v10" }), 300),
    onError: fail
  });
}
main().catch(fail);
