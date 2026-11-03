# Probe: the decision 0012 gate (deck.gl v10 CRS)

Decision 0012 (allboa/design `decisions/0012-renderer-reprojection.md`) lets
a scene ask the renderer to reproject vector data, and builds nothing until
deck.gl can do it. This probe checks that gate every week:

1. **On npm**: is there a deck.gl version 10 or later (release or
   prerelease)? Whether it has PROJJSON `coordinateSystem` (deck.gl#10894),
   which 0012's gate 1 also asks, is tested by step 2, because the page uses
   it.
2. **Draws**: does a v10 page draw sparse lon/lat lines, polygon rings and
   points, declared as EPSG:4326 PROJJSON (written by PROJ) through the
   layers' `coordinateSystem`, in a view whose CRS is EPSG:3031? Draws is the
   0001 probe's rule: 90 percent or more of sample points on the reference
   data have ink (within 1 px).
3. **Tolerance**: is that drawing within 1 px of PROJ's, for all three kinds
   together? Both drawings are 900 x 900 pixels at device pixel ratio 1: 1 px
   black lines, 1 px ring outlines and 4 px outline circles on white. A pixel
   is ink when its luminance is under 160 (of 255), which keeps the core of an
   antialiased 1 px line and drops its faint edge. Every ink pixel of each
   drawing must lie within 1 px (Chebyshev) of ink in the other.

The reference is `make_ref.py`: the lines and rings densified in lon/lat
(0.05 degree steps) and projected by PROJ (pyproj). They have long planar
edges in lon/lat (parallels with a vertex every 30 degrees, a ring every 45,
a line and a box across the antimeridian, a line towards the pole), so a
renderer passes only if it subdivides them.

## Result on 2026-11-03

Gate 1 is closed: npm has no deck.gl 10 (latest 9.4.1, beta 9.4.0-beta.4).
The baseline, which runs every time on deck.gl 9.4.1 in an
`OrthographicView` with `CARTESIAN` positions (how aobcore draws today),
shows the harness works:

| drawing | within 1 px (to ref, from ref) | largest gap px | passes |
| --- | --- | --- | --- |
| proj4js, sparse vertices | 48.4%, 48.4% | more than 10 | no (no subdivision, as expected) |
| proj4js, densified 0.05 deg | 100.0%, 100.0% | 0 | yes |

So proj4js agrees with PROJ to the pixel on these lines once they are
densified; what a renderer must add is the subdivision.

## When v10 appears

`src/v10.js` is written before v10's API is published. It looks for a custom
projection view export (`_CustomProjectionView`, `CustomProjectionView`,
`ProjectedView`) and records which exist; anything it cannot do is a page
error, and the gate reports gate 2 closed with that error. That report is
the signal to fix `src/v10.js` to the real API (view props, camera units),
which is the only file that should need to change.

To try a specific version: `node gate.mjs 10.0.0-alpha.1`.

## Running it

```sh
pip install pyproj
CHROMIUM=/path/to/chrome node gate.mjs
```

It writes `results/` (screenshots, `gate.json`, `summary.md`). It exits 1
when the harness itself is broken (a baseline page errors, the reference draws
nothing, densified proj4js fails, or sparse proj4js passes), and 3 when a
gate's state differs from `expect-gate.json`, so CI goes red the week a gate
opens. That is the alert: act on decision 0012 (or fix `src/v10.js`), then
update `expect-gate.json`. A closed gate that stays closed is a green run.
A version given on the command line is a test of the v10 path and never
exits 3.

CI: `.github/workflows/probe-deckgl-crs-gate.yml`, weekly, on demand (with an
optional version) and on pull requests that touch this folder.
