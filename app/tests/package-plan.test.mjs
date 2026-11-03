// Pruebas de los helpers puros del paquete PDF. Ejecutar: node --test "tests/*.test.mjs" (desde app/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { planAnnexes, checkLimits, paginate, fitRect, scaleDown, winAnsi, clipText, paperPt, LIMITS } from '../js/package-plan.js';
import minerva from '../js/models/minerva.js';

const mk = (id, type, size = 1000, title = id) => ({ id, title, file: { meta: { type, size, name: id + '.x' } } });

test('planAnnexes conserva el orden y clasifica por tipo', () => {
  const p = planAnnexes([mk('cert:a', 'image/png'), mk('doc:cedula', 'application/pdf'), mk('cert:b', 'application/zip'), mk('cert:c', 'image/webp')]);
  assert.deepEqual(p.map((x) => x.id), ['cert:a', 'doc:cedula', 'cert:b', 'cert:c']);
  assert.deepEqual(p.map((x) => x.kind), ['image', 'pdf', 'skip', 'image']);
  assert.deepEqual(planAnnexes(null), []);
});

test('checkLimits: cantidad y peso total (ignora lo omitido)', () => {
  assert.equal(checkLimits(planAnnexes([mk('a', 'application/pdf', 1000)])).ok, true);
  const big = planAnnexes([mk('a', 'application/pdf', 40 * 1048576), mk('b', 'image/png', 30 * 1048576)]);
  const r = checkLimits(big);
  assert.equal(r.ok, false); assert.match(r.error, /MB/);
  assert.equal(checkLimits(planAnnexes([mk('z', 'text/plain', 999 * 1048576)])).ok, true);
  const many = planAnnexes(Array.from({ length: LIMITS.maxAnnexFiles + 1 }, (_, i) => mk('i' + i, 'image/png', 10)));
  assert.equal(checkLimits(many).ok, false);
});

test('paginate corta en el último punto seguro que cabe', () => {
  assert.deepEqual(paginate([100, 400, 900], 800, 1000), [0]);
  assert.deepEqual(paginate([300, 700, 900, 1500], 2000, 1000), [0, 900, 1500]);
  // bloque más alto que la página: tras el último punto seguro, corte duro
  assert.deepEqual(paginate([50], 2500, 1000), [0, 50, 1050, 2050]);
  // sin puntos seguros
  assert.deepEqual(paginate([], 2100, 1000), [0, 1000, 2000]);
  // inválidos
  assert.deepEqual(paginate([10], 500, 0), [0]);
});

test('fitRect no amplía y centra', () => {
  assert.deepEqual(fitRect(100, 50, 400, 400), { x: 150, y: 175, w: 100, h: 50 });
  const f = fitRect(800, 400, 400, 400);
  assert.equal(f.w, 400); assert.equal(f.h, 200); assert.equal(f.y, 100);
  assert.deepEqual(fitRect(0, 5, 10, 10), { x: 0, y: 0, w: 0, h: 0 });
});

test('scaleDown, paperPt, winAnsi, clipText', () => {
  assert.deepEqual(scaleDown(6000, 3000, 3000), { w: 3000, h: 1500 });
  assert.deepEqual(scaleDown(100, 50, 3000), { w: 100, h: 50 });
  assert.equal(paperPt('a4').w, 595.28); assert.equal(paperPt('x').w, 612);
  assert.equal(winAnsi('Anexo · Título “x” — ñ 漢'), 'Anexo · Título "x" - ñ ?');
  assert.equal(clipText('abcdefghij', 5, (s) => s.length), 'ab...');
  assert.equal(clipText('abc', 5, (s) => s.length), 'abc');
});

const profile = {
  personales: { nombres: 'A', apellidos: 'B' },
  superior: [{ id: 'sup1', programa: 'Ing' }, { id: 'sup2', programa: 'Mat' }],
  documents: { cedula: ['doc:cedula', 'doc:cedula:2'], policia: ['doc:policia'] },
};
const files = Object.fromEntries(['photo', 'cert:sup1', 'cert:sup2', 'doc:cedula', 'doc:cedula:2', 'doc:policia']
  .map((id) => [id, { meta: { type: id === 'cert:sup2' || id.startsWith('doc:') ? 'application/pdf' : 'image/png', name: id } }]));

