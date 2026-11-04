// Utilidades de las pruebas de sincronización: "equipo" en memoria (adaptador local del motor) y bytes de archivos válidos.
import { stampProfile, stampTemplates, stampFiles, canon } from '../js/sync/clock.js';
import { deriveSyncKeys, newSalt } from '../js/sync/sync-crypto.js';
import { maxClock } from '../js/sync/local-store.js';

export const PASS = 'caballo correcto batería grapa';
const clone = (v) => JSON.parse(JSON.stringify(v));

/** PNG mínimo (firma real + relleno) de `n` bytes con un byte distintivo. */
export function png(n = 64, tag = 1) {
  const b = new Uint8Array(n);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < n; i++) b[i] = (i * 31 + tag) & 0xff;
  return b;
}
export const pdf = (text = 'x') => new TextEncoder().encode('%PDF-1.4\n' + text + '\n%%EOF');

let shared = null;
/** Claves derivadas una sola vez para toda la suite (PBKDF2 600 000 cuesta ~0,3 s). */
export async function sharedKeys() {
  if (!shared) shared = await deriveSyncKeys(PASS, { salt: newSalt(), creating: true });
  return shared;
}

/** Un "equipo": datos locales en memoria con el mismo contrato que js/sync/local-store.js; las ediciones fechan el reloj como store.js. */
export function device(name, init = {}) {
  let t = init.t0 ?? 1_700_000_000_000;
  const now = () => (t += 1000);
  const s = { profile: clone(init.profile || {}), templates: clone(init.templates || []), clock: {}, files: new Map(), applies: 0, snapshots: [] };
  for (const [id, f] of Object.entries(init.files || {})) s.files.set(id, { bytes: f.bytes, meta: { name: f.name || id, type: f.type || 'image/png', size: f.bytes.length } });
  const local = {
    async read() { return { profile: clone(s.profile), templates: clone(s.templates), clock: { ...s.clock }, files: [...s.files].map(([id, f]) => ({ id, meta: { ...f.meta } })) }; },
    async readBytes(id) { return s.files.get(id)?.bytes; },
    async hasData() { return Object.keys(s.profile).length > 0 || s.templates.length > 0 || s.files.size > 0; },
    async saveClock(c) { s.clock = maxClock(s.clock, c); }, // igual que local-store.js: nunca pisa un sello más nuevo
    async apply({ base, profile, templates, clock, puts, dels }) {
      if (base && (canon(base.profile) !== canon(s.profile) || canon(base.templates) !== canon(s.templates) || (base.clock && canon(base.clock) !== canon(s.clock)))) throw Object.assign(new Error('local-changed'), { code: 'local-changed', userMessage: 'cambió' });
      s.snapshots.push({ profile: clone(s.profile), templates: clone(s.templates) });
      s.profile = clone(profile); s.templates = clone(templates); s.clock = { ...clock };
      for (const p of puts) s.files.set(p.id, { bytes: p.bytes ?? s.files.get(p.id).bytes, meta: { ...p.meta } });
      for (const id of dels) s.files.delete(id);
      s.applies++;
    },
  };
  return {
    name, s, local, now,
    jump(ms) { t += ms; },
    edit(fn) { const prev = clone(s.profile); fn(s.profile); s.clock = stampProfile(prev, s.profile, s.clock, now()); },
    editTemplates(fn) { const prev = clone(s.templates); s.templates = fn(clone(s.templates)); s.clock = stampTemplates(prev, s.templates, s.clock, now()); },
    putFile(id, bytes, meta = {}) { s.files.set(id, { bytes, meta: { name: id + '.png', type: 'image/png', ...meta, size: bytes.length } }); s.clock = stampFiles(s.clock, { put: [id] }, now()); },
    delFile(id) { s.files.delete(id); s.clock = stampFiles(s.clock, { del: [id] }, now()); },
  };
}
