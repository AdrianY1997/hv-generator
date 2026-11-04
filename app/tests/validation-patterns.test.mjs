// Los patrones de validación de los schemas son TEXTO en literales de JS: '\d' o '\b' sin doble barra pierden la barra (o se vuelven un carácter
// de control) y el patrón deja de significar lo que dice. Esta prueba compila y ejercita cada `re` de ambos modelos.
import test from 'node:test';
import assert from 'node:assert/strict';
import minerva from '../js/models/minerva.js';
import fu from '../js/models/formato-unico.js';
import { RULES } from '../js/validators.js';

function patterns(model) {
  const out = [];
  for (const s of model.schema.sections) for (const f of s.fields) for (const v of f.validate || []) if (v && typeof v === 'object' && v.rule === 'pattern') out.push({ model: model.id, section: s.id, field: f.id, v });
  return out;
}
const all = [...patterns(minerva), ...patterns(fu)];

test('todos los patrones compilan, no contienen caracteres de control y llevan mensaje', () => {
  assert.ok(all.length >= 3);
  for (const { model, section, field, v } of all) {
    const where = `${model}:${section}.${field}`;
    assert.equal(typeof v.re, 'string', where);
    assert.ok(!/[\u0000-\u001f\u007f]/.test(v.re), `${where}: carácter de control en el patrón (¿'\\b' o '\\d' sin doble barra?)`);
    assert.doesNotThrow(() => new RegExp(v.re, v.flags || ''), where);
    assert.ok(v.message, where);
  }
});

test('libreta militar y licencia de conducción: aceptan los valores previstos y rechazan los demás', () => {
  const find = (m, id) => { for (const s of m.schema.sections) { const f = s.fields.find((x) => x.id === id); if (f) return f.validate.find((v) => v.rule === 'pattern'); } return null; };
  const ok = (p, s) => !RULES.pattern(s, p);
  let checked = 0;
  for (const m of [minerva, fu]) {
    const lib = find(m, 'libretaMilitar');
    if (lib) {
      checked++;
      for (const s of ['12345', '1234567890', 'No. 123456 / Primera / D.M. 12', '0001234 segunda']) assert.ok(ok(lib, s), `libreta ${s} (${m.id})`);
      for (const s of ['1234', 'abc', 'dddddd', '12 34', 'd{5,}']) assert.ok(!ok(lib, s), `libreta ${s} no (${m.id})`);
    }
    const lic = find(m, 'licenciaConduccion');
    if (lic) {
      checked++;
      for (const s of ['A1', 'a2', 'B1', 'b3', 'C1', 'C3', 'Categoría C2', 'B1 y C1']) assert.ok(ok(lic, s), `licencia ${s} (${m.id})`);
      for (const s of ['D1', 'A3', 'AB1', 'B', 'B11', 'XB1X']) assert.ok(!ok(lic, s), `licencia ${s} no (${m.id})`);
    }
    const num = find(m, 'licenciaNumero');
    if (num) assert.ok(ok(num, 'AB-12345') && !ok(num, '12'));
  }
  assert.ok(checked >= 2, 'Minerva trae libretaMilitar y licenciaConduccion');
});
