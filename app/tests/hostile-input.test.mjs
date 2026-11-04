// Entradas hostiles: cabeceras de imagen / topes de PDF (package-plan), claves reservadas y ids de archivo raros (backup-merge, migrate).
// Ejecutar: node --test "app/tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageDimensions, checkImagePixels, checkPdfAppend, LIMITS } from '../js/package-plan.js';
import { mergeBackup, prepareBackup } from '../js/backup-merge.js';
import { CURRENT_VERSION, migrate } from '../js/migrate.js';

const b64 = (b) => Buffer.from(b).toString('base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const tpl = () => ({ id: 't1', name: 'Plantilla', modelId: 'minerva', include: { sections: {}, items: {}, fields: {} }, options: {} });
const backup = (over = {}) => ({ app: 'hv-minerva', version: 1, exportedAt: '2026-10-01T10:00:00.000Z', profile: { personales: { nombres: 'A' } }, templates: [tpl()], files: [], ...over });
const pdfFile = (id) => ({ id, meta: { type: 'application/pdf', name: id + '.pdf' }, data: b64(PDF) });

// ---- Cabeceras de imagen ----
const pngHdr = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return new Uint8Array(b); };
const jpegHdr = (w, h, pad = 0) => { // SOI + APP0 de relleno + SOF0
  const app = Buffer.concat([Buffer.from([0xff, 0xe0, (pad + 2) >> 8, (pad + 2) & 255]), Buffer.alloc(pad)]);
  const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), app, sof, Buffer.alloc(8)]));
};
const webp = (kind, w, h) => {
  const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1');
  if (kind === 'X') { b.write('VP8X', 12, 'latin1'); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); }
  if (kind === 'L') { b.write('VP8L', 12, 'latin1'); b[20] = 0x2f; b.writeUInt32LE((((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)) >>> 0, 21); }
  if (kind === 'S') { b.write('VP8 ', 12, 'latin1'); b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a; b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28); }
  return new Uint8Array(b);
};

test('imageDimensions lee PNG, JPEG (tras un APP grande) y los tres WebP sin decodificar', () => {
  assert.deepEqual(imageDimensions(pngHdr(6000, 8000)), { w: 6000, h: 8000 });
  assert.deepEqual(imageDimensions(jpegHdr(4032, 3024)), { w: 4032, h: 3024 });
  assert.deepEqual(imageDimensions(jpegHdr(100, 50, 60000)), { w: 100, h: 50 });
  assert.deepEqual(imageDimensions(webp('X', 12000, 9000)), { w: 12000, h: 9000 });
  assert.deepEqual(imageDimensions(webp('L', 3000, 2000)), { w: 3000, h: 2000 });
  assert.deepEqual(imageDimensions(webp('S', 640, 480)), { w: 640, h: 480 });
});

test('imageDimensions devuelve null con basura, truncados o PNG sin IHDR', () => {
  assert.equal(imageDimensions(null), null);
  assert.equal(imageDimensions(new Uint8Array(10)), null);
  assert.equal(imageDimensions(new Uint8Array(100)), null);
  assert.equal(imageDimensions(pngHdr(1, 1).subarray(0, 20)), null);
  const bad = pngHdr(1, 1); bad[12] = 0x58;
  assert.equal(imageDimensions(bad), null);
  assert.equal(imageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, ...new Array(30).fill(0)])), null); // longitud de segmento inválida
});

test('checkImagePixels: presupuesto de 40 MP; ilegible si no hay cabecera o es 0x0', () => {
  assert.equal(LIMITS.maxImagePixels, 40e6);
  assert.deepEqual(checkImagePixels(pngHdr(4000, 3000)), { ok: true, w: 4000, h: 3000 });
  assert.equal(checkImagePixels(pngHdr(7000, 6000)).reason, 'grande');
  assert.equal(checkImagePixels(pngHdr(65535, 65535)).reason, 'grande'); // bomba de píxeles
  assert.equal(checkImagePixels(pngHdr(0, 10)).reason, 'ilegible');
  assert.equal(checkImagePixels(new Uint8Array(64)).reason, 'ilegible');
});

test('checkPdfAppend: tope por archivo (150) y tope total (maxPages)', () => {
  assert.deepEqual(checkPdfAppend(0, LIMITS.maxPagesPerFile), { ok: true });
  assert.equal(checkPdfAppend(0, LIMITS.maxPagesPerFile + 1).reason, 'file');
  assert.equal(checkPdfAppend(300, 100).ok, true);
  assert.equal(checkPdfAppend(350, 100).reason, 'total');
  assert.equal(checkPdfAppend(0, NaN).reason, 'ilegible');
});

