# Probe: RasterLayer in EPSG:3031

The question from decision 0001 (allboa/design
`decisions/0001-rasterlayer-3031.md`, spike `../../rasterlayer-3031/`), made
repeatable: does deck.gl-raster's `RasterLayer` draw a COG over the pole in an
EPSG:3031 `OrthographicView`, both when the COG is already in EPSG:3031 and
when it is lon/lat with the pole as its bottom row and the antimeridian as its
edge?

## Result on 2026-11-03

**Yes, from deck.gl-raster 0.9.0, with the stock layer.** 0.9.0's
`RasterLayer` measures mesh error on the map, in output pixels
(`_errorSpace: "output"` in `RasterReprojector`). That is the forward metric
the spike proposed upstream (part 1 of 0001's proposal), so the runtime patch
is no longer needed. The 0.10.0-beta.2 behaves the same.

| case | 0.8.1 | 0.9.0 | 0.10.0-beta.2 |
| --- | --- | --- | --- |
| EPSG:3031 COG: full, pole, antimeridian | draws | draws | draws |
| lon/lat -180..180 to -90: full, pole, antimeridian | blank | draws | draws |
| lon/lat 90..270 to -90 (seam inside the image) | blank | draws | draws |
| lon/lat with the spike's forward-metric patch | draws | (not needed) | (not needed) |

Still open from 0001's proposal:

- **Part 2, `maxIterations`.** It is still not a `RasterLayer` prop. The
  full-resolution 3600 x 500 lon/lat image stops at the 10000-iteration cap
  with 0.341 px of error left (target 0.125 px) and a console warning. It is
  invisible at these zooms; the 90..270 image converges (8265 vertices), and so
  does the level-3 overview (3397 vertices).
- **Part 3, polar tests upstream.** Not checked from here.

Screenshots and the full table for that run are in `record/2026-11-03/`.

## How it works

`run.mjs` reads `versions.json` (named entries, each pinning the
`@developmentseed` packages to one version or dist-tag, and deck.gl), and for
each entry:

1. installs the packages into `.runs/<entry>/` and bundles `src/` against them
   with esbuild;
2. makes the spike's synthetic COGs once, with `../../rasterlayer-3031/make_cogs.py`;
3. renders each case in headless Chromium (SwiftShader), reading the COGs
   over HTTP Range from `serve.mjs`;
4. samples pixels at lon/lat points that must be on data in that view, off the
   graticule, and calls the case `draws` (90% or more not background),
   `blank` (10% or less) or `partial`;
5. compares with `expect.json` and writes `results/<entry>/` (screenshots and
   `results.json`) and `results/summary.md`.

It exits 1 when an entry not marked `watch` differs from `expect.json`. Betas
are `watch`: a change there is reported, not a failure. The mesh numbers are
read from the layer's own state, so they follow whichever metric that version
uses.

```sh
pip install numpy rasterio pyproj
node run.mjs                 # every entry
node run.mjs 0.9.0 beta      # some entries
CHROMIUM=/path/to/chrome node run.mjs
```

Without `CHROMIUM`, it uses the `playwright` package's browser if one is
installed next to `run.mjs`.

CI: `.github/workflows/probe-rasterlayer-3031.yml` runs it weekly, on demand
(with a list of entries) and on pull requests that touch this folder, and
uploads `results/` as an artifact.

## Adding a version or a case

- A new release: add an entry to `versions.json`. If it should behave
  differently, add its expectations to `expect.json` with a note here on what
  changed upstream.
- A new case: add a URL case to `src/main.js` if it needs one, and a row to
  `CASES` in `run.mjs` with the points that must be on data.
