// Avisos persistentes de la app (#notices): privacidad en el primer uso (G05), recordatorio de respaldo (G05)
// y fallo de almacenamiento (G04). Todo es descartable y nunca bloquea el uso.
import { h, icon, toast } from './ui.js';

const K_ACK = 'hv.privacy.ack';
const NUDGE_DAYS = 30;
const DAY = 86400000;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento: el aviso reaparecerá */ } };
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* nada */ } };

/** Estado del recordatorio: null (no hace falta) o {never:boolean, days:number}. Puro, probado desde Playwright. */
export function backupNudge(lastAt, hasData, now = Date.now()) {
  if (!hasData) return null;
  if (!lastAt) return { never: true, days: null };
  const days = Math.floor((now - lastAt) / DAY);
  return days > NUDGE_DAYS ? { never: false, days } : null;
}

const LABELS = { privacy: 'Aviso de privacidad', nudge: 'Aviso de respaldo' };
function banner(id, kind, ic, children, actions) {
  return h('div', { class: 'notice' + (kind ? ' notice--' + kind : ''), 'data-notice': id, role: kind === 'danger' ? 'alert' : 'region', 'aria-label': kind === 'danger' ? null : (LABELS[id] || 'Aviso') },
    icon(ic), h('div', { class: 'notice__t' }, children, h('div', { class: 'notice__act' }, actions)));
}

export function initNotices({ store }) {
  const host = document.getElementById('notices');
  if (!host) return;
  const slot = {};
  const put = (id, el) => { slot[id]?.remove(); slot[id] = el; if (el) host.append(el); };
  const btn = (text, onclick, cls = '') => h('button', { type: 'button', class: 'mn-btn mn-btn--sm ' + cls, onclick }, text);
  const goAjustes = () => { location.hash = '#/ajustes'; };

  // --- Privacidad: primer uso ---
  let acked = lsGet(K_ACK) === '1' || ssGet(K_ACK) === '1';
  function paintPrivacy() {
    if (acked) return put('privacy', null);
    put('privacy', banner('privacy', '', 'info',
      [h('p', {}, h('strong', {}, 'Tus datos se quedan en este equipo. '), 'Esta app no los envía a ningún servidor: cédula, antecedentes y fotografía viven solo en este navegador, sin cifrar. ',
        'Si borras los datos del sitio, usas modo privado o cambias de equipo, se pierden: descarga respaldos con frecuencia. En un equipo compartido, borra tus datos al terminar.')],
      [btn('Entendido', () => { acked = true; lsSet(K_ACK, '1'); ssSet(K_ACK, '1'); paintPrivacy(); refreshNudge(); }, 'mn-btn--primary'),
        btn('Más información', goAjustes, 'mn-btn--quiet')]));
  }

  // --- Recordatorio de respaldo ---
  async function refreshNudge() {
    if (!acked || ssGet('hv.nudge.off') === '1') return put('nudge', null);
    let n = null;
    try { n = backupNudge(store.lastBackupAt(), await store.hasData()); } catch { /* sin aviso */ }
    if (!n) return put('nudge', null);
    const text = n.never ? 'Aún no has descargado ningún respaldo de tus datos.' : `Tu último respaldo fue hace ${n.days} días.`;
    put('nudge', banner('nudge', 'warn', 'clock',
      [h('p', {}, h('strong', {}, 'Haz un respaldo. '), text, ' Si el navegador borra los datos, no se pueden recuperar.')],
      [btn('Descargar respaldo', async (e) => {
        const b = e.currentTarget; // currentTarget se anula tras el primer await: se captura antes
        b.disabled = true;
        try {
          const { downloadBackupFlow } = await import('./import-dialog.js'); // diálogo: con o sin contraseña (G05)
          const r = await downloadBackupFlow(store);
          if (r) { toast(r === 'encrypted' ? 'Respaldo cifrado descargado.' : 'Respaldo descargado.'); refreshNudge(); }
          else b.disabled = false;
        } catch (err) { console.error(err); toast(err?.userMessage || 'No se pudo generar el respaldo.', 4000, 'error'); b.disabled = false; }
      }, 'mn-btn--primary'),
      btn('Más tarde', () => { ssSet('hv.nudge.off', '1'); put('nudge', null); }, 'mn-btn--quiet')]));
  }

  // --- Fallo de almacenamiento (cuota, bloqueado) ---
  let lastToast = 0;
  store.onStorageError((err) => {
    if (Date.now() - lastToast > 6000) { lastToast = Date.now(); toast(err.userMessage, 4000, 'error'); }
    put('storage', banner('storage', 'danger', 'alert', [h('p', {}, h('strong', {}, err.quota ? 'Almacenamiento lleno. ' : 'No se pudo guardar. '), err.userMessage)],
      [btn('Abrir Ajustes', goAjustes, 'mn-btn--primary'), btn('Cerrar', () => put('storage', null), 'mn-btn--quiet')]));
  });

  paintPrivacy();
  refreshNudge();
  store.subscribe((e) => { if (e.type === 'all') refreshNudge(); });
  return { refreshNudge };
}
