import test from 'node:test';
import assert from 'node:assert/strict';
import { evalCond, refsOf, createVisibility, pruneProfile, checkSchemaConditions, answered, hasValue } from '../js/conditions.js';
import { validateProfile } from '../js/validators.js';
import minerva from '../js/models/minerva.js';
import { fitCapacity } from '../js/models/minerva-fit.js';

const rec = (o) => (ref) => ({ value: Object.hasOwn(o, ref) ? o[ref] : undefined, visible: true });
const ev = (cond, o = {}) => evalCond(cond, rec(o));

test('respuestas: vacío no es lo mismo que false, 0 o []', () => {
  for (const v of [undefined, null, '', '   ']) assert.equal(answered(v), false);
  for (const v of [false, 0, [], 'No']) assert.equal(answered(v), true);
  assert.equal(hasValue(false), false);
  assert.equal(hasValue([]), false);
  assert.equal(hasValue(0), true);
});

test('operadores de una hoja', () => {
  assert.equal(ev({ field: 'a', equals: 'Si' }, { a: 'Si' }), true);
  assert.equal(ev({ field: 'a', equals: 'Si' }, { a: 'No' }), false);
  assert.equal(ev({ field: 'a', equals: true }, { a: true }), true);
  assert.equal(ev({ field: 'a', equals: true }, { a: false }), false);
  assert.equal(ev({ field: 'a', not: 'F' }, { a: 'M' }), true);
  assert.equal(ev({ field: 'a', not: 'F' }, { a: 'F' }), false);
  assert.equal(ev({ field: 'a', in: ['x', 'y'] }, { a: 'y' }), true);
  assert.equal(ev({ field: 'a', in: ['x', 'y'] }, { a: 'z' }), false);
  assert.equal(ev({ field: 'a', notIn: ['x'] }, { a: 'z' }), true);
  assert.equal(ev({ field: 'a', includes: 'k' }, { a: ['j', 'k'] }), true);
  assert.equal(ev({ field: 'a', includes: 'k' }, { a: [] }), false);
  assert.equal(ev({ field: 'a', notEmpty: true }, { a: 'x' }), true);
  assert.equal(ev({ field: 'a', notEmpty: true }, { a: '' }), false);
  assert.equal(ev({ field: 'a', empty: true }, { a: '' }), true);
  assert.equal(ev({ field: 'a', gt: 0 }, { a: 2 }), true);
  assert.equal(ev({ field: 'a', gt: 0 }, { a: 0 }), false);
  assert.equal(ev({ field: 'a', gte: 2 }, { a: '2' }), true);
  assert.equal(ev({ field: 'a', lt: 2 }, { a: 1 }), true);
  assert.equal(ev({ field: 'a', lte: 2 }, { a: 3 }), false);
});

test('controlador vacío: tres valores y whenEmpty', () => {
  assert.equal(ev({ field: 'a', equals: 'Si' }, {}), null);
  assert.equal(ev({ field: 'a', in: ['x'] }, {}), null);
  assert.equal(ev({ field: 'a', includes: 'k' }, {}), null);
  assert.equal(ev({ field: 'a', gt: 0 }, {}), null);
  assert.equal(ev({ field: 'a', not: 'F' }, {}), true, 'vacío no es igual a nada');
  assert.equal(ev({ field: 'a', notEmpty: true }, {}), false);
  assert.equal(ev({ field: 'a', equals: 'Si', whenEmpty: true }, {}), true);
  assert.equal(ev({ field: 'a', equals: 'Si', whenEmpty: false }, {}), false);
  assert.equal(ev({ field: 'a', equals: 'Si', whenEmpty: true }, { a: 'No' }), false, 'whenEmpty solo rige con el controlador vacío');
});

