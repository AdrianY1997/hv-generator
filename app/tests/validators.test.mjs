import test from 'node:test';
import assert from 'node:assert/strict';
import { check, normalize, worst, validateRecord, validateProfile, ageOn, issueText, nitCheckDigit } from '../js/validators.js';

const TODAY = '2026-10-29';
const ctxOf = (rec, profile = {}) => ({ today: TODAY, get: (id) => rec[id], root: (s, f) => profile?.[s]?.[f] });
const lvl = (rules, v, rec = {}, profile) => worst(check(rules, v, ctxOf(rec, profile)))?.level ?? null;

test('vacío nunca incumple', () => {
  assert.deepEqual(check(['celular', 'email', 'cedula'], '', ctxOf({})), []);
  assert.deepEqual(check(['email'], null, ctxOf({})), []);
});

test('cédula: dígitos y 6 a 10', () => {
  assert.equal(lvl(['cedula'], '1.234.567.890'), null);
  assert.equal(lvl(['cedula'], '12345'), 'error');
  assert.equal(lvl(['cedula'], '12345678901'), 'error');
  assert.equal(lvl(['cedula'], '12a456'), 'error');
  assert.equal(normalize(['cedula'], '1.234.567', ctxOf({})), '1234567');
  assert.equal(normalize(['cedula'], 'AB-123', ctxOf({})), 'AB-123');
});

test('documento depende del tipo', () => {
  const r = [{ rule: 'documento' }];
  assert.equal(lvl(r, '1098765432', { tipoDocumento: 'CC' }), null);
  assert.equal(lvl(r, '123', { tipoDocumento: 'CC' }), 'error');
  assert.equal(lvl(r, '1098765432', { tipoDocumento: 'TI' }), null);
  assert.equal(lvl(r, '123456', { tipoDocumento: 'TI' }), 'warn');
  assert.equal(lvl(r, 'AB123456', { tipoDocumento: 'Pasaporte' }), null);
  assert.equal(lvl(r, 'A', { tipoDocumento: 'Pasaporte' }), 'warn');
  assert.equal(lvl(r, '1098765432'), null, 'sin tipo se trata como CC');
  assert.equal(normalize(r, '10.987.654', ctxOf({ tipoDocumento: 'CC' })), '10987654');
  assert.equal(normalize(r, 'ab 123 45', ctxOf({ tipoDocumento: 'Pasaporte' })), 'AB12345');
});

test('celular colombiano', () => {
  assert.equal(lvl(['celular'], '300 123 4567'), null);
  assert.equal(lvl(['celular'], '+57 300-123-4567'), null);
  assert.equal(lvl(['celular'], '2001234567'), 'error');
  assert.equal(lvl(['celular'], '30012345'), 'error');
  assert.equal(normalize(['celular'], '+57 3001234567', ctxOf({})), '300 123 4567');
  assert.equal(normalize(['celular'], '12', ctxOf({})), '12');
});

test('teléfono: fijo, indicativo, celular y varios', () => {
  assert.equal(lvl(['telefono'], '234 5678'), null);
  assert.equal(lvl(['telefono'], '1 234 5678'), null);
  assert.equal(lvl(['telefono'], '601 234 5678'), null);
  assert.equal(lvl(['telefono'], '3001234567'), null);
  assert.equal(lvl(['telefono'], '2345678 / 3001234567'), null);
  assert.equal(lvl(['telefono'], '2345678 ext 12'), null);
  assert.equal(lvl(['telefono'], '12345'), 'warn');
  assert.equal(normalize(['telefono'], '2345678', ctxOf({})), '234 5678');
  assert.equal(normalize(['telefono'], '6012345678', ctxOf({})), '601 234 5678');
  assert.equal(normalize(['telefono'], '2345678 ext 12', ctxOf({})), '2345678 ext 12', 'con extensión no se reescribe');
  assert.equal(normalize(['telefono'], '2345678 / 3001234567', ctxOf({})), '2345678 / 3001234567');
});

