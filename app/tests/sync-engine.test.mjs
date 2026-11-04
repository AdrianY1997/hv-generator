// Motor de sincronización (G04) con un proveedor en memoria y dos o tres "equipos": convergencia, borrados, conflictos, presupuesto
// de adjuntos, trozos, contraseña distinta, alteración y modos forzados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncOnce } from '../js/sync/engine.js';
import { createMemoryProvider, SyncError } from '../js/sync/provider.js';
import { MANIFEST_NAME, parseManifest } from '../js/sync/sync-format.js';
import { deriveSyncKeys } from '../js/sync/sync-crypto.js';
import { decryptBackup } from '../js/backup-crypto.js';
import { device, png, pdf, sharedKeys, PASS } from './_sync-fixtures.mjs';

const tpl = (id, name) => ({ id, name, modelId: 'minerva', jobType: '', createdAt: '', updatedAt: '', include: { sections: {}, items: {}, fields: {} }, options: { showPhoto: true, attachCertificates: true, attachDocuments: true, objective: '' } });

/** Conecta un equipo a un espacio: devuelve sync(opts) que conserva el estado entre llamadas, como el controlador. */
function link(dev, space, { maxChunk = 1000, budget, hooks, keys: k } = {}) {
  let state = {};
  const provider = createMemoryProvider(space, { maxChunk, hooks });
  return {
    provider,
    get state() { return state; },
    async sync(opts = {}) {
      const keys = k || await sharedKeys();
      const r = await syncOnce({ provider, local: dev.local, state, getKeys: async () => keys, budget, now: dev.now, ...opts });
      state = r.state;
      return r;
    },
  };
}
const newSpace = () => ({ index: {}, blobs: {}, etag: 0 });

test('crear en A, traer a un B vacío; sin cambios no se vuelve a escribir', async () => {
  const space = newSpace();
  const A = device('A', { profile: { personales: { nombres: 'Ana', apellidos: 'Pérez' }, superior: [{ id: 's1', programa: 'Derecho' }] }, templates: [tpl('t1', 'Admin')], files: { photo: { bytes: png(300, 1) }, 'doc:cedula': { bytes: pdf('cedula'), type: 'application/pdf', name: 'cedula.pdf' } } });
  const B = device('B');
  const a = link(A, space), b = link(B, space);
  assert.equal((await a.sync()).status, 'created');
  // Nada en claro en el remoto.
  const all = JSON.stringify(space);
  for (const secret of ['Ana', 'Pérez', 'Derecho', 'Admin', 'cedula']) assert.ok(!all.includes(secret), 'texto claro en el remoto: ' + secret);
  const rb = await b.sync();
  assert.equal(rb.status, 'merged');
  assert.deepEqual(B.s.profile, A.s.profile);
  assert.deepEqual(B.s.templates, A.s.templates);
  assert.deepEqual([...B.s.files.keys()].sort(), ['doc:cedula', 'photo']);
  assert.deepEqual(B.s.files.get('photo').bytes, A.s.files.get('photo').bytes);
  const writes = space.writes;
  assert.equal((await a.sync()).status, 'up-to-date');
  assert.equal((await b.sync()).status, 'up-to-date');
  assert.equal(space.writes, writes, 'sin cambios no se escribe');
});

test('ediciones en ambos equipos se combinan (por campo gana la más reciente) y convergen', async () => {
  const space = newSpace();
  const A = device('A', { profile: { personales: { nombres: 'Ana', celular: '300' } } });
  const B = device('B', { t0: 1_700_000_000_500 });
  const a = link(A, space), b = link(B, space);
  await a.sync(); await b.sync();
  A.edit((p) => { p.personales.celular = '311'; });
  B.edit((p) => { p.personales.nombres = 'Ana María'; p.idiomas = [{ id: 'i1', idioma: 'Inglés' }]; });
  await a.sync();
  const rb = await b.sync(); // B: remoto cambió -> fusiona, aplica y sube
  assert.equal(rb.status, 'merged');
  await a.sync();
  const want = { personales: { nombres: 'Ana María', celular: '311' }, idiomas: [{ id: 'i1', idioma: 'Inglés' }] };
  assert.deepEqual(A.s.profile, want);
  assert.deepEqual(B.s.profile, want);
  assert.equal(A.s.snapshots.length, 1, 'copia previa antes de aplicar en A');
  // Mismo campo en los dos: gana la edición posterior.
  A.edit((p) => { p.personales.celular = 'A'; });
  B.jump(3_600_000);
  B.edit((p) => { p.personales.celular = 'B'; }); // una hora después (sin haber visto la de A)
  await a.sync(); await b.sync(); await a.sync();
  assert.equal(A.s.profile.personales.celular, 'B');
  assert.equal(B.s.profile.personales.celular, 'B');
  const w = space.writes;
  await a.sync(); await b.sync(); await a.sync();
  assert.equal(space.writes, w, 'convergió: no hay ida y vuelta infinita');
});

