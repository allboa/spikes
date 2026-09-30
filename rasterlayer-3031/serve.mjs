// Minimal static server with HTTP Range support (COG readers need it).
// Usage: node serve.mjs [port] [root]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] || 8931);
const root = path.resolve(process.argv[3] || path.dirname(new URL(import.meta.url).pathname));
const types = { ".html": "text/html", ".js": "text/javascript", ".tif": "image/tiff", ".json": "application/json", ".png": "image/png" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.writeHead(404).end(); return; }
  const size = fs.statSync(p).size;
  const head = { "Content-Type": types[path.extname(p)] || "application/octet-stream",
    "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length" };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (m) {
    let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
    let end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
    res.writeHead(206, { ...head, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    fs.createReadStream(p, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...head, "Content-Length": size });
    fs.createReadStream(p).pipe(res);
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
