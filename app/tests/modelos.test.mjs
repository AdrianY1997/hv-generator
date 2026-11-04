// G02: varios modelos de HV. Registro, coherencia del schema del Formato Único, ids compartidos con Minerva (datos que se escriben una
// vez), derivaciones de lectura, capacidades del formato, tiempo total de experiencia, escape y regresión del render en blanco de Minerva.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { registry, DEFAULT_MODEL, getModel, templatesFor, templateModelId } from '../js/models/index.js';
import minerva from '../js/models/minerva.js';
import fu, { experienceTotals, CAPACITY } from '../js/models/formato-unico.js';
import layout from '../js/models/formato-unico-layout.js';
import { deriveShared, splitApellidos, derivedValue, DERIVED } from '../js/models/shared-fields.js';
import { checkSchemaConditions } from '../js/conditions.js';

const secOf = (m, id) => m.schema.sections.find((s) => s.id === id);
const sheets = (html) => (html.match(/class="hv-sheet"/g) || []).length;
const NO_DATE = { id: 'x', include: { sections: { solicitud: false }, items: {}, fields: {} }, options: {} };

test('registro: dos modelos, Minerva por omisión; plantillas por modelo (sin modelId = Minerva)', () => {
  assert.deepEqual(Object.keys(registry), ['minerva', 'formato-unico']);
  assert.equal(DEFAULT_MODEL, 'minerva');
  assert.equal(getModel('nada').id, 'minerva');
  const list = [{ id: 'a', modelId: 'minerva' }, { id: 'b', modelId: 'formato-unico' }, { id: 'c' }, { id: 'd', modelId: 'otro' }];
  assert.deepEqual(templatesFor(list, 'minerva').map((t) => t.id), ['a', 'c']);
  assert.deepEqual(templatesFor(list, 'formato-unico').map((t) => t.id), ['b']);
  assert.equal(templateModelId({ modelId: 'otro' }), 'otro', 'un modelo desconocido se conserva (no se lista, no se pierde)');
});

test('Formato Único: schema coherente (ids únicos, condiciones válidas, opciones, documentos)', () => {
  const S = fu.schema.sections;
  assert.equal(new Set(S.map((s) => s.id)).size, S.length);
  for (const s of S) {
    assert.equal(new Set(s.fields.map((f) => f.id)).size, s.fields.length, s.id);
    for (const f of s.fields) {
      assert.ok(f.label && f.type, `${s.id}.${f.id}`);
      if (f.type === 'select') assert.ok(f.options?.length && f.options.every((o) => typeof o.value === 'string' && o.label), `${s.id}.${f.id}`);
    }
  }
  assert.deepEqual(checkSchemaConditions(S), []);
  assert.ok(!S.some((s) => s.fields.some((f) => f.type === 'photo')), 'el formato oficial no lleva foto');
  assert.equal(fu.schema.photo, undefined);
  const ids = fu.schema.documents.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const d of minerva.schema.documents) assert.equal(fu.schema.documents.find((x) => x.id === d.id), d, `documento compartido ${d.id} (mismo objeto)`);
  assert.ok(ids.includes('bienesrentas'));
  assert.ok(!fu.fileIds({}, null).includes('photo'), 'nunca pide la foto');
  assert.deepEqual(fu.fileIds({}, null), ['cert:personales:libretaMilitar', 'cert:basica:titulo'], 'candidatos: certificados de campo (sin leer archivos)');
});

test('ids compartidos con Minerva: misma forma, mismo tipo, mismos certificados y opciones que no pierden respuestas', () => {
  const extra = { 'superior.modalidad': ['Tecnológica especializada'] }; // FU tiene más opciones: forms.js muestra el valor ajeno en Minerva
  let shared = 0;
  for (const s of fu.schema.sections) {
    const m = secOf(minerva, s.id);
    if (!m) continue;
    assert.equal(!!s.repeatable, !!m.repeatable, `forma de la sección ${s.id}`);
    assert.equal(!!s.certificate, !!m.certificate, `certificado de la sección ${s.id} (mismo id de archivo)`);
    for (const f of s.fields) {
      const g = m.fields.find((x) => x.id === f.id);
      if (!g) continue;
      shared++;
      const k = `${s.id}.${f.id}`;
      assert.equal(f.type, g.type, k);
      assert.equal(!!f.certificate, !!g.certificate, k);
      if (f.type === 'select') {
        const a = new Set(f.options.map((o) => o.value)), b = new Set(g.options.map((o) => o.value));
        for (const v of b) assert.ok(a.has(v), `${k}: el valor «${v}» de Minerva no existe en el Formato Único`);
        for (const v of a) assert.ok(b.has(v) || extra[k]?.includes(v), `${k}: valor nuevo «${v}» sin declarar`);
      }
    }
  }
  assert.ok(shared >= 30, `campos compartidos: ${shared}`);
});

