## Edge cases: where GDAL's geometry-aware reprojection (ogr2ogr and the
## gdal vector pipeline) and a per-coordinate wk + PROJ transform differ.
## Usage: Rscript edge.R <data-dir>
suppressMessages({library(gdalraster); library(wk)})
data_dir <- commandArgs(TRUE)[1]

## A one-layer GeoPackage from WKT strings, with a CRS.
mk <- function(name, wkt, crs) {
  f <- file.path(tempdir(), paste0(name, ".gpkg"))
  csv <- file.path(tempdir(), paste0(name, ".csv"))
  unlink(f)
  writeLines(c("id,WKT", sprintf('%d,"%s"', seq_along(wkt), wkt)), csv)
  ogr2ogr(csv, f, cl_arg = c("-f", "GPKG", "-a_srs", crs,
                             "-oo", "GEOM_POSSIBLE_NAMES=WKT",
                             "-oo", "KEEP_GEOM_COLUMNS=NO", "-nln", "x"))
  f
}
read_wkb <- function(f) {
  v <- GDALVector$new(f); d <- v$fetch(-1); v$close()
  wk::wkb(d[[attr(d, "gis")$geom_column]])
}
via_ogr2ogr <- function(f, crs, extra = character()) {
  o <- tempfile(fileext = ".gpkg")
  ogr2ogr(f, o, cl_arg = c("-t_srs", crs, extra))
  read_wkb(o)
}
via_pipeline <- function(f, crs) {
  o <- tempfile(fileext = ".gpkg")
  alg <- gdal_run("vector pipeline", c("read", f, "!", "reproject", "--output-crs", crs,
                                       "!", "write", o), quiet = TRUE)
  alg$release()
  read_wkb(o)
}
via_wk <- function(f, crs) {
  v <- GDALVector$new(f); src <- v$getSpatialRef(); v$close()
  wk_transform(read_wkb(f), PROJ::proj_trans_create(src, crs))
}
run <- function(title, f, crs) {
  cat("\n##", title, "\n\n")
  out <- list(
    "ogr2ogr -t_srs" = via_ogr2ogr(f, crs),
    "ogr2ogr -t_srs -wrapdateline" = via_ogr2ogr(f, crs, "-wrapdateline"),
    "gdal vector pipeline reproject" = via_pipeline(f, crs),
    "wk_transform + PROJ trans" = via_wk(f, crs)
  )
  for (nm in names(out)) {
    cat(nm, ":\n", paste0("  ", as.character(wk::as_wkt(out[[nm]])), "\n"), sep = "")
  }
}

## 1. The north pole into south polar stereographic. Its image is at
##    infinity; PROJ returns a huge finite number rather than an error.
run("North pole into EPSG:3031",
    mk("np", c("POINT (0 90)", "LINESTRING (0 80, 0 90, 180 80)"), "OGC:CRS84"),
    "EPSG:3031")

## 2. A ring around the south pole, EPSG:3031 into lon/lat.
run("Pole-enclosing ring, EPSG:3031 into OGC:CRS84",
    mk("ring", "POLYGON ((1000000 0, 0 1000000, -1000000 0, 0 -1000000, 1000000 0))",
       "EPSG:3031"),
    "OGC:CRS84")

## 3. A two-vertex line from 170E to 170W at 70S, EPSG:3031 into lon/lat.
p <- wk_coords(PROJ::proj_trans(wk::xy(c(170, -170), c(-70, -70), crs = "OGC:CRS84"),
                                "EPSG:3031"))
run("Antimeridian-crossing line, EPSG:3031 into OGC:CRS84",
    mk("am", sprintf("LINESTRING (%.6f %.6f, %.6f %.6f)", p$x[1], p$y[1], p$x[2], p$y[2]),
       "EPSG:3031"),
    "OGC:CRS84")

## 4. The same line into projected targets whose seam is at 180 degrees.
f <- mk("am", sprintf("LINESTRING (%.6f %.6f, %.6f %.6f)", p$x[1], p$y[1], p$x[2], p$y[2]),
        "EPSG:3031")
for (crs in c("EPSG:3857", "EPSG:8857")) {
  run(paste("Antimeridian-crossing line, EPSG:3031 into", crs), f, crs)
}

## 5. Natural Earth 50m land (Antarctica closes through -90 along +-180),
##    lon/lat into EPSG:3031: are the two routes identical?
f <- file.path(data_dir, "land50.gpkg")
a <- wk_coords(via_ogr2ogr(f, "EPSG:3031"))
b <- wk_coords(via_wk(f, "EPSG:3031"))
cat("\n## ne_50m_land, OGC:CRS84 into EPSG:3031\n\n")
cat(sprintf("ogr2ogr vertices: %d; wk + PROJ vertices: %d; max coordinate difference: %s m\n",
            nrow(a), nrow(b),
            if (nrow(a) == nrow(b)) format(max(abs(c(a$x - b$x, a$y - b$y)))) else "NA"))