test('minerva.fileIds / annexList respetan las banderas de plantilla', () => {
  const ids = (t) => new Set(minerva.fileIds(profile, t));
  const full = ids(null);
  assert.ok(full.has('photo') && full.has('cert:sup1'));
  const tNone = { include: {}, options: { showPhoto: false, attachCertificates: false, attachDocuments: false } };
  assert.equal(ids(tNone).size, 0);
  const tDocs = { include: { documents: { cedula: true, policia: false } }, options: { showPhoto: true, attachCertificates: false, attachDocuments: true } };
  const d = ids(tDocs);
  assert.deepEqual([...d].sort(), ['doc:cedula', 'doc:cedula:2', 'photo']);
  const list = minerva.annexList(profile, { ...tDocs, options: { ...tDocs.options, attachCertificates: true } }, files);
  assert.deepEqual(list.map((a) => a.id), ['cert:sup1', 'cert:sup2', 'doc:cedula', 'doc:cedula:2']); // certificados y luego documentos, CC primero
  assert.deepEqual(minerva.annexList(profile, tNone, files), []);
});

// ---- Capa de texto invisible (G08) ----
import { layerText, mergeWords, readingOrder, layoutTextLayer, TEXT_LAYER } from '../js/package-plan.js';
// Helvetica/WinAnsi: Latin-1 + algunos símbolos de la página 0x80-0x9F (lo que `font.getCharacterSet()` de pdf-lib declara).
const WIN = new Set([...' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~', ...'¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ€•…–—‘’“”™'].map((c) => c.codePointAt(0)));
const has = (c) => WIN.has(c.codePointAt(0));

test('layerText: conserva acentos, ñ, ¿ y ¡; translitera lo que WinAnsi no tiene; omite lo irrepresentable', () => {
  assert.equal(layerText('Ana María Pérez Ñandú ¿Cómo? ¡Sí!', has), 'Ana María Pérez Ñandú ¿Cómo? ¡Sí!');
  assert.equal(layerText('Ōsaka Łódź ﬁn', has), 'Osaka ódz fin'); // ō -> o; Ł no tiene descomposición y se omite; ó se conserva; ź -> z; ﬁ -> fi
  assert.equal(layerText('Hola 😀 mundo', has), 'Hola mundo');
  assert.equal(layerText('a b​c\n\td', has), 'a bc d'); // NBSP -> espacio; ancho cero fuera; saltos -> espacio
  assert.equal(layerText('  ', has), '');
  assert.equal(layerText(null, has), '');
  assert.equal(layerText('日本語', has), '');
});

test('mergeWords: une palabras de la misma línea y separa columnas distintas y líneas', () => {
  const w = (text, x, y = 0, wd = 30, h = 10, rot) => ({ text, x, y, w: wd, h, rot });
  const m = mergeWords([w('Ana', 0), w('María', 34), w('Pérez', 200), w('Gómez', 234), w('abajo', 0, 14)]);
  assert.deepEqual(m.map((r) => r.text), ['Ana María', 'Pérez Gómez', 'abajo']);
  assert.equal(m[0].w, 64); // caja unida
  assert.deepEqual(mergeWords([w('x', 0, 0, 5, 10), w('', 10), null, { text: 'y', x: 1, y: 1, w: 1, h: 0 }]).map((r) => r.text), ['x']); // descarta vacíos/inválidos
  assert.equal(mergeWords([w('IV.', 0, 0, 20, 10, 90), w('sec', 25, 0, 20, 10, 90)]).length, 2); // el texto girado no se une
});

test('readingOrder: líneas de arriba abajo, de izquierda a derecha; el texto girado al final', () => {
  const r = (text, x, y, rot) => ({ text, x, y, w: 40, h: 10, rot });
  const o = readingOrder([r('c', 100, 50), r('b', 50, 51), r('margen', 590, 0, 90), r('a', 0, 49), r('d', 0, 80)]);
  assert.deepEqual(o.map((x) => x.text), ['a', 'b', 'c', 'd', 'margen']);
  assert.deepEqual(readingOrder([]), []);
});