test('deriveShared: rellena solo lo vacío, en ambos sentidos, sin mutar', () => {
  assert.deepEqual(splitApellidos('Pérez Gómez'), ['Pérez', 'Gómez']);
  assert.deepEqual(splitApellidos('de la Torre Ruiz'), ['de la Torre', 'Ruiz']);
  assert.deepEqual(splitApellidos('Del Río'), ['Del Río', '']);
  assert.deepEqual(splitApellidos('  Ruiz  '), ['Ruiz', '']);
  const p = { personales: { apellidos: 'Pérez Gómez', ciudad: 'Bogotá', lugarNacimiento: 'Tunja' }, basica: { nivel: 'Bachiller técnico' } };
  const d = deriveShared(p);
  assert.equal(d.personales.primerApellido, 'Pérez'); assert.equal(d.personales.segundoApellido, 'Gómez');
  assert.equal(d.personales.residenciaMunicipio, 'Bogotá'); assert.equal(d.personales.nacimientoMunicipio, 'Tunja');
  assert.equal(d.basica.ultimoGrado, '11');
  assert.equal(p.personales.primerApellido, undefined, 'no muta el original');
  const q = deriveShared({ personales: { primerApellido: 'Ruiz', segundoApellido: 'Díaz', nacimientoMunicipio: 'Pasto', nacimientoDepto: 'Nariño', residenciaMunicipio: 'Cali' }, basica: { ultimoGrado: '7' } });
  assert.equal(q.personales.apellidos, 'Ruiz Díaz'); assert.equal(q.personales.lugarNacimiento, 'Pasto, Nariño'); assert.equal(q.personales.ciudad, 'Cali');
  assert.equal(q.basica.nivel, 'Bachiller básico');
  const both = deriveShared({ personales: { apellidos: 'A B', primerApellido: 'X' } });
  assert.equal(both.personales.apellidos, 'A B', 'lo escrito manda');
  assert.equal(both.personales.segundoApellido, undefined, 'con primer apellido propio no se parte «Apellidos»');
  const empty = {};
  assert.equal(deriveShared(empty), empty);
  assert.equal(derivedValue(p, 'personales', 'primerApellido'), 'Pérez');
  assert.equal(derivedValue(p, 'personales', 'apellidos'), '', 'campo con dato: sin marcador');
  for (const [s, f, fn, txt] of DERIVED) { assert.equal(typeof fn, 'function'); assert.ok(s && f && txt); }
});

test('datos de Minerva salen en el Formato Único y al revés (se escriben una vez)', () => {
  const p = {
    personales: { nombres: 'Ana María', apellidos: 'Pérez Gómez', tipoDocumento: 'CC', numeroDocumento: '1020304050', sexo: 'F', nacionalidad: 'Colombiana', correo: 'ana@example.com', fechaNacimiento: '1990-05-17', estadoCivil: 'Soltero(a)' },
    superior: [{ id: 's1', modalidad: 'Profesional', programa: 'Ingeniería de sistemas', graduado: true, fechaGrado: '2014-06-20', institucion: 'U' }],
    experiencia: [{ id: 'e1', empresa: 'Alcaldía de Tunja', cargo: 'Profesional universitario', fechaInicio: '2018-01-15', actual: true }],
  };
  const h = fu.render(p, null, {});
  for (const s of ['Pérez', 'Gómez', 'Ana María', '1020304050', 'Ingeniería de sistemas', 'Alcaldía de Tunja', 'Profesional universitario', 'ana@example.com']) assert.ok(h.includes(`>${s}<`), s);
  assert.ok(h.includes('>UN<'), 'modalidad Profesional = UN');
  assert.deepEqual(fu.missing(p, null, {}), [], 'el primer apellido derivado cuenta como escrito');
  const q = { personales: { nombres: 'Luis', primerApellido: 'de la Torre', segundoApellido: 'Ruiz', residenciaMunicipio: 'Pasto' } };
  const m = minerva.render(q, null, {});
  assert.ok(m.includes('>de la Torre Ruiz<'), 'Minerva imprime los apellidos del Formato Único');
  assert.ok(m.includes('>Pasto<'));
  assert.ok(!minerva.missing(q, null, {}).some((x) => /Apellidos/.test(x)));
});

