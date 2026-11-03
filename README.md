# spikes

Throwaway experiments for allonboard. Each spike lives in its own folder and ends in a decision record in [allboa/design/decisions](https://github.com/allboa/design/tree/main/decisions), even when the answer is no.

Read the org agent brief first: [allboa/design AGENTS.md](https://github.com/allboa/design/blob/main/AGENTS.md). It covers the design principles, how work flows, and when to stop and ask.

## Probes

A probe is a spike made repeatable: it asks the same question of every new
release of what it depends on, checks the answer by itself, and runs in CI.
Probes live in [`probes/`](probes/), one folder each, with a workflow in
`.github/workflows/`. When a probe's answer changes, the decision record it
came from gets a follow-up note.

- [`probes/rasterlayer-3031/`](probes/rasterlayer-3031/): decision 0001, does
  deck.gl-raster's `RasterLayer` draw over the pole in EPSG:3031.
- [`probes/deckgl-crs-gate/`](probes/deckgl-crs-gate/): decision 0012's gate,
  can a deck.gl release draw lon/lat data in an EPSG:3031 view by itself,
  within 1 px of PROJ.
