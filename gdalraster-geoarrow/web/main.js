// Draw an Arrow IPC stream whose geometry column is native GeoArrow
// (geoarrow.linestring, interleaved FixedSizeList<double,2>) in an
// OrthographicView, in the data's own CRS (EPSG:3031 metres).
// Modelled on the probe template in allboa/design (origin/2026-09-30/probe).
import { tableFromIPC } from "apache-arrow";
import { Deck, OrthographicView, COORDINATE_SYSTEM } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";

const statusEl = document.getElementById("status");
const report = {};
window.__spike = report;

function fail(msg) {
  statusEl.textContent = msg;
  statusEl.className = "status error";
  report.error = msg;
}

async function main() {
  const src = new URLSearchParams(location.search).get("src") || "../coast.arrows";
  const t0 = performance.now();
  const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
  const table = tableFromIPC(bytes);
  const decodeMs = performance.now() - t0;

  // find the geometry column by its extension name, as a renderer would
  const field = table.schema.fields.find((f) => f.metadata.get("ARROW:extension:name"));
  if (!field) return fail("No GeoArrow extension field in the stream.");
  const ext = field.metadata.get("ARROW:extension:name");
  const vertexType = field.type.children[0].type;
  report.src = src;
  report.bytes = bytes.length;
  report.rows = table.numRows;
  report.batches = table.batches.length;
  report.column = field.name;
  report.extension = ext;
  report.fieldExtensionMetadata = field.metadata.get("ARROW:extension:metadata") || null;
  report.storage = String(field.type);
  report.vertexIsFixedSizeList2 = vertexType.typeId === 16 && vertexType.listSize === 2;
  report.crsFromSchemaGeo = (() => {
    // GDAL's Arrow driver puts the CRS in the schema-level "geo" metadata
    // (as WKT2 or PROJJSON), not in ARROW:extension:metadata on the field.
    try {
      const crs = JSON.parse(table.schema.metadata.get("geo")).columns[field.name].crs;
      if (typeof crs === "string") {
        const m = crs.match(/ID\["EPSG",(\d+)\]\]\s*$/);
        return m ? "EPSG:" + m[1] : "WKT";
      }
      return crs && crs.id ? crs.id.authority + ":" + crs.id.code : "PROJJSON";
    } catch (e) { return "none"; }
  })();
  if (ext !== "geoarrow.linestring") return fail("Expected geoarrow.linestring, got " + ext);
  if (!report.vertexIsFixedSizeList2) return fail("Expected interleaved xy vertices, got " + String(vertexType));

  // geoarrow.linestring: List<FixedSizeList<double,2>>. Bind buffers per batch;
  // no parsing, no per-feature objects.
  const col = table.getChild(field.name);
  const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const lineColor = dark ? [120, 190, 220, 255] : [30, 70, 95, 255];
  const layers = [];
  let vertices = 0;
  let extent = 0;
  col.data.forEach((d, i) => {
    const n = d.length;
    const offs = d.valueOffsets;
    const coords = d.children[0].children[0].values; // Float64Array, xyxy...
    const base = offs[0];
    const starts = base === 0 ? offs.subarray(0, n) : Int32Array.from(offs.subarray(0, n), (o) => o - base);
    const view = coords.subarray(base * 2, offs[n] * 2);
    vertices += offs[n] - base;
    for (let k = 0; k < view.length; k++) extent = Math.max(extent, Math.abs(view[k]));
    layers.push(new PathLayer({
      id: "coast-" + i,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      _pathType: "open",
      positionFormat: "XY",
      data: { length: n, startIndices: starts, attributes: { getPath: { value: view, size: 2 } } },
      getColor: lineColor,
      getWidth: 1.2,
      widthUnits: "pixels"
    }));
  });
  report.vertices = vertices;
  report.extent_m = extent;

  document.getElementById("meta").textContent =
    ext + " | " + report.storage + " | " + table.numRows + " rows, " +
    vertices.toLocaleString("en-US") + " vertices | " + (bytes.length / 1024).toFixed(0) + " KiB | " +
    "crs " + report.crsFromSchemaGeo;

  const host = document.getElementById("deck");
  const w = host.clientWidth || 800;
  const h = host.clientHeight || 800;
  const zoom = Math.log2(Math.min(w, h) * 0.95 / (2 * extent));
  new Deck({
    parent: host,
    views: new OrthographicView({ id: "polar", flipY: false, controller: true }),
    initialViewState: { target: [0, 0, 0], zoom, minZoom: zoom - 2, maxZoom: zoom + 9 },
    layers,
    onAfterRender: () => { report.rendered = true; },
    onError: (err) => fail("Rendering error: " + (err && err.message ? err.message : err))
  });
  statusEl.textContent = "Arrow IPC decoded in " + decodeMs.toFixed(1) + " ms (fetch included); geometry buffers bound as decoded.";
}

main().catch((e) => fail(String(e && e.stack ? e.stack : e)));
