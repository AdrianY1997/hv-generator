import { h, icon, pageHead, toast } from '../ui.js';
import { certFileId, fmtSize } from '../forms.js';
import { referencedFileIds, findOrphans } from '../orphans.js';

const DAY = 86400000;
let dlgId = 0;

/** Vista "Ajustes": privacidad, almacenamiento, respaldo, archivos huérfanos y borrado de datos (G04, G05, G11). */
export function mount(el, ctx) {
  const { model, store } = ctx;
  let alive = true;

  // ---------- Privacidad (sección permanente) ----------
  const privacy = h('section', { class: 'mn-card aj-card', 'aria-labelledby': 'aj-priv' },
    h('h2', { id: 'aj-priv' }, 'Privacidad y tus datos'),
    h('ul', { class: 'aj-list' },
      h('li', {}, 'Todo lo que escribes y subes (cédula, antecedentes, fotografía, certificados) se guarda solo en este navegador. La app no envía nada a ningún servidor.'),
      h('li', {}, 'No está cifrado: en un equipo compartido, otra persona con acceso a este navegador podría verlo. Borra tus datos al terminar.'),
      h('li', {}, 'Si borras los datos del sitio, usas una ventana privada o cambias de equipo, se pierde todo. Descarga un respaldo con frecuencia y guárdalo en un lugar seguro (el respaldo va sin cifrar salvo que le pongas contraseña al descargarlo).')));

  // ---------- Almacenamiento (G04) ----------
  const meterText = h('p', { role: 'status', 'aria-live': 'polite' }, 'Calculando…');
  const fill = h('i');
  const bar = h('div', { class: 'mn-progress', role: 'progressbar', 'aria-label': 'Uso del almacenamiento', 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill);
  const lsText = h('p', { class: 'muted' });
  const persistText = h('p', {});
  const persistMsg = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const persistBtn = h('button', { type: 'button', class: 'mn-btn', onclick: async () => {
    persistBtn.disabled = true;
    const r = await store.requestPersist();
    persistMsg.textContent = r === null ? 'Este navegador no ofrece almacenamiento persistente.'
      : r ? 'Listo: el navegador no borrará estos datos automáticamente.'
        : 'El navegador no lo concedió (suele depender de que uses el sitio con frecuencia o lo instales). Sigue descargando respaldos.';
    persistBtn.disabled = false;
    await paintStorage();
  } }, icon('check'), 'Proteger mis datos');
  const storage = h('section', { class: 'mn-card aj-card', 'aria-labelledby': 'aj-sto' },
    h('h2', { id: 'aj-sto' }, 'Almacenamiento'),
    h('div', { class: 'aj-meter' }, bar, meterText),
    lsText,
    persistText,
    h('p', { class: 'muted' }, 'Pedir almacenamiento persistente le indica al navegador que estos datos son importantes y no debe borrarlos solo cuando falte espacio. Según el navegador, puede mostrar un permiso o decidirlo automáticamente.'),
    h('div', { class: 'aj-actions' }, persistBtn), persistMsg);

  function lsBytes() {
    let n = 0;
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('hv.')) n += (k.length + (localStorage.getItem(k) || '').length) * 2; } catch { /* sin datos */ }
    return n;
  }
  async function paintStorage() {
    const e = await store.storageEstimate();
    if (!alive) return;
    if (e.usage != null && e.quota) {
      const pct = Math.min(100, (e.usage / e.quota) * 100);
      fill.style.setProperty('--value', pct.toFixed(1) + '%');
      bar.setAttribute('aria-valuenow', pct.toFixed(1));
      meterText.textContent = `Usado ${fmtSize(e.usage)} de ${fmtSize(e.quota)} disponibles (${pct < 0.1 ? '<0,1' : pct.toFixed(1).replace('.', ',')} %). Incluye archivos adjuntos y los archivos de la app para uso sin conexión; es una estimación del navegador.`;
    } else {
      fill.style.setProperty('--value', '0%');
      meterText.textContent = 'Este navegador no informa el uso de almacenamiento.';
    }
    lsText.textContent = `Perfil y plantillas: ${fmtSize(lsBytes())} (el navegador suele limitar este espacio a unos 5 MB; los adjuntos van aparte).`;
    persistText.textContent = e.persisted === null ? 'Almacenamiento persistente: no disponible en este navegador.'
      : e.persisted ? 'Almacenamiento persistente: activado.' : 'Almacenamiento persistente: no activado.';
    persistBtn.hidden = e.persisted === true;
  }

  // ---------- Respaldo ----------
  const backupText = h('p', { role: 'status', 'aria-live': 'polite' });
  const paintBackup = () => {
    const at = store.lastBackupAt();
    if (!at) { backupText.textContent = 'Aún no has descargado ningún respaldo.'; return; }
    const d = Math.floor((Date.now() - at) / DAY);
    backupText.textContent = `Último respaldo: ${d <= 0 ? 'hoy' : d === 1 ? 'hace 1 día' : `hace ${d} días`} (${new Date(at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}).${d > 30 ? ' Hace más de 30 días: conviene hacer uno nuevo.' : ''}`;
  };
  const backupBtn = h('button', { type: 'button', class: 'mn-btn mn-btn--primary', onclick: async () => {
    backupBtn.disabled = true;
    try {
      const { downloadBackupFlow } = await import('../import-dialog.js'); // diálogo: con o sin contraseña (G05)
      const r = await downloadBackupFlow(store);
      if (r) { toast(r === 'encrypted' ? 'Respaldo cifrado descargado. Guarda la contraseña: sin ella no se puede abrir.' : 'Respaldo descargado.'); paintBackup(); }
    } catch (e) { console.error(e); toast(e?.userMessage || 'No se pudo generar el respaldo.', 4000, 'error'); }
    backupBtn.disabled = false;
  } }, icon('download'), 'Descargar respaldo');
  const backup = h('section', { class: 'mn-card aj-card', 'aria-labelledby': 'aj-bak' },
    h('h2', { id: 'aj-bak' }, 'Respaldo'),
    backupText,
    h('p', { class: 'muted' }, 'El respaldo es un archivo JSON con tu perfil, plantillas y archivos. Para restaurarlo usa Vista previa > Importar JSON.'),
    h('p', { class: 'muted' }, 'Al descargarlo puedes protegerlo con una contraseña (cifrado AES-256 en este equipo). Sin contraseña el archivo queda en claro. Si olvidas la contraseña, el respaldo no se puede recuperar.'),
    h('div', { class: 'aj-actions' }, backupBtn));

  // ---------- Archivos huérfanos (G11) ----------
  const orphHost = h('div', { 'aria-live': 'polite' });
  const scanBtn = h('button', { type: 'button', class: 'mn-btn', onclick: () => scan() }, icon('folder'), 'Revisar archivos huérfanos');
  const orphans = h('section', { class: 'mn-card aj-card', 'aria-labelledby': 'aj-orph' },
    h('h2', { id: 'aj-orph' }, 'Archivos huérfanos'),
    h('p', { class: 'muted' }, 'Son archivos guardados en este equipo que ya no pertenecen a ningún registro del perfil, documento ni plantilla (por ejemplo, de un registro eliminado). Ocupan espacio y viajan en tus respaldos. Nada se borra solo: tú eliges qué eliminar.'),
    h('div', { class: 'aj-actions' }, scanBtn), orphHost);

  async function scan() {
    scanBtn.disabled = true;
    orphHost.replaceChildren(h('p', { class: 'muted' }, 'Revisando…'));
    try {
      const files = await store.listFiles();
      const refs = referencedFileIds(store.getProfile(), store.getTemplates(), model.schema, certFileId);
      const list = findOrphans(files, refs);
      if (alive) renderOrphans(list, files.length);
    } catch (e) {
      console.error(e);
      orphHost.replaceChildren(h('p', { class: 'mn-error', role: 'alert' }, icon('alert'), 'No se pudieron revisar los archivos.'));
    }
    scanBtn.disabled = false;
  }
  function renderOrphans(list, total) {
    if (!list.length) { orphHost.replaceChildren(h('p', {}, h('strong', {}, 'Sin archivos huérfanos. '), `Se revisaron ${total} archivo(s) y todos están en uso.`)); return; }
    const boxes = new Map();
    const sum = h('p', { role: 'status', 'aria-live': 'polite' });
    const delBtn = h('button', { type: 'button', class: 'mn-btn mn-btn--danger', onclick: async () => {
      const sel = list.filter((o) => boxes.get(o.id).checked);
      if (!sel.length) return;
      const size = sel.reduce((n, o) => n + o.size, 0);
      if (!confirm(`¿Eliminar ${sel.length} archivo(s) huérfano(s) (${fmtSize(size)})? Esta acción no se puede deshacer. Si los necesitas, descarga un respaldo antes.`)) return;
      delBtn.disabled = true;
      try { await store.deleteFiles(sel.map((o) => o.id)); toast(`${sel.length} archivo(s) eliminado(s).`); await paintStorage(); }
      catch (e) { console.error(e); toast(e?.userMessage || 'No se pudieron eliminar los archivos.', 4000, 'error'); }
      await scan();
    } }, icon('trash'), 'Eliminar seleccionados');
    const upd = () => {
      const sel = list.filter((o) => boxes.get(o.id).checked);
      sum.textContent = sel.length ? `${sel.length} seleccionado(s) · ${fmtSize(sel.reduce((n, o) => n + o.size, 0))}` : 'Ninguno seleccionado.';
      delBtn.disabled = !sel.length;
    };
    const ul = h('ul', { class: 'aj-orph' }, list.map((o, i) => {
      const cb = h('input', { type: 'checkbox', id: 'orph-' + i, onchange: upd });
      boxes.set(o.id, cb);
      return h('li', {}, h('label', { class: 'mn-check', for: 'orph-' + i }, cb, h('span', {}, `${o.name} · ${fmtSize(o.size)}`)), h('span', { class: 'aj-orph__id' }, o.id));
    }));
    const all = h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm', onclick: () => { const every = list.every((o) => boxes.get(o.id).checked); for (const c of boxes.values()) c.checked = !every; upd(); } }, 'Seleccionar / quitar todos');
    orphHost.replaceChildren(h('p', {}, h('strong', {}, `${list.length} archivo(s) huérfano(s)`), ` de ${total} (${fmtSize(list.reduce((n, o) => n + o.size, 0))}).`), all, ul, sum, h('div', { class: 'aj-actions' }, delBtn));
    upd();
  }

  // ---------- Borrar todos mis datos (G05) ----------
  const danger = h('section', { class: 'mn-card aj-card', 'aria-labelledby': 'aj-del' },
    h('h2', { id: 'aj-del' }, 'Borrar todos mis datos'),
    h('p', {}, 'Elimina de este navegador tu perfil, plantillas, archivos y preferencias de la app. No se puede deshacer. Hazlo al terminar en un equipo compartido, y descarga antes un respaldo si quieres conservar algo.'),
    h('div', { class: 'aj-actions' }, h('button', { type: 'button', class: 'mn-btn mn-btn--danger', onclick: openWipe }, icon('trash'), 'Borrar todos mis datos')));

  function openWipe() {
    const tid = 'wipe-t-' + (++dlgId), iid = 'wipe-i-' + dlgId;
    const dlg = h('dialog', { class: 'mn-dialog', 'aria-labelledby': tid });
    const input = h('input', { type: 'text', id: iid, class: 'mn-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const go = h('button', { type: 'button', class: 'mn-btn mn-btn--danger', disabled: true }, 'Borrar definitivamente');
    const msg = h('p', { class: 'mn-error', role: 'alert' });
    const close = () => { dlg.close(); dlg.remove(); };
    input.addEventListener('input', () => { go.disabled = input.value.trim().toUpperCase() !== 'BORRAR'; });
    go.addEventListener('click', async () => {
      if (input.value.trim().toUpperCase() !== 'BORRAR') return;
      go.disabled = true;
      const ok = await store.wipeAll();
      if (!ok) { msg.replaceChildren(icon('alert'), 'No se pudieron borrar todos los archivos. Cierra otras pestañas de la app e inténtalo de nuevo.'); go.disabled = false; return; }
      close();
      location.hash = '#/perfil';
      location.reload();
    });
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); close(); });
    dlg.append(
      h('div', { class: 'mn-dialog__head' }, h('h2', { id: tid }, '¿Borrar todos tus datos?')),
      h('div', { class: 'mn-dialog__body aj-confirm' },
        h('p', {}, 'Se eliminarán de este navegador el perfil, las plantillas, los certificados, documentos y la fotografía. No hay forma de recuperarlos sin un respaldo.'),
        h('label', { class: 'mn-label', for: iid }, 'Escribe BORRAR para confirmar'), input, msg),
      h('div', { class: 'mn-dialog__foot' }, h('button', { type: 'button', class: 'mn-btn mn-btn--quiet', onclick: close }, 'Cancelar'), go));
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
  }

  el.replaceChildren(
    pageHead({ eyebrow: 'Ajustes', title: 'Tus datos en este equipo', text: 'Privacidad, espacio disponible, respaldo y limpieza. Todo ocurre en este navegador.' }),
    h('div', { class: 'aj-grid' }, privacy, storage, backup, orphans, danger));
  paintStorage(); paintBackup();
  const unsub = store.subscribe((e) => { if (e.type === 'files' || e.type === 'all') paintStorage(); });
  return () => { alive = false; unsub(); document.querySelectorAll('dialog.mn-dialog[aria-labelledby^="wipe-t-"]').forEach((d) => d.remove()); };
}
