suppressMessages({library(nanoarrow); library(geoarrow); library(wk)})
a <- commandArgs(TRUE); pre <- a[1]
co <- function(f) {
  df <- as.data.frame(read_nanoarrow(f))
  g <- df[["geometry"]]
  x <- wk_coords(g)
  enc <- read_nanoarrow(f)$get_schema()$children$geometry$metadata[["ARROW:extension:name"]]
  list(enc = enc, n = nrow(x), nonfinite = sum(!is.finite(x$x) | !is.finite(x$y)), x = x$x, y = x$y, feat = length(g))
}
ref <- co(sprintf("out/%s_ogr2ogr_arrow.arrows", pre))
for (r in c("ogr2ogr_arrow","pipeline_stream","vrt_warped","wk_proj_stream","wk_proj_memory")) {
  f <- sprintf("out/%s_%s.arrows", pre, r); if (!file.exists(f)) next
  o <- co(f)
  d <- if (o$n == ref$n) max(abs(c(o$x - ref$x, o$y - ref$y)), na.rm = TRUE) else NA
  cat(sprintf("%-16s encoding=%s features=%d vertices=%d nonfinite=%d max_diff_vs_ogr2ogr_m=%s\n", r, o$enc, o$feat, o$n, o$nonfinite, format(d, digits = 3)))
}
