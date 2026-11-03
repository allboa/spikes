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
export async function loadLines() {
  return (await fetch("data/lines.json")).json();
}
