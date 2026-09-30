#!/usr/bin/env bash
# Runs the whole spike. Needs the conda-forge environment in environment.yml
# on PATH (with PROJ_DATA set if PROJ cannot find proj.db).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
data="$here/data"
mkdir -p "$data/out"
cd "$data"

ne=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
for f in ne_50m_coastline ne_50m_land ne_10m_coastline; do
  [ -f "$f.geojson" ] || curl -sSfL -o "$f.geojson" "$ne/$f.geojson"
done
[ -f coast50.gpkg ] || ogr2ogr -f GPKG coast50.gpkg ne_50m_coastline.geojson -nln coast
[ -f land50.gpkg ] || ogr2ogr -f GPKG land50.gpkg ne_50m_land.geojson -nln land
# 2.8 million vertices: the 10m coastline densified to 0.005 degrees
[ -f big.gpkg ] || ogr2ogr -f GPKG big.gpkg ne_10m_coastline.geojson \
  -segmentize 0.005 -nln coast -nlt LINESTRING -explodecollections

routes="ogr2ogr_arrow pipeline_stream vrt_warped wk_proj_stream wk_proj_memory"

echo "## 50m coastline, densify 0.25 degrees, into EPSG:3031"
for r in $routes; do
  Rscript "$here/bench.R" "$r" coast50.gpkg EPSG:3031 0.25 "out/small_$r.arrows"
done
Rscript "$here/compare.R" small

echo "## 10m coastline (2.8M vertices), no densify, into EPSG:3031, two runs"
for i in 1 2; do
  for r in $routes; do
    Rscript "$here/bench.R" "$r" big.gpkg EPSG:3031 0 "out/big_$r.arrows"
  done
done
Rscript "$here/compare.R" big

echo "## pipeline_stream with GDAL's Arrow and Parquet drivers switched off"
GDAL_SKIP="Arrow Parquet" Rscript -e 'cat("Arrow driver present:", "Arrow" %in% gdalraster::gdal_formats()$short_name, "\n")' 2>/dev/null | tail -1
GDAL_SKIP="Arrow Parquet" Rscript "$here/bench.R" pipeline_stream coast50.gpkg EPSG:3031 0.25 out/noarrow_pipeline_stream.arrows

Rscript "$here/edge.R" "$data"
