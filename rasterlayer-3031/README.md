# Spike: deck.gl-raster RasterLayer in EPSG:3031

Issue: [allboa/spikes#3](https://github.com/allboa/spikes/issues/3).
Decision record: `allboa/design` `decisions/0001-rasterlayer-3031.md`.

Question: can deck.gl-raster's lower-level `RasterLayer`, given a custom
EPSG:3031 reprojection, draw one untiled COG that covers the pole and crosses
the antimeridian in an `OrthographicView`?

## Result

- **A COG already in EPSG:3031 draws with stock deck.gl-raster 0.8.1**, pole
  and antimeridian included. The reprojection is the identity, the mesh is two
  triangles, and nothing is special at the pole or on the 180 meridian.
- **A lon/lat (EPSG:4326) COG over the pole does not draw with stock 0.8.1.**
  The adaptive mesh builder (`RasterReprojector` in
  `@developmentseed/raster-reproject`) never converges: it stops at its
  10000-iteration cap with every triangle at zero area, so the layer draws
  nothing and logs `mesh refinement did not converge ... currentError=3600`.
- **The cause is the error metric, not the view or the layer.** The
  reprojector checks each triangle by sending an interpolated output point
  back through `inverseReproject` and `inverseTransform`. That inverse is not
  single-valued at the pole (every longitude) or on the 180 meridian (-180 or
  +180, decided by a rounding sign). Samples there always report an error of
  the whole image width, so refinement piles every new vertex onto that edge.
- **A forward error metric fixes it.** Measuring the error in the forward
  direction (project the exact UV sample, compare with the interpolated
  position, divide by the local size of one source pixel in the output) is
  well defined at the pole and the antimeridian. With that one function
  replaced (`src/forward-metric.js`, patched onto the prototype at runtime),
  the same RasterLayer draws both lon/lat COGs correctly, pole and seam
  included, and the mesh uses fewer vertices where it does converge.
- An antimeridian **inside** the image (lon 90..270) with no pole row already
  works on stock 0.8.1 if the caller wraps the inverse longitude into the
  image's range. That is a caller-side fix; the pole and an image-edge seam
  are not fixable from the caller side.

Other things confirmed along the way:

- `RasterLayer` works in an `OrthographicView` with
  `coordinateSystem: CARTESIAN`, and positions in metres (up to 6.4e6) draw
  with no visible float32 jitter at the zoom levels tried (its fp64 split of
  the positions helps here).
- `@developmentseed/geotiff` reads the COGs over HTTP Range from a local
  server, including DEFLATE and overviews. Its `overviews` array holds only
  the reduced levels (level n is `overviews[n - 1]`), and `assembleTiles`
  expects whole tiles, so the spike pastes clipped edge tiles itself.
- Full-resolution 3600 x 500 lon/lat input reaches 0.216 px (not the
  0.125 px target) before the 10000-iteration cap even with the forward
  metric. `maxIterations` is not a `RasterLayer` prop. An overview (level 3,
  450 x 62) converges in 2150 vertices.

## Numbers

From `node mesh-check.mjs` (`screenshots/mesh-check.txt`), 0.1 degree pixels,
target error 0.125 px:

| Image | Metric | Lon wrap | Converged | Max error px | Vertices |
| --- | --- | --- | --- | --- | --- |
| lon -180..180, lat -40..-90 | stock inverse | off | no | 1800 | 10005 (all degenerate) |
| lon -180..180, lat -40..-90 | stock inverse | on | no | 3600 | 10005 (all degenerate) |
| lon -180..180, lat -40..-90 | forward | - | cap hit | 0.216 | 10005 |
| lon 90..270, lat -40..-90 | stock inverse | on | no | 2700 | 10005 (all degenerate) |
| lon 90..270, lat -40..-90 | forward | - | yes | 0.125 | 5372 |
| lon 90..270, lat -40..-89.9 | stock inverse | on | cap hit | 0.313 | 10005 |
| lon 90..270, lat -40..-80 | stock inverse | on | yes | 0.125 | 8221 |
| lon 90..270, lat -40..-80 | forward | - | yes | 0.125 | 5323 |
| EPSG:3031 source (browser) | stock inverse | - | yes | 0.000 | 4 |

## Screenshots

Headless Chromium (SwiftShader WebGL), 900 x 900, `screenshots/`:

| File | Shows |
| --- | --- |
| `stock_3031.png`, `stock_3031_pole.png`, `stock_3031_antimeridian.png` | EPSG:3031 COG, stock layer: draws, pole and seam clean |
| `stock_4326.png`, `stock_4326-90-270.png` | lon/lat COGs, stock layer: nothing drawn |
| `stock_4326_mesh.png` | stock mesh debug overlay: all triangles collapsed onto the 180 meridian |
| `forward_4326.png`, `forward_4326_pole.png`, `forward_4326_antimeridian.png` | lon/lat -180..180 COG with the forward metric: draws, pole and seam clean |
| `forward_4326_mesh.png` | the adaptive mesh with the forward metric (overview level 3) |
| `forward_4326-90-270.png`, `forward_4326-90-270_nowrap.png` | seam inside the image; identical because the forward metric never calls the inverse |

The red line is the 180 meridian (bottom of the view: EPSG:3031 puts lon 0
up), the red ring is the pole. The synthetic field has 30 degree sector
stripes, a ring at -60 and a blob centred on the antimeridian at -65, so a
seam or a pole artefact would show.

`screenshots/results.json` has the per-page numbers (read time, mesh time,
vertices, triangles, convergence).

## Run it

Needs node 22 and Python 3 with `numpy rasterio pyproj` (rasterio wheels bundle
GDAL). No CDN: everything is bundled locally with esbuild.

```sh
npm install
python3 make_cogs.py        # writes data/*.tif (about 31 MB, not committed)
npm run build               # bundles src/main.js to dist/app.js
npm run serve               # http://localhost:8931/index.html?case=4326&metric=forward
npm run shots               # headless screenshots into screenshots/
node mesh-check.mjs         # convergence table, no browser
```

`screenshot.mjs` uses `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`;
set `CHROMIUM` to point elsewhere. Page parameters are listed at the top of
`src/main.js` (`case`, `metric`, `wrap`, `focus`, `debug`, `overview`).

## Files

- `make_cogs.py`: writes the three test COGs (lon/lat -180..180, lon/lat
  90..270, EPSG:3031), 256 x 256 tiles, DEFLATE, internal overviews.
- `serve.mjs`: static server with HTTP Range support.
- `src/main.js`: the page: reads a COG, colours it, builds the reprojection
  functions with proj4, draws `RasterLayer` in an `OrthographicView`.
- `src/forward-metric.js`: the proposed upstream fix, as a runtime patch.
- `mesh-check.mjs`: headless convergence table for the mesh builder.
- `screenshot.mjs`: headless screenshots and `results.json`.

## What an upstream fix needs

1. In `RasterReprojector._findReprojectionCandidate`, measure error in the
   forward direction (or fall back to it when the inverse round trip is not
   finite or jumps by more than half the image). This is about 30 lines and
   uses only `forwardTransform` and `forwardReproject`.
2. Expose `maxIterations` (or scale it with image size) through
   `RasterLayer`, so full-resolution pole-covering images can reach the target.
3. Tests with an EPSG:3031 output and a lon/lat input that covers the pole,
   with the antimeridian both as an image edge and inside the image.

Related upstream issues (titles only; not readable from this session):
developmentseed/deck.gl-raster #625 "Adaptive reprojection mesh never
converges near the poles for global EPSG:4326 sources", #366 "COG tiles near
+-180 longitude cause RasterReprojector mesh divergence", #172 "Support images
over the North/South poles", #171 "Support images spanning the antimeridian",
#646 "Public example of deck.gl-raster over south pole with cartesian
coordinate system rendering", #330 "Example with polar stereographic data".
