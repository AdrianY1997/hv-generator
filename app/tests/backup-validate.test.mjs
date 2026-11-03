// Pruebas de la validación pura de respaldos (sin DOM ni IndexedDB). Casos maliciosos incluidos.
// Ejecutar: node --test "app/tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup, normalizeProfile, normalizeTemplates, sniffMime, b64DecodedSize, decodeBase64, isAllowedType, MAX_FILE, MAX_TOTAL } from '../js/backup-validate.js';
import { normalizeTemplate, newTemplate } from '../js/template-model.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

const tpl = (over = {}) => ({ id: 't1', name: 'N', include: { sections: {}, items: {}, fields: {} }, options: {}, ...over });
const file = (over = {}) => ({ id: 'cert:a', meta: { name: 'a.pdf', type: 'application/pdf', size: PDF.length }, data: b64(PDF), ...over });
const backup = (over = {}) => ({ app: 'hv-minerva', version: 1, profile: { personales: { nombres: 'A' } }, templates: [tpl()], files: [file()], ...over });

test('respaldo válido pasa y normaliza', () => {
  const r = validateBackup(backup({ files: [file(), file({ id: 'photo', meta: { name: 'f.png', type: 'image/png' }, data: b64(PNG) }), file({ id: 'doc:x', meta: { type: 'image/jpeg' }, data: b64(JPG) })] }));
  assert.equal(r.ok, true);
  assert.equal(r.files.length, 3);
  assert.equal(r.files[0].meta.size, PDF.length);
  assert.equal(r.files[2].meta.name, 'archivo');
});

test('rechaza image/svg+xml y text/html declarados en meta.type', () => {
  for (const [type, bytes] of [['image/svg+xml', SVG], ['text/html', HTML], ['application/xhtml+xml', HTML], ['', SVG]]) {
    const r = validateBackup(backup({ files: [file({ meta: { name: 'x', type }, data: b64(bytes) })] }));
    assert.equal(r.ok, false, type);
    assert.match(r.error, /tipo no permitido/);
  }
});

test('rechaza contenido que no coincide con el tipo declarado (HTML disfrazado de PDF o PNG)', () => {
  assert.equal(validateBackup(backup({ files: [file({ data: b64(HTML) })] })).ok, false);
  assert.equal(validateBackup(backup({ files: [file({ meta: { type: 'image/png' }, data: b64(SVG) })] })).ok, false);
  assert.equal(validateBackup(backup({ files: [file({ meta: { type: 'image/png' }, data: b64(JPG) })] })).ok, false);
});

test('rechaza base64 inválido', () => {
  for (const data of ['!!!!', 'abc', 'JVBERi0=\n', 'JVBERi0*', 42, null, undefined, { a: 1 }]) {
    assert.equal(validateBackup(backup({ files: [file({ data })] })).ok, false, String(data));
  }
});

test('rechaza formas erróneas de nivel superior', () => {
  const bad = [null, 'x', [], { app: 'otra' },
    backup({ profile: 'x' }), backup({ profile: [] }), backup({ profile: null }),
    backup({ templates: {} }), backup({ templates: 'x' }), backup({ templates: [1] }), backup({ templates: [null] }), backup({ templates: [tpl({ include: 'x' })] }), backup({ templates: [tpl({ id: 5 })] }),
    backup({ files: {} }), backup({ files: [null] }), backup({ files: ['x'] }),
    backup({ files: [file({ id: 7 })] }), backup({ files: [file({ id: '' })] }), backup({ files: [file({ id: '../x<script>' })] }),
    backup({ files: [file({ meta: 'x' })] }), backup({ files: [file({ meta: [] })] }), backup({ files: [file({ meta: undefined })] }),
    backup({ files: [file(), file()] })];
  for (const d of bad) assert.equal(validateBackup(d).ok, false, JSON.stringify(d)?.slice(0, 80));
});

