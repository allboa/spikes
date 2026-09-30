// Shared by both approaches: colour ramp, reference graticule, camera presets.
// The graticule is a reference overlay only; it is projected here with proj4.
import proj4 from "proj4";

export const EPSG3031 = "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
const to3031 = proj4("EPSG:4326", EPSG3031);
export const project3031 = (lon, lat) => to3031.forward([lon, lat]);
export const unproject3031 = (x, y) => to3031.inverse([x, y]);

const ramp = [[8, 29, 88], [37, 52, 148], [34, 94, 168], [29, 145, 192], [65, 182, 196], [127, 205, 187], [199, 233, 180], [237, 248, 177]];
export function rampColor(t) {
  t = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(t)), f = t - i, a = ramp[i], b = ramp[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function graticule() {
  const lines = [];
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = []; for (let lat = -90; lat <= -40; lat += 0.5) pts.push(project3031(lon, lat));
    lines.push({ path: pts, color: lon === -180 ? [220, 40, 40, 255] : [90, 100, 110, 160], w: lon === -180 ? 2 : 1 });
  }
  for (const lat of [-40, -50, -60, -70, -80]) {
    const pts = []; for (let lon = -180; lon <= 180; lon += 0.5) pts.push(project3031(lon, lat));
    lines.push({ path: pts, color: [90, 100, 110, 160], w: 1 });
  }
  return lines;
}

// Camera presets in EPSG:3031 metres: centre and the width to fit.
export const VIEWS = {
  far: { target: [0, 0], extent: 4.4e7 },           // whole disc small: coarse level
  all: { target: [0, 0], extent: 1.35e7 },          // whole disc
  coast: { target: [1.6e6, 1.2e6], extent: 3.0e6 }, // mid zoom
  antimeridian: { target: [0, -2.4e6], extent: 1.2e6 }, // lon 180 is -y
  pole: { target: [0, 0], extent: 4.0e5 },          // close to the pole: finest level
};
export const fitZoom = (extent, w, h) => Math.log2(Math.min(w, h) / extent);
// Orthographic view: one view unit (metre) is 2^zoom CSS pixels.
export function viewExtent(vs, w, h) {
  const s = Math.pow(2, -vs.zoom), t = vs.target;
  return [t[0] - (w / 2) * s, t[1] - (h / 2) * s, t[0] + (w / 2) * s, t[1] + (h / 2) * s];
}
