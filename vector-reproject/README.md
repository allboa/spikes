# Spike: vector reprojection, GDAL streaming or wk + PROJ

Issue: [allboa/spikes#8](https://github.com/allboa/spikes/issues/8).
Decision record: `allboa/design` `decisions/0004-vector-reprojection.md`.

Question: when vector data must reach the view CRS, should GDAL reproject it
as it streams from the source (virtual, on the fly), or should R transform
it in memory with a wk handler fed by a PROJ transform
(`PROJ::proj_trans_create()` into `wk::wk_transform()`)?

## What it showed

- **The numbers are identical.** Every route calls the same PROJ, so the
  coordinates agree to the bit (maximum difference 0 m) on the Natural Earth
  50m coastline, 50m land, and a 2.8 million vertex 10m coastline, all
  lon/lat into EPSG:3031.
- **Speed and memory barely differ.** At 2.8 million vertices every route
  takes 2 to 4 seconds and peaks at 320 to 490 MB above baseline. The output
  blob has to be complete for the embed transport, so streaming the input
  saves little.
- **GDAL is geometry-aware; wk + PROJ is per coordinate.** Into a lon/lat
  target, GDAL splits lines at the antimeridian and closes a pole-enclosing
  ring along +-180 and -90. It does this by default, in `ogr2ogr` and in
  `gdal vector reproject`. A per-coordinate transform draws the line across
  the whole map and gives a wrong ring. Into a polar projected target from
  lon/lat, the two agree.
- **Neither guards the view's domain.** The north pole into EPSG:3031 comes
  back from PROJ as y = 4.0e23, a finite number, on every route. Clipping to
  the view's valid area has to happen in the source CRS, before any route.
- **Densifying is GDAL-only for now.** GDAL segmentizes lazily
  (`gdal vector segmentize`, GDAL 3.12) or in `ogr2ogr -segmentize`. wk 0.9.5
  has no segmentize filter, and an OGR VRT warped layer has no densify step.

## Routes

All routes end in a native, interleaved GeoArrow stream in EPSG:3031,
written to Arrow IPC bytes. The code is [`bench.R`](bench.R).

| Route | Reprojects in | Densify | Lazy input | GeoArrow encoding in |
| --- | --- | --- | --- | --- |
| `ogr2ogr_arrow` | GDAL (`ogr2ogr -t_srs`) | `-segmentize` | no, full copy in `/vsimem` | GDAL Arrow driver (current aobcore, decision 0002) |
| `pipeline_stream` | GDAL (`gdal vector pipeline ! reproject`, `--of stream`) | `segmentize` step | yes | R, per batch (WKB to geoarrow writer in one C pass) |
| `vrt_warped` | GDAL (OGR VRT `OGRVRTWarpedLayer`) | none | yes | R, per batch |
| `wk_proj_stream` | wk (`wk_transform_filter` with a PROJ trans) | GDAL `segmentize` step, lazy | yes | R, per batch, same pass as the transform |
| `wk_proj_memory` | wk (`wk_transform` on the whole vector) | none | no, whole layer read | R |

## Results

Full output: [`results.txt`](results.txt). Versions: R 4.5.3, GDAL 3.13.3,
PROJ 9.9.0, gdalraster 2.7.0, PROJ (R package) 0.7.0, wk 0.9.5, geoarrow
0.4.4 and nanoarrow 0.8.0.1, all from conda-forge; aobcore at allboa/aobcore
main (8a8c278).

Natural Earth 10m coastline densified to 0.005 degrees (4,133 lines, 2,772,032
vertices, 42 MB of IPC), lon/lat into EPSG:3031, second of two runs:

| Route | Seconds | Peak MB over base | Max difference from `ogr2ogr_arrow` |
| --- | --- | --- | --- |
| `ogr2ogr_arrow` | 2.69 | 459 | 0 |
| `pipeline_stream` | 2.16 | 369 | 0 |
| `vrt_warped` | 2.49 | 367 | 0 |
| `wk_proj_stream` | 1.73 | 317 | 0 |
| `wk_proj_memory` | 2.53 | 413 | 0 |

The first run was within 1 second and 30 MB of these. The 50m coastline with
a 0.25 degree densify gives 69,949 vertices on every route that densifies,
identical to the bit, in 0.1 to 0.3 seconds.

Edge cases, from [`edge.R`](edge.R):

| Case | GDAL (`ogr2ogr`, with or without `-wrapdateline`, and `gdal vector reproject`) | wk + PROJ |
| --- | --- | --- |
| North pole into EPSG:3031 | `POINT (0 4.0e23)` | the same |
| Ring around the south pole, EPSG:3031 into lon/lat | 8 vertices, closed along +-180 and -90 | 5 vertices, wrong ring |
| Line from 170E to 170W at 70S, EPSG:3031 into lon/lat | two parts split at 180 | one line across the map |
| ne_50m_land into EPSG:3031 | 60,669 vertices | identical, difference 0 m |

## Notes

- `gdalraster::gdal_run("vector pipeline", ...)` with `write --of stream`
  returns a lazy `GDALVector` (via `$outputs()`, since the pipeline has more
  than one output). Its `getArrowStream()` is the generic one, so geometry
  arrives as WKB, per decision 0002. `geoarrow::geoarrow_writer()` as a wk
  handler turns each batch into native interleaved GeoArrow in one C pass,
  and `wk::wk_transform_filter()` can sit in front of it to transform in the
  same pass.
- The CLI pipeline needs GDAL 3.11.3 or later in gdalraster (2.2.0 or
  later). The `segmentize` step needs GDAL 3.12. The pipeline route does not
  need GDAL's Arrow driver, so the `libgdal-arrow-parquet` plugin is not
  required.
- `PROJ::proj_trans_create()` returns an object of class
  `c("proj_trans", "wk_trans")`, so it plugs into `wk_transform()` and
  `wk_transform_filter()` directly.
- Peak memory is measured as `VmHWM` minus `VmRSS` after the libraries load,
  in a fresh process per route.

## Running it

Create the conda-forge environment in [`environment.yml`](environment.yml),
install aobcore from allboa/aobcore main, and run [`run.sh`](run.sh). It
downloads Natural Earth GeoJSON into `data/` (not committed) and writes the
IPC outputs to `data/out/`.