test('combinadores', () => {
  const T = { field: 'a', equals: 1 }, F = { field: 'a', equals: 2 }, U = { field: 'b', equals: 1 };
  const o = { a: 1 };
  assert.equal(ev({ allOf: [T, T] }, o), true);
  assert.equal(ev({ allOf: [T, F] }, o), false);
  assert.equal(ev({ allOf: [T, U] }, o), null);
  assert.equal(ev({ allOf: [F, U] }, o), false);
  assert.equal(ev({ anyOf: [F, T] }, o), true);
  assert.equal(ev({ anyOf: [F, U] }, o), null);
  assert.equal(ev({ anyOf: [F, F] }, o), false);
  assert.equal(ev({ noneOf: [F, F] }, o), true);
  assert.equal(ev({ noneOf: [F, T] }, o), false);
  assert.equal(ev({ noneOf: [F, U] }, o), null);
  assert.equal(ev({ allOf: [] }, o), true);
});

test('condiciones mal formadas o hostiles no ocultan nada ni se ejecutan', () => {
  for (const c of [null, undefined, 'x', 5, [], {}, { field: 7 }, { allOf: 'no' }, { field: 'a' }]) assert.equal(ev(c, { a: 1 }), true);
  let ran = false;
  globalThis.__pwned = () => { ran = true; };
  assert.equal(ev({ field: 'a', equals: '__pwned()' }, { a: 'x' }), false);
  assert.equal(ev({ field: 'constructor', equals: 'x' }, {}), null);
  assert.equal(ev({ field: '__proto__', equals: 'x' }, {}), null);
  assert.equal(ran, false);
  delete globalThis.__pwned;
  // anidamiento absurdo: corta en vez de desbordar la pila
  let deep = { field: 'a', equals: 1 };
  for (let i = 0; i < 50; i++) deep = { allOf: [deep] };
  assert.doesNotThrow(() => ev(deep, { a: 1 }));
});

test('refsOf lista los controladores', () => {
  assert.deepEqual([...refsOf({ allOf: [{ field: 'a', equals: 1 }, { anyOf: [{ field: 'x.y', notEmpty: true }] }] })].sort(), ['a', 'x.y']);
});

const SECS = [
  { id: 'p', title: 'P', fields: [
    { id: 'trabaja', type: 'select' },
    { id: 'empresa', type: 'text', showIf: { field: 'trabaja', equals: 'Si' } },
    { id: 'sub', type: 'text', showIf: { field: 'empresa', notEmpty: true } }, // cadena: depende de un campo condicional
    { id: 'sexo', type: 'select' },
  ] },
  { id: 'f', title: 'F', fields: [
    { id: 'conyuge', type: 'text', showIf: { field: 'p.sexo', in: ['M'] } },
    { id: 'graduado', type: 'checkbox' },
    { id: 'fecha', type: 'date', showIf: { field: 'graduado', equals: true } },
  ] },
  { id: 'r', title: 'R', repeatable: true, fields: [
    { id: 'actual', type: 'checkbox' },
    { id: 'fin', type: 'date', showIf: { field: 'actual', not: true } },
  ] },
  { id: 'extra', title: 'Extra', showIf: { field: 'p.trabaja', equals: 'Si' }, fields: [{ id: 'x', type: 'text' }] },
];

test('visibilidad: campo, cadena, sección y otra sección', () => {
  const prof = { p: { trabaja: 'Si', empresa: 'ACME', sub: 's', sexo: 'M' }, f: { conyuge: 'Ana' } };
  let V = createVisibility(SECS, prof);
  assert.equal(V.fieldVisible(SECS[0], prof.p, SECS[0].fields[1]), true);
  assert.equal(V.fieldVisible(SECS[0], prof.p, SECS[0].fields[2]), true);
  assert.equal(V.fieldVisible(SECS[1], prof.f, SECS[1].fields[0]), true);
  assert.equal(V.sectionVisible(SECS[3]), true);
  prof.p.trabaja = 'No';
  V = createVisibility(SECS, prof);
  assert.equal(V.fieldVisible(SECS[0], prof.p, SECS[0].fields[1]), false);
  assert.equal(V.fieldVisible(SECS[0], prof.p, SECS[0].fields[2]), false, 'el controlador oculto oculta al dependiente (sub tiene empresa)');
  assert.equal(V.sectionVisible(SECS[3]), false);
  assert.deepEqual([...V.visibleIds(SECS[0], prof.p)].sort(), ['sexo', 'trabaja']);
});