test('rechaza archivos de más de 5 MB y totales excesivos', () => {
  const big = Buffer.concat([PDF, Buffer.alloc(MAX_FILE)]);
  const r = validateBackup(backup({ files: [file({ data: b64(big) })] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /5 MB/);
  const nearMax = Buffer.concat([PDF, Buffer.alloc(MAX_FILE - PDF.length)]);
  assert.equal(validateBackup(backup({ files: [file({ data: b64(nearMax) })] })).ok, true);
  const many = Array.from({ length: Math.ceil(MAX_TOTAL / MAX_FILE) + 1 }, (_, i) => file({ id: 'doc:' + i, data: b64(nearMax) }));
  const t = validateBackup(backup({ files: many }));
  assert.equal(t.ok, false);
  assert.match(t.error, /suman/);
});

test('un solo archivo malo rechaza todo el respaldo', () => {
  const r = validateBackup(backup({ files: [file(), file({ id: 'cert:b', meta: { type: 'image/svg+xml' }, data: b64(SVG) })] }));
  assert.equal(r.ok, false);
});

test('sniffMime y base64', () => {
  assert.equal(sniffMime(PDF), 'application/pdf');
  assert.equal(sniffMime(Buffer.concat([Buffer.from('junk\n'), PDF])), 'application/pdf');
  assert.equal(sniffMime(PNG), 'image/png');
  assert.equal(sniffMime(JPG), 'image/jpeg');
  assert.equal(sniffMime(Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), Buffer.alloc(4)])), 'image/webp');
  assert.equal(sniffMime(SVG), null);
  assert.equal(sniffMime(HTML), null);
  assert.equal(sniffMime(new Uint8Array(0)), null);
  assert.equal(b64DecodedSize(b64(PDF)), PDF.length);
  assert.equal(b64DecodedSize('a'), -1);
  assert.equal(decodeBase64('@@@@'), null);
  assert.deepEqual([...decodeBase64(b64([1, 2, 3, 4]))], [1, 2, 3, 4]);
  assert.equal(isAllowedType('image/svg+xml'), false);
  assert.equal(isAllowedType('image/webp'), true);
});

const SECS = [{ id: 'personales', repeatable: false }, { id: 'superior', repeatable: true }];

test('normalizeProfile: forma y tipos', () => {
  assert.deepEqual(normalizeProfile('x'), {});
  assert.deepEqual(normalizeProfile([1]), {});
  assert.deepEqual(normalizeProfile(null), {});
  const n = normalizeProfile({ personales: 'texto', superior: { a: 1 }, documents: { cedula: 'x', rut: ['a', 5, 'b'] }, documentsShown: 'x' }, SECS);
  assert.equal('personales' in n, false);
  assert.equal('superior' in n, false);
  assert.deepEqual(n.documents, { cedula: [], rut: ['a', 'b'] });
  assert.equal('documentsShown' in n, false);
  const ok = normalizeProfile({ personales: { nombres: 'A' }, superior: [{ id: '1' }, 'x', null, []], documents: [], documentsShown: ['cedula', 3] }, SECS);
  assert.deepEqual(ok.personales, { nombres: 'A' });
  assert.deepEqual(ok.superior, [{ id: '1' }]);
  assert.equal('documents' in ok, false);
  assert.deepEqual(ok.documentsShown, ['cedula']);
});

test('normalizeProfile no muta ni hereda __proto__', () => {
  const input = JSON.parse('{"__proto__":{"polluted":true},"personales":{"a":1}}');
  const n = normalizeProfile(input, SECS);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(n), Object.prototype);
  assert.equal(n.polluted, undefined);
  assert.ok('__proto__' in input);
});

test('normalizeTemplate: solo campos conocidos y tipos', () => {
  assert.equal(normalizeTemplate(null), null);
  assert.equal(normalizeTemplate('x'), null);
  assert.equal(normalizeTemplate([]), null);
  const t = normalizeTemplate({
    id: 't', name: 5, evil: '<img onerror=1>', include: { sections: { a: true, b: 'yes', c: false }, items: [], fields: 'x', documents: { cedula: false, x: 1 } },
    options: { showPhoto: 'no', attachCertificates: false, objective: { a: 1 } },
  });
  assert.equal(t.id, 't');
  assert.equal(t.name, '');
  assert.equal('evil' in t, false);
  assert.deepEqual(t.include.sections, { a: true, c: false });
  assert.deepEqual(t.include.items, {});
  assert.deepEqual(t.include.fields, {});
  assert.deepEqual(t.include.documents, { cedula: false });
  assert.equal(t.options.showPhoto, true);
  assert.equal(t.options.attachCertificates, false);
  assert.equal(t.options.objective, '');
});

test('normalizeTemplate conserva ausente include.documents y una plantilla nueva es estable', () => {
  assert.equal('documents' in normalizeTemplate({ id: 'a', include: { sections: {} }, options: {} }).include, false);
  const n = newTemplate({ id: 'm', schema: { sections: [{ id: 's' }], documents: [{ id: 'd' }] } });
  assert.deepEqual(normalizeTemplate(n), n);
});

test('normalizeTemplates descarta basura y plantillas sin id', () => {
  assert.deepEqual(normalizeTemplates('x'), []);
  assert.deepEqual(normalizeTemplates({}), []);
  const out = normalizeTemplates([null, 5, 'x', { name: 'sin id' }, { id: 'ok' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'ok');
});
