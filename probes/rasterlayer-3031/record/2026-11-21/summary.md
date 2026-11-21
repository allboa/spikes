# Probe results: RasterLayer in EPSG:3031

Written by `run.mjs`. Each cell is the outcome (draws, blank, partial, or error when the page failed: from the share of sample points over the data that are not background), marked with `!` where it differs from `expect.json`. Mesh is the layer's own: vertices and the error left, in the layer's metric.

| case | 0.10.0 (0.10.0) | beta (0.10.0-beta.4) |
| --- | --- | --- |
| 3031 | draws, 4 v, 0.000 px | draws, 4 v, 0.000 px |
| 3031_pole | draws, 4 v, 0.000 px | draws, 4 v, 0.000 px |
| 3031_antimeridian | draws, 4 v, 0.000 px | draws, 4 v, 0.000 px |
| 4326 | draws, 10005 v, 0.341 px | draws, 10005 v, 0.341 px |
| 4326_pole | draws, 10005 v, 0.341 px | draws, 10005 v, 0.341 px |
| 4326_antimeridian | draws, 10005 v, 0.341 px | draws, 10005 v, 0.341 px |
| 4326-90-270 | draws, 8265 v, 0.125 px | draws, 8265 v, 0.125 px |
| 4326_mesh | picture only, 3397 v, 0.125 px | picture only, 3397 v, 0.125 px |
| 4326_forward |  |  |
| 4326_forward_pole |  |  |
| 4326_forward_antimeridian |  |  |
