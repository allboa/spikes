# R-planned tiles: the planner. This is the part the R core would own
# (in R it would read the same COG structure through GDAL, e.g. gdalraster's
# BLOCK_OFFSET_x_y / BLOCK_SIZE_x_y metadata items in the TIFF domain, and
# project with PROJ). Python stands in for R in the spike.
#
# Given a COG and a view (extent in view-CRS metres plus metres per device
# pixel), plan() picks one overview level, finds the tiles whose footprint
# meets the view, and returns for each tile:
#   - where its bytes are: URL, byte offset and length inside the COG
#   - a mesh already projected to the view CRS (EPSG:3031), with UVs into the
#     tile's texture and triangle indices
# The browser fetches the byte ranges itself, decodes and draws. It never
# parses the TIFF and never projects anything.
import math
import numpy as np
import tifffile
from pyproj import Transformer

VIEW_CRS = "EPSG:3031"
_to_view = {4326: Transformer.from_crs("EPSG:4326", VIEW_CRS, always_xy=True)}
MAX_CELL_DEG = 2.0          # mesh cell size for lon/lat sources (curvature)


class Cog:
    """Structure of one COG: levels, tile byte ranges, geotransform, CRS."""

    def __init__(self, path, url):
        self.path, self.url = path, url
        tf = tifffile.TiffFile(path)
        p0 = tf.pages[0]
        self.byteorder = tf.byteorder
        scale = p0.tags["ModelPixelScaleTag"].value
        tie = p0.tags["ModelTiepointTag"].value
        geokeys = p0.geotiff_tags or {}
        epsg = geokeys.get("ProjectedCSTypeGeoKey") or geokeys.get("GeographicTypeGeoKey")
        self.epsg = int(getattr(epsg, "value", epsg))
        self.nodata = float(p0.tags["GDAL_NODATA"].value) if "GDAL_NODATA" in p0.tags else None
        self.x0, self.y0 = tie[3], tie[4]
        W0 = p0.shape[1]
        self.levels = []
        for i, p in enumerate(tf.pages):
            if i > 0 and not p.is_reduced:
                continue                                   # skip masks
            assert p.compression == 8 and p.predictor == 1 and p.dtype == np.float32
            h, w = p.shape
            f = W0 / w                                     # decimation factor
            self.levels.append(dict(
                index=len(self.levels), width=w, height=h,
                tw=p.tilewidth, th=p.tilelength,
                ncol=math.ceil(w / p.tilewidth), nrow=math.ceil(h / p.tilelength),
                offsets=list(p.dataoffsets), counts=list(p.databytecounts),
                dx=scale[0] * f, dy=scale[1] * f))
        tf.close()

    # pixel (col, row) at a level -> source CRS
    def px_to_src(self, L, col, row):
        return self.x0 + col * L["dx"], self.y0 - row * L["dy"]

    def to_view(self, x, y):
        if self.epsg == 3031:
            return np.asarray(x, float), np.asarray(y, float)
        return _to_view[self.epsg].transform(x, y)

    # size of one source pixel in view metres (used to choose the level)
    def pixel_m(self, L):
        if self.epsg == 3031:
            return L["dx"]
        # lon/lat: the meridional size of a pixel, at the latitude of true scale
        return L["dy"] * 111_320.0


def _tile_mesh(cog, L, tx, ty):
    """Mesh for one tile, in view metres. Returns positions, uvs, indices, bbox."""
    vw = min(L["tw"], L["width"] - tx * L["tw"])      # valid pixels in this tile
    vh = min(L["th"], L["height"] - ty * L["th"])
    if cog.epsg == 3031:
        nu = nv = 1                                        # affine: a quad is exact
    else:
        nu = max(1, math.ceil(vw * L["dx"] / MAX_CELL_DEG))
        nv = max(1, math.ceil(vh * L["dy"] / MAX_CELL_DEG))
    cu = np.linspace(0, vw, nu + 1)
    cv = np.linspace(0, vh, nv + 1)
    CU, CV = np.meshgrid(cu, cv)
    sx, sy = cog.px_to_src(L, tx * L["tw"] + CU.ravel(), ty * L["th"] + CV.ravel())
    X, Y = cog.to_view(sx, sy)
    pos = np.column_stack([X, Y, np.zeros_like(X)]).astype(np.float32)
    uv = np.column_stack([CU.ravel() / L["tw"], CV.ravel() / L["th"]]).astype(np.float32)
    idx = []
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            b, c = a + 1, a + nu + 1
            idx += [a, c, b, b, c, c + 1]
    bbox = [float(X.min()), float(Y.min()), float(X.max()), float(Y.max())]
    return pos, uv, np.asarray(idx, np.uint32), bbox


def choose_level(cog, m_per_px):
    """Coarsest level whose source pixel is no bigger than a device pixel."""
    best = cog.levels[0]
    for L in cog.levels:                                   # fine -> coarse
        if cog.pixel_m(L) <= m_per_px:
            best = L
    return best


def plan(cog, view, m_per_px, level=None):
    """view = [xmin, ymin, xmax, ymax] in view metres; m_per_px = metres per
    device pixel. Returns a JSON-able plan."""
    L = cog.levels[level] if level is not None else choose_level(cog, m_per_px)
    vx0, vy0, vx1, vy1 = view
    tiles = []
    for ty in range(L["nrow"]):
        for tx in range(L["ncol"]):
            k = ty * L["ncol"] + tx
            if L["counts"][k] == 0:
                continue                                   # sparse tile: all nodata
            pos, uv, idx, bb = _tile_mesh(cog, L, tx, ty)
            if bb[2] < vx0 or bb[0] > vx1 or bb[3] < vy0 or bb[1] > vy1:
                continue                                   # footprint misses the view
            tiles.append(dict(
                id=f"{L['index']}/{tx}/{ty}", z=L["index"], x=tx, y=ty,
                offset=int(L["offsets"][k]), length=int(L["counts"][k]),
                tw=L["tw"], th=L["th"],
                positions=[round(float(v), 1) for v in pos.ravel()],
                uvs=[round(float(v), 6) for v in uv.ravel()],
                indices=idx.tolist()))
    return dict(url=cog.url, view_crs=VIEW_CRS, source_epsg=cog.epsg,
                byteorder=cog.byteorder, dtype="float32", compression="deflate",
                nodata=cog.nodata, level=L["index"], levels=len(cog.levels),
                level_size=[L["width"], L["height"]], pixel_m=cog.pixel_m(L),
                m_per_px=m_per_px, tiles=tiles)
