#!/usr/bin/env node
// Tiny static web server for a project's docs website (no dependencies).
// Usage: node docs-serve.mjs <dist-folder> <port>
// Files are read on every request, so a rebuild shows up immediately.
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';

const root = resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4321);
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.pdf': 'application/pdf',
};

async function findFile(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch { return null; }
  const full = resolve(join(root, p));
  if (full !== root && !full.startsWith(root + sep)) return null; // no escaping the folder
  for (const candidate of [full, join(full, 'index.html'), full + '.html']) {
    try { if ((await stat(candidate)).isFile()) return candidate; } catch {}
  }
  return null;
}

createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let file = await findFile(req.url || '/');
  let status = 200;
  if (!file) { status = 404; file = await findFile('/404.html'); }
  if (!file) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found (docs not built yet? run: kit docs build)'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(status, { 'content-type': types[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500).end(); }
}).listen(port, '0.0.0.0', () => console.log(`Docs: serving ${root} on port ${port}`));
