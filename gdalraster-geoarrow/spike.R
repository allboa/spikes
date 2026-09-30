# Spike allboa/spikes#2: gdalraster to native GeoArrow.
#
# Question: can an OGR layer reach the browser as a native GeoArrow column
# (geoarrow.linestring, not WKB) through gdalraster's Arrow stream, with GDAL
# asked for GeoArrow encoding and no conversion in between?
#
# Three routes are tried and reported:
#   A. GeoJSON source, GDALVector$getArrowStream() with each encoding option.
#   B. GDAL does clip + reproject + GeoArrow encoding (ogr2ogr to the Arrow
#      driver with GEOMETRY_ENCODING=GEOARROW, in /vsimem), then
#      GDALVector$getArrowStream() on that dataset. Written to IPC by nanoarrow.
#   C. Route A's WKB stream converted in R by geoarrow (the R-side fallback).
#
# Output: coast.arrows (Arrow IPC stream, route B) and coast-c.arrows (route C)
# next to this script, read by index.html.
#
# Run: Rscript spike.R   (see README.md for the environment)

suppressPackageStartupMessages({
  library(gdalraster)
  library(nanoarrow)
  library(geoarrow)
})

here <- function(...) file.path(getwd(), ...)

cat(gdal_version()[1], "\n")
cat("gdalraster", format(packageVersion("gdalraster")),
    "nanoarrow", format(packageVersion("nanoarrow")),
    "geoarrow", format(packageVersion("geoarrow")),
    "wk", format(packageVersion("wk")), "\n")
cat("Arrow driver present:", "Arrow" %in% gdal_formats()$short_name, "\n\n")

src <- paste0("/vsicurl/https://raw.githubusercontent.com/nvkelso/",
              "natural-earth-vector/master/geojson/ne_50m_coastline.geojson")

geom_field <- function(schema) {
  for (ch in schema$children) {
    ext <- ch$metadata[["ARROW:extension:name"]]
    if (!is.null(ext)) return(list(name = ch$name, format = ch$format, ext = ext))
  }
  NULL
}

# ---- A: generic OGR Arrow stream on a GeoJSON layer ----------------------
cat("== Route A: GeoJSON layer, generic OGR Arrow stream\n")
lyr <- new(GDALVector, src)
cat("driver", lyr$getDriverShortName(), "| FastGetArrowStream",
    lyr$testCapability()$FastGetArrowStream, "\n")
for (opt in list(character(),
                 "GEOMETRY_METADATA_ENCODING=GEOARROW",
                 "GEOMETRY_ENCODING=GEOARROW")) {
  lyr$arrowStreamOptions <- opt
  s <- lyr$getArrowStream()
  g <- geom_field(s$get_schema())
  cat(sprintf("  %-38s -> %s format=%s ext=%s\n",
              if (length(opt)) opt else "(no options)", g$name, g$format, g$ext))
  s$release()
  lyr$releaseArrowStream()
}
lyr$close()

# ---- B: GDAL writes GeoArrow (Arrow driver), gdalraster streams it -------
cat("\n== Route B: ogr2ogr to Arrow driver (GEOMETRY_ENCODING=GEOARROW_INTERLEAVED), then stream\n")
mem <- "/vsimem/coast.arrows"
ok <- ogr2ogr(src, mem, cl_arg = c(
  "-f", "Arrow",
  "-nln", "coast",
  "-clipsrc", "-180", "-90", "180", "-40",   # south of 40S
  "-segmentize", "0.25",                     # densify in degrees before projecting
  "-explodecollections", "-nlt", "LINESTRING",
  "-t_srs", "EPSG:3031",
  "-lco", "FORMAT=STREAM",
  "-lco", "GEOMETRY_ENCODING=GEOARROW_INTERLEAVED",  # FixedSizeList<double,2>
  "-lco", "FID="                             # no FID column
))
stopifnot(isTRUE(ok))

lyr <- new(GDALVector, mem)
cat("driver", lyr$getDriverShortName(), "| FastGetArrowStream",
    lyr$testCapability()$FastGetArrowStream, "| features", lyr$getFeatureCount(), "\n")
lyr$arrowStreamOptions <- c("GEOMETRY_METADATA_ENCODING=GEOARROW", "INCLUDE_FID=NO")
s <- lyr$getArrowStream()
g <- geom_field(s$get_schema())
cat(sprintf("  stream geometry -> %s format=%s ext=%s\n", g$name, g$format, g$ext))

# the stream goes straight to IPC bytes: no WKB, no conversion in R
out_b <- here("coast.arrows")
write_nanoarrow(s, out_b)
invisible(lyr$releaseArrowStream())
lyr$close()
invisible(vsi_unlink(mem))
cat("  wrote", out_b, file.size(out_b), "bytes\n")

# read back with nanoarrow as an independent check of what the browser gets
chk <- read_nanoarrow(out_b)
g <- geom_field(chk$get_schema())
sch <- chk$get_schema()
tbl <- as.data.frame(chk)
cat(sprintf("  IPC check -> %s format=%s child=%s ext=%s rows=%d\n", g$name, g$format,
            sch$children[[g$name]]$children[[1]]$format, g$ext, nrow(tbl)))
cat("  field ARROW:extension:metadata:",
    if (is.null(m <- sch$children[[g$name]]$metadata[["ARROW:extension:metadata"]])) "(absent)" else substr(m, 1, 100), "\n")
cat("  schema 'geo' metadata:", substr(sch$metadata[["geo"]], 1, 160), "...\n")

# ---- C: WKB stream converted in R by geoarrow -----------------------------
cat("\n== Route C: GeoJSON WKB stream, converted in R by geoarrow\n")
lyr <- new(GDALVector, src)
lyr$arrowStreamOptions <- c("GEOMETRY_METADATA_ENCODING=GEOARROW", "INCLUDE_FID=NO")
s <- lyr$getArrowStream()
tab <- as.data.frame(s)                         # geometry column is geoarrow_vctr (wkb)
invisible(lyr$releaseArrowStream())
lyr$close()
gcol <- names(tab)[vapply(tab, inherits, logical(1), "geoarrow_vctr")]
cat("  R column", gcol, "class", class(tab[[gcol]])[1], "\n")
# (clip/reproject omitted here; route C shows only the encoding step)
native <- as_geoarrow_vctr(tab[[gcol]], schema = geoarrow_multilinestring(coord_type = "INTERLEAVED"))
df <- data.frame(geometry = native)
out_c <- here("coast-c.arrows")
write_nanoarrow(df, out_c)
chk <- read_nanoarrow(out_c)
g <- geom_field(chk$get_schema())
sch <- chk$get_schema()
cat(sprintf("  IPC check -> %s format=%s ext=%s field crs in ARROW:extension:metadata: %s\n", g$name, g$format, g$ext,
            grepl("\"crs\"", sch$children[[g$name]]$metadata[["ARROW:extension:metadata"]] %||% "")))
