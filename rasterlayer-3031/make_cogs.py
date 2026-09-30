# Regenerate the spike's COGs (they are not committed).
# Stand-in for real polar data: a smooth synthetic "SST-like" field defined on
# lon/lat, with 30 degree sector stripes so seams at the antimeridian and
# the pole are easy to see.
#
#   polar_4326.tif        EPSG:4326, lon -180..180, lat -90..-40, 0.1 deg
#                         (the image edge IS the antimeridian; bottom row IS the pole)
#   polar_4326_90_270.tif EPSG:4326, lon 90..270, lat -90..-40, 0.1 deg
#                         (the antimeridian runs through the middle of the image)
#   polar_3031.tif        EPSG:3031, +-6.4e6 m, 5 km, nodata outside lat -40
#
# All are tiled 256x256 COGs, DEFLATE, with internal overviews.
# Needs: pip install numpy rasterio   (rasterio wheels bundle GDAL)
import os, sys
import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.shutil import copy as rio_copy

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(OUT, exist_ok=True)
LAT_LIMIT = -40.0
NODATA = -9999.0

def field(lon, lat):
    t = (lat + 90) / (LAT_LIMIT + 90)              # 0 at the pole, 1 at -40
    f = -1.8 + 14 * t ** 1.6 + 1.6 * np.sin(np.radians(lon) * 3 + t * 4) * np.sin(np.pi * t)
    # 30 degree sector stripes (lighter every other sector), fading out at the pole
    sector = (np.floor(np.mod(lon, 360) / 30) % 2) * 0.8 * np.clip(t * 4, 0, 1)
    # a ring at -60 and a marker blob centred on the antimeridian at -65
    ring = 2.0 * np.exp(-((lat + 60) / 0.4) ** 2)
    dl = np.mod(lon - 180 + 180, 360) - 180
    blob = 3.0 * np.exp(-((dl / 6) ** 2 + ((lat + 65) / 3) ** 2))
    return (f + sector + ring + blob).astype(np.float32)

def write_cog(path, arr, transform, crs, nodata=None):
    tmp = path + ".tmp.tif"
    prof = dict(driver="GTiff", width=arr.shape[1], height=arr.shape[0], count=1,
                dtype="float32", crs=crs, transform=transform, nodata=nodata)
    with rasterio.open(tmp, "w", **prof) as ds:
        ds.write(arr, 1)
    rio_copy(tmp, path, driver="COG", COMPRESS="DEFLATE", BLOCKSIZE=256,
             OVERVIEWS="AUTO", OVERVIEW_RESAMPLING="AVERAGE", RESAMPLING="AVERAGE")
    os.remove(tmp)
    with rasterio.open(path) as ds:
        print(os.path.basename(path), ds.width, ds.height, ds.crs, "overviews", ds.overviews(1))

def lonlat_cog(name, lon0, lon1, res=0.1):
    nx = int(round((lon1 - lon0) / res)); ny = int(round((LAT_LIMIT + 90) / res))
    lon = lon0 + res * (np.arange(nx) + 0.5)
    lat = LAT_LIMIT - res * (np.arange(ny) + 0.5)
    LON, LAT = np.meshgrid(lon, lat)
    arr = field(LON, LAT)
    write_cog(os.path.join(OUT, name), arr, from_bounds(lon0, -90, lon1, LAT_LIMIT, nx, ny), "EPSG:4326")
    return arr

lonlat_cog("polar_4326.tif", -180, 180)
lonlat_cog("polar_4326_90_270.tif", 90, 270)

# EPSG:3031 version: the same field sampled at 3031 cell centres, nodata outside LAT_LIMIT
from pyproj import Transformer
R, RES = 6_400_000, 5000
n = 2 * R // RES
dst_t = from_bounds(-R, -R, R, R, n, n)
dst = np.full((n, n), NODATA, dtype=np.float32)
# evaluate the analytic field directly at cell centres: exact, no warp blur
xs = -R + RES * (np.arange(n) + 0.5)
X, Y = np.meshgrid(xs, xs[::-1])
tr = Transformer.from_crs("EPSG:3031", "EPSG:4326", always_xy=True)
LON, LAT = tr.transform(X, Y)
ok = LAT <= LAT_LIMIT
dst[ok] = field(LON[ok], LAT[ok])
write_cog(os.path.join(OUT, "polar_3031.tif"), dst, dst_t, "EPSG:3031", nodata=NODATA)