test('repetibles: cada ítem se evalúa por separado', () => {
  const prof = { r: [{ id: '1', actual: true, fin: '2020-01-01' }, { id: '2', actual: false }, { id: '3' }] };
  const V = createVisibility(SECS, prof);
  const fin = SECS[2].fields[1];
  assert.deepEqual(prof.r.map((it) => V.fieldVisible(SECS[2], it, fin)), [false, true, true]);
});

test('perfiles anteriores (marca legacyConditions): controlador vacío + dato propio -> se muestra; sin dato -> oculto', () => {
  const V = createVisibility(SECS, { legacyConditions: true, p: { empresa: 'ACME' }, f: { fecha: '2020-01-01' } });
  assert.equal(V.fieldVisible(SECS[0], { empresa: 'ACME' }, SECS[0].fields[1]), true);
  assert.equal(V.fieldVisible(SECS[0], {}, SECS[0].fields[1]), false);
  // casilla sin marcar (false) es una respuesta: manda
  assert.equal(V.fieldVisible(SECS[1], { graduado: false, fecha: '2020-01-01' }, SECS[1].fields[2]), false);
  assert.equal(V.fieldVisible(SECS[1], { fecha: '2020-01-01' }, SECS[1].fields[2]), true);
  assert.equal(V.fieldVisible(SECS[1], { graduado: true }, SECS[1].fields[2]), true);
});

test('perfil NUEVO (sin marca): controlador sin responder o borrado oculta al dependiente aunque tenga dato', () => {
  const V = createVisibility(SECS, { p: { empresa: 'ACME' }, f: { fecha: '2020-01-01' } });
  assert.equal(V.fieldVisible(SECS[0], { empresa: 'ACME' }, SECS[0].fields[1]), false);
  assert.equal(V.fieldVisible(SECS[1], { fecha: '2020-01-01' }, SECS[1].fields[2]), false);
  // la marca solo vale si es exactamente true
  assert.equal(createVisibility(SECS, { legacyConditions: 'true' }).fieldVisible(SECS[0], { empresa: 'ACME' }, SECS[0].fields[1]), false);
  // el usuario respondió No y luego borró el controlador: el dato ya no se imprime
  const prof = { p: { trabaja: 'No', empresa: 'ACME' } };
  assert.equal(pruneProfile(SECS, prof).profile.p.empresa, undefined);
  prof.p.trabaja = '';
  assert.equal(pruneProfile(SECS, prof).profile.p.empresa, undefined);
  assert.match(HV({ infopersonal: { empresaActual: 'EMPRESA-QX9', trabajaActualmente: '' } }), /^((?!EMPRESA-QX9)[\s\S])*$/);
});

test('umbral no numérico en gt/gte/lt/lte: condición mal formada, no oculta nada (ni con controlador vacío)', () => {
  for (const op of ['gt', 'gte', 'lt', 'lte']) {
    for (const bad of ['5', null, NaN, undefined, {}, [3]]) {
      assert.equal(ev({ field: 'a', [op]: bad }, { a: 3 }), true, `${op}=${String(bad)}`);
      assert.equal(ev({ field: 'a', [op]: bad }, {}), true, `${op}=${String(bad)} vacío`);
    }
  }
  assert.equal(ev({ field: 'a', gt: 5 }, { a: 3 }), false);
  const sec = [{ id: 's', fields: [{ id: 'a', type: 'text' }, { id: 'b', type: 'text', showIf: { field: 'a', gt: '5' } }] }];
  assert.ok(checkSchemaConditions(sec).some((m) => /umbral/.test(m)));
  sec[0].fields[1].showIf = { field: 'a', gt: 5 };
  assert.deepEqual(checkSchemaConditions(sec), []);
});

