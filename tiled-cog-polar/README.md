# Spike: tiled COG in a polar view

Issue: [allboa/spikes#1](https://github.com/allboa/spikes/issues/1) (gate A).
Decision record: `allboa/design` `decisions/0003-tiled-cog-polar.md`
(status: proposed; gate A is Michael's call).

Question: how should a tiled COG with overviews reach an EPSG:3031
`OrthographicView` with level of detail? Two options were compared:

- **(a) R-planned tiles.** A planner (R in the product, Python here) picks
  the overview level and the tiles for the view. It ships each tile's byte
  range plus a mesh already projected to the view CRS, with UVs. The browser
  fetches the bytes with HTTP Range, inflates them, and draws textured
  meshes. It never parses the TIFF and never projects anything.
- **(b) Browser-side traversal.** The browser walks the COG pyramid itself,
  as deck.gl-raster's COGLayer does, but in the view CRS rather than in Web
  Mercator.

## Result

- **(a) works end to end** for both test COGs: one in EPSG:3031, and one in
  lon/lat covering the pole with the antimeridian at the image edge. The
  pole and the seam need nothing special, because each tile's mesh is built
  in source pixel space and projected once, as in the probe. Five COG levels
  were exercised. The presets pick levels 3, 1 and 0. One page session
  zoomed with the mouse wheel re-plans through levels 3, 2, 1, 1 and 0.
- **(b) also works as a prototype**, for the EPSG:3031 COG. It keeps
  deck.gl-raster's `RasterTileLayer`, `AffineTileset` and `RasterLayer`, and
  replaces two methods of `RasterTileset2D` (`getTileIndices`,
  `getTileMetadata`) plus one of `RasterTileLayer` (`_renderTileLayer`). In
  every preset run with both approaches, it picks the same level and the same
  number of tiles as the planner. For the
  lon/lat COG it draws, but the pole-row tiles show gaps and 16 mesh
  non-convergence warnings, unless spike #3's forward error metric patch is
  applied. It stands on private API: underscore methods, underscore metadata
  fields, and deck.gl `TileLayer` internals.

| Preset | COG | Screen km/px | (a) level, tiles | (b) level, tiles | Bytes fetched (a) |
| --- | --- | --- | --- | --- | --- |
| far | 3031 | 48.9 | 3, 4 | 3, 4 | 234 KiB |
| all | 3031 | 15.0 | 1, 25 | 1, 25 | 3.5 MiB |
| coast | 3031 | 3.3 | 0, 12 | - | 2.6 MiB |
| pole | 3031 | 0.44 | 0, 4 | 0, 4 | 916 KiB |
| far | 4326 | 48.9 | 2, 4 | - | 384 KiB |
| all | 4326 | 15.0 | 0, 30 | 0, 30 | 5.7 MiB |
| pole | 4326 | 0.44 | 0, 15 | - | 2.9 MiB |
| antimeridian | 4326 | 1.3 | 0, 8 | - | 1.3 MiB |

Level 0 is full resolution. Plans take 2 to 28 ms in the Python planner. A
plan is 1 to 8 KiB of JSON for the 3031 COG and up to 374 KiB for the lon/lat
COG, whose curved meshes use 2-degree cells. `screenshots/results.json` has
every number.

## What each approach costs

**(a) R-planned tiles:** about 130 lines of planner, about 80 lines of
transport and about 160 lines of browser code, all written here.

- Needs a live R session (httpuv or websocket) for interactive re-planning,
  with one round trip per settled view change. For a standalone page, R can
  ship the plan for every level up front: 139 tiles and 42 KiB of JSON for
  the 3031 COG. The lon/lat COG needs 45 tiles and 1.8 MiB of JSON, about
  1 MiB as binary buffers (positions, UVs, indices), and less if tiles
  share a mesh. The browser
  then only filters tiles by footprint and pixel size (about 30 lines, the
  same test as `viewCrsTileIndices` in `src/traversal.js`).
- Projection stays in R with full PROJ, so any source CRS works. The browser
  bundle needs no proj4 and no TIFF parser.
- The payload is tied to one view CRS, which is the trade-off the design post
  already accepts. It does not suit globe or spinning views.
- The planner reads tile byte ranges from the COG header. tifffile does it
  here; in R, GDAL exposes `BLOCK_OFFSET_x_y` and `BLOCK_SIZE_x_y` metadata
  items in the `TIFF` domain. Decoding is DEFLATE via `DecompressionStream`.
  Other codecs (LZW, ZSTD, LERC) and predictors would need browser decoders;
  `@developmentseed/geotiff` already has them.

**(b) browser traversal:** about 130 lines on top of deck.gl-raster 0.8.1 for
the prototype. Upstream, it needs:

1. A view-projection abstraction in `RasterTileset2D` and
   `raster-tile-traversal`. Today tile bounding volumes go through
   `projectTo3857` and are rescaled to the 512-unit Mercator world. The LOD
   test uses Mercator metres per pixel at the tile's latitude. Dataset bounds
   are clamped to 85.05 degrees. The per-tile mesh targets Mercator common
   space, with `_webMercatorInitialTriangulation` clamping it. All four need a
   "project to view", "view units per pixel" and "cull in view units" hook.
2. `tile.bbox` in view units for non-geographic views. deck.gl `TileLayer`
   culls sub-layers against it, so a lon/lat bbox culls every tile in an
   `OrthographicView`. The first prototype drew nothing because of this.
3. The `TileLayer` zoom gate. It hides everything below `minZoom` (default
   0), and an `OrthographicView` of metres sits near zoom -13. Lowering
   `minZoom` hangs the page: `Tileset2D` walks parents while `z > minZoom`,
   and `RasterTileset2D.getParentIndex` returns z = 0 for z = 0. The
   prototype sets `extent` to lift the gate instead.
4. A way to pass a custom tileset (or view projection) through
   `RasterTileLayer`/`COGLayer` without overriding `_renderTileLayer`.
5. The forward error metric from spike #3, for lon/lat sources over the pole.
6. Source-to-view projection in the browser. proj4 covers polar
   stereographic, but not every CRS PROJ does, so arbitrary CRSs need proj4
   definitions shipped from R, or PROJ in wasm.

Items 1 to 5 are upstream changes to deck.gl-raster's tiling core, several
PRs with tests and maintainer review. They are worth proposing: they also
serve lonboard. Item 6 is ongoing.

## Screenshots

Headless Chromium (SwiftShader WebGL), 900 x 900, `screenshots/`. Tile
outlines are coloured by COG level: red 0 (full resolution), orange 1, green
2, blue 3, purple 4. Labels are `level/col/row`. The red meridian is lon 180
(down in EPSG:3031) and the red ring is the pole.

| File | Shows |
| --- | --- |
| `a_3031_far.png`, `a_3031_all.png`, `a_3031_coast.png`, `a_3031_pole.png` | (a), 3031 COG at four zooms: levels 3, 1, 0, 0 |
| `a_3031_all_clean.png` | (a), 3031 COG, no outlines |
| `a_3031_wheel_1.png` .. `a_3031_wheel_4.png` | (a), one session zoomed with the mouse wheel: levels 2, 1, 1, 0 |
| `a_4326_far.png`, `a_4326_all.png` | (a), lon/lat COG: levels 2 and 0 |
| `a_4326_pole.png` | (a), lon/lat COG at the pole: 15 tile wedges meet cleanly |
| `a_4326_antimeridian.png` | (a), lon/lat COG across the image seam at 180 |
| `b_3031_far.png`, `b_3031_all.png`, `b_3031_pole.png` | (b) prototype, 3031 COG: same tiles as (a) |
| `b_4326_all_stock.png` | (b), lon/lat COG, stock mesh metric: gaps on the pole-row tile edges |
| `b_4326_all_forward.png` | (b), lon/lat COG with the forward metric: clean |

## Run it

Needs node 22 and Python 3 with `numpy rasterio pyproj tifffile` (rasterio
wheels bundle GDAL).

```sh
npm install
python3 make_cogs.py        # writes data/*.tif (about 31 MB, not committed)
npm run build               # bundles src/planned.js and src/traversal.js into dist/
python3 server.py 8941      # planner + Range server
# open http://localhost:8941/planned.html?cog=polar_3031&outlines=1
#      http://localhost:8941/traversal.html?cog=polar_3031&outlines=1
npm run shots               # headless screenshots and results.json (starts the server)
```

`screenshot.mjs` uses `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
(set `CHROMIUM` to change it) and `python3` (set `PYTHON` to a Python with the
packages above).

## Files

- `make_cogs.py`: the test COGs (same generator as `rasterlayer-3031/`).
  Only `polar_3031.tif` (2560 x 2560, 5 km, 5 levels) and `polar_4326.tif`
  (3600 x 500, 0.1 degree, 5 levels) are used here.
- `planner.py`: approach (a), the R stand-in. It reads COG structure, chooses
  a level, culls tiles and builds meshes.
- `server.py`: transport stand-in. `/plan` returns JSON, and everything else
  is static with HTTP Range.
- `src/planned.js`: the (a) browser side: Range fetch, inflate, colour, and a
  `SimpleMeshLayer` per tile.
- `src/traversal.js`: the (b) prototype on deck.gl-raster.
- `src/forward-metric.js`: spike #3's mesh error metric patch.
- `src/common.js`: colour ramp, graticule and camera presets.
- `screenshot.mjs`: headless screenshots, including the mouse-wheel session.

The planner chooses one level per view: the coarsest whose source pixel is
no larger than a device pixel. For lon/lat sources it uses the meridional
pixel size. Tiles are culled by the bounding box of their projected
footprint, which is loose for pole wedges: the antimeridian view fetches 8
tiles where fewer would do. A per-tile quadtree, as in (b), would refine
that. Both are details the R planner can improve without changing the
contract.