// ---- Ids de archivo y claves reservadas ----
test('ids de archivo constructor / toString / __proto__ no se confunden con renombrados heredados', () => {
  for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    for (const sv of [0, CURRENT_VERSION]) {
      const r = prepareBackup(backup({ schemaVersion: sv, profile: { documents: { rut: ['doc:rut:1', id] } }, files: [pdfFile('doc:rut:1'), pdfFile(id)] }));
      assert.equal(r.ok, true, id);
      assert.ok(r.files.every((x) => typeof x.id === 'string'), id);
      assert.ok(r.files.some((x) => x.id === id), id);
    }
  }
});

test('claves reservadas del perfil (__proto__, constructor, prototype) se descartan al validar y fusionar', () => {
  const dirty = JSON.parse('{"__proto__":{"x":1},"constructor":{"y":1},"prototype":"z","personales":{"nombres":"A","constructor":"c","__proto__":{"p":1}},"documents":{"constructor":["doc:c"],"rut":["doc:rut"]}}');
  const v = prepareBackup(backup({ profile: dirty }));
  assert.equal(v.ok, true);
  assert.deepEqual(Object.keys(v.profile).sort(), ['documents', 'documentsShown', 'legacyConditions', 'personales']); // sin schemaVersion = perfil anterior a las condiciones y al nuevo conjunto por defecto (se materializa la lista que veía)
  assert.deepEqual(Object.keys(v.profile.documents), ['rut']);
  const m = mergeBackup({ profile: { personales: { nombres: '' } }, templates: [], files: [{ id: 'doc:rut' }] }, { profile: dirty, templates: [], files: [] });
  assert.equal(m.ok, true);
  assert.deepEqual(Object.keys(m.profile.personales), ['nombres']);
  assert.ok(!Object.hasOwn(m.profile, 'constructor') && !Object.hasOwn(m.profile, 'prototype'));
  assert.deepEqual(Object.keys(m.profile.documents), ['rut']);
});

// ---- Colisiones de renombrado (migrate / prepareBackup) ----
test('migrate: el renombrado nunca elige un id que ya existe en el destino (fileIds / takenIds)', () => {
  const r = migrate({ documents: { rut: ['doc:rut:1'] } }, { fileIds: ['doc:rut:1', 'doc:rut'] });
  assert.deepEqual(r.profile.documents.rut, ['doc:rut:2']);
  assert.deepEqual(r.renames, { 'doc:rut:1': 'doc:rut:2' });
  const r2 = migrate({ documents: { rut: ['doc:rut:1'] } }, { takenIds: ['doc:rut', 'doc:rut:2'] });
  assert.deepEqual(r2.renames, { 'doc:rut:1': 'doc:rut:3' });
});

test('migrate: claves reservadas en documents no contaminan el resultado', () => {
  const r = migrate(JSON.parse('{"documents":{"__proto__":["doc:x"],"constructor":["doc:y"],"rut":["doc:rut:1"]}}'), {});
  assert.deepEqual(Object.keys(r.profile.documents), ['rut']);
  assert.equal(Object.getPrototypeOf(r.profile.documents), Object.prototype);
});

test('prepareBackup con takenIds: el renombrado legacy no pisa un archivo existente en IndexedDB', () => {
  const r = prepareBackup(backup({ schemaVersion: 0, profile: { documents: { rut: ['doc:rut:1'] } }, files: [pdfFile('doc:rut:1')] }), { takenIds: ['doc:rut'] });
  assert.equal(r.files[0].id, 'doc:rut:2');
  assert.deepEqual(r.profile.documents.rut, ['doc:rut:2']);
});

test('quietDestroy no espera a un destroy() colgado ni propaga rechazos (worker de pdf.js atascado)', async () => {
  const { quietDestroy } = await import('../js/pdf-ingest.js');
  const t0 = Date.now();
  quietDestroy({ destroy: () => new Promise(() => {}) }); // nunca resuelve
  quietDestroy({ destroy: () => Promise.reject(new Error('x')) });
  quietDestroy({ destroy: () => { throw new Error('sync'); } });
  quietDestroy(null);
  quietDestroy({});
  assert.ok(Date.now() - t0 < 100);
  await new Promise((r) => setTimeout(r, 10)); // un rechazo sin manejar haría fallar el proceso de pruebas
});
