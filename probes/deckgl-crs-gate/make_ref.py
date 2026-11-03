# Test lines for the 0012 gate, and their reference positions from PROJ.
#
# Writes data/lines.json:
#   lonlat: lines as sparse lon/lat vertices (long planar edges in EPSG:4326,
#           which a renderer has to subdivide to draw correctly)
#   ref:    the same lines densified in lon/lat (0.05 degree steps) and
#           projected to EPSG:3031 by PROJ (pyproj): the reference drawing
#   rings, refRings: polygon rings, the same way (drawn by their outlines)
#   points, refPoints: points in lon/lat and in EPSG:3031
#   crs4326, crs3031: PROJJSON for both CRSs, from PROJ, for the v10 page
#
# Needs: pip install pyproj
import json, os, sys
from pyproj import CRS, Transformer

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(OUT, exist_ok=True)
T = Transformer.from_crs("EPSG:4326", "EPSG:3031", always_xy=True)

lines = []
# meridians every 30 degrees, -40 to -85, two vertices each (straight in 3031 too)
for lon in range(-165, 180, 30):
    lines.append([[lon, -40.0], [lon, -85.0]])
# parallels with 30 degree vertex spacing: long edges that must curve
for lat in (-50.0, -60.0, -70.0, -80.0):
    lines.append([[float(lon), lat] for lon in range(-180, 181, 30)])
# a line across the antimeridian inside the domain (lon runs past 180)
lines.append([[160.0, -55.0], [200.0, -75.0]])
# a line towards the pole
lines.append([[45.0, -60.0], [45.0, -89.5]])

def densify(line, step=0.05):
    out = [line[0]]
    for (x0, y0), (x1, y1) in zip(line[:-1], line[1:]):
        n = max(1, int(max(abs(x1 - x0), abs(y1 - y0)) / step))
        for i in range(1, n + 1):
            t = i / n
            out.append([x0 + t * (x1 - x0), y0 + t * (y1 - y0)])
    return out


# polygon rings, closed: a ring of parallel -65 with 45 degree vertex spacing,
# and a box that crosses the antimeridian (lon runs past 180)
rings = [
    [[float(lon), -65.0] for lon in range(-180, 181, 45)],
    [[165.0, -58.0], [195.0, -58.0], [195.0, -68.0], [165.0, -68.0], [165.0, -58.0]],
]
points = [[float(lon), lat] for lat in (-45.0, -75.0) for lon in range(-150, 181, 60)]

def project(line):
    xs, ys = T.transform([p[0] for p in line], [p[1] for p in line])
    return [[round(x, 3), round(y, 3)] for x, y in zip(xs, ys)]

ref = [project(densify(line)) for line in lines]

out = {
    "lonlat": lines, "ref": ref,
    "rings": rings, "refRings": [project(densify(r)) for r in rings],
    "points": points, "refPoints": project(points),
    "crs4326": CRS.from_epsg(4326).to_json_dict(),
    "crs3031": CRS.from_epsg(3031).to_json_dict(),
}
with open(os.path.join(OUT, "lines.json"), "w") as f:
    json.dump(out, f)
print(f"{len(lines)} lines, {len(rings)} rings, {len(points)} points, {sum(len(r) for r in ref)} reference line vertices")