test('correo', () => {
  assert.equal(lvl(['email'], 'a@b.co'), null);
  assert.equal(lvl(['email'], 'a@b'), 'error');
  assert.equal(lvl(['email'], 'a b@c.com'), 'error');
  assert.equal(normalize(['email'], '  Ana@Mail.COM ', ctxOf({})), 'ana@mail.com');
});

test('fechas: futura, edad mínima y máxima', () => {
  assert.equal(lvl(['notFuture'], '2026-10-30'), 'error');
  assert.equal(lvl(['notFuture'], '2026-10-29'), null);
  assert.equal(lvl(['notFuture'], '2027'), 'error');
  assert.equal(lvl([{ rule: 'notFuture', level: 'warn' }], '2027-01-01'), 'warn');
  assert.equal(lvl(['edad'], '1990-01-01'), null);
  assert.equal(lvl(['edad'], '2010-01-01'), 'warn', '16 años: menor de 18');
  assert.equal(lvl(['edad'], '2020-01-01'), 'warn', '6 años');
  assert.equal(lvl(['edad'], '1900-01-01'), 'warn');
  assert.equal(lvl(['edad'], '2008-10-29'), null, 'cumple 18 hoy');
  assert.equal(lvl(['edad'], '2008-10-30'), 'warn', 'cumple 18 mañana');
  assert.equal(ageOn('2000-02-29', '2026-02-28'), 25);
  assert.equal(check(['edad'], '2030-01-01', ctxOf({})).length, 0, 'la futura la avisa notFuture');
});

test('fin >= inicio y años', () => {
  const r = [{ rule: 'notBefore', other: 'fechaInicio', otherLabel: 'la fecha de ingreso' }];
  assert.equal(lvl(r, '2020-01-01', { fechaInicio: '2020-01-02' }), 'error');
  assert.equal(lvl(r, '2020-01-02', { fechaInicio: '2020-01-02' }), null);
  assert.equal(lvl(r, '2020-01-02', { fechaInicio: '' }), null);
  assert.match(worst(check(r, '2020-01-01', ctxOf({ fechaInicio: '2020-01-02' }))).message, /ingreso/);
  const y = [{ rule: 'notBefore', other: 'primariaAnio', level: 'warn' }];
  assert.equal(lvl(y, 2005, { primariaAnio: 2010 }), 'warn');
  assert.equal(lvl(['year'], 1800), 'warn');
  assert.equal(lvl(['year'], 2026), null);
  assert.equal(lvl(['year'], 2028), 'warn');
});

test('después del nacimiento (advertencia)', () => {
  const P = { personales: { fechaNacimiento: '2000-05-10' } };
  const r = [{ rule: 'afterBirth', years: 14 }];
  assert.equal(lvl(r, '2012-01-01', {}, P), 'warn');
  assert.equal(lvl(r, '2016-01-01', {}, P), null);
  assert.equal(lvl(r, '1999-01-01', {}, P), 'warn');
  assert.equal(lvl(r, '2013', {}, P), 'warn');
  assert.equal(lvl(r, '2016-01-01', {}, {}), null, 'sin nacimiento no hay regla');
});

test('rango, patrón y reglas desconocidas', () => {
  assert.equal(lvl([{ rule: 'range', min: 0, max: 20 }], 25), 'warn');
  assert.equal(lvl([{ rule: 'range', min: 0, max: 20 }], 5), null);
  assert.equal(lvl([{ rule: 'pattern', re: '\\d{5,}' }], 'Primera clase'), 'warn');
  assert.equal(lvl([{ rule: 'pattern', re: '\\d{5,}' }], '12345678 / Primera'), null);
  assert.equal(lvl([{ rule: 'pattern', re: '(' }], 'x'), null, 'regex inválida no rompe');
  assert.equal(lvl(['inventada'], 'x'), null);
});