test('borrados con lápidas: registro, plantilla y archivo se borran en el otro equipo', async () => {
  const space = newSpace();
  const A = device('A', { profile: { cursos: [{ id: 'c1', nombre: 'Uno' }, { id: 'c2', nombre: 'Dos' }] }, templates: [tpl('t1', 'A'), tpl('t2', 'B')], files: { 'cert:c2': { bytes: png(80, 2) } } });
  const B = device('B');
  const a = link(A, space), b = link(B, space);
  await a.sync(); await b.sync();
  A.edit((p) => { p.cursos = p.cursos.filter((c) => c.id !== 'c2'); });
  A.editTemplates((l) => l.filter((t) => t.id !== 't2'));
  A.delFile('cert:c2');
  await a.sync();
  const r = await b.sync();
  assert.deepEqual(B.s.profile.cursos.map((c) => c.id), ['c1']);
  assert.deepEqual(B.s.templates.map((t) => t.id), ['t1']);
  assert.equal(B.s.files.has('cert:c2'), false);
  assert.equal(r.stats.itemsDeleted + r.stats.templatesDeleted + r.stats.filesDeleted, 3);
  assert.equal(Object.keys(space.blobs).length, 0, 'el adjunto borrado sale también del remoto');
});

test('conflicto: otro equipo escribe entre la lectura y la escritura -> se reintenta fusionando, sin perder nada', async () => {
  const space = newSpace();
  const A = device('A', { profile: { personales: { nombres: 'Ana' } } });
  const B = device('B', { t0: 1_700_000_000_300 });
  const a = link(A, space);
  await a.sync();
  const b0 = link(B, space); await b0.sync();
  let once = true;
  const b = link(B, space, { hooks: { async beforeWrite() { if (once) { once = false; A.edit((p) => { p.personales.ciudad = 'Cali'; }); await a.sync(); } } } });
  Object.defineProperty(b, 'state', { value: b0.state, writable: true });
  B.edit((p) => { p.personales.celular = '300'; });
  const keys = await sharedKeys();
  const r = await syncOnce({ provider: b.provider, local: B.local, state: b0.state, getKeys: async () => keys, now: B.now });
  assert.ok(['merged', 'pushed'].includes(r.status));
  await a.sync({ });
  assert.deepEqual(A.s.profile.personales, { nombres: 'Ana', ciudad: 'Cali', celular: '300' });
  assert.deepEqual(B.s.profile.personales, { nombres: 'Ana', ciudad: 'Cali', celular: '300' });
});

test('si la persona edita durante la sincronización, no se pisa su cambio (local-changed -> reintento)', async () => {
  const space = newSpace();
  const A = device('A', { profile: { personales: { nombres: 'Ana' } } });
  const B = device('B');
  const a = link(A, space), b = link(B, space);
  await a.sync(); await b.sync();
  A.edit((p) => { p.personales.ciudad = 'Cali'; }); await a.sync();
  const orig = B.local.apply;
  let first = true;
  B.local.apply = async (x) => { if (first) { first = false; B.edit((p) => { p.personales.celular = '999'; }); } return orig(x); };
  await b.sync();
  assert.deepEqual(B.s.profile.personales, { nombres: 'Ana', ciudad: 'Cali', celular: '999' });
});

test('presupuesto de adjuntos: lo que no cabe se omite (se informa), el otro equipo lo conserva como fantasma y no hay ida y vuelta', async () => {
  const space = newSpace();
  const A = device('A', { files: { photo: { bytes: png(400, 1) }, 'cert:a': { bytes: png(500, 2) }, 'cert:b': { bytes: png(3000, 3) } } });
  const B = device('B');
  const a = link(A, space, { budget: 1000 }), b = link(B, space, { budget: 1000 });
  const ra = await a.sync();
  assert.deepEqual(ra.skipped.map((s) => s.id), ['cert:b']);
  const rb = await b.sync();
  assert.deepEqual([...B.s.files.keys()].sort(), ['cert:a', 'photo']);
  assert.ok(rb.skipped.some((s) => s.id === 'cert:b' && s.elsewhere));
  const w = space.writes;
  for (let i = 0; i < 2; i++) { await a.sync(); await b.sync(); }
  assert.equal(space.writes, w, 'el fantasma no provoca escrituras');
  // B edita algo: el índice remoto conserva cert:b para A.
  B.edit((p) => { p.x = { y: 1 }; }); await b.sync(); await a.sync();
  assert.equal(A.s.files.has('cert:b'), true);
  const m = parseManifest(space.index[MANIFEST_NAME]).manifest;
  assert.equal(Object.keys(m.blobs).length, 2);
});

