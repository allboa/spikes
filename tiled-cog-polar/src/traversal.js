// Approach (b) prototype: browser-side tile traversal in the view CRS.
//
// deck.gl-raster's RasterTileLayer/COGLayer traverse the COG's own tile
// pyramid, but every geometric test in that traversal is done in Web Mercator:
// tile bounding volumes are sampled through projectTo3857 and rescaled to the
// 512-unit Mercator world, the level-of-detail test uses Mercator metres per
// pixel at the tile's latitude, the dataset bounds are clamped to 85.05
// degrees, and the per-tile mesh targets Mercator common space. None of that
// is meaningful in an OrthographicView of EPSG:3031 metres.
//
// This prototype keeps deck.gl-raster's pieces that are CRS-neutral
// (AffineTileset levels, RasterLayer meshes, TileLayer caching) and replaces
// the two Mercator-bound methods of RasterTileset2D:
//   - getTileIndices: a quadtree walk over the COG levels, culling with tile
//     footprints in view metres and choosing the level by source pixel size
//     against device pixels (2^zoom view units per CSS pixel);
//   - getTileMetadata: per-tile reprojection into the view CRS instead of
//     Mercator common space.
// RasterTileLayer._renderTileLayer is overridden only to swap in that tileset.
//
// URL parameters: cog=polar_3031 | polar_4326, view=<preset>, outlines=1,
//                 metric=forward (use spike #3's forward error metric patch)
import { Deck, OrthographicView, COORDINATE_SYSTEM } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { RasterTileLayer, RasterTileset2D, AffineTileset, AffineTilesetLevel } from "@developmentseed/deck.gl-raster";
import { GeoTIFF } from "@developmentseed/geotiff";
import { graticule, rampColor, VIEWS, fitZoom, project3031, unproject3031 } from "./common.js";
import { useForwardMetric } from "./forward-metric.js";

const q = new URLSearchParams(location.search);
const COG = q.get("cog") || "polar_3031";
const VIEW = q.get("view") || "all";
const OUTLINES = q.get("outlines") === "1";
useForwardMetric(q.get("metric") === "forward");
const statusEl = document.getElementById("status");
const result = { approach: "browser-traversal", cog: COG, view: VIEW, fetchedTiles: 0, warnings: 0 };
window.__spike = result;
const ow = console.warn; console.warn = (...a) => { result.warnings++; ow(...a); };
const LEVEL_COLORS = [[230, 60, 60], [240, 150, 30], [40, 160, 70], [60, 110, 230], [160, 70, 200]];  // by COG level, as in planned.js

// ---- descriptor: the COG pyramid, coarse (z=0) to fine ----
function buildDescriptor(tiff, is3031) {
  const images = [...tiff.overviews].reverse().concat([tiff]);    // coarse -> fine
  const mpu = is3031 ? 1 : 111320;                                // metres per CRS unit (approx for degrees)
  const levels = images.map((img) => new AffineTilesetLevel({
    affine: img.transform, tileWidth: img.tileWidth, tileHeight: img.tileHeight,
    arrayWidth: img.width, arrayHeight: img.height, mpu,
  }));
  const toView = is3031 ? (x, y) => [x, y] : (x, y) => project3031(x, y);
  const fromView = is3031 ? (x, y) => [x, y] : (x, y) => unproject3031(x, y);
  const to4326 = is3031 ? (x, y) => unproject3031(x, y) : (x, y) => [x, y];
  const from4326 = is3031 ? (x, y) => project3031(x, y) : (x, y) => [x, y];
  const descriptor = new AffineTileset({
    levels,
    // Required by the Mercator code paths we bypass; never used for drawing here.
    projectTo3857: () => [NaN, NaN], projectFrom3857: () => [NaN, NaN],
    projectTo4326: to4326, projectFrom4326: from4326,
  });
  return { descriptor, images, toView, fromView };
}

// ---- traversal in the view CRS ----
const REF = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5], [0.5, 0.5]];
function footprint(level, x, y, toView) {
  const { topLeft: a, topRight: b, bottomLeft: c, bottomRight: d } = level.projectedTileCorners(x, y);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of REF) {
    const sx = (1 - u) * (1 - v) * a[0] + u * (1 - v) * b[0] + (1 - u) * v * c[0] + u * v * d[0];
    const sy = (1 - u) * (1 - v) * a[1] + u * (1 - v) * b[1] + (1 - u) * v * c[1] + u * v * d[1];
    const [px, py] = toView(sx, sy);
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  return [x0, y0, x1, y1];
}

