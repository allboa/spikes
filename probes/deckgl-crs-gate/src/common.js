// Shared by both pages: the camera and how a run reports back.
export const SIZE = 900;
export const EXTENT = 12e6;            // view width in EPSG:3031 metres
export const ZOOM = Math.log2((SIZE * 0.95) / EXTENT);
export const INK = [0, 0, 0, 255];

export const result = { ready: false, error: null, info: {} };
window.__probe = result;

export function done(extra) {
  Object.assign(result.info, extra || {});
  result.ready = true;
  document.body.dataset.ready = "1";
}
export function fail(e) {
  result.error = String((e && e.stack) || e);
  done();
}
// The three kinds the gate covers, drawn the same way on every page: 1 px
// lines, polygon rings as 1 px outlines, points as 4 px outline circles.
export function layersFor(L, { paths, rings, points, coordinateSystem }) {
  const common = coordinateSystem === undefined ? {} : { coordinateSystem };
  return [
    new L.PathLayer({ id: "lines", data: paths, getPath: (d) => d, getColor: INK, getWidth: 1, widthUnits: "pixels", ...common }),
    new L.PolygonLayer({ id: "rings", data: rings, getPolygon: (d) => d, filled: false, stroked: true,
      getLineColor: INK, getLineWidth: 1, lineWidthUnits: "pixels", ...common }),
    new L.ScatterplotLayer({ id: "points", data: points, getPosition: (d) => d, filled: false, stroked: true,
      getRadius: 4, radiusUnits: "pixels", getLineColor: INK, getLineWidth: 1, lineWidthUnits: "pixels", ...common }),
  ];
}
export async function loadLines() {
  return (await fetch("data/lines.json")).json();
}
