// Local test server (no Netlify CLI needed): node dev.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
process.env.ADMIN_PASSWORD ??= "datta@29";
const dir = ".devdata"; fs.mkdirSync(dir, { recursive: true });
globalThis.__DEV_STORE = {
  async setJSON(k, v) { fs.writeFileSync(path.join(dir, k + ".json"), JSON.stringify(v)); },
  async get(k) { try { return JSON.parse(fs.readFileSync(path.join(dir, k + ".json"), "utf8")); } catch { return null; } },
  async list() { return { blobs: fs.readdirSync(dir).map((f) => ({ key: f.replace(/\.json$/, "") })) }; },
};
const { default: api } = await import("./netlify/functions/api.mjs");
const types = { ".html": "text/html", ".css": "text/css", ".png": "image/png", ".js": "text/javascript" };
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const url = new URL(req.url, "http://localhost:8888");
  if (url.pathname.startsWith("/api/")) {
    const r = await api(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(await r.text());
  }
  const f = path.join("public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!f.startsWith("public") || !fs.existsSync(f)) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
}).listen(8888, () => console.log("http://localhost:8888"));
