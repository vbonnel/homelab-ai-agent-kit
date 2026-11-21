#!/usr/bin/env node
// Tiny static web server for a project's docs website (no dependencies).
// Usage: node docs-serve.mjs <dist-folder> <port>
// Files are read on every request, so a rebuild shows up immediately.
// /_kit/edit: saving a page changed in the browser, when the project allows it (docs-edit.mjs).
import { realpathSync } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDIT_PATH, editHandler } from './docs-edit.mjs';

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml', '.pdf': 'application/pdf',
};

// Serve the folder `dist` on `port`. `options.edit`: passed to editHandler (tests replace the build).
export function startDocsServer(dist, port, { host = '0.0.0.0', edit = {} } = {}) {
  const root = resolve(dist);

  async function findFile(urlPath) {
    let p;
    try { p = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]); } catch { return null; }
    const full = resolve(join(root, p));
    if (full !== root && !full.startsWith(root + sep)) return null; // no escaping the folder
    for (const candidate of [full, join(full, 'index.html'), full + '.html']) {
      try { if ((await stat(candidate)).isFile()) return candidate; } catch {}
    }
    return null;
  }

  const editing = editHandler({ dist: root, findFile, ...edit });

  const server = createServer(async (req, res) => {
    let path = '/';
    try { path = new URL(req.url || '/', 'http://docs').pathname; } catch {}
    if (path === EDIT_PATH) {
      try { await editing(req, res); } catch { if (!res.headersSent) res.writeHead(500).end(); }
      return;
    }
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
  });
  server.listen(port, host);
  return server;
}

// Run as a command (the docs service): the path may go through a link (/opt/agent-kit)
const isMain = () => {
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
};
if (process.argv[1] && isMain()) {
  const dist = process.argv[2] || 'dist';
  const port = Number(process.argv[3] || 4321);
  startDocsServer(dist, port).on('listening', () => console.log(`Docs: serving ${resolve(dist)} on port ${port}`));
}
