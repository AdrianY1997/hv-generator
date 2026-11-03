// Pruebas de las funciones puras de lectura y vigencia. Textos SINTÉTICOS (cédula y números inventados).
// Ejecutar: node --test app/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, analyzeText, computeVigencia, docVigencia, summarizeVigencia, addDays, extractCedulas, cedulaMatch, normalizeText, extractState, pickPages, pageCharCap } from '../js/doc-parse.js';
import { SOURCES, shownDocIds, DEFAULT_SHOWN } from '../js/doc-sources.js';

const CC = '1234567890';
const FIX = {
  policia: 'POLICÍA NACIONAL DE COLOMBIA\nDirección de Investigación Criminal\nLa cédula de ciudadanía No. 1.234.567.890 de PRUEBA PERSONA\nsiendo las 07:43:24 PM horas del 25/03/2026,\nNO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES',
  procuraduria: 'PROCURADURÍA GENERAL DE LA NACIÓN\nCERTIFICADO ORDINARIO No. 123456789\nBogotá DC, 25 de marzo del 2026\nEl señor PRUEBA PERSONA identificado con C.C. 1234567890\nNO REGISTRA SANCIONES NI INHABILIDADES VIGENTES\nJefe de división',
  contraloria: 'CONTRALORÍA DELEGADA PARA RESPONSABILIDAD FISCAL CERTIFICA: Que una vez consultado el SIBOR, hoy miércoles 25 de marzo de 2026, a las 19:46:13, la cédula de ciudadanía 1234567890 NO SE ENCUENTRA REPORTADO COMO RESPONSABLE FISCAL. Código de Verificación: 8F3A2C91B Generó: WEB',
  contraloria2: 'CERTIFICA hoy día, 3 de enero de 2026, a las 08:00:00 Documento de identidad: 1234567890 Código de Verificación 7731905',
  redam: 'REGISTRO DE DEUDORES ALIMENTARIOS MOROSOS Certificado Código Verificación: AB12CD34 Cédula de ciudadanía 1.234.567.890 Fecha de expedición: 16/03/2026 Válida hasta: 14/06/2026 No se encuentra inscrito',
  rnmc: 'POLICÍA NACIONAL Registro Nacional de Medidas Correctivas Que a la fecha, 25/03/2026 07:44:53 p. m. la persona identificada con cédula de ciudadanía 1234567890 NO TIENE MEDIDAS CORRECTIVAS PENDIENTES POR CUMPLIR Registro interno de validación No. 998877',
};

test('parseDate: formatos en español y numéricos', () => {
  assert.equal(parseDate('25 de marzo del 2026'), '2026-03-25');
  assert.equal(parseDate('Bogotá DC, 3 de Enero de 2026'), '2026-01-03');
  assert.equal(parseDate('25/03/2026'), '2026-03-25');
  assert.equal(parseDate('25-03-2026'), '2026-03-25');
  assert.equal(parseDate('2026-03-25'), '2026-03-25');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('sin fecha'), null);
});

test('policía: fecha de la consulta, estado y cédula', () => {
  const r = analyzeText(FIX.policia, 'policia', CC);
  assert.equal(r.lectura, 'auto'); assert.equal(r.emitidoEn, '2026-03-25'); assert.equal(r.fechaConfianza, 'alta');
  assert.equal(r.estado, 'sin_registros'); assert.deepEqual(r.cedulasLeidas, [CC]);
  assert.equal(r.codigo, null);
});

test('procuraduría: número de certificado, fecha, estado', () => {
  const r = analyzeText(FIX.procuraduria, 'procuraduria', CC);
  assert.equal(r.emitidoEn, '2026-03-25'); assert.equal(r.codigo, '123456789'); assert.equal(r.estado, 'sin_registros');
  assert.equal(cedulaMatch(r.cedulasLeidas, CC), true);
});

test('contraloría: "hoy ..." y código de verificación (no confunde "puede constatar")', () => {
  let r = analyzeText(FIX.contraloria, 'contraloria', CC);
  assert.equal(r.emitidoEn, '2026-03-25'); assert.equal(r.codigo, '8F3A2C91B'); assert.equal(r.estado, 'sin_registros');
  r = analyzeText(FIX.contraloria2, 'contraloria', CC);
  assert.equal(r.emitidoEn, '2026-01-03'); assert.equal(r.codigo, '7731905');
  assert.equal(analyzeText('Con el Código de Verificación puede constatar la autenticidad 25/03/2026 texto largo suficiente aqui', 'contraloria').codigo, null);
});

