## Usage: Rscript bench.R <route> <dsn> <crs> <densify|0> <outfile>
## Each route ends in a native interleaved GeoArrow stream in <crs>, written to
## Arrow IPC bytes. Prints one line of JSON with timings and peak memory.
suppressMessages({
  library(gdalraster); library(nanoarrow); library(geoarrow); library(wk)
})
a <- commandArgs(TRUE)
route <- a[1]; dsn <- a[2]; crs <- a[3]; dens <- as.numeric(a[4]); out <- a[5]

hwm <- function() {
  x <- readLines("/proc/self/status")
  as.numeric(gsub("[^0-9]", "", grep("^VmHWM", x, value = TRUE))) / 1024
}
rss <- function() {
  x <- readLines("/proc/self/status")
  as.numeric(gsub("[^0-9]", "", grep("^VmRSS", x, value = TRUE))) / 1024
}
invisible(PROJ::proj_trans_create("OGC:CRS84", crs))  # load PROJ db up front
base <- rss()

ipc <- function(stream) {
  con <- rawConnection(raw(), open = "wb"); on.exit(close(con))
  write_nanoarrow(stream, con); rawConnectionValue(con)
}
schema_ls <- geoarrow_multilinestring(coord_type = "INTERLEAVED")
schema_ls <- geoarrow::as_geoarrow_schema(schema_ls)

## Convert one Arrow batch (WKB geometry) to native GeoArrow, optionally
## passing the coordinates through a wk_trans on the way. One C pass:
## WKB reader -> (transform filter) -> geoarrow writer.
convert_batch <- function(batch, trans = NULL) {
  df <- as.data.frame(batch)
  gcol <- names(df)[vapply(df, wk::is_handleable, logical(1))][1]
  g <- df[[gcol]]
  w <- geoarrow_writer(schema_ls)
  if (!is.null(trans)) w <- wk_transform_filter(w, trans)
  arr <- wk_handle(g, w)
  as_nanoarrow_array(data.frame(geometry = geoarrow::as_geoarrow_vctr(arr)))
}
drain <- function(stream, trans = NULL) {
  parts <- list(); n <- 0L
  while (!is.null(b <- stream$get_next())) {
    n <- n + 1L; parts[[n]] <- convert_batch(b, trans)
  }
  stream$release()
  basic_array_stream(parts, validate = FALSE)
}

vec_out <- function(alg) {
  o <- alg$outputs(); o[[which(vapply(o, inherits, TRUE, "Rcpp_GDALVector"))[1]]]
}
t0 <- proc.time()[["elapsed"]]
if (route == "ogr2ogr_arrow") {
  ## current aobcore route (decision 0002): materialise in /vsimem Arrow
  s <- aobcore::gdal_vector_stream(dsn, crs,
         densify = if (dens > 0) dens else NULL, explode = TRUE,
         options = c("-nlt", "LINESTRING"), route = "gdal")
  bytes <- ipc(s)
} else if (route == "pipeline_stream") {
  ## GDAL >= 3.11 CLI pipeline, "stream" output: lazy, per feature
  steps <- c("read", dsn, "!")
  if (dens > 0) steps <- c(steps, "segmentize", format(dens), "!")
  steps <- c(steps, "reproject", "--output-crs", crs, "!",
             "write", "--of", "stream", "streamed")
  alg <- gdal_run("vector pipeline", steps, quiet = TRUE)
  lyr <- vec_out(alg)
  lyr$arrowStreamOptions <- c("GEOMETRY_METADATA_ENCODING=GEOARROW", "INCLUDE_FID=NO")
  df <- drain(lyr$getArrowStream())
  bytes <- ipc(df)
} else if (route == "vrt_warped") {
  ## OGR VRT warped layer: lazy reprojection, no densify step available
  lname <- GDALVector$new(dsn)$getName()
  vrt <- sprintf('<OGRVRTDataSource><OGRVRTWarpedLayer><OGRVRTLayer name="%s"><SrcDataSource>%s</SrcDataSource></OGRVRTLayer><TargetSRS>%s</TargetSRS></OGRVRTWarpedLayer></OGRVRTDataSource>',
                 lname, normalizePath(dsn), crs)
  lyr <- GDALVector$new(vrt)
  lyr$arrowStreamOptions <- c("GEOMETRY_METADATA_ENCODING=GEOARROW", "INCLUDE_FID=NO")
  df <- drain(lyr$getArrowStream())
  bytes <- ipc(df)
} else if (route == "wk_proj_stream") {
  ## GDAL streams source-CRS batches (densified lazily in GDAL when asked);
  ## PROJ trans applied by wk per batch
  src <- if (dens > 0) {
    alg <- gdal_run("vector pipeline", c("read", dsn, "!", "segmentize", format(dens),
                    "!", "write", "--of", "stream", "streamed"), quiet = TRUE)
    vec_out(alg)
  } else GDALVector$new(dsn)
  src_crs <- src$getSpatialRef()
  tr <- PROJ::proj_trans_create(src_crs, crs)
  src$arrowStreamOptions <- c("GEOMETRY_METADATA_ENCODING=GEOARROW", "INCLUDE_FID=NO")
  df <- drain(src$getArrowStream(), tr)
  bytes <- ipc(df)
} else if (route == "wk_proj_memory") {
  ## everything in memory: read all WKB, transform whole vector, convert
  src <- GDALVector$new(dsn)
  tr <- PROJ::proj_trans_create(src$getSpatialRef(), crs)
  d <- src$fetch(-1)
  g <- wk::wkb(d[[attr(d, "gis")$geom_column]])
  g <- wk_transform(g, tr)
  bytes <- ipc(as_nanoarrow_array_stream(
    data.frame(geometry = as_geoarrow_vctr(g, schema = schema_ls))))
}
el <- proc.time()[["elapsed"]] - t0
writeBin(bytes, out)
cat(sprintf('{"route":"%s","seconds":%.2f,"peak_mb_over_base":%.0f,"ipc_mb":%.1f}\n',
            route, el, hwm() - base, length(bytes) / 2^20))