test('pruneProfile quita lo que no aplica sin mutar y reporta lo oculto', () => {
  const prof = { p: { trabaja: 'No', empresa: 'ACME', sexo: 'F' }, f: { conyuge: 'X', graduado: false, fecha: '2020-01-01' }, r: [{ id: '1', actual: true, fin: '2020-01-01' }], extra: { x: 'y' }, documents: { cedula: ['a'] } };
  const copy = structuredClone(prof);
  const { profile, off } = pruneProfile(SECS, prof);
  assert.deepEqual(prof, copy);
  assert.equal(profile.p.empresa, undefined);
  assert.equal(profile.p.trabaja, 'No');
  assert.equal(profile.f.conyuge, undefined);
  assert.equal(profile.f.fecha, undefined);
  assert.equal(profile.r[0].fin, undefined);
  assert.equal(profile.r[0].actual, true);
  assert.deepEqual(profile.extra, {});
  assert.deepEqual(profile.documents, { cedula: ['a'] });
  assert.ok(off.has('p.empresa') && off.has('f.conyuge') && off.has('extra'));
});

test('validateProfile no valida lo oculto', () => {
  const secs = [{ id: 'a', title: 'A', fields: [
    { id: 'tiene', type: 'select' },
    { id: 'cel', type: 'tel', validate: ['celular'], showIf: { field: 'tiene', equals: 'Si' } },
  ] }];
  assert.equal(validateProfile(secs, { a: { tiene: 'Si', cel: '123' } }).length, 1);
  assert.equal(validateProfile(secs, { a: { tiene: 'No', cel: '123' } }).length, 0);
});

// ---------- el modelo Minerva ----------
const sections = minerva.schema.sections;
const secOf = (id) => sections.find((s) => s.id === id);

test('schema Minerva: condiciones bien formadas, referencias válidas, ningún obligatorio condicional', () => {
  assert.deepEqual(checkSchemaConditions(sections), []);
  const n = sections.reduce((a, s) => a + s.fields.filter((f) => f.showIf).length, 0);
  assert.ok(n >= 50, `condiciones: ${n}`);
});

test('schema Minerva: todo campo condicional es alcanzable (existe un estado del controlador que lo muestra)', () => {
  // Para cada campo condicional se busca un valor de su(s) controlador(es) que lo vuelva visible.
  for (const s of sections) for (const f of s.fields) {
    if (!f.showIf) continue;
    const refs = [...refsOf(f.showIf)];
    const candidates = (ref) => {
      const [sid, fid] = ref.includes('.') ? ref.split('.') : [s.id, ref];
      const c = secOf(sid).fields.find((x) => x.id === fid);
      if (c.type === 'checkbox') return [true, false];
      if (c.type === 'select') return c.options.map((o) => o.value);
      if (c.type === 'multiselect') return c.options.map((o) => [o.value]);
      return ['x', 5];
    };
    const combos = refs.reduce((acc, ref) => acc.flatMap((a) => candidates(ref).map((v) => ({ ...a, [ref]: v }))), [{}]);
    const ok = combos.some((combo) => {
      const prof = {}, record = {};
      for (const [ref, v] of Object.entries(combo)) {
        if (ref.includes('.')) { const [sid, fid] = ref.split('.'); (prof[sid] ||= {})[fid] = v; } else record[ref] = v;
      }
      prof[s.id] = s.repeatable ? [record] : { ...(prof[s.id] || {}), ...record };
      const V = createVisibility(sections, prof);
      return V.fieldVisible(s, s.repeatable ? prof[s.id][0] : prof[s.id], f);
    });
    assert.ok(ok, `${s.id}.${f.id} nunca se podría mostrar`);
  }
});

const HV = (profile, template = null, files = {}) => minerva.render(profile, template, files);