function viewCrsTileIndices(descriptor, toView, viewport, pixelRatio, maxZ) {
  const zoom = Array.isArray(viewport.zoom) ? viewport.zoom[0] : viewport.zoom;
  const devPxPerViewUnit = Math.pow(2, zoom) * pixelRatio;
  const [vx0, vy0, vx1, vy1] = viewport.getBounds();
  const out = [];
  const visit = (z, x, y) => {
    const level = descriptor.levels[z];
    const [x0, y0, x1, y1] = footprint(level, x, y, toView);
    if (x1 < vx0 || x0 > vx1 || y1 < vy0 || y0 > vy1) return;         // culled
    const devPxPerSourcePx = level.metersPerPixel * devPxPerViewUnit;
    if (devPxPerSourcePx <= 1 || z >= maxZ) { out.push({ x, y, z }); return; }
    const child = descriptor.levels[z + 1];
    const { topLeft, bottomRight, topRight, bottomLeft } = level.projectedTileCorners(x, y);
    const xs = [topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]], ys = [topLeft[1], topRight[1], bottomLeft[1], bottomRight[1]];
    const r = child.crsBoundsToTileRange(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    // shrink by a hair so neighbours sharing an edge are not included
    for (let cy = r.minRow; cy <= r.maxRow; cy++) for (let cx = r.minCol; cx <= r.maxCol; cx++) {
      const cc = child.projectedTileCorners(cx, cy), pc = level.projectedTileCorners(x, y);
      const inside = Math.min(cc.bottomRight[0], pc.bottomRight[0]) > Math.max(cc.topLeft[0], pc.topLeft[0]) + 1e-9 &&
        Math.min(cc.topLeft[1], pc.topLeft[1]) > Math.max(cc.bottomRight[1], pc.bottomRight[1]) + 1e-9;
      if (inside) visit(z + 1, cx, cy);
    }
  };
  const root = descriptor.levels[0];
  for (let y = 0; y < root.matrixHeight; y++) for (let x = 0; x < root.matrixWidth; x++) visit(0, x, y);
  return out;
}

function makeTilesetClass(descriptor, toView, fromView) {
  return class ViewCrsTileset2D extends RasterTileset2D {
    getTileIndices(opts) {
      const idx = viewCrsTileIndices(descriptor, toView, opts.viewport, this.getPixelRatio(), descriptor.levels.length - 1);
      result.selected = idx.length;
      // report as COG levels (0 = full resolution), as the planner does
      result.selectedLevels = [...new Set(idx.map((i) => descriptor.levels.length - 1 - i.z))].sort();
      return idx;
    }
    getTileMetadata(index) {
      const meta = super.getTileMetadata(index);        // bbox, corners, tile transforms
      meta._projectPosition = toView;                     // view CRS, not Mercator common space
      meta._unprojectPosition = fromView;
      meta._webMercatorInitialTriangulation = undefined;  // no 85.05 degree clamp
      // deck.gl's TileLayer culls sub-layers against tile.bbox. A lon/lat bbox
      // ({west, south, ...}) is compared with view metres and culls every tile,
      // so give it the footprint in view units ({left, top, right, bottom}).
      const [x0, y0, x1, y1] = footprint(descriptor.levels[index.z], index.x, index.y, toView);
      meta.bbox = { left: x0, top: y1, right: x1, bottom: y0 };
      return meta;
    }
  };
}

class ViewCrsRasterTileLayer extends RasterTileLayer {
  static layerName = "ViewCrsRasterTileLayer";
  _renderTileLayer(descriptor, getTileData, renderTile) {
    const TilesetClass = this.props.tilesetClass;
    const device = this.context.device;
    class TilesetFactory extends TilesetClass {
      constructor(opts) {
        super(opts, descriptor, { getPixelRatio: () => {
          const ctx = device.getDefaultCanvasContext();
          const [bw] = ctx.getDrawingBufferSize(), [cw] = ctx.getCSSSize();
          return cw ? bw / cw : 1;
        } });
      }
    }
    return new TileLayer({
      id: `raster-tile-layer-${this.id}`,
      TilesetClass: TilesetFactory,
      getTileData: (tile) => this._wrapGetTileData(tile, getTileData),
      renderSubLayers: (props) => this._renderSubLayers(props, descriptor, renderTile),
      maxRequests: 16, refinementStrategy: "no-overlap",
      // TileLayer hides everything when viewport.zoom < minZoom (default 0)
      // unless `extent` is set, and an OrthographicView of metres sits near
      // zoom -13. Lowering minZoom is not an option: Tileset2D then walks
      // parents while z > minZoom, and RasterTileset2D.getParentIndex returns
      // z = 0 for z = 0, so it loops forever. Setting `extent` (unused by our
      // traversal) lifts the gate instead.
      extent: [-1e9, -1e9, 1e9, 1e9],
      onViewportLoad: this.props.onViewportLoad,
    });
  }
}

