// Prototype of the upstream fix proposed by this spike.
//
// RasterReprojector measures mesh error by taking a linearly interpolated
// OUTPUT position, running it back through inverseReproject + inverseTransform,
// and comparing the resulting pixel to the exact pixel. That needs a
// single-valued, continuous inverse. A lon/lat raster that covers the pole or
// has the antimeridian as an image edge has neither: every output point on the
// pole maps to one arbitrary longitude, and points on the 180 meridian map to
// -180 or +180 depending on the sign of a rounding error. The error there stays
// at the image width forever, refinement piles all its points onto that edge,
// and it stops at maxIterations with a mesh of zero-area triangles.
//
// This patch measures the error in the forward direction instead: project the
// exact UV sample forward, compare it with the interpolated output position,
// and express the distance in units of "one source pixel as it lands in the
// output" (local Jacobian of the forward mapping). The forward mapping is
// single-valued and continuous at the pole and on the antimeridian, so the
// metric is well defined there. Only forwardTransform and forwardReproject are
// used.
import { RasterReprojector } from "@developmentseed/raster-reproject";

const SAMPLE_POINTS = [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]];
const mix = (a, b, c, s) => s[0] * a + s[1] * b + s[2] * c;

export function forwardErrorCandidate(t) {
  const T = this.triangles, uv = this.uvs, out = this.exactOutputPositions, f = this.reprojectors;
  const ia = 2 * T[t * 3], ib = 2 * T[t * 3 + 1], ic = 2 * T[t * 3 + 2];
  const W1 = this.width - 1, H1 = this.height - 1;
  const fwd = (px, py) => { const p = f.forwardTransform(px, py); return f.forwardReproject(p[0], p[1]); };
  let maxError = 0, mu = 0, mv = 0;
  for (const s of SAMPLE_POINTS) {
    const u = mix(uv[ia], uv[ib], uv[ic], s), v = mix(uv[ia + 1], uv[ib + 1], uv[ic + 1], s);
    const ox = mix(out[ia], out[ib], out[ic], s), oy = mix(out[ia + 1], out[ib + 1], out[ic + 1], s);
    const px = u * W1, py = v * H1;
    const e = fwd(px, py), eu = fwd(px + 1, py), ev = fwd(px, py + 1);
    const pix = Math.max(Math.hypot(eu[0] - e[0], eu[1] - e[1]), Math.hypot(ev[0] - e[0], ev[1] - e[1]));
    if (!(pix > 0)) continue;
    const err = Math.hypot(ox - e[0], oy - e[1]) / pix;
    if (err > maxError) { maxError = err; mu = u; mv = v; }
  }
  if ((mu === uv[ia] && mv === uv[ia + 1]) || (mu === uv[ib] && mv === uv[ib + 1]) || (mu === uv[ic] && mv === uv[ic + 1])) maxError = 0;
  this._candidatesUV[2 * t] = mu;
  this._candidatesUV[2 * t + 1] = mv;
  this._queuePush(t, maxError);
}

const original = RasterReprojector.prototype._findReprojectionCandidate;
export function useForwardMetric(on) {
  RasterReprojector.prototype._findReprojectionCandidate = on ? forwardErrorCandidate : original;
}