test('REDAM: válida hasta, expedición y código', () => {
  const r = analyzeText(FIX.redam, 'redam', CC);
  assert.equal(r.validaHasta, '2026-06-14'); assert.equal(r.emitidoEn, '2026-03-16'); assert.equal(r.codigo, 'AB12CD34');
  assert.equal(computeVigencia(SOURCES.redam, r, new Date(2026, 5, 1)).expiresAt, '2026-06-14');
});

test('RNMC: fecha, estado y registro interno', () => {
  const r = analyzeText(FIX.rnmc, 'rnmc', CC);
  assert.equal(r.emitidoEn, '2026-03-25'); assert.equal(r.estado, 'sin_registros'); assert.equal(r.codigo, '998877');
});

test('estado: "registra" sin negación gana', () => {
  assert.equal(extractState('El ciudadano REGISTRA SANCIONES vigentes').estado, 'registra');
  assert.equal(extractState('TIENE ASUNTOS PENDIENTES con las autoridades').estado, 'registra');
  assert.equal(extractState('Registraduría Nacional del Estado Civil').estado, null);
});

test('cédula: coincidencia, discrepancia y desconocido', () => {
  const r = analyzeText(FIX.procuraduria, 'procuraduria', '9999999');
  assert.equal(cedulaMatch(r.cedulasLeidas, '9999999'), false);
  assert.equal(cedulaMatch(r.cedulasLeidas, ''), null);
  assert.equal(cedulaMatch([], CC), null);
  assert.deepEqual(extractCedulas('Cédula de Ciudadanía No. 80.123.456 y NIT 900123456'), ['80123456', '900123456']);
  assert.equal(cedulaMatch(['1234567890'], '1.234.567.890'), true);
});

test('lectura fallida: sin texto, sin fecha, fecha de poca confianza', () => {
  assert.deepEqual(analyzeText('  \n ', 'policia'), { lectura: 'fallo', motivo: 'sin_texto' });
  const r = analyzeText('Documento sin ninguna fecha reconocible pero con suficiente texto de relleno', 'rut');
  assert.equal(r.lectura, 'fallo'); assert.equal(r.motivo, 'sin_fecha');
  const g = analyzeText('Constancia de afiliación emitida para el titular 10/02/2026 sin etiqueta clara de expedición', 'eps');
  assert.equal(g.emitidoEn, '2026-02-10');
});

test('normalizeText limpia espacios', () => assert.equal(normalizeText('a  b\n\n c'), 'a b c'));

const NOW = new Date(2026, 5, 1); // 1 jun 2026 (hora local)
test('vigencia: vigente, por vencer, vencido, 90 días', () => {
  const s = SOURCES.procuraduria;
  assert.equal(addDays('2026-03-25', 90), '2026-06-23');
  let v = computeVigencia(s, { emitidoEn: '2026-03-25' }, NOW);
  assert.equal(v.state, 'vigente'); assert.equal(v.daysLeft, 22);
  v = computeVigencia(s, { emitidoEn: '2026-03-10' }, NOW);
  assert.equal(v.state, 'por_vencer'); assert.equal(v.daysLeft, 7); assert.equal(v.label, 'Vence en 7 días');
  v = computeVigencia(s, { emitidoEn: '2026-02-01' }, NOW);
  assert.equal(v.state, 'vencido'); assert.equal(v.label, 'Vencido'); assert.ok(v.daysLeft < 0);
  assert.equal(computeVigencia(s, { emitidoEn: '2026-03-03' }, NOW).label, 'Vence hoy');
});

test('vigencia: configurable (judicial), sin regla y no leído', () => {
  const p = SOURCES.policia;
  assert.equal(computeVigencia(p, { emitidoEn: '2026-04-20' }, NOW).state, 'vencido'); // 30 días por defecto
  assert.equal(computeVigencia(p, { emitidoEn: '2026-04-20', vigenciaDias: 90 }, NOW).state, 'vigente');
  assert.equal(computeVigencia(SOURCES.rut, { emitidoEn: '2020-01-01' }, NOW).state, 'sin_vigencia');
  assert.equal(computeVigencia(SOURCES.cedula, {}, NOW).label, 'Sin vigencia oficial');
  assert.equal(computeVigencia(p, { lectura: 'fallo' }, NOW).state, 'no_leido');
  assert.equal(computeVigencia(undefined, {}, NOW).state, 'sin_vigencia');
});

