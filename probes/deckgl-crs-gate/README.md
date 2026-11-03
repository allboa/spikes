# Probe: the decision 0012 gate (deck.gl v10 CRS)

Decision 0012 (allboa/design `decisions/0012-renderer-reprojection.md`) lets
a scene ask the renderer to reproject vector data, and builds nothing until
deck.gl can do it. This probe checks that gate every week:

1. **On npm**: is there a deck.gl version 10 or later (release or
   prerelease)?
2. **Draws**: does a v10 page draw sparse lon/lat lines, declared as EPSG:4326
   PROJJSON through the layer's `coordinateSystem`, in a view whose CRS is
   EPSG:3031? Draws means 90 percent or more of the reference line pixels have
   ink within 2 px.
3. **Tolerance**: is that drawing within 1 px of PROJ's? Both drawings are
   900 x 900 pixels at device pixel ratio 1, 1 px black lines on white,
   thresholded to a mask, and every ink pixel of each must lie within 1 px
   (Chebyshev) of ink in the other.

The reference is `make_ref.py`: the lines densified in lon/lat (0.05 degree
steps) and projected by PROJ (pyproj). The lines have long planar edges in
lon/lat (parallels with a vertex every 30 degrees, a line across the
antimeridian, one towards the pole), so a renderer passes only if it
subdivides them.

## Result on 2026-11-03

Gate 1 is closed: npm has no deck.gl 10 (latest 9.4.1, beta 9.4.0-beta.4).
The baseline, which runs every time on deck.gl 9.4.1 in an
`OrthographicView` with `CARTESIAN` positions (how aobcore draws today),
shows the harness works:

| drawing | within 1 px (to ref, from ref) | largest gap px | passes |
| --- | --- | --- | --- |
| proj4js, sparse vertices | 52.6%, 53.0% | 11 | no (no subdivision, as expected) |
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
only when the harness itself is broken (the reference draws nothing, densified
proj4js fails, or sparse proj4js passes); a closed gate is a result.

CI: `.github/workflows/probe-deckgl-crs-gate.yml`, weekly, on demand (with an
optional version) and on pull requests that touch this folder.
