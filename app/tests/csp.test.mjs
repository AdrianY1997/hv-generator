// Guarda de la CSP de index.html (G04/G05): si cambias el <script> en línea del tema, su hash debe cambiar en la CSP o el navegador lo
// bloquea (tema sin aplicar al cargar). Y la CSP no debe abrir la red más allá de api.github.com (sincronización con Gist).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] || '';
const dir = (name) => (csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name) || []).slice(1);

test('index.html tiene CSP antes de cualquier script', () => {
  assert.ok(csp, 'falta la CSP');
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'la CSP debe ir antes del primer <script>');
});

test('cada <script> en línea está permitido por su hash; sin unsafe-inline ni unsafe-eval en scripts', () => {
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const allowed = dir('script-src');
  assert.ok(!allowed.includes("'unsafe-inline'") && !allowed.includes("'unsafe-eval'"));
  for (const code of inline) assert.ok(allowed.includes(`'sha256-${crypto.createHash('sha256').update(code, 'utf8').digest('base64')}'`), 'hash desactualizado para: ' + code.slice(0, 60));
  assert.ok(!/\son[a-z]+=/i.test(html.replace(/<svg[\s\S]*?<\/svg>/g, '')), 'sin manejadores de eventos en línea');
});

test('la red queda limitada al propio sitio y a api.github.com', () => {
  assert.deepEqual(dir('connect-src').filter((s) => /^https?:/.test(s)), ['https://api.github.com']);
  assert.deepEqual(dir('default-src'), ["'self'"]);
  for (const d of ['script-src', 'style-src', 'img-src', 'font-src', 'worker-src']) assert.ok(!dir(d).some((s) => /^https?:|^\*$/.test(s)), d);
});

test('pdf.js: el worker se carga por URL del mismo origen (worker-src \'self\'), sin blob ni wasm-unsafe-eval', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const src = fs.readFileSync(path.join(root, 'js', 'pdf-ingest.js'), 'utf8');
  assert.match(src, /workerSrc\s*=\s*new URL\('\.\.\/vendor\/pdfjs\/pdf\.worker\.min\.js',\s*import\.meta\.url\)\.href/, 'workerSrc debe ser una URL del propio sitio');
  assert.ok(!/createObjectURL|new Blob/.test(src), 'el worker no debe armarse como blob');
  assert.ok(fs.existsSync(path.join(root, 'vendor', 'pdfjs', 'pdf.worker.min.js')));
  assert.ok(dir('worker-src').includes("'self'"));
  assert.ok(!dir('script-src').includes("'wasm-unsafe-eval'"), 'pdf.js 4.10 (vendorizado) no necesita WebAssembly: no se abre la CSP');
  const vendor = fs.readFileSync(path.join(root, 'vendor', 'pdfjs', 'pdf.worker.min.js'), 'utf8');
  assert.ok(!/WebAssembly\.(instantiate|compile)/.test(vendor), 'si una versión nueva de pdf.js usa WebAssembly, hay que añadir wasm-unsafe-eval a script-src (y a worker-src si aplica) y documentarlo');
});