test('resumen: documento con varios archivos toma el más urgente', () => {
  const metas = { a: { emitidoEn: '2026-03-25' }, b: { emitidoEn: '2026-01-01' }, c: { emitidoEn: '2026-03-10' } };
  const profile = { documents: { procuraduria: ['a', 'b'], contraloria: ['c'], rut: ['x'], policia: [] } };
  assert.equal(docVigencia(SOURCES.procuraduria, ['a', 'b'], metas, NOW).state, 'vencido');
  const docs = ['procuraduria', 'contraloria', 'rut', 'policia'].map((id) => ({ id, label: id }));
  const sum = summarizeVigencia(docs, profile, { ...metas, x: {} }, NOW);
  assert.deepEqual(sum.vencidos.map((x) => x.id), ['procuraduria']);
  assert.deepEqual(sum.porVencer.map((x) => x.id), ['contraloria']);
  assert.equal(sum.conArchivo, 3);
});

test('documentos mostrados: base por defecto, archivos previos y selección explícita', () => {
  const ids = ['cedula', 'policia', 'procuraduria', 'contraloria', 'rnmc', 'inhabilidades', 'libreta', 'rut', 'redam'];
  assert.deepEqual(shownDocIds({}, ids), ids.filter((i) => DEFAULT_SHOWN.includes(i)));
  assert.ok(shownDocIds({ documents: { rut: ['doc:rut'] } }, ids).includes('rut')); // legado con archivos sigue visible
  assert.deepEqual(shownDocIds({ documentsShown: ['redam'], documents: { rut: ['doc:rut'] } }, ids), ['redam']); // explícita manda
  assert.deepEqual(shownDocIds({ documentsShown: [] }, ids), []);
  assert.deepEqual(shownDocIds({ documentsShown: ['inexistente', 'rut'] }, ids), ['rut']);
});

test('registro: ids coherentes, URLs https y sin "Registro RUD"', () => {
  for (const [id, s] of Object.entries(SOURCES)) {
    assert.equal(s.id, id);
    for (const u of [s.url, s.validatorUrl, s.urlInfo, ...(s.alt || []).map((a) => a.url)].filter(Boolean)) assert.match(u, /^https:\/\//);
    assert.ok(['Asistido', 'Manual'].includes(s.verdict));
    assert.doesNotMatch(s.nombre, /RUD/);
  }
});

test('pickPages: primeras 4 + últimas 2, todas si caben, sin repetir', () => {
  assert.deepEqual(pickPages(0), []);
  assert.deepEqual(pickPages(1), [1]);
  assert.deepEqual(pickPages(6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(pickPages(7), [1, 2, 3, 4, 6, 7]);
  assert.deepEqual(pickPages(30), [1, 2, 3, 4, 29, 30]);
  assert.deepEqual(pickPages(30, 1, 1), [1, 30]);
  assert.deepEqual(pickPages(5, 4, 2), [1, 2, 3, 4, 5]); // se solapan: sin duplicados
  assert.deepEqual(pickPages(10, 0, 2), [9, 10]);
  assert.deepEqual(pickPages('x'), []);
  assert.deepEqual(pickPages(undefined), []);
  assert.deepEqual(pickPages(8.9), [1, 2, 3, 4, 7, 8]);
  for (const n of [1, 2, 3, 6, 7, 12, 100]) { const p = pickPages(n); assert.equal(new Set(p).size, p.length); assert.ok(p.every((x, i) => x >= 1 && x <= n && (i === 0 || x > p[i - 1]))); }
});

test('pickPages: la fecha y el código de la última página entran al análisis', () => {
  const pages = Array.from({ length: 12 }, (_, i) => (i === 11 ? 'Bogotá DC, 25 de marzo del 2026. Código de Verificación: AB12CD34' : `Página ${i + 1} de texto genérico`));
  const text = pickPages(pages.length).map((n) => pages[n - 1]).join('\n');
  assert.ok(!text.includes('Página 7 de'));
  const r = analyzeText(text, 'procuraduria', '');
  assert.equal(r.emitidoEn, '2026-03-25');
  assert.ok(r.codigo);
});

test('pageCharCap: reparte el presupuesto con un mínimo por página', () => {
  assert.equal(pageCharCap(6, 120000), 20000);
  assert.equal(pageCharCap(1, 120000), 120000);
  assert.equal(pageCharCap(100, 120000), 4000);
  assert.equal(pageCharCap(0), 120000);
});
