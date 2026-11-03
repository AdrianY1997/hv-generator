// Datos de prueba generados desde el esquema real del modelo (Node, sin navegador). Todo es ficticio.
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// El esquema se lee con Node puro (ver schema-dump.mjs): así los datos de prueba siguen al modelo real sin duplicarlo.
const here = path.dirname(fileURLToPath(import.meta.url));
const dump = JSON.parse(execFileSync(process.execPath, [path.join(here, 'schema-dump.mjs')], { encoding: 'utf8', maxBuffer: 1 << 26 }));
export const model = { id: dump.id, schema: { sections: dump.sections, documents: dump.documents } };
export const SECTIONS = dump.sections;
export const DOCS = dump.documents;

/** Igual que js/template-model.js (newTemplate): plantilla vacía con todo incluido. */
export function newTemplate() {
  const now = new Date().toISOString();
  return {
    id: 'tpl-' + Math.random().toString(36).slice(2, 10), name: '', modelId: model.id, jobType: '', createdAt: now, updatedAt: now,
    include: { sections: Object.fromEntries(SECTIONS.map((s) => [s.id, true])), items: {}, fields: {}, documents: Object.fromEntries(DOCS.map((d) => [d.id, true])) },
    options: { showPhoto: true, attachCertificates: true, attachDocuments: true, objective: '' },
  };
}

const val = (f, i, tag) => {
  if (f.type === 'photo') return '';
  if (f.type === 'select') return f.options?.[0]?.value ?? '';
  if (f.type === 'multiselect') return [];
  if (f.type === 'checkbox') return false;
  if (f.type === 'date') return `2020-03-${String(1 + (i % 27)).padStart(2, '0')}`;
  if (f.type === 'email') return 'ana.perez@example.com';
  if (f.type === 'tel') return '3001234567';
  if (f.type === 'number') return 3;
  return `${(f.label || f.id).slice(0, 18)} ${tag}${i + 1}`;
};

/** Perfil completo: `n` registros por sección repetible (2 por omisión); `repeat` fija cuántos en secciones concretas. */
export function fullProfile({ n = 2, repeat = {} } = {}) {
  const profile = {};
  for (const s of SECTIONS) {
    if (s.repeatable) {
      const count = repeat[s.id] ?? n;
      profile[s.id] = Array.from({ length: count }, (_, i) => Object.fromEntries([['id', `it-${s.id}-${i}`], ...s.fields.map((f) => [f.id, val(f, i, s.id.slice(0, 3))])]));
    } else profile[s.id] = Object.fromEntries(s.fields.map((f) => [f.id, val(f, 0, 'x')]));
  }
  Object.assign(profile.personales, { nombres: 'Ana María', apellidos: 'Pérez Gómez', tipoDocumento: 'CC', numeroDocumento: '1020304050', correo: 'ana.perez@example.com', celular: '3001234567', fechaNacimiento: '1990-05-17' });
  // Respuestas que hacen aplicables los campos condicionales (showIf, docs/CONDICIONALES.md): así el perfil «completo» muestra e imprime todo.
  Object.assign(profile.personales, { sexo: 'M', estadoCivil: 'Casado(a)' });
  Object.assign(profile.infopersonal || {}, { comoSupo: 'Otro', vivienda: 'Alquilada' });
  Object.assign(profile.basica || {}, { nivel: 'Bachiller académico' });
  Object.assign(profile.trayectoria || {}, { sectores: ['Industria: otros', 'OTROS SECTORES'], areas: ['Otras áreas'] });
  for (const e of profile.experiencia || []) Object.assign(e, { contratoTermino: 'Fijo', contratoVinculacion: 'Otro' });
  return profile;
}
/** Desborda la hoja: muchos trabajos y hermanos para forzar la hoja de continuación. */
export const overflowProfile = (jobs = 14, siblings = 12) => fullProfile({ n: 2, repeat: { experiencia: jobs, hermanos: siblings, superior: 6, cursos: 8, referencias: 6 } });

export function template(name, patch = {}) {
  const t = newTemplate();
  t.name = name;
  return Object.assign(t, patch, { include: { ...t.include, ...(patch.include || {}) } });
}
/** Plantilla que excluye secciones. */
export const templateExcluding = (name, secIds) => {
  const t = template(name);
  for (const id of secIds) t.include.sections[id] = false;
  return t;
};

// ---------- archivos binarios ----------
/** PDF con texto (Helvetica); `pages` copias de la misma página, o un arreglo de páginas (cada una, texto o arreglo de líneas) con contenido distinto. */
export function tinyPdf(lines, pages = 1) {
  const per = Array.isArray(pages) ? pages.map((p) => (Array.isArray(p) ? p : [p])) : null;
  if (per) pages = per.length;
  const L = Array.isArray(lines) ? lines : [lines];
  const esc = (s) => String(s).replace(/[\\()]/g, '\\$&');
  const fontNo = 3 + pages * 2;
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', `<</Type/Pages/Kids[${kids}]/Count ${pages}>>`];
  for (let p = 0; p < pages; p++) {
    const stream = 'BT /F1 12 Tf 50 740 Td 16 TL ' + (per ? per[p] : L).map((t) => `(${esc(t)}) Tj T*`).join(' ') + ' ET';
    objs.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${4 + p * 2} 0 R/Resources<</Font<</F1 ${fontNo} 0 R>>>>>>`);
    objs.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);
  }
  objs.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** PNG RGB w x h con un degradado y un disco (sin dependencias). */
export function makePng(w = 600, h = 800) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const dx = x - w / 2, dy = y - h * 0.4, disc = dx * dx + dy * dy < (w * 0.2) ** 2;
      const o = row + 1 + x * 3;
      raw[o] = disc ? 85 : 136 + (((x * 60) / w) | 0); raw[o + 1] = disc ? 85 : 136 + (((y * 50) / h) | 0); raw[o + 2] = disc ? 102 : 200;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** PNG RGB w x h de ruido (incompresible): un JPEG de esto pesa mucho siempre; sirve para no lograr un peso máximo. */
export function noisePng(w = 800, h = 1000) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let seed = 12345;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let i = 1; i <= w * 3; i++) { seed = (seed * 1103515245 + 12345) >>> 0; raw[row + i] = seed >>> 24; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Líneas de un certificado de Procuraduría (sintético) con la fecha dada, p. ej. '25 de marzo del 2026'. */
export const procuraduriaLines = (fecha, cedula = '1020304050') => [
  'PROCURADURIA GENERAL DE LA NACION', 'CERTIFICADO ORDINARIO No. 123456789', `Bogota DC, ${fecha}`,
  `El senor PRUEBA PERSONA identificado con C.C. ${cedula}`, 'NO REGISTRA SANCIONES NI INHABILIDADES VIGENTES'];