async function main() {
  const tiff = await GeoTIFF.fromUrl(new URL(`data/${COG}.tif`, location.href).href);
  const is3031 = tiff.crs === 3031;
  const { descriptor, images, toView, fromView } = buildDescriptor(tiff, is3031);
  const nodata = tiff.nodata;
  const TilesetClass = makeTilesetClass(descriptor, toView, fromView);

  const getTileData = async (tile) => {
    const { x, y, z } = tile.index;
    const t = await images[z].fetchTile(x, y, { boundless: false, signal: tile.signal });
    result.fetchedTiles++;
    const a = t.array, src = a.layout === "band-separate" ? a.bands[0] : a.data;
    const img = new ImageData(a.width, a.height);
    for (let i = 0; i < a.width * a.height; i++) {
      const v = src[i];
      if (nodata !== null && v === nodata) continue;
      const c = rampColor((v + 2) / 18);
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    return { image: img, width: a.width, height: a.height, z };
  };

  const host = document.getElementById("deck");
  const v = VIEWS[VIEW];
  const zoom = fitZoom(v.extent, host.clientWidth, host.clientHeight);
  let loaded = false;
  const layers = () => {
    const L = [new ViewCrsRasterTileLayer({
      id: "cog", tilesetDescriptor: descriptor, tilesetClass: TilesetClass,
      getTileData, renderTile: (d) => ({ image: d.image }),
      onViewportLoad: () => { loaded = true; },
    })];
    L.push(new PathLayer({ id: "graticule", data: graticule(), getPath: (d) => d.path, getColor: (d) => d.color,
      getWidth: (d) => d.w, widthUnits: "pixels", coordinateSystem: COORDINATE_SYSTEM.CARTESIAN }));
    L.push(new ScatterplotLayer({ id: "pole", data: [[0, 0]], getPosition: (d) => d, getRadius: 4, radiusUnits: "pixels",
      filled: false, stroked: true, getLineColor: [220, 40, 40, 255], lineWidthUnits: "pixels", getLineWidth: 1.5,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN }));
    return L;
  };
  const deck = new Deck({
    parent: host,
    views: new OrthographicView({ id: "polar", flipY: false, controller: true }),
    initialViewState: { target: [v.target[0], v.target[1], 0], zoom, minZoom: -16, maxZoom: -2 },
    layers: layers(),
    onError: (e) => { result.error = String(e && e.message || e); },
  });
  window.__deck = deck;
  const poll = setInterval(() => {
    const tl = deck.layerManager && deck.layerManager.getLayers().find((l) => l.id === "raster-tile-layer-cog");
    const ts = tl && tl.state && tl.state.tileset;
    if (ts && OUTLINES && !result._outlined && loaded) {
      result._outlined = true;
      const sel = ts.selectedTiles || [];
      const rings = sel.map((t) => {
        const { x, y, z } = t.index, level = descriptor.levels[z];
        const c = level.projectedTileCorners(x, y), ring = [];
        const edge = (p, q) => { for (let k = 0; k < 16; k++) { const f = k / 16; ring.push(toView(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f)); } };
        edge(c.topLeft, c.topRight); edge(c.topRight, c.bottomRight); edge(c.bottomRight, c.bottomLeft); edge(c.bottomLeft, c.topLeft);
        ring.push(ring[0]);
        const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        const lev = descriptor.levels.length - 1 - z;   // label as COG level, 0 = full resolution
        return { ring, z: lev, id: `${lev}/${x}/${y}`, center: [cx, cy] };
      });
      deck.setProps({ layers: layers().concat([
        new PathLayer({ id: "outlines", data: rings, getPath: (d) => d.ring, getColor: (d) => [...LEVEL_COLORS[d.z % 5], 255],
          getWidth: 1.5, widthUnits: "pixels", coordinateSystem: COORDINATE_SYSTEM.CARTESIAN }),
        new TextLayer({ id: "labels", data: rings, getPosition: (d) => d.center, getText: (d) => d.id, getSize: 12,
          background: true, getBackgroundColor: [255, 255, 255, 200], coordinateSystem: COORDINATE_SYSTEM.CARTESIAN }),
      ]) });
    }
    if (loaded && (!OUTLINES || result._outlined) && deck.layerManager.getLayers().every((l) => l.isLoaded)) {
      clearInterval(poll);
      statusEl.textContent =
        `browser traversal (prototype)  cog ${COG}  source EPSG:${is3031 ? 3031 : 4326}, view EPSG:3031\n` +
        `COG level(s) selected (0 = full resolution, ${descriptor.levels.length - 1} = coarsest): ${result.selectedLevels.join(", ")}\n` +
        `${result.selected} tiles selected, ${result.fetchedTiles} fetched, mesh warnings ${result.warnings}`;
      setTimeout(() => { document.body.dataset.ready = "1"; }, 500);
    }
  }, 100);
}
main().catch((e) => { result.error = String(e && e.stack || e); statusEl.textContent = "ERROR " + result.error; document.body.dataset.ready = "1"; });
