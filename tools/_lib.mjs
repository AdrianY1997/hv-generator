// Utilidades compartidas por tools/a11y.mjs y tools/keyboard.mjs (herramientas de desarrollo; NO se despliegan).
// Cargan axe-core y playwright desde una carpeta externa (--deps o A11Y_DEPS), sirven app/ en un puerto local temporal y siembran datos de prueba.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const APP = path.resolve(here, '..', 'app');
export const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
export const DEPS = path.resolve(arg('deps', process.env.A11Y_DEPS || here));
const req = createRequire(path.join(DEPS, 'noop.js'));
export let axeSrc, chromium;
try {
  axeSrc = fs.readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');
  ({ chromium } = req('playwright'));
} catch (e) {
  console.error('Faltan axe-core/playwright. Instale con:  npm i --prefix <carpeta> axe-core playwright  y pase --deps <carpeta>.\n' + e.message);
  process.exit(2);
}

// ---------- servidor estatico ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.wasm': 'application/wasm' };
export const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(APP, p);
  if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); rs.end('no'); return; }
  rs.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(rs);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
export const BASE = `http://127.0.0.1:${server.address().port}/`;

// ---------- datos de prueba ----------
// PDF minimo con texto (certificado de ejemplo) para el lector de vigencia.
export function tinyPdf(text) {
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>', null, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  const stream = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  objs[3] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
export const SEED = async () => {
  const { registry, DEFAULT_MODEL } = await import('./js/models/index.js');
  const { newTemplate } = await import('./js/template-model.js');
  const model = registry[DEFAULT_MODEL];
  const profile = {};
  for (const s of model.schema.sections) {
    const val = (f, i) => {
      if (f.type === 'photo') return '';
      if (f.type === 'select') return f.options?.[0]?.value ?? '';
      if (f.type === 'multiselect') return [];
      if (f.type === 'checkbox') return false;
      if (f.type === 'date') return '2020-03-0' + (1 + i);
      if (f.type === 'email') return 'ana.perez@example.com';
      if (f.type === 'tel') return '300 123 4567';
      if (f.type === 'number') return 3;
      return (f.label || f.id).slice(0, 24) + ' ' + (i + 1);
    };
    if (s.repeatable) profile[s.id] = [0, 1].map((i) => Object.fromEntries([['id', 'it' + s.id + i], ...s.fields.map((f) => [f.id, val(f, i)])]));
    else profile[s.id] = Object.fromEntries(s.fields.map((f) => [f.id, val(f, 0)]));
  }
  profile.personales.nombres = 'Ana María'; profile.personales.apellidos = 'Pérez Gómez'; profile.personales.numeroDocumento = '1020304050';
  const t1 = newTemplate(model); t1.name = 'Cargo administrativo'; t1.jobType = 'Administrativo';
  const t2 = newTemplate(model); t2.name = 'Cargo operativo'; t2.include.sections[model.schema.sections[3]?.id] = false;
  localStorage.setItem('hv.profile', JSON.stringify(profile));
  localStorage.setItem('hv.templates', JSON.stringify([t1, t2]));
  localStorage.setItem('hv.version', '1');
};

// ---------- estados a auditar ----------
export const settle = (page, ms = 350) => page.waitForTimeout(ms);
export async function go(page, route) { await page.goto(BASE + '#' + route); await page.waitForSelector('#app > *'); await settle(page); }
export async function choose(page, trigger, buffer, name, mime) {
  const pending = page.waitForEvent('filechooser'); await page.waitForTimeout(250); // la interceptacion es asincrona
  await trigger.click();
  const fc = await pending;
  await fc.setFiles({ name, mimeType: mime, buffer });
}
export async function png(page) {
  const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 600, 800); g.addColorStop(0, '#889'); g.addColorStop(1, '#ccd'); x.fillStyle = g; x.fillRect(0, 0, 600, 800); x.fillStyle = '#556'; x.beginPath(); x.arc(300, 320, 120, 0, 7); x.fill(); return c.toDataURL('image/png').split(',')[1]; });
  return Buffer.from(b64, 'base64');
}
