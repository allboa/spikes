# Decision 0012 gate, 2026-11-21

npm: dist-tags {"v8-latest":"8.9.36","beta":"10.0.0-alpha.1","latest":"9.4.1","v9.3-latest":"9.3.12"}; 1 version(s) 10 or later

| gate | state |
| --- | --- |
| 1. deck.gl 10 on npm | open: 10.0.0-alpha.1 |
| 2. draws lon/lat in an EPSG:3031 view | closed: only 31 percent of the reference drawn |
| 3. within 1 px of PROJ | not run (gate 2 closed) |

Baseline on deck.gl 9.4.1 (OrthographicView, CARTESIAN), against PROJ's densified reference (13806 ink pixels):

| drawing | within 1 px (to ref, from ref) | largest gap px | passes |
| --- | --- | --- | --- |
| proj4js, sparse vertices | 48.4%, 48.4% | >10 | no (expected: no subdivision) |
| proj4js, densified 0.05 deg | 100.0%, 100.0% | 0 | yes |
| deck.gl 10.0.0-alpha.1, renderer reprojection | 45.1%, 28.2% | >10 | no |
| deck.gl 10.0.0-alpha.1, view CRS without its area of use (diagnostic) | 48.4%, 48.4% | >10 | no |

Harness ok.