test('trozos: núcleo y adjuntos se parten en archivos <= maxChunk y se reensamblan; cada trozo es un sobre de respaldo estándar', async () => {
  const space = newSpace();
  const big = 'x'.repeat(5000);
  const A = device('A', { profile: { perfil: { texto: big } }, files: { photo: { bytes: png(6000, 9) } } });
  const B = device('B');
  await link(A, space, { maxChunk: 1000 }).sync();
  const m = parseManifest(space.index[MANIFEST_NAME]).manifest;
  assert.ok(m.core > 3, 'núcleo partido');
  assert.ok(Object.values(m.blobs)[0] > 3, 'adjunto partido');
  for (const [n, v] of [...Object.entries(space.index), ...Object.entries(space.blobs)]) if (n !== MANIFEST_NAME) assert.ok(v.length <= 1000, n);
  await link(B, space, { maxChunk: 1000 }).sync();
  assert.equal(B.s.profile.perfil.texto, big);
  assert.deepEqual(B.s.files.get('photo').bytes, A.s.files.get('photo').bytes);
  // Compatibilidad: el núcleo unido se abre con decryptBackup y la contraseña (mismo formato de sobre que un respaldo cifrado).
  const env = JSON.parse(Array.from({ length: m.core }, (_, i) => space.index[`hv-core-${String(i).padStart(3, '0')}.txt`]).join(''));
  const core = await decryptBackup(env, PASS);
  assert.equal(core.format, 'hv-minerva-sync-core');
  assert.equal(core.profile.perfil.texto, big);
});

test('contraseña distinta en el segundo equipo: error claro y ningún dato local cambia', async () => {
  const space = newSpace();
  const A = device('A', { profile: { personales: { nombres: 'Ana' } } });
  await link(A, space).sync();
  const m = parseManifest(space.index[MANIFEST_NAME]).manifest;
  const wrong = await deriveSyncKeys('otra contraseña larga', { salt: m.kdf.salt, iterations: m.kdf.iterations });
  const B = device('B', { profile: { personales: { nombres: 'Bea' } } });
  await assert.rejects(link(B, space, { keys: wrong }).sync(), (e) => e instanceof SyncError && e.code === 'auth' && /contraseña/.test(e.userMessage));
  assert.deepEqual(B.s.profile, { personales: { nombres: 'Bea' } });
  assert.equal(B.s.applies, 0);
});

test('adjunto alterado en el remoto: se rechaza (HMAC/GCM) sin aplicarlo; el resto sí llega', async () => {
  const space = newSpace();
  const A = device('A', { profile: { personales: { nombres: 'Ana' } }, files: { photo: { bytes: png(200, 4) } } });
  await link(A, space, { maxChunk: Infinity }).sync();
  const name = Object.keys(space.blobs)[0];
  const env = JSON.parse(space.blobs[name]);
  env.ciphertext = env.ciphertext.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
  space.blobs[name] = JSON.stringify(env);
  const B = device('B');
  const r = await link(B, space, { maxChunk: Infinity }).sync();
  assert.equal(B.s.profile.personales.nombres, 'Ana');
  assert.equal(B.s.files.has('photo'), false);
  assert.equal(r.incoming.length, 1);
});

test('unirse con datos propios: confirmJoin elige; cancelar no toca nada; "local" hace ganar este equipo', async () => {
  const space = newSpace();
  const A = device('A', { profile: { personales: { nombres: 'Ana' } } });
  await link(A, space).sync();
  const B = device('B', { profile: { personales: { nombres: 'Bea', celular: '1' } } });
  const r0 = await link(B, space).sync({ confirmJoin: async () => null });
  assert.equal(r0.status, 'cancelled');
  assert.equal(B.s.applies, 0);
  const b = link(B, space);
  await b.sync({ confirmJoin: async () => 'local' });
  assert.deepEqual(B.s.profile.personales, { nombres: 'Bea', celular: '1' });
  await link(A, space).sync();
  assert.deepEqual(A.s.profile.personales, { nombres: 'Bea', celular: '1' });
  const C = device('C', { profile: { personales: { nombres: 'Cata' } } });
  await link(C, space).sync({ confirmJoin: async () => 'remote' });
  assert.deepEqual(C.s.profile.personales, { nombres: 'Bea', celular: '1' });
});

test('modos forzados: "push" reemplaza el remoto con este equipo; "pull" deja este equipo igual al remoto (borra lo que sobra)', async () => {
  const space = newSpace();
  const A = device('A', { profile: { personales: { nombres: 'Ana' } }, files: { photo: { bytes: png(100, 1) } } });
  const B = device('B');
  const a = link(A, space), b = link(B, space);
  await a.sync(); await b.sync();
  B.edit((p) => { p.extra = { nota: 'solo B' }; });
  B.putFile('cert:solo-b', png(90, 7));
  const rp = await b.sync({ mode: 'pull' });
  assert.equal(rp.status, 'pulled');
  assert.deepEqual(B.s.profile, { personales: { nombres: 'Ana' } });
  assert.equal(B.s.files.has('cert:solo-b'), false);
  A.edit((p) => { p.personales.nombres = 'Ana (A)'; });
  const r = await a.sync({ mode: 'push' });
  assert.equal(r.pushed, true);
  await b.sync();
  assert.equal(B.s.profile.personales.nombres, 'Ana (A)');
});