test('render: cada caja que usa el render existe en el layout (perfil con todo)', () => {
  const misses = new Set();
  const orig = layout.pages.map((p) => p.w);
  layout.pages.forEach((p, i) => { p.w = new Proxy(orig[i], { get: (o, k) => { if (typeof k === 'string' && !(k in o)) misses.add(`${i}:${k}`); return o[k]; } }); });
  try {
    const exp = (n, extra = {}) => ({ id: 'e' + n, empresa: 'E' + n, sector: n % 2 ? 'Pública' : 'Privada', pais: 'Colombia', departamento: 'Boyacá', municipio: 'Tunja', correoEntidad: 'a@b.co', telefono: '1', fechaInicio: `20${10 + n}-01-01`, fechaFin: `20${10 + n}-12-31`, cargo: 'C', dependencia: 'D', direccion: 'Cra 1', ...extra });
    fu.render({
      solicitud: { entidadReceptora: 'ICBF', fecha: '2026-11-03', ciudadDiligenciamiento: 'Tunja' },
      personales: { primerApellido: 'A', segundoApellido: 'B', nombres: 'C', tipoDocumento: 'PPT', numeroDocumento: '123456', sexo: 'M', nacionalidad: 'Venezolana', libretaMilitar: '12345', claseLibreta: 'Primera clase', distritoMilitar: '3', fechaNacimiento: '1990-01-02', nacimientoPais: 'X', nacimientoDepto: 'Y', nacimientoMunicipio: 'Z', direccion: 'D', residenciaPais: 'P', residenciaDepto: 'Q', residenciaMunicipio: 'R', telefono: '1', correo: 'a@b.co' },
      basica: { ultimoGrado: '11', titulo: 'Bachiller', mesGrado: '11', anio: 2007 },
      superior: Array.from({ length: 5 }, (_, i) => ({ id: 's' + i, modalidad: 'Maestría', semestres: 4, graduado: i % 2 === 0, programa: 'P' + i, fechaGrado: '2015-06-01', tarjetaProfesional: 'T' })),
      idiomas: [{ id: 'i0', idioma: 'Inglés', habla: 'Alto', lee: 'Medio', escribe: 'Bajo' }, { id: 'i1', idioma: 'Francés', habla: 'Bajo', lee: 'Bajo', escribe: 'Bajo' }],
      experiencia: [exp(0, { actual: true, fechaFin: '' }), ...[1, 2, 3, 4].map((n) => exp(n))],
      tiempoExperiencia: {}, declaracion: { inhabilidad: 'No' },
    }, null, {});
  } finally { layout.pages.forEach((p, i) => { p.w = orig[i]; }); }
  assert.deepEqual([...misses], []);
});

test('capacidades: 5 estudios, 2 idiomas y hojas de experiencia repetidas («imprima nuevamente esta hoja»)', () => {
  assert.deepEqual(CAPACITY, { superior: 5, idiomas: 2, experienciaPorHoja: 4, experienciaAnterioresPorHoja: 3 });
  const many = (n, f) => Array.from({ length: n }, (_, i) => ({ id: `x${i}`, ...f(i) }));
  const base = { personales: { primerApellido: 'A', nombres: 'B' } };
  assert.equal(sheets(fu.render(base, null, {})), 3);
  const sup = fu.render({ ...base, superior: many(6, (i) => ({ programa: 'Programa ' + i })) }, null, {});
  assert.ok(sup.includes('hv-cont') && sup.includes('>Programa 5<'), 'el sexto estudio va a la hoja de continuación');
  const idi = fu.render({ ...base, idiomas: many(3, (i) => ({ idioma: 'Idioma ' + i })) }, null, {});
  assert.ok(idi.includes('hv-cont') && idi.includes('>Idioma 2<'));
  const exp = (n, cur) => many(n, (i) => ({ empresa: 'Empresa ' + i, cargo: 'c', fechaInicio: `20${10 + i}-01-01`, ...(i < cur ? { actual: true } : { fechaFin: `20${10 + i}-12-31` }) }));
  assert.equal(sheets(fu.render({ ...base, experiencia: exp(4, 1) }, null, {})), 3, '1 actual + 3 anteriores caben en una hoja');
  assert.equal(sheets(fu.render({ ...base, experiencia: exp(8, 1) }, null, {})), 5, '1 actual + 7 anteriores = 3 hojas de experiencia');
  assert.equal(sheets(fu.render({ ...base, experiencia: exp(3, 2) }, null, {})), 4, 'dos trabajos actuales: uno por hoja en el bloque superior');
  assert.ok(!fu.render({ ...base, experiencia: exp(8, 1) }, null, {}).includes('hv-cont'), 'la experiencia no va a la continuación');
});