test('render: «Trabaja actualmente» No oculta empresa, vinculación y contrato; Sí los muestra', () => {
  const base = { infopersonal: { empresaActual: 'EMPRESA-QX1', tipoContratoActual: 'CONTRATO-QX2', vinculacionActual: 'Empleado' } };
  const si = HV({ infopersonal: { ...base.infopersonal, trabajaActualmente: 'Si' } });
  assert.match(si, /EMPRESA-QX1/);
  assert.match(si, /CONTRATO-QX2/);
  const no = HV({ infopersonal: { ...base.infopersonal, trabajaActualmente: 'No' } });
  assert.doesNotMatch(no, /EMPRESA-QX1|CONTRATO-QX2/);
  assert.ok(no.length < si.length);
  // perfil anterior (marca legacyConditions, sin responder): el dato no desaparece en silencio
  assert.match(HV({ ...base, legacyConditions: true }), /EMPRESA-QX1/);
  assert.doesNotMatch(HV(base), /EMPRESA-QX1/); // perfil nuevo sin responder: oculto
});

test('render: cónyuge solo con estado civil casado o unión libre; libreta no para mujeres', () => {
  const p = (estadoCivil, sexo) => ({ personales: { estadoCivil, sexo, libretaMilitar: 'LIBRETA-12345678' }, familiar: { conyugeNombre: 'CONYUGE-QX3' } });
  assert.match(HV(p('Casado(a)', 'M')), /CONYUGE-QX3/);
  assert.match(HV(p('Unión libre', 'M')), /CONYUGE-QX3/);
  assert.doesNotMatch(HV(p('Soltero(a)', 'M')), /CONYUGE-QX3/);
  assert.doesNotMatch(HV(p('Viudo(a)', 'M')), /CONYUGE-QX3/);
  assert.match(HV(p('Casado(a)', 'M')), /LIBRETA-12345678/);
  assert.doesNotMatch(HV(p('Casado(a)', 'F')), /LIBRETA-12345678/);
});

test('render: experiencia en trabajo actual no imprime fecha ni motivo de retiro y calcula el tiempo hasta hoy', () => {
  const y = new Date().getFullYear();
  const job = (actual) => ({ experiencia: [{ id: 'e1', empresa: 'EMP', cargo: 'CAR', fechaInicio: `${y - 3}-01-01`, fechaFin: `${y - 1}-02-03`, motivoRetiro: 'MOTIVO-QX4', actual }] });
  const done = HV(job(false));
  assert.match(done, /MOTIVO-QX4/);
  assert.match(done, />2 años/);
  const cur = HV(job(true));
  assert.doesNotMatch(cur, /MOTIVO-QX4/);
  assert.match(cur, />3 años/);
});

test('render: estudios, seguridad social y «otro» siguen su pregunta', () => {
  const html = (p) => HV(p);
  assert.doesNotMatch(html({ estudiosActuales: { cursa: 'No', tipoEstudios: 'ESTUDIO-QX5' } }), /ESTUDIO-QX5/);
  assert.match(html({ estudiosActuales: { cursa: 'Si', tipoEstudios: 'ESTUDIO-QX5' } }), /ESTUDIO-QX5/);
  assert.doesNotMatch(html({ seguridadSocial: { eps: 'No', epsNombre: 'EPS-QX6' } }), /EPS-QX6/);
  assert.match(html({ seguridadSocial: { eps: 'Si', epsNombre: 'EPS-QX6' } }), /EPS-QX6/);
  assert.doesNotMatch(html({ infopersonal: { comoSupo: 'Amigo', comoSupoOtro: 'OTRO-QX7' } }), /OTRO-QX7/);
  assert.match(html({ infopersonal: { comoSupo: 'Otro', comoSupoOtro: 'OTRO-QX7' } }), /OTRO-QX7/);
  assert.doesNotMatch(html({ trayectoria: { sectores: ['COMERCIO'], sectorOtros: 'SECT-QX8' } }), /SECT-QX8/);
  assert.match(html({ trayectoria: { sectores: ['OTROS SECTORES'], sectorOtros: 'SECT-QX8' } }), /SECT-QX8/);
  const sup = (graduado) => html({ superior: [{ id: 's1', modalidad: 'Profesional', programa: 'P', graduado, semestres: 9, fechaGrado: '2019-05-05' }] });
  assert.match(sup(false), />4.5</, 'en curso: los semestres cuentan');
  assert.doesNotMatch(sup(false), />2019</, 'en curso: sin fecha de grado');
  assert.doesNotMatch(sup(true), />4.5</, 'graduado: los semestres no aplican');
  assert.match(sup(true), />2019</);
});