test('errores antes que advertencias', () => {
  const r = [{ rule: 'edad' }, 'notFuture'];
  const out = check(r, '2026-10-30', ctxOf({}));
  assert.equal(out[0].level, 'error');
});

test('validateRecord y validateProfile según el schema', () => {
  const fields = [
    { id: 'fechaInicio', label: 'Ingreso', type: 'date' },
    { id: 'fechaFin', label: 'Retiro', type: 'date', validate: [{ rule: 'notBefore', other: 'fechaInicio', otherLabel: 'la fecha de ingreso' }] },
  ];
  const rec = { fechaInicio: '2021-01-01', fechaFin: '2020-01-01' };
  const r = validateRecord(fields, rec, { today: TODAY });
  assert.equal(r.length, 1);
  assert.equal(r[0].fieldId, 'fechaFin');
  const sections = [
    { id: 'personales', title: 'I. Información general', fields: [{ id: 'celular', label: 'Celular', type: 'tel', validate: ['celular'] }] },
    { id: 'experiencia', title: 'VI. Experiencia', repeatable: true, fields },
  ];
  const profile = { personales: { celular: '12' }, experiencia: [{ id: 'a', ...rec }, { id: 'b', fechaInicio: '2020-01-01', fechaFin: '2021-01-01' }] };
  const all = validateProfile(sections, profile, { today: TODAY });
  assert.deepEqual(all.map((x) => [x.secId, x.index ?? null, x.fieldId, x.level]), [['personales', null, 'celular', 'error'], ['experiencia', 0, 'fechaFin', 'error']]);
  assert.match(issueText(all[1]), /#1/);
  const only = validateProfile(sections, profile, { today: TODAY, include: (s) => s !== 'personales' });
  assert.equal(only.length, 1);
});

test('dirección: aviso si es vaga; normaliza espacios y "#"', () => {
  assert.equal(lvl(['direccion'], 'Calle 10 # 5-20'), null);
  assert.equal(lvl(['direccion'], 'Vereda El Roble'), null);
  assert.equal(lvl(['direccion'], 'Cra 7'), 'warn');
  assert.equal(lvl(['direccion'], '12345'), 'warn');
  assert.equal(lvl(['direccion'], 'x'), 'warn');
  assert.equal(normalize(['direccion'], '  Calle   10#5 - 20  ', ctxOf({})), 'Calle 10 # 5-20');
  assert.equal(normalize(['direccion'], 'Carrera 7 No. 12-30, ', ctxOf({})), 'Carrera 7 No. 12-30');
});

test('NIT: dígito de verificación y formato', () => {
  assert.equal(nitCheckDigit('899999068'), 1); // Universidad Nacional: 899.999.068-1
  assert.equal(nitCheckDigit('860002964'), 4); // Banco de Bogotá: 860.002.964-4
  assert.equal(lvl(['nit'], '899.999.068-1'), null);
  assert.equal(lvl(['nit'], '899999068-1'), null);
  assert.equal(lvl(['nit'], '899999068'), null); // sin DV: solo se revisa la longitud
  assert.equal(lvl(['nit'], '899999068-5'), 'warn');
  assert.match(worst(check(['nit'], '899999068-5', ctxOf({}))).message, /debería ser 1/);
  assert.equal(lvl(['nit'], '12345'), 'warn');
  assert.equal(lvl(['nit'], 'abc'), 'warn');
  assert.equal(normalize(['nit'], '899.999.068 - 1', ctxOf({})), '899999068-1');
  assert.equal(normalize(['nit'], 'sin nit', ctxOf({})), 'sin nit');
});

test('cruce de experiencia: avisa en el registro que empieza después; tolera empalmes cortos; trabajo actual cuenta hasta hoy', () => {
  const A = { empresa: 'Acme', fechaInicio: '2018-01-01', fechaFin: '2020-06-30' };
  const run = (rec, others) => check([{ rule: 'noOverlap' }], rec.fechaInicio, { today: TODAY, get: (id) => rec[id], others: () => others });
  // empieza antes de que termine el anterior (6 meses)
  const B = { empresa: 'Beta', fechaInicio: '2020-01-01', fechaFin: '2022-01-01' };
  const r = run(B, [A]);
  assert.equal(r.length, 1);
  assert.equal(r[0].level, 'warn');
  assert.match(r[0].message, /Se cruza 182 días con tu trabajo en Acme \(01\/01\/2018 a 30\/06\/2020\)/);
  // el registro que empieza primero no se avisa (lo avisa el siguiente)
  assert.deepEqual(run(A, [B]), []);
  // empalme corto (<= 31 días): normal
  assert.deepEqual(run({ fechaInicio: '2020-06-10', fechaFin: '2021-01-01' }, [A]), []);
  // consecutivos sin cruce
  assert.deepEqual(run({ fechaInicio: '2020-07-01', fechaFin: '2021-01-01' }, [A]), []);
  // trabajo actual: termina hoy
  const cur = { empresa: 'Gamma', fechaInicio: '2025-01-01', actual: true };
  assert.equal(run({ fechaInicio: '2026-01-01', actual: true }, [cur]).length, 1);
  assert.match(run({ fechaInicio: '2026-01-01', actual: true }, [cur])[0].message, /a hoy\)/);
  // sin fechas / sin otros / otro sin fin ni "actual": no avisa
  assert.deepEqual(run({ fechaInicio: '' }, [A]), []);
  assert.deepEqual(run(B, []), []);
  assert.deepEqual(run(B, [{ empresa: 'X', fechaInicio: '2019-01-01' }]), []);
  assert.deepEqual(run({ fechaInicio: '2020-01-01' }, [A]), []); // este sin fin ni actual: no se sabe
  // nunca es error
  assert.equal(run(B, [A])[0].level, 'warn');
});