test('tiempo total: lo simultáneo cuenta una vez, por ocupación, actual hasta hoy, modo manual', () => {
  const r = experienceTotals([
    { fechaInicio: '2010-01-01', fechaFin: '2011-12-30', sector: 'Pública' }, // 729 días
    { fechaInicio: '2011-01-01', fechaFin: '2012-12-30', sector: 'Pública' }, // se cruza con el anterior
    { fechaInicio: '2013-01-01', fechaFin: '2013-12-31', ocupacion: 'Independiente', sector: 'Pública' },
    { fechaInicio: '2014-01-01', fechaFin: '2014-06-29' }, // sin ocupación: solo total
    { fechaInicio: '2015-01-01' }, // sin retiro y no actual: no suma
  ], '2026-01-01');
  assert.deepEqual(r['Servidor público'], { years: 3, months: 0 }); // 2010-01-01..2012-12-30 = 1095 días = 36 meses
  assert.deepEqual(r.Independiente, { years: 1, months: 0 });
  assert.equal(r['Empleado privado'], null);
  assert.deepEqual(r.total, { years: 4, months: 6 }); // 1095 + 365 + 180 = 1640 días = 54 meses
  assert.deepEqual(experienceTotals([{ fechaInicio: '2025-01-01', actual: true, sector: 'Privada' }], '2025-12-31')['Empleado privado'], { years: 1, months: 0 });
  const h = fu.render({ tiempoExperiencia: { calculo: 'manual', servidorAnios: 2, servidorMeses: 11, privadoMeses: 3 } }, null, {});
  assert.ok(h.includes('>2<') && h.includes('>11<') && h.includes('>3<'));
  assert.ok(h.includes('<dt>Total tiempo experiencia</dt><dd>3 años y 2 meses</dd>'), 'la lectura lineal da el total calculado');
});

test('escape, datos ocultos y plantilla: lo hostil no se interpreta, lo que no aplica no se imprime', () => {
  const evil = '<img src=x onerror=alert(1)>"&';
  const h = fu.render({ personales: { nombres: evil, sexo: 'F', libretaMilitar: '99999' }, solicitud: { entidadReceptora: evil } }, null, {});
  assert.ok(!h.includes('<img src=x'), 'sin HTML del usuario');
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!h.includes('99999'), 'libreta militar oculta con sexo F: no se imprime');
  const t = { id: 't', include: { sections: { experiencia: false }, items: {}, fields: { 'personales.nombres': false } }, options: {} };
  const p = { personales: { nombres: 'Visible?', primerApellido: 'Ruiz' }, experiencia: [{ id: 'e', empresa: 'Oculta SA', cargo: 'x' }] };
  const r = fu.render(p, t, {});
  assert.ok(!r.includes('Visible?') && !r.includes('Oculta SA') && r.includes('>Ruiz<'));
});

test('lectura lineal accesible (.hv-sr) y hojas aria-hidden con texto real para la capa de texto del paquete', () => {
  const h = fu.render({ personales: { primerApellido: 'Ruiz', nombres: 'Ana' } }, null, {});
  assert.match(h, /<div class="hv-sr" role="group" aria-label="Contenido de la hoja de vida en lectura lineal" style="position:absolute/);
  assert.ok(h.includes('<dt>Primer apellido</dt><dd>Ruiz</dd>'));
  assert.equal((h.match(/<div class="hv-sheet" aria-hidden="true">/g) || []).length, 3);
  assert.ok(/<text [^>]*>DATOS PERSONALES<\/text>/.test(h), 'rótulos como <text> SVG (los recoge rasterizeHv)');
  assert.ok(h.includes('<image ') && h.includes('href="data:image/png;base64,'), 'escudo incrustado (sin peticiones externas)');
  assert.ok(!/dafp\.gov\.co/.test(h), 'el texto tapado en el PDF (rectángulo blanco) no se emite');
  assert.equal(layout.width, 612); assert.equal(layout.height, 792); assert.equal(layout.pages.length, 3);
});

test('fitLimit: casillas conocidas, nulas para campos sin casilla de texto', () => {
  const a = fu.fitLimit('personales', 'primerApellido');
  assert.ok(a && a.comfort > 20 && a.max > a.comfort && a.multi === false, JSON.stringify(a));
  assert.ok(fu.fitLimit('personales', 'libretaMilitar').max < fu.fitLimit('personales', 'direccion').max);
  assert.ok(fu.fitLimit('solicitud', 'ciudadDiligenciamiento').max < 120, 'reserva el espacio de la fecha');
  assert.equal(fu.fitLimit('personales', 'fechaNacimiento'), null);
});

test('regresión: el render en blanco de Minerva no cambia (byte a byte)', () => {
  const h = minerva.render({}, NO_DATE, {});
  assert.equal(crypto.createHash('sha256').update(h).digest('hex'), 'c98a49e24eb8a19daf4fdddf30facc43524a180dd2a88209b7d45510ef7e5852');
  assert.equal(h.length, 151789);
});
