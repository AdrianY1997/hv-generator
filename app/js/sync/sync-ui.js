// Tarjeta "Sincronización entre equipos" de Ajustes (G04). Solo interfaz: la lógica está en controller.js.
// Clases del sistema de diseño (mn-*, aj-*, imp-* de import-dialog.css) + css/sync.css. Textos en español; estados con role=status/alert.
import { h, icon, toast } from '../ui.js';
import { passFields } from '../import-dialog.js';
import * as sync from './controller.js';
import { folderSupported, pickFolder } from './folder.js';
import { TOKEN_URL } from './gist.js';
import { DEFAULT_BUDGET_MB, MAX_BUDGET_MB } from './sync-format.js';
import { fmtSize } from '../forms.js';

(function injectCss() {
  const href = new URL('../../css/sync.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === href)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.append(l);
})();

let seq = 0;
const when = (ms) => {
  if (!ms) return 'nunca';
  const min = Math.round((Date.now() - ms) / 60000);
  const rel = min < 1 ? 'hace un momento' : min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} día(s)`;
  return `${rel} (${new Date(ms).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })})`;
};

/** <dialog> de confirmación. `choices`: [{value, label, hint}] (radios) o null. -> Promise<valor|true|null>. */
function ask({ title, body, okLabel, danger = false, choices = null }) {
  return new Promise((resolve) => {
    const n = ++seq, tid = `sy-dt-${n}`, did = `sy-dd-${n}`;
    const dlg = h('dialog', { class: 'mn-dialog imp-dialog imp-dialog--sm', 'aria-labelledby': tid, 'aria-describedby': did });
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    const radios = (choices || []).map((c, i) => {
      const input = h('input', { type: 'radio', name: `sy-r-${n}`, id: `sy-r-${n}-${i}`, value: c.value, checked: i === 0 || null });
      return { input, row: h('label', { class: 'imp-opt', for: input.id }, input, h('span', {}, h('strong', {}, c.label), c.hint ? h('span', { class: 'mn-help imp-hint' }, c.hint) : null)) };
    });
    const ok = h('button', { type: 'button', class: 'mn-btn ' + (danger ? 'mn-btn--danger' : 'mn-btn--primary'), onclick: () => done(choices ? radios.find((r) => r.input.checked)?.input.value ?? null : true) }, okLabel);
    dlg.append(
      h('div', { class: 'mn-dialog__head' }, h('h2', { id: tid }, title)),
      h('div', { class: 'mn-dialog__body imp-body' }, h('div', { id: did }, ...[].concat(body).map((t) => (typeof t === 'string' ? h('p', {}, t) : t))),
        choices ? h('fieldset', { class: 'imp-modes' }, h('legend', { class: 'mn-label' }, 'Elige una opción'), radios.map((r) => r.row)) : null),
      h('div', { class: 'mn-dialog__foot' }, h('button', { type: 'button', class: 'mn-btn mn-btn--quiet', onclick: () => done(null) }, 'Cancelar'), ok));
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); done(null); });
    document.body.append(dlg);
    dlg.showModal();
    (radios[0]?.input || ok).focus();
  });
}

const confirmJoin = () => ask({
  title: 'Unir este equipo a tu sincronización',
  body: ['Ya existe una copia sincronizada y este equipo también tiene datos. No se borra nada: se combinan. Antes de cambiar algo se guarda una copia previa que puedes descargar desde aquí.',
    'Elige qué gana en los datos que tienen valores distintos en los dos lados y que no se han editado desde que activaste la sincronización:'],
  okLabel: 'Combinar',
  choices: [
    { value: 'remote', label: 'Preferir la copia sincronizada', hint: 'Recomendado si el otro equipo tiene lo más reciente.' },
    { value: 'local', label: 'Preferir los datos de este equipo', hint: 'Lo que hay aquí reemplaza lo distinto en la copia sincronizada.' },
  ],
});

/** Construye la tarjeta. -> { el, destroy } */
export function syncCard(store) {
  let alive = true;
  const status = h('p', { class: 'sy-status', role: 'status', 'aria-live': 'polite' });
  const alert = h('div', { class: 'sy-alert-host' });
  const body = h('div', { class: 'sy-body' });
  const el = h('section', { class: 'mn-card aj-card sy-card', 'aria-labelledby': 'aj-sync' },
    h('h2', { id: 'aj-sync' }, 'Sincronización entre equipos'),
    h('p', { class: 'muted' }, 'Opcional. Guarda una copia CIFRADA de tus datos en una carpeta que ya sincronizas con tu nube, o en un Gist secreto de GitHub, para seguir trabajando desde otro equipo. Se cifra aquí antes de salir: ni tu nube ni GitHub pueden leerla sin tu contraseña de sincronización.'),
    status, alert, body);

  const showError = (msg) => { alert.replaceChildren(msg ? h('p', { class: 'mn-error sy-alert', role: 'alert' }, icon('alert'), h('span', {}, msg)) : ''); };
  const unsub = sync.onStatus((s) => { if (alive && s.running) status.textContent = s.progress || 'Sincronizando…'; });
  const busy = (btns, on) => btns.forEach((b) => { if (b) b.disabled = on; });

  async function paint() {
    const info = await sync.getInfo();
    if (!alive) return;
    const st = info.status;
    if (st.running) status.textContent = st.progress || 'Sincronizando…';
    else if (!info.configured) status.textContent = 'Estado: no configurada. Tus datos solo están en este equipo.';
    else status.textContent = `Estado: ${info.unlocked ? 'conectada' : 'bloqueada (falta la contraseña en esta sesión)'}. Última sincronización: ${when(info.lastSyncAt)}.`;
    showError(st.lastError && !st.running ? st.lastError.message : '');
    body.replaceChildren(info.configured ? connected(info) : setup());
  }

  // ---------- Sin configurar ----------
  function setup() {
    const base = `sy-${++seq}`;
    const fsOk = folderSupported();
    const radio = (value, label, hint, disabled) => {
      const input = h('input', { type: 'radio', name: `${base}-kind`, value, id: `${base}-k-${value}`, disabled: disabled || null, 'aria-describedby': `${base}-k-${value}-h` });
      return { input, row: h('label', { class: 'imp-opt' + (disabled ? ' is-disabled' : ''), for: input.id }, input, h('span', {}, h('strong', {}, label), h('span', { class: 'mn-help imp-hint', id: `${base}-k-${value}-h` }, hint))) };
    };
    const rFolder = radio('folder', 'Carpeta sincronizada', fsOk ? 'Una carpeta de Google Drive, OneDrive, Dropbox o Syncthing ya instalada en este equipo. La app escribe en ella un solo archivo cifrado (hv-generator-sync.json) y tu nube lo lleva a tus otros equipos.' : 'No disponible en este navegador (requiere Chrome o Edge de escritorio). Usa GitHub Gist.', !fsOk);
    const rGist = radio('gist', 'GitHub Gist secreto', 'Funciona en cualquier navegador, también en el celular. Necesitas una cuenta de GitHub y un token con permiso «gist».');
    (fsOk ? rFolder : rGist).input.checked = true;

    let dir = null;
    const dirText = h('p', { class: 'mn-help', 'aria-live': 'polite' }, 'Ninguna carpeta elegida.');
    const pick = h('button', { type: 'button', class: 'mn-btn', onclick: async () => {
      try { dir = await pickFolder(); dirText.textContent = `Carpeta elegida: «${dir.name}».`; showError(''); }
      catch (e) { if (e.code !== 'cancelled') showError(e.userMessage); }
    } }, icon('folder'), 'Elegir carpeta…');
    const folderBox = h('div', { class: 'sy-sub' }, h('div', { class: 'aj-actions' }, pick), dirText);

    const tokId = `${base}-tok`;
    const token = h('input', { type: 'password', id: tokId, class: 'mn-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': `${tokId}-h` });
    const gistBox = h('div', { class: 'sy-sub' },
      h('div', { class: 'mn-field' }, h('label', { class: 'mn-label', for: tokId }, 'Token de GitHub (permiso «gist»)'), token),
      h('p', { class: 'mn-help', id: `${tokId}-h` },
        h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Crear un token solo con permiso «gist»', h('span', { class: 'mn-sr' }, ' (se abre en otra pestaña)')), '. ',
        'Recomendado: un token fine-grained con solo «Gists: lectura y escritura», o uno classic restringido al alcance «gist», con fecha de vencimiento y NINGÚN otro permiso. Si pierdes este equipo, revoca el token en GitHub. Se guarda solo en este navegador, cifrado con tu contraseña de sincronización, y solo se envía a api.github.com.'));

    const pf = passFields(base, { confirm: true, warn: false, label: 'Contraseña de sincronización' });
    const warn = h('p', { class: 'imp-warn', id: `${base}-pwarn` }, h('strong', {}, 'Usa la MISMA contraseña en todos tus equipos. '), 'No se puede recuperar: si la olvidas, la copia sincronizada no se puede abrir (tus datos locales siguen en cada equipo). No es la contraseña de GitHub ni la de tu nube.');
    const remember = h('input', { type: 'checkbox', id: `${base}-rem`, checked: null });
    const auto = h('input', { type: 'checkbox', id: `${base}-auto`, checked: true });
    const opt = (input, label, hint) => h('label', { class: 'imp-opt', for: input.id }, input, h('span', {}, h('strong', {}, label), hint ? h('span', { class: 'mn-help imp-hint' }, hint) : null));
    const go = h('button', { type: 'submit', class: 'mn-btn mn-btn--primary' }, icon('upload'), 'Conectar y sincronizar');
    const paintKind = () => { const g = rGist.input.checked; gistBox.hidden = !g; folderBox.hidden = g; };
    rFolder.input.addEventListener('change', paintKind); rGist.input.addEventListener('change', paintKind);
    paintKind();

    const form = h('form', { class: 'sy-form', novalidate: '', onsubmit: async (ev) => {
      ev.preventDefault();
      showError('');
      const kind = rGist.input.checked ? 'gist' : 'folder';
      if (kind === 'gist' && !token.value.trim()) { token.setAttribute('aria-invalid', 'true'); token.focus(); showError('Pega el token de GitHub.'); return; }
      token.removeAttribute('aria-invalid');
      if (kind === 'folder' && !dir) { showError('Primero elige la carpeta sincronizada.'); pick.focus(); return; }
      if (pf.validate()) return;
      busy([go, pick], true);
      try {
        const r = await sync.connect({ kind, token: token.value, dir, passphrase: pf.value(), remember: remember.checked, auto: auto.checked, budgetMB: DEFAULT_BUDGET_MB, confirmJoin });
        token.value = ''; pf.pass.value = ''; for (const i of form.querySelectorAll('input[type=password],input[autocomplete$="password"]')) i.value = '';
        if (r.status === 'cancelled') { status.textContent = 'Conexión cancelada: no se cambió nada.'; busy([go, pick], false); return; }
        toast(r.status === 'created' ? 'Sincronización creada. Conecta tus otros equipos con la misma contraseña.' : 'Equipo conectado y sincronizado.');
        sync.startAutoSync({ store, toast });
        await paint();
        const res = sync.getStatus().lastResult;
        if (res?.text) status.textContent += ' ' + res.text;
      } catch (e) {
        showError(e.userMessage || 'No se pudo conectar.');
        await paintStatusOnly();
        busy([go, pick], false);
      }
    } },
      h('fieldset', { class: 'imp-modes' }, h('legend', { class: 'mn-label' }, '¿Dónde guardar la copia cifrada?'), rFolder.row, rGist.row),
      folderBox, gistBox, pf.root, warn,
      opt(remember, 'Recordar la contraseña en este equipo', 'Permite sincronizar sola al abrir la app, pero la protección del token queda limitada a las defensas del navegador (CSP y mismo origen): un fallo de seguridad en la página podría usarlo. Déjalo apagado en equipos compartidos; así la escribirás en cada sesión.'),
      opt(auto, 'Sincronizar automáticamente', 'Al abrir la app, al recuperar la conexión y un minuto después de tus cambios. Siempre combina; nunca reemplaza sin preguntar.'),
      h('div', { class: 'aj-actions' }, go));
    return form;
  }
  async function paintStatusOnly() {
    const info = await sync.getInfo();
    if (alive && !info.configured) status.textContent = 'Estado: no configurada. Tus datos solo están en este equipo.';
  }

  // ---------- Conectada ----------
  function connected(info) {
    const where = info.provider === 'gist' ? `GitHub Gist secreto${info.login ? ` de @${info.login}` : ''}` : `Carpeta «${info.folderName || 'sin nombre'}» (archivo hv-generator-sync.json)`;
    const dl = h('dl', { class: 'imp-sum sy-info' });
    const row = (k, v) => dl.append(h('dt', {}, k), h('dd', {}, v));
    row('Destino', where);
    row('Última sincronización', when(info.lastSyncAt));
    row('Automática', info.auto ? 'Sí (al abrir, al reconectar y tras tus cambios)' : 'No (usa «Sincronizar ahora»)');
    row('Límite de adjuntos', `${info.budgetMB} MB`);
    const out = [dl];
    const last = info.status.lastResult;
    if (last?.text) out.push(h('p', {}, last.text));
    if (info.extraScopes?.length) out.push(h('p', { class: 'imp-warn' }, h('strong', {}, 'Tu token tiene permisos de más '), `(${info.extraScopes.join(', ')}). La app solo necesita «gist»: crea uno nuevo solo con ese permiso, revoca este en GitHub y vuelve a conectar.`));
    if (last?.conflictCopies?.length) out.push(h('p', { class: 'imp-warn' }, h('strong', {}, 'Tu nube creó copias en conflicto: '), last.conflictCopies.join(', '), '. Ocurre si dos equipos escribieron a la vez. La app usa solo hv-generator-sync.json; cuando todo esté al día puedes borrar esas copias.'));
    const skipped = info.skipped || [];
    if (skipped.length) {
      const mine = skipped.filter((s) => !s.elsewhere), other = skipped.filter((s) => s.elsewhere);
      out.push(h('details', { class: 'imp-det sy-skip' }, h('summary', {}, `${skipped.length} adjunto(s) no se sincronizan`),
        mine.length ? h('p', { class: 'mn-help' }, `No caben en el límite de ${info.budgetMB} MB (se quedan solo en este equipo; sube el límite en Opciones avanzadas o lleva el respaldo):`) : null,
        mine.length ? h('ul', {}, mine.map((s) => h('li', {}, `${s.name} · ${fmtSize(s.size)}`))) : null,
        other.length ? h('p', { class: 'mn-help' }, 'Están en otro equipo y no se subieron (por su límite):') : null,
        other.length ? h('ul', {}, other.map((s) => h('li', {}, `${s.name} · ${fmtSize(s.size)}`))) : null));
    }

    const now = h('button', { type: 'button', class: 'mn-btn mn-btn--primary' }, icon('check'), 'Sincronizar ahora');
    const off = h('button', { type: 'button', class: 'mn-btn mn-btn--quiet' }, icon('x'), 'Desconectar');
    const all = () => [now, off, ...adv.querySelectorAll('button,input')];
    const run = async (mode = 'merge') => {
      busy(all(), true); showError('');
      try {
        const r = await sync.syncNow({ mode, interactive: true });
        toast(r.applied ? 'Sincronizado: se recibieron cambios.' : r.pushed ? 'Sincronizado: se subieron tus cambios.' : 'Sincronizado: todo al día.');
      } catch (e) { /* el estado ya trae el error */ }
      await paint();
      if (sync.getStatus().lastResult?.text && !sync.getStatus().lastError) status.textContent += ' ' + sync.getStatus().lastResult.text;
    };
    now.addEventListener('click', () => run('merge'));
    off.addEventListener('click', async () => {
      const ok = await ask({ title: '¿Desconectar este equipo?', okLabel: 'Desconectar', danger: true,
        body: ['Se borran de este navegador el token, la clave recordada y el estado de la sincronización.', 'Tus datos se quedan en este equipo y la copia remota NO se borra (bórrala en GitHub o en la carpeta si ya no la usas).'] });
      if (!ok) return;
      await sync.disconnect();
      toast('Sincronización desconectada en este equipo. Tus datos siguen aquí.');
      await paint();
    });

    // Bloqueada: pedir la contraseña.
    let unlockBox = null;
    if (!info.unlocked) {
      const base = `sy-u-${++seq}`;
      const pf = passFields(base, { confirm: false, warn: false, label: 'Contraseña de sincronización' });
      const ub = h('button', { type: 'submit', class: 'mn-btn mn-btn--primary' }, 'Desbloquear');
      unlockBox = h('form', { class: 'sy-form sy-unlock', novalidate: '', onsubmit: async (ev) => {
        ev.preventDefault();
        if (pf.validate()) return;
        ub.disabled = true; status.textContent = 'Derivando la clave (unos segundos)…';
        try { await sync.unlock(pf.value()); pf.pass.value = ''; toast('Sincronización desbloqueada.'); await run('merge'); }
        catch (e) { status.textContent = 'Estado: bloqueada (falta la contraseña en esta sesión).'; ub.disabled = false; pf.showError(e.userMessage || 'No se pudo desbloquear.'); }
      } }, h('p', {}, 'En esta sesión falta la contraseña de sincronización (no se recordó en este equipo).'), pf.root, h('div', { class: 'aj-actions' }, ub));
      now.disabled = true;
    }

    // Opciones avanzadas
    const base = `sy-a-${++seq}`;
    const autoCb = h('input', { type: 'checkbox', id: `${base}-auto`, checked: info.auto || null });
    const remCb = h('input', { type: 'checkbox', id: `${base}-rem`, checked: info.remember || null });
    const budget = h('input', { type: 'number', id: `${base}-bud`, class: 'mn-input sy-num', min: '0', max: String(MAX_BUDGET_MB), step: '1', value: String(info.budgetMB), 'aria-describedby': `${base}-bud-h` });
    const save = async (patch, msg) => { try { await sync.setOptions(patch); toast(msg); } catch (e) { console.error(e); toast('No se pudo guardar la opción.', 4000, 'error'); } await paint(); };
    autoCb.addEventListener('change', () => save({ auto: autoCb.checked }, autoCb.checked ? 'Sincronización automática activada.' : 'Sincronización automática desactivada.'));
    remCb.addEventListener('change', () => save({ remember: remCb.checked }, remCb.checked ? 'La clave se recordará en este equipo.' : 'La clave ya no se recuerda: la pedirá en cada sesión.'));
    budget.addEventListener('change', () => save({ budgetMB: budget.value }, 'Límite de adjuntos guardado.'));
    const opt = (input, label, hint) => h('label', { class: 'imp-opt', for: input.id }, input, h('span', {}, h('strong', {}, label), hint ? h('span', { class: 'mn-help imp-hint' }, hint) : null));
    const pushBtn = h('button', { type: 'button', class: 'mn-btn mn-btn--danger', disabled: !info.unlocked || null, onclick: async () => {
      if (!(await ask({ title: '¿Reemplazar la copia remota con este equipo?', okLabel: 'Reemplazar la copia remota', danger: true,
        body: ['La copia sincronizada quedará exactamente como los datos de este equipo (sin combinar).', 'Ojo: tus otros equipos seguirán combinando sus propios datos. Para que otro equipo quede igual, usa allí «Reemplazar este equipo con la copia remota».'] }))) return;
      await run('push');
    } }, 'Reemplazar la copia remota con este equipo');
    const pullBtn = h('button', { type: 'button', class: 'mn-btn mn-btn--danger', disabled: !info.unlocked || null, onclick: async () => {
      if (!(await ask({ title: '¿Reemplazar este equipo con la copia remota?', okLabel: 'Reemplazar este equipo', danger: true,
        body: ['Los datos de este equipo quedarán exactamente como la copia sincronizada: lo que solo esté aquí se BORRA de este navegador.', 'Antes se guarda una copia previa que podrás descargar desde aquí.'] }))) return;
      await run('pull');
    } }, 'Reemplazar este equipo con la copia remota');
    const snapBtn = info.snapshotAt ? h('button', { type: 'button', class: 'mn-btn', onclick: async () => {
      try {
        const { snapshotBackup } = await import('./local-store.js');
        const { downloadJson } = await import('../export.js');
        const b = await snapshotBackup();
        if (b) { downloadJson(b, `hv-copia-previa-sincronizacion-${new Date(info.snapshotAt).toISOString().slice(0, 10)}.json`); toast('Copia previa descargada (sin cifrar). Para restaurarla: Vista previa > Importar JSON.'); }
      } catch (e) { console.error(e); toast('No se pudo generar la copia previa.', 4000, 'error'); }
    } }, icon('download'), 'Descargar la copia previa a la última sincronización') : null;
    const adv = h('details', { class: 'imp-det sy-adv' }, h('summary', {}, 'Opciones avanzadas'),
      opt(autoCb, 'Sincronizar automáticamente', 'Al abrir la app, al recuperar la conexión y un minuto después de tus cambios.'),
      opt(remCb, 'Recordar la contraseña en este equipo', 'Sin esto, la pedirá en cada sesión (más seguro). Con esto activado, el token queda protegido solo por la CSP y el mismo origen de la página.'),
      h('div', { class: 'mn-field sy-field' }, h('label', { class: 'mn-label', for: budget.id }, 'Límite de adjuntos que se suben (MB)'), budget,
        h('p', { class: 'mn-help', id: `${base}-bud-h` }, `De 0 a ${MAX_BUDGET_MB}. El perfil y las plantillas siempre se sincronizan; los adjuntos (foto, certificados, documentos) solo mientras quepan. En GitHub, cuanto más grande, más lenta la primera sincronización.`)),
      h('p', { class: 'mn-help' }, 'Los borrados se sincronizan (registros, plantillas y archivos). Un equipo que pase más de 180 días sin sincronizar puede volver a traer algo que ya borraste en otro.'),
      snapBtn ? h('p', { class: 'mn-help' }, `Copia previa del ${new Date(info.snapshotAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}: tus datos como estaban justo antes de que la sincronización los cambiara. Va sin cifrar.`) : null,
      h('div', { class: 'aj-actions' }, snapBtn, pushBtn, pullBtn));
    out.push(unlockBox, h('div', { class: 'aj-actions' }, now, off), adv);
    return h('div', { class: 'sy-connected' }, ...out.filter(Boolean));
  }

  paint();
  const unsubStore = store.subscribe((e) => { if (e.type === 'all' && alive && !sync.getStatus().running) paint(); });
  return { el, destroy() { alive = false; unsub(); unsubStore(); document.querySelectorAll('dialog.mn-dialog[aria-labelledby^="sy-dt-"]').forEach((d) => d.remove()); } };
}
