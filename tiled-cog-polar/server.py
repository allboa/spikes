# Transport stand-in for the R side (in R this would be an httpuv server or a
# websocket in the core's local-server transport).
#
#   GET /plan?cog=polar_3031&view=xmin,ymin,xmax,ymax&mpp=<m per device px>[&level=n]
#       -> JSON plan from planner.plan()
#   GET /<path>   static files with HTTP Range support (the COG bytes)
#
# Usage: python server.py [port]
import json, os, sys, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import planner

HERE = os.path.dirname(os.path.abspath(__file__))
COGS = {}


def get_cog(name):
    if name not in COGS:
        rel = f"data/{name}.tif"
        COGS[name] = planner.Cog(os.path.join(HERE, rel), rel)
    return COGS[name]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/plan":
            q = parse_qs(u.query)
            t0 = time.perf_counter()
            view = [float(v) for v in q["view"][0].split(",")]
            level = int(q["level"][0]) if "level" in q else None
            p = planner.plan(get_cog(q["cog"][0]), view, float(q["mpp"][0]), level)
            p["plan_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            body = json.dumps(p).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        rng = self.headers.get("Range")
        path = self.translate_path(u.path)
        if rng and os.path.isfile(path):
            size = os.path.getsize(path)
            a, b = rng.replace("bytes=", "").split("-")
            start = int(a) if a else size - int(b)
            end = min(int(b), size - 1) if (a and b) else size - 1
            with open(path, "rb") as f:
                f.seek(start)
                data = f.read(end - start + 1)
            self.send_response(206)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8941
    print(f"serving {HERE} on http://localhost:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
