// Consistencia del registro de documentos (js/doc-sources.js): ids únicos, campos legales, valores por defecto y paridad entre modelos.
// Fuente de los datos: docs/VERIFICACION-LEGAL.md (2026-11-03).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, DOC_ORDER, DEFAULT_SHOWN, LEGACY_DEFAULT_SHOWN, DISCLAIMER, VIGENCIA_BASIS, EMPLOYER_LABEL, CONFIANZA_LABEL, LEGAL_STATUS_LABEL, EMPLOYER_CHIP_NO, DOC_MIGRATE, registryDocuments } from '../js/doc-sources.js';
import minerva from '../js/models/minerva.js';
import fu from '../js/models/formato-unico.js';

const ids = Object.keys(SOURCES);
// Ids que ya existían antes de la verificación legal: nunca se renombran ni se eliminan (los archivos viven en doc:<id>).
const LEGACY_IDS = ['cedula', 'procuraduria', 'contraloria', 'policia', 'rnmc', 'inhabilidades', 'libreta', 'rut', 'eps', 'pension', 'sisben', 'redam', 'bdme', 'vigenciacedula', 'leyangel', 'bienesrentas'];

test('registro: ids únicos, estables y en el mismo orden que la lista de los modelos', () => {
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(DOC_ORDER).size, DOC_ORDER.length);
  assert.deepEqual([...DOC_ORDER].sort(), [...ids].sort(), 'DOC_ORDER y SOURCES tienen los mismos ids');
  for (const id of LEGACY_IDS) assert.ok(ids.includes(id), `el id ${id} no puede desaparecer ni renombrarse`);
  assert.deepEqual(DOC_ORDER.slice(0, 15), ['cedula', 'procuraduria', 'contraloria', 'policia', 'rnmc', 'inhabilidades', 'libreta', 'rut', 'eps', 'pension', 'sisben', 'redam', 'bdme', 'vigenciacedula', 'leyangel'], 'los ids antiguos conservan su orden; los nuevos van al final');
  for (const [from, to] of Object.entries(DOC_MIGRATE)) assert.ok(ids.includes(to), `migración ${from} -> ${to}`);
  for (const id of ['autorizaciondatos', 'autorizacion1918', 'procuraduriaespecial', 'examenmedico']) assert.ok(ids.includes(id), id);
});