test('los datos ocultos se conservan en el perfil (el render no muta lo que recibe)', () => {
  const profile = { infopersonal: { trabajaActualmente: 'No', empresaActual: 'ACME' } };
  const copy = structuredClone(profile);
  HV(profile);
  minerva.missing(profile, null, {});
  assert.deepEqual(profile, copy);
});

test('certificados de campos ocultos no se anexan ni cuentan como faltantes', () => {
  const files = { 'cert:personales:libretaMilitar': { meta: { name: 'l.pdf', type: 'application/pdf' }, dataUrl: 'data:application/pdf;base64,AA==' } };
  const man = { personales: { sexo: 'M', libretaMilitar: '12345678' } }, mujer = { personales: { sexo: 'F', libretaMilitar: '12345678' } };
  assert.equal(minerva.annexList(man, null, files).length, 1);
  assert.equal(minerva.annexList(mujer, null, files).length, 0);
  assert.ok(!minerva.fileIds(mujer, null).includes('cert:personales:libretaMilitar'));
  const t = { id: 't', name: 'T', include: { sections: {}, items: {}, fields: {}, documents: {} }, options: { attachCertificates: true, showPhoto: true } };
  assert.ok(minerva.missing(man, t, {}).some((m) => /libreta/i.test(m)));
  assert.ok(!minerva.missing(mujer, t, {}).some((m) => /libreta/i.test(m)));
});

// ---------- capacidad de las casillas ----------
test('fitCapacity: una línea, filas y bloque; la casilla más pequeña manda', () => {
  assert.equal(fitCapacity(null), null);
  assert.equal(fitCapacity({ mode: 'line', boxes: [[0, 'no-existe']] }), null);
  const a = fitCapacity({ mode: 'line', boxes: [[0, 't5']] });
  assert.ok(a.comfort > 20 && a.max > a.comfort && !a.multi);
  const both = fitCapacity({ mode: 'line', boxes: [[0, 't5'], [0, 't4']] });
  assert.ok(both.max <= a.max);
  const b = fitCapacity({ mode: 'block', boxes: [[0, ['t46', 't47', 't48'], 24.25]] });
  assert.ok(b.multi && b.max > b.comfort);
});

test('Minerva.fitLimit: los campos de texto impresos tienen casilla y los de otra clase, no', () => {
  assert.ok(minerva.fitLimit('personales', 'apellidos').max > 0);
  assert.ok(minerva.fitLimit('experiencia', 'funciones').multi);
  assert.equal(minerva.fitLimit('personales', 'fechaNacimiento'), null);
  const printed = ['personales.nombres', 'personales.correo', 'infopersonal.aficiones', 'familiar.conyugeNombre', 'hermanos.nombre', 'experiencia.empresa', 'experiencia.motivoRetiro', 'seguridadSocial.epsNombre', 'referencias.nombre', 'sistemas.programa', 'idiomas.idioma'];
  for (const k of printed) { const [s, f] = k.split('.'); const l = minerva.fitLimit(s, f); assert.ok(l && l.max >= l.comfort && l.comfort > 5, k); }
});

test('sección repetible oculta: pruneProfile la vacía (base de «tiene datos» en plantillas: sus registros no cuentan)', () => {
  const secs = [
    { id: 'c', fields: [{ id: 'tiene', type: 'select' }] },
    { id: 'hijos', repeatable: true, showIf: { field: 'c.tiene', equals: 'Si' }, fields: [{ id: 'nombre', type: 'text' }] },
  ];
  const prof = { c: { tiene: 'No' }, hijos: [{ id: '1', nombre: 'A' }] };
  assert.deepEqual(pruneProfile(secs, prof).profile.hijos, []);
  assert.equal(prof.hijos.length, 1); // el perfil guardado conserva el dato
  assert.equal(pruneProfile(secs, { c: { tiene: 'Si' }, hijos: prof.hijos }).profile.hijos.length, 1);
});