test('layoutTextLayer: puntos PDF, línea base, escala horizontal y límites', () => {
  const page = { w: 612, h: 792 };
  const font = { has, width: (t, s) => t.length * 0.5 * s };
  const L = (runs, o = {}) => layoutTextLayer(runs, { page, font, ...o });
  // 100x14 px en (40, 20) px -> 75x10.5 pt; tamaño = alto/1.117; línea base a 0.81 del alto desde arriba.
  const [a] = L([{ text: 'Ana María', x: 40, y: 20, w: 100, h: 14 }]);
  assert.equal(a.rot, 0);
  assert.ok(Math.abs(a.x - 30) < 1e-9);
  assert.ok(Math.abs(a.y - (792 - (15 + 10.5 * 0.81))) < 1e-9);
  assert.ok(Math.abs(a.size - 10.5 / 1.117) < 1e-9);
  assert.ok(Math.abs(a.tz - (75 / (9 * 0.5 * a.size)) * 100) < 1e-6); // ancho de la caja / ancho natural
  // Con el origen de una hoja de flujo (margen 36 pt).
  const [b] = L([{ text: 'x', x: 0, y: 0, w: 10, h: 10 }], { box: { x: 36, y: 36 } });
  assert.ok(Math.abs(b.x - 36) < 1e-9 && b.y < 792 - 36);
  // Fuera de la página o vacío: se descarta.
  assert.deepEqual(L([{ text: 'x', x: 900, y: 0, w: 10, h: 10 }, { text: '日本', x: 0, y: 0, w: 10, h: 10 }, { text: 'y', x: 0, y: 2000, w: 10, h: 10 }]), []);
  // Escala horizontal acotada (25%-400%) y 100 si la diferencia es mínima.
  assert.equal(L([{ text: 'ab', x: 0, y: 0, w: 10000, h: 10 }])[0].tz, 400);
  assert.equal(L([{ text: 'a'.repeat(60), x: 0, y: 0, w: 12, h: 10 }])[0].tz, 25);
  const h = 10, size = (h * 0.75) / 1.117, wpx = (4 * 0.5 * size) / 0.75;
  assert.equal(L([{ text: 'abcd', x: 0, y: 0, w: wpx * 1.01, h }])[0].tz, 100);
});

test('layoutTextLayer: texto girado (notas al margen) conserva la dirección y queda dentro de la caja', () => {
  const page = { w: 612, h: 792 };
  const font = { has, width: (t, s) => t.length * 0.5 * s };
  // Caja estrecha y alta de 8x240 px = 6x180 pt, leída de abajo hacia arriba (90° antihorario): empieza en la parte baja de la caja.
  const [r] = layoutTextLayer([{ text: 'Permitida reproducción', x: 780, y: 100, w: 8, h: 240, rot: 90 }], { page, font });
  assert.equal(r.rot, 90);
  assert.ok(Math.abs(r.size - 6 / 1.117) < 1e-9); // el grosor de la caja es el cuerpo de la letra
  const top = 75, bottom = 75 + 180;
  assert.ok(Math.abs(r.y - (792 - bottom)) < 1e-9); // el origen está en el borde inferior de la caja (en PDF, y desde abajo)
  assert.ok(r.x > 585 && r.x < 594); // dentro de la caja horizontal (585-591 pt)
  // Una caja alta y estrecha SIN `rot` y con varias letras se toma como girada 90°.
  assert.equal(layoutTextLayer([{ text: 'LIBRE', x: 10, y: 10, w: 8, h: 40 }], { page, font })[0].rot, 90);
  // Una sola letra alta (p. ej. un "1" en una celda) NO se gira.
  assert.equal(layoutTextLayer([{ text: '1', x: 10, y: 10, w: 8, h: 40 }], { page, font })[0].rot, 0);
});

test('layoutTextLayer: topes de ejecuciones y de caracteres por página', () => {
  const page = { w: 612, h: 792 };
  const font = { has, width: () => 10 };
  const many = Array.from({ length: 50 }, (_, i) => ({ text: 'palabra' + i, x: 0, y: i * 12, w: 40, h: 10 }));
  assert.equal(layoutTextLayer(many, { page, font, limits: { maxRunsPerPage: 20, maxChars: 1e9 } }).length, 20);
  assert.ok(layoutTextLayer(many, { page, font, limits: { maxRunsPerPage: 1e9, maxChars: 30 } }).length <= 5);
  assert.ok(TEXT_LAYER.maxRunsPerPage > 1000);
});