test('registro: cada documento tiene etiqueta, pista, cómo obtenerlo y los campos legales', () => {
  for (const [id, s] of Object.entries(SOURCES)) {
    assert.equal(s.id, id);
    assert.ok(s.label && s.hint && s.nombre && s.entidad, `${id}: etiqueta, pista, nombre y entidad`);
    assert.ok(['Asistido', 'Manual'].includes(s.verdict), id);
    assert.ok(Array.isArray(s.steps) && s.steps.length, `${id}: pasos de «Cómo obtenerlo»`);
    assert.ok(s.action && Array.isArray(s.inputs), id);
    assert.ok(['core', 'optional', 'otros'].includes(s.tier), id);
    assert.equal(s.core, s.tier === 'core');
    assert.equal(s.optional, s.tier !== 'core');
    // Base legal: cita corta + URL https; vacía solo si se declara «sin verificar».
    assert.ok(Array.isArray(s.legalBasis), id);
    assert.ok(s.legalBasis.length > 0 || s.legalStatus === 'sin_verificar', `${id}: base legal o «sin_verificar»`);
    for (const r of s.legalBasis) { assert.ok(r.text && r.text.length >= 10, id); assert.match(r.url, /^https:\/\//, id); }
    assert.ok(LEGAL_STATUS_LABEL[s.legalStatus], `${id}: legalStatus`);
    const em = s.employerMayRequire;
    assert.ok(em && EMPLOYER_LABEL[em.value] && CONFIANZA_LABEL[em.confianza] && em.nota, `${id}: employerMayRequire`);
    assert.ok(typeof s.publicEntityNote === 'string' && s.publicEntityNote.length > 10, `${id}: publicEntityNote`);
    // Vigencia coherente.
    const v = s.vigencia;
    assert.ok(['oficial', 'practica', 'ninguna'].includes(v.tipo) && VIGENCIA_BASIS[v.basis], `${id}: vigencia`);
    if (v.tipo === 'ninguna') assert.equal(v.basis, 'ninguna', id); else assert.ok(v.dias >= 1 && v.dias <= 365, id);
    if (v.tipo === 'oficial') assert.equal(v.basis, 'norma', `${id}: «oficial» solo para normas expresas`);
    for (const u of [s.url, s.validatorUrl, s.urlInfo, ...(s.alt || []).map((a) => a.url)].filter(Boolean)) assert.match(u, /^https:\/\//, id);
    assert.doesNotMatch(JSON.stringify(s), /RUD\b/, `${id}: sin «Registro RUD»`);
    assert.doesNotMatch(JSON.stringify(s), /contradicen|contradictori|fuente secundaria, sin confirmar/i, `${id}: sin notas obsoletas`);
  }
});

test('valores por defecto según la verificación legal', () => {
  const tier = (t) => ids.filter((i) => SOURCES[i].tier === t).sort();
  assert.deepEqual([...DEFAULT_SHOWN].sort(), ['cedula', 'contraloria', 'eps', 'pension', 'policia', 'procuraduria']);
  assert.deepEqual(tier('core'), [...DEFAULT_SHOWN].sort(), 'lo visible por defecto es lo «principal»');
  for (const id of ['rnmc', 'rut', 'libreta', 'redam']) assert.equal(SOURCES[id].tier, 'optional', id);
  for (const id of ['inhabilidades', 'sisben', 'bdme', 'vigenciacedula', 'leyangel', 'autorizacion1918']) assert.equal(SOURCES[id].tier, 'otros', id);
  for (const id of ids) if (!DEFAULT_SHOWN.includes(id)) assert.notEqual(SOURCES[id].tier, 'core', id);
  assert.ok(LEGACY_DEFAULT_SHOWN.includes('rnmc') && LEGACY_DEFAULT_SHOWN.includes('inhabilidades'));
});

test('correcciones puntuales del informe (etiquetas, citas y avisos)', () => {
  const S = SOURCES;
  assert.match(S.policia.label, /consulta en línea/);
  assert.match(S.policia.hint, /Decreto 19 de 2012/);
  assert.equal(S.policia.employerMayRequire.value, 'no');
  assert.match(S.procuraduria.label, /Certificado de antecedentes \(Procuraduría\)/);
  assert.match(S.procuraduria.hint, /Res\. PGN 143\/2002/);
  assert.match(S.contraloria.hint, /criterio/i);
  assert.match(S.rnmc.hint, /art\. 183/);
  assert.match(S.rnmc.hint, /Sin vigencia legal/);
  assert.match(S.inhabilidades.hint, /autorización escrita/);
  assert.match(S.inhabilidades.hint, /No es un documento que debas aportar/);
  assert.match((S.inhabilidades.notes || []).join(' '), /C-407 de 2020/);
  assert.ok(S.inhabilidades.legalBasis.some((r) => /C-407/.test(r.text)));
  assert.match(S.libreta.label, /tarjeta o certificación provisional/);
  assert.match(S.libreta.hint, /Ley 1861, art\. 42/);
  assert.equal(S.libreta.employerMayRequire.value, 'no');
  assert.match(S.redam.hint, /Ley 2097/);
  assert.match(S.redam.vigencia.fuente, /Ley 2097/);
  assert.doesNotMatch(S.redam.vigencia.fuente, /PDF de muestra/);
  assert.match(S.bdme.manualNote, /30 de mayo/);
  assert.match(S.bdme.manualNote, /30 de noviembre/);
  assert.match(S.bdme.manualNote, /NO se pudo verificar/);
  assert.match(S.leyangel.hint, /Ley 2480/);
  assert.match(S.leyangel.manualNote, /Kiara/);
  assert.match(S.rut.hint, /contratistas/);
  assert.match(S.sisben.hint, /No se encontró una norma/);
  assert.match(S.eps.hint, /empleador/);
  assert.match(S.pension.hint, /empleador/);
  assert.match(S.examenmedico.hint, /Res\. 3941/);
  assert.equal(S.sisben.legalStatus, 'sin_verificar');
  assert.equal(S.vigenciacedula.legalStatus, 'sin_verificar');
  assert.equal(S.bdme.employerMayRequire.confianza, 'baja');
  assert.ok(EMPLOYER_CHIP_NO.startsWith('Un empleador no puede exigirlo'));
});

test('descargo: texto del informe', () => {
  assert.match(DISCLAIMER.title, /no es asesoría jurídica/);
  for (const frag of ['noviembre de 2026', 'verifica siempre con la entidad', 'Ley 1581 de 2012', 'Ministerio del Trabajo']) assert.ok(DISCLAIMER.body.includes(frag), frag);
});

test('paridad: Minerva y Formato Único usan el mismo registro (sin divergencia)', () => {
  assert.deepEqual(minerva.schema.documents, registryDocuments());
  assert.deepEqual(minerva.schema.documents.map((d) => d.id), DOC_ORDER);
  for (const d of minerva.schema.documents) {
    assert.equal(fu.schema.documents.find((x) => x.id === d.id), d, `${d.id}: mismo objeto en el Formato Único`);
    assert.equal(d.label, SOURCES[d.id].label);
    assert.equal(d.hint, SOURCES[d.id].hint);
  }
  assert.deepEqual(fu.schema.documents.map((d) => d.id), DOC_ORDER, 'el Formato Único no añade documentos propios fuera del registro');
  for (const d of fu.schema.documents) assert.ok(SOURCES[d.id], `${d.id} está en el registro`);
});

// ---- Quinta auditoría: palabras exactas del estado legal (docs/VERIFICACION-LEGAL.md es la fuente de verdad) ----
import fs from 'node:fs';
import { computeVigencia } from '../js/doc-parse.js';

test('legal: procuraduría y REDAM son «parcial» (norma leída, vigencia/reglamento sin comprobar), con nota y lenguaje prudente', () => {
  const md = fs.readFileSync(new URL('../../docs/VERIFICACION-LEGAL.md', import.meta.url), 'utf8');
  assert.match(md, /VERIFIED \(norma\) \/ PARTIAL \(sigue vigente\)/, 'la fuente de verdad marca la vigencia disciplinaria como PARTIAL');
  assert.match(md, /Decreto 1310\/2022[^|]*no leído/, 'la fuente de verdad: Decreto 1310/2022 no leído');
  for (const id of ['procuraduria', 'procuraduriaespecial', 'redam']) {
    assert.equal(SOURCES[id].legalStatus, 'parcial', id);
    assert.ok(SOURCES[id].legalNote && SOURCES[id].legalNote.length > 40, `${id}: dice qué falta verificar`);
    assert.equal(SOURCES[id].vigencia.tipo, 'oficial', `${id}: la norma sigue acotando la vigencia`);
  }
  assert.match(SOURCES.procuraduria.legalNote, /no se comprobó que siga vigente/);
  assert.match(SOURCES.redam.legalNote, /Decreto 1310 de 2022/);
  assert.match(SOURCES.redam.legalNote, /no se leyó/);
  for (const id of ['procuraduria', 'redam']) {
    assert.match(SOURCES[id].hint, /según la norma citada/, id);
    assert.match(SOURCES[id].hint, /confirma que sigue vigente/, id);
    assert.doesNotMatch(SOURCES[id].hint, /garantiz|siempre vale|es obligatori/i, id);
  }
  assert.match(SOURCES.redam.vigencia.fuente, /no se leyó el Decreto 1310/);
  assert.match(VIGENCIA_BASIS.norma, /Norma citada/);
  assert.match(VIGENCIA_BASIS.norma, /confirma que sigue vigente/);
  // Lo que sí quedó verificado por completo conserva su estado.
  for (const id of ['policia', 'inhabilidades', 'libreta', 'leyangel']) assert.equal(SOURCES[id].legalStatus, 'verificado', id);
});

test('legal: documentos básicos (cédula, EPS, pensión) no muestran «Sin verificar…»: etiqueta neutral', () => {
  for (const id of ['cedula', 'eps', 'pension']) assert.equal(SOURCES[id].legalStatus, 'sin_verificar', id);
  assert.equal(LEGAL_STATUS_LABEL.sin_verificar, 'Sin norma específica identificada');
  for (const label of Object.values(LEGAL_STATUS_LABEL)) assert.doesNotMatch(label, /sin verificar|no se encontró/i);
  assert.match(LEGAL_STATUS_LABEL.parcial, /parcial/i);
});

test('vigencia «oficial»: una plantilla puede ACORTARla pero no alargarla, y se dice por qué; «práctica» la sustituye', () => {
  const now = new Date('2026-11-04T12:00:00');
  const meta = { emitidoEn: '2026-10-20' }; // procuraduría: 90 días -> vence 2027-01-18
  const base = computeVigencia(SOURCES.procuraduria, meta, now, {});
  assert.equal(base.expiresAt, '2027-01-18');
  const shorter = computeVigencia(SOURCES.procuraduria, meta, now, { maxAgeDays: 30 });
  assert.equal(shorter.expiresAt, '2026-11-19');
  assert.equal(shorter.porPlantilla, true);
  assert.match(shorter.detail, /según la plantilla/);
  const longer = computeVigencia(SOURCES.procuraduria, meta, now, { maxAgeDays: 365 });
  assert.equal(longer.expiresAt, '2027-01-18', 'no se alarga');
  assert.equal(longer.porPlantilla, false);
  assert.equal(longer.normaLimita, true);
  assert.match(longer.detail, /límite fijado por la norma citada que una plantilla no alarga/);
  assert.equal(computeVigencia(SOURCES.redam, { ...meta, validaHasta: '2026-12-01' }, now, { maxAgeDays: 365 }).expiresAt, '2026-12-01', 'REDAM: «Válida hasta» manda');
  const practica = computeVigencia(SOURCES.contraloria, meta, now, { maxAgeDays: 365 });
  assert.equal(practica.expiresAt, '2027-10-20', 'práctica: la plantilla sustituye la regla');
  assert.equal(practica.normaLimita, false);
});

test('conjunto por defecto nuevo: la migración conserva el anterior para quien ya usaba la app (LEGACY_DEFAULT_SHOWN es el de HEAD desplegado)', () => {
  assert.deepEqual(LEGACY_DEFAULT_SHOWN, ['cedula', 'policia', 'procuraduria', 'contraloria', 'rnmc', 'inhabilidades']);
  assert.ok(!DEFAULT_SHOWN.includes('rnmc') && !DEFAULT_SHOWN.includes('inhabilidades'));
});
