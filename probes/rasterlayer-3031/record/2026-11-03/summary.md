# Probe results: RasterLayer in EPSG:3031

Written by `run.mjs`. Each cell is the outcome (draws, blank or partial: the share of sample points over the data that are not background), marked with `!` where it differs from `expect.json`. Mesh is the layer's own: vertices and the error left, in the layer's metric.

| case | 0.8.1 (0.8.1) | 0.9.0 (0.9.0) | beta (0.10.0-beta.2) |
| --- | --- | --- | --- |
| 3031 | draws, 4 v, 0.000 px | draws, 4 v, 0.000 px | draws, 4 v, 0.000 px |
| 3031_pole | draws, 4 v, 0.000 px | draws, 4 v, 0.000 px | draws, 4 v, 0.000 px |
| 3031_antimeridian | draws, 4 v, 0.000 px | draws, 4 v, 0.000 px | draws, 4 v, 0.000 px |
| 4326 | blank, 10005 v, 3600.000 px | draws, 10005 v, 0.341 px | draws, 10005 v, 0.341 px |
| 4326_pole | blank, 10005 v, 3600.000 px | draws, 10005 v, 0.341 px | draws, 10005 v, 0.341 px |
| 4326_antimeridian | blank, 10005 v, 3600.000 px | draws, 10005 v, 0.341 px | draws, 10005 v, 0.341 px |
| 4326-90-270 | blank, 10005 v, 2700.000 px | draws, 8265 v, 0.125 px | draws, 8265 v, 0.125 px |
| 4326_mesh | picture only, 10005 v, 450.000 px | picture only, 3397 v, 0.125 px | picture only, 3397 v, 0.125 px |
| 4326_forward | draws, 10005 v, 0.216 px |  |  |
| 4326_forward_pole | draws, 10005 v, 0.216 px |  |  |
| 4326_forward_antimeridian | draws, 10005 v, 0.216 px |  |  |