test('cruce de experiencia en validateProfile (sin duplicar el aviso)', () => {
  const sections = [{ id: 'experiencia', title: 'VI. Experiencia', repeatable: true, fields: [
    { id: 'empresa', label: 'Empresa', type: 'text' },
    { id: 'fechaInicio', label: 'Ingreso', type: 'date', validate: ['noOverlap'] },
    { id: 'fechaFin', label: 'Retiro', type: 'date' },
  ] }];
  const profile = { experiencia: [
    { id: 'a', empresa: 'Acme', fechaInicio: '2018-01-01', fechaFin: '2020-12-31' },
    { id: 'b', empresa: 'Beta', fechaInicio: '2020-01-01', fechaFin: '2022-01-01' },
  ] };
  const all = validateProfile(sections, profile, { today: TODAY });
  assert.deepEqual(all.map((x) => [x.index, x.fieldId, x.level]), [[1, 'fechaInicio', 'warn']]);
  assert.match(issueText(all[0]), /#2 · Ingreso: Se cruza 366 días con tu trabajo en Acme/);
});

test('grado superior anterior al bachillerato: aviso (notBeforeRoot)', () => {
  const r = [{ rule: 'notBeforeRoot', section: 'basica', field: 'anio', otherLabel: 'tu año de grado de bachillerato' }];
  const prof = { basica: { anio: '2010' } };
  assert.equal(lvl(r, '2009-12-01', {}, prof), 'warn');
  assert.match(worst(check(r, '2009-12-01', ctxOf({}, prof))).message, /2009.*2010/);
  assert.equal(lvl(r, '2010-12-01', {}, prof), null);
  assert.equal(lvl(r, '2015-12-01', {}, prof), null);
  assert.equal(lvl(r, '2009-12-01', {}, {}), null); // sin dato de bachillerato
  assert.equal(lvl(r, '2009-12-01', {}, { basica: { anio: 'x' } }), null);
});
