// Formato Único: casillas Sí/No de «graduado» (lo no definido no imprime NO) y campos de plantilla honrados en el respaldo de la ciudad y en
// el tiempo manual de experiencia.
import test from 'node:test';
import assert from 'node:assert/strict';
import fu from '../js/models/formato-unico.js';

/** Rutas de las X dibujadas en la hoja 1 (cada casilla marcada añade una). */
const marks = (html) => {
  const svg = html.match(/<svg class="mv-ov"[\s\S]*?<\/svg>/)?.[0] || '';
  return [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
};
const withGrad = (graduado) => fu.render({ superior: [{ id: 's1', programa: 'Derecho', ...(graduado === undefined ? {} : { graduado }) }] }, null, {});

test('graduado sin definir NO marca NO; true marca SÍ; solo un false (o «no») explícito marca NO; SÍ y NO son casillas distintas', () => {
  const base = marks(withGrad(undefined));
  const yes = marks(withGrad(true)), no = marks(withGrad(false)), noText = marks(withGrad('no'));
  assert.equal(yes.length, base.length + 1, 'true marca una casilla');
  assert.equal(no.length, base.length + 1, 'false marca una casilla');
  assert.deepEqual(noText, no, '«no» equivale a false');
  const extra = (list) => list.filter((d) => !base.includes(d));
  assert.equal(extra(yes).length, 1); assert.equal(extra(no).length, 1);
  assert.notDeepEqual(extra(yes), extra(no), 'SÍ y NO caen en casillas distintas');
  assert.deepEqual(marks(withGrad('')), base, 'vacío = sin definir');
  assert.deepEqual(marks(withGrad(null)), base, 'null = sin definir');
});

test('con la plantilla sin «graduado» no se marca ninguna de las dos casillas', () => {
  const t = { id: 't', include: { sections: {}, items: {}, fields: { 'superior.graduado': false } }, options: {} };
  const p = { superior: [{ id: 's1', programa: 'Derecho', graduado: true }] };
  assert.deepEqual(marks(fu.render(p, t, {})), marks(fu.render({ superior: [{ id: 's1', programa: 'Derecho' }] }, null, {})));
});

test('la ciudad de la hoja 3 usa el municipio de correspondencia solo si la plantilla incluye ese campo', () => {
  const p = { personales: { residenciaMunicipio: 'Ipiales' }, solicitud: { fecha: '2026-01-02' } };
  const tpl = (fields) => ({ id: 't', include: { sections: {}, items: {}, fields }, options: {} });
  assert.ok(fu.render(p, null, {}).includes('Ipiales'));
  assert.ok(fu.render(p, tpl({}), {}).includes('Ipiales'));
  const h = fu.render(p, tpl({ 'personales.residenciaMunicipio': false }), {});
  assert.ok(!h.includes('Ipiales'), 'campo desmarcado: ni en la hoja ni en la ciudad de respaldo');
  assert.ok(h.includes('2026') || h.includes('02'), 'la fecha sigue');
});

test('el tiempo manual solo imprime los campos que la plantilla incluye', () => {
  const p = { tiempoExperiencia: { calculo: 'manual', servidorAnios: 37, privadoMeses: 3 } };
  const tpl = (fields) => ({ id: 't', include: { sections: {}, items: {}, fields }, options: {} });
  const all = fu.render(p, tpl({}), {});
  assert.match(all, /37 años/);
  const cut = fu.render(p, tpl({ 'tiempoExperiencia.servidorAnios': false }), {});
  assert.doesNotMatch(cut, /37 años/);
  assert.match(cut, /3 meses/, 'lo demás sigue');
});
