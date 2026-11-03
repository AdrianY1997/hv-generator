// Guarda de G16: todo módulo, hoja de estilo y fuente de la app debe estar en la lista de precache de sw.js (CORE o MORE).
// Si agregas un archivo a app/js, app/css o app/fonts y esta prueba falla, añádelo a MORE en app/sw.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
const walk = (d) => fs.readdirSync(path.join(APP, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name).split(path.sep).join('/')]));

test('sw.js lista cada archivo de js/, css/ y fonts/', () => {
  const listed = new Set([...sw.matchAll(/'((?:js|css|fonts)\/[^']+|index\.html)'/g)].map((m) => m[1]));
  const missing = [...walk('js'), ...walk('css'), ...walk('fonts')].filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], 'faltan en sw.js: ' + missing.join(', '));
});

test('sw.js solo lista archivos que existen', () => {
  const listed = [...sw.matchAll(/'((?:js|css|fonts)\/[^']+|index\.html)'/g)].map((m) => m[1]);
  const gone = listed.filter((f) => !fs.existsSync(path.join(APP, f)));
  assert.deepEqual(gone, [], 'no existen: ' + gone.join(', '));
});

test('sw.js conserva el marcador __BUILD__ que el workflow de Pages sustituye', () => {
  assert.match(sw, /const VERSION = '__BUILD__';/);
});
