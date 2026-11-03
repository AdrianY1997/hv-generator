// Servidor estático mínimo para las pruebas (solo Node, sin dependencias). Sirve ../app en http://127.0.0.1:<PORT>/ (PORT, por omisión 4173).
// Uso:  node serve.mjs   (lo arranca Playwright desde playwright.config.mjs)
// `createAppServer({ stamp })` también lo usan las pruebas offline: con `stamp` reemplaza __BUILD__ en sw.js, igual que el workflow de Pages.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.map': 'application/json' };

export function createAppServer({ stamp = null } = {}) {
  return http.createServer((rq, rs) => {
    let p;
    try { p = decodeURIComponent(new URL(rq.url, 'http://x').pathname); } catch { rs.writeHead(400); rs.end('bad'); return; }
    if (p.endsWith('/')) p += 'index.html';
    const f = path.resolve(APP, '.' + p);
    if (!f.startsWith(APP + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404, { 'content-type': 'text/plain' }); rs.end('no'); return; }
    // Sin caché de navegador: las pruebas siempre ven el código actual (el service worker se prueba aparte).
    const headers = { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' };
    if (stamp && p === '/sw.js') {
      rs.writeHead(200, headers);
      rs.end(fs.readFileSync(f, 'utf8').replaceAll('__BUILD__', stamp));
      return;
    }
    rs.writeHead(200, headers);
    fs.createReadStream(f).pipe(rs);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = Number(process.env.PORT || 4173);
  const server = createAppServer();
  server.listen(PORT, '127.0.0.1', () => console.log(`sirviendo ${APP} en http://127.0.0.1:${PORT}/`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
