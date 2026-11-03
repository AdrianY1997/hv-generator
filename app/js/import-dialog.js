// Diálogo de importación de respaldo (G12): resumen del archivo, qué cambia respecto a lo actual y elección Combinar / Reemplazar.
// <dialog> nativo con clases mn-* (foco atrapado y Esc los da el navegador; el resultado se anuncia con aria-live).
import { h } from './ui.js';
import { mergeBackup, summarizeProfile } from './backup-merge.js';
import { passphraseStrength, normalizePassphrase, passphraseLength, MIN_PASSPHRASE, MAX_PASSPHRASE } from './backup-crypto.js';

(function injectCss() {
  const href = new URL('../css/import-dialog.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === href)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.append(l);
})();

let dlgSeq = 0;
/** Vacía los campos de contraseña de un diálogo antes de quitarlo (la contraseña no debe quedar en el DOM ni en el valor del input). */
const wipePasswords = (dlg) => { for (const i of dlg.querySelectorAll('input[autocomplete$="password"]')) { i.value = ''; i.type = 'password'; } };

// ---------- Contraseña del respaldo (G05) ----------
/**
 * Campos de contraseña accesibles: etiqueta, "Mostrar contraseña", confirmación opcional, indicador de fortaleza (texto, aria-live) y
 * la advertencia de que una contraseña perdida no se recupera. `validate()` devuelve el mensaje de error (o null) y marca aria-invalid.
 */
function passFields(base, { confirm = true, warn = confirm, label = 'Contraseña' } = {}) {
  const pid = `${base}-pw`, cid = `${base}-pc`, sid = `${base}-ps`, wid = `${base}-pwarn`;
  const attrs = { type: 'password', class: 'mn-input', autocomplete: confirm ? 'new-password' : 'current-password', autocapitalize: 'off', spellcheck: 'false', maxlength: String(MAX_PASSPHRASE + 64) };
  const pass = h('input', { ...attrs, id: pid, 'aria-describedby': confirm ? `${sid} ${wid}` : null });
  const conf = confirm ? h('input', { ...attrs, id: cid, 'aria-describedby': wid }) : null;
  const show = h('input', { type: 'checkbox', id: `${base}-show` });
  show.addEventListener('change', () => { for (const i of [pass, conf]) if (i) i.type = show.checked ? 'text' : 'password'; });
  const bar = h('span', { class: 'imp-bar', 'aria-hidden': 'true' }, h('span', { class: 'imp-bar__fill' }));
  const strength = h('p', { class: 'mn-help imp-strength', id: sid, 'aria-live': 'polite' });
  const paintStrength = () => {
    const st = passphraseStrength(pass.value);
    bar.dataset.level = String(pass.value ? st.level : 0);
    strength.textContent = !pass.value ? `Mínimo ${MIN_PASSPHRASE} caracteres. Una frase de varias palabras es más segura que una palabra con símbolos.`
      : `Seguridad: ${st.label.toLowerCase()}${st.ok ? '' : ` (mínimo ${MIN_PASSPHRASE} caracteres)`}. Es solo una orientación.`;
  };
  if (confirm) pass.addEventListener('input', paintStrength);
  const err = h('p', { class: 'mn-error', role: 'alert' });
  const field = (lbl, input) => h('div', { class: 'mn-field' }, h('label', { class: 'mn-label', for: input.id }, lbl), input);
  const root = h('div', { class: 'imp-pass' },
    field(label, pass), confirm ? bar : null, confirm ? strength : null, confirm ? field('Repite la contraseña', conf) : null,
    h('label', { class: 'imp-opt imp-opt--show', for: show.id }, show, h('span', {}, 'Mostrar la contraseña')),
    warn ? h('p', { class: 'imp-warn', id: wid }, h('strong', {}, 'Si pierdes la contraseña no hay forma de recuperar el respaldo. '), 'La app no la guarda ni existe una clave de rescate. Anótala en un lugar seguro, aparte del archivo.') : null,
    err);
  if (confirm) paintStrength();
  const clear = () => { err.textContent = ''; for (const i of [pass, conf]) if (i) i.removeAttribute('aria-invalid'); };
  const invalid = (msg, el) => { clear(); err.textContent = msg; el.setAttribute('aria-invalid', 'true'); el.focus(); return msg; };
  return {
    root, pass,
    value: () => pass.value,
    clearError: clear,
    showError: (msg) => { invalid(msg, pass); pass.select?.(); },
    /** Valida longitud y confirmación. Devuelve el mensaje (y enfoca el campo con el problema) o null. */
    validate() {
      const v = normalizePassphrase(pass.value);
      if (!v) return invalid('Escribe una contraseña.', pass);
      if (confirm && passphraseLength(v) < MIN_PASSPHRASE) return invalid(`La contraseña debe tener al menos ${MIN_PASSPHRASE} caracteres.`, pass);
      if (v.length > MAX_PASSPHRASE) return invalid(`La contraseña no puede pasar de ${MAX_PASSPHRASE} caracteres.`, pass);
      if (confirm && normalizePassphrase(conf.value) !== v) return invalid('Las dos contraseñas no coinciden.', conf);
      clear(); return null;
    },
  };
}

/** <dialog> mínimo con formulario. `build(base)` -> nodos del cuerpo. `submit()` -> valor (cierra) | lanza un error de `userErr` (queda abierto). */
function formDialog({ title, intro, build, okLabel, submit, focus }) {
  return new Promise((resolve) => {
    const n = ++dlgSeq, tid = `dlg-t-${n}`, did = `dlg-d-${n}`;
    const dlg = h('dialog', { class: 'mn-dialog imp-dialog imp-dialog--sm', 'aria-labelledby': tid, 'aria-describedby': intro ? did : null });
    let settled = false, busy = false;
    const finish = (val) => { if (settled) return; settled = true; wipePasswords(dlg); dlg.close(); dlg.remove(); resolve(val); };
    const status = h('p', { class: 'mn-help', role: 'status', 'aria-live': 'polite' });
    const ok = h('button', { type: 'submit', class: 'mn-btn mn-btn--primary' }, okLabel);
    const cancel = h('button', { type: 'button', class: 'mn-btn mn-btn--quiet', onclick: () => finish(null) }, 'Cancelar');
    const form = h('form', { novalidate: '', onsubmit: async (ev) => {
      ev.preventDefault();
      if (busy) return;
      busy = true; ok.disabled = true; status.textContent = 'Procesando…';
      try { finish(await submit()); }
      catch (e) { if (!e?.silent) console.error(e); e?.show?.(e.userMessage); }
      busy = false; ok.disabled = false; status.textContent = '';
    } });
    const body = build(`dlg-${n}`);
    form.append(
      h('div', { class: 'mn-dialog__head' }, h('h2', { id: tid }, title)),
      h('div', { class: 'mn-dialog__body imp-body' }, intro ? h('p', { id: did }, intro) : null, ...body, status),
      h('div', { class: 'mn-dialog__foot' }, cancel, ok));
    dlg.append(form);
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); finish(null); });
    document.body.append(dlg);
    dlg.showModal();
    (focus?.() || form.querySelector('input'))?.focus();
  });
}
const userErr = (msg, show) => Object.assign(new Error(msg), { userMessage: msg, show, silent: true });

/**
 * Diálogo de descarga del respaldo (G05): casilla "Proteger con contraseña" (apagada por omisión).
 * -> Promise<{ passphrase: string|null }|null> (null = la persona canceló). La contraseña solo vive en esa variable hasta cifrar.
 */
export function openExportDialog() {
  let box, fields;
  return formDialog({
    title: 'Descargar respaldo',
    intro: 'El respaldo es un archivo JSON con tu perfil, plantillas y archivos. Por omisión queda SIN cifrar: cualquiera que tenga el archivo puede leerlo.',
    okLabel: 'Descargar',
    build: (base) => {
      box = h('input', { type: 'checkbox', id: `${base}-prot` });
      fields = passFields(base);
      const wrap = h('div', { hidden: '' }, fields.root);
      box.addEventListener('change', () => { wrap.hidden = !box.checked; fields.clearError(); if (box.checked) fields.pass.focus(); });
      return [h('label', { class: 'imp-opt', for: box.id }, box, h('span', {}, h('strong', {}, 'Proteger con contraseña'), h('span', { class: 'mn-help imp-hint' }, 'Cifra el archivo en este equipo (AES-256-GCM). Para abrirlo después necesitarás la misma contraseña.'))), wrap];
    },
    focus: () => box,
    submit: async () => {
      if (!box.checked) return { passphrase: null };
      const msg = fields.validate();
      if (msg) throw userErr(msg, () => {});
      return { passphrase: fields.value() };
    },
  });
}

/**
 * Pide la contraseña de un respaldo cifrado. `verify(passphrase)` (async) descifra y devuelve el resultado, o lanza un error con
 * `userMessage` (contraseña incorrecta, archivo alterado...): el diálogo sigue abierto para reintentar. -> Promise<resultado|null>.
 */
export function openPassphraseDialog({ fileName = '', verify }) {
  let fields;
  return formDialog({
    title: 'Respaldo cifrado',
    intro: `${fileName ? `«${fileName}» está` : 'Este respaldo está'} protegido con contraseña. Escríbela para abrirlo; hasta entonces no se cambia ningún dato.`,
    okLabel: 'Descifrar',
    build: () => { fields = passFields(`dlg-pp${dlgSeq}`, { confirm: false, warn: false }); return [fields.root]; },
    focus: () => fields.pass,
    submit: async () => {
      fields.clearError();
      try { return await verify(fields.value()); }
      catch (e) { throw userErr(e?.userMessage || 'No se pudo descifrar el respaldo.', fields.showError); }
    },
  });
}
const mb = (n) => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB';
const fmtDate = (iso) => {
  const d = new Date(iso);
  return iso && !Number.isNaN(d.getTime()) ? d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : 'No indica fecha';
};
const plain = (t) => String(t || '').replace(/^[IVXL]+\.\s+/, '');

/**
 * openImportDialog({ prepared, current:{profile, templates, files}, sections, currentShown }) -> Promise<{mode, preferBackup, noop}|null>
 * `prepared`: resultado de prepareBackup. `null` = la persona canceló. El resultado puede traer `safetyPassphrase` (cifrar la copia previa con ella).
 */
export function openImportDialog({ prepared, current, sections = [], currentShown = null }) {
  return new Promise((resolve) => {
    const n = ++dlgSeq, tid = `imp-t-${n}`, gid = `imp-g-${n}`, pid = `imp-p-${n}`;
    const titleOf = Object.fromEntries(sections.map((s) => [s.id, plain(s.title)]));
    const dlg = h('dialog', { class: 'mn-dialog imp-dialog', 'aria-labelledby': tid, 'aria-describedby': pid });
    const inc = summarizeProfile(prepared.profile), cur = summarizeProfile(current.profile);
    const mk = (value, label, hint, checked) => {
      const input = h('input', { type: 'radio', name: gid, value, id: `${gid}-${value}`, checked: checked || null });
      return { input, row: h('label', { class: 'imp-opt', for: input.id }, input, h('span', {}, h('strong', {}, label), h('span', { class: 'mn-help imp-hint' }, hint))) };
    };
    const merge = mk('merge', 'Combinar con mis datos actuales', 'No borra nada: agrega lo que falta y conserva lo tuyo cuando hay diferencias.', true);
    const repl = mk('replace', 'Reemplazar todo', 'Borra el perfil, las plantillas y los archivos actuales y deja solo los del respaldo.', false);
    const prefer = h('input', { type: 'checkbox', id: `${gid}-prefer` });
    const preferRow = h('label', { class: 'imp-opt imp-opt--sub', for: prefer.id }, prefer,
      h('span', {}, h('strong', {}, 'Preferir el respaldo si hay diferencias'), h('span', { class: 'mn-help imp-hint' }, 'En los datos que existen en ambos lados, gana el respaldo en vez de lo actual.')));
    const preview = h('div', { class: 'imp-preview', id: pid, 'aria-live': 'polite' });
    // Copia de seguridad previa: por omisión SIN cifrar (se descarga sola); se puede cifrar con su propia contraseña.
    const safe = h('input', { type: 'checkbox', id: `${gid}-safe` });
    const safeFields = passFields(`${gid}-safe`);
    const safeWrap = h('div', { hidden: '' }, safeFields.root);
    safe.addEventListener('change', () => { safeWrap.hidden = !safe.checked; safeFields.clearError(); if (safe.checked) safeFields.pass.focus(); });
    const safeBox = h('div', { class: 'imp-safe' },
      h('p', { class: 'mn-help' }, 'Antes de importar se descargará automáticamente una copia de seguridad de tus datos actuales.'),
      h('label', { class: 'imp-opt', for: safe.id }, safe, h('span', {}, h('strong', {}, 'Cifrar esa copia con una contraseña'), h('span', { class: 'mn-help imp-hint' }, 'Por omisión va sin cifrar. Márcalo si el equipo es compartido.'))),
      safeWrap);

    const info = h('dl', { class: 'imp-sum' });
    const row = (k, v) => info.append(h('dt', {}, k), h('dd', {}, v));
    row('Fecha del respaldo', fmtDate(prepared.exportedAt));
    row('Versión de los datos', prepared.upgraded ? `${prepared.schemaVersion} (se actualizará al formato actual)` : String(prepared.schemaVersion));
    row('Perfil', `${inc.fields} campo(s) con dato y ${inc.items} registro(s) en ${inc.sections} sección(es)`);
    row('Plantillas', String(prepared.templates.length));
    row('Archivos', `${prepared.files.length} (${mb(prepared.totalBytes)})`);

    const secName = (k) => titleOf[k] || k;
    function paint() {
      const isMerge = merge.input.checked;
      prefer.disabled = !isMerge;
      preferRow.classList.toggle('is-disabled', !isMerge);
      const out = { mode: isMerge ? 'merge' : 'replace', preferBackup: isMerge && prefer.checked, noop: false };
      preview.replaceChildren(h('h3', { class: 'imp-h' }, 'Qué va a pasar'));
      if (!isMerge) {
        out.noop = false;
        preview.append(h('ul', {},
          h('li', {}, `Se descarta lo actual: ${cur.fields} campo(s) y ${cur.items} registro(s) del perfil, ${current.templates.length} plantilla(s) y ${current.files.length} archivo(s).`),
          h('li', {}, `Quedan los del respaldo: ${inc.fields} campo(s), ${inc.items} registro(s), ${prepared.templates.length} plantilla(s) y ${prepared.files.length} archivo(s).`)));
      } else {
        const m = mergeBackup(current, prepared, { preferBackup: out.preferBackup, currentShown });
        if (!m.ok) { preview.append(h('p', { class: 'mn-error', role: 'alert' }, m.error)); out.error = true; }
        else {
          out.noop = !m.changed;
          const s = m.stats, p = s.profile, lis = [];
          if (p.filled) lis.push(`${p.filled} campo(s) vacío(s) se completan con el respaldo.`);
          if (p.itemsAdded) lis.push(`${p.itemsAdded} registro(s) nuevo(s) se agregan.`);
          if (p.replaced) lis.push(`${p.replaced} campo(s) distintos se reemplazan por los del respaldo.`);
          if (p.itemsReplaced) lis.push(`${p.itemsReplaced} registro(s) se actualizan${out.preferBackup ? ' con los del respaldo' : ' (el del respaldo es más reciente)'}.`);
          if (s.templates.added) lis.push(`${s.templates.added} plantilla(s) nueva(s).`);
          if (s.templates.renamed) lis.push(`${s.templates.renamed} plantilla(s) con el mismo id pero distintas: se agregan como "(importada)".`);
          if (s.files.added) lis.push(`${s.files.added} archivo(s) nuevo(s).`);
          if (s.files.replaced) lis.push(`${s.files.replaced} archivo(s) se reemplazan por los del respaldo.`);
          const kept = p.kept + p.itemsKept + s.files.kept;
          if (kept) lis.push(`${kept} dato(s) distintos se conservan como están (${p.kept} campo(s), ${p.itemsKept} registro(s), ${s.files.kept} archivo(s))${out.preferBackup ? '' : '; marca "Preferir el respaldo" para tomar los del respaldo'}.`);
          if (p.skipped) lis.push(`${p.skipped} elemento(s) del respaldo no se pudieron combinar y se omiten.`);
          if (!lis.length || out.noop) preview.append(h('p', {}, 'No hay nada nuevo: tus datos ya contienen este respaldo. No se cambia nada.'));
          if (lis.length && !out.noop) preview.append(h('ul', {}, lis.map((t) => h('li', {}, t))));
          const secs = Object.entries(s.sections).filter(([, v]) => v.filled || v.replaced || v.itemsAdded || v.itemsReplaced || v.kept || v.itemsKept);
          if (secs.length && !out.noop) {
            preview.append(h('details', { class: 'imp-det' }, h('summary', {}, 'Detalle por sección'),
              h('ul', {}, secs.map(([k, v]) => h('li', {}, `${secName(k)}: ` + [
                v.filled && `${v.filled} campo(s) completado(s)`, v.replaced && `${v.replaced} reemplazado(s)`, v.itemsAdded && `${v.itemsAdded} registro(s) nuevo(s)`,
                v.itemsReplaced && `${v.itemsReplaced} actualizado(s)`, (v.kept + v.itemsKept) && `${v.kept + v.itemsKept} conservado(s)`].filter(Boolean).join(', ') + '.')))));
          }
        }
      }
      cur_out = out;
      safeBox.hidden = out.noop; // sin cambios no se descarga copia previa
      ok.disabled = !!out.error;
      ok.textContent = isMerge ? (out.noop ? 'Cerrar sin cambios' : 'Combinar') : 'Reemplazar todo';
      ok.className = 'mn-btn ' + (isMerge ? 'mn-btn--primary' : 'mn-btn--danger');
    }
    let cur_out = null, settled = false;
    const finish = (val) => { if (settled) return; settled = true; wipePasswords(dlg); dlg.close(); dlg.remove(); resolve(val); };
    const ok = h('button', { type: 'button', class: 'mn-btn mn-btn--primary', onclick: () => {
      if (!cur_out || cur_out.error) return finish(null);
      if (safe.checked && !cur_out.noop) { if (safeFields.validate()) return; return finish({ ...cur_out, safetyPassphrase: safeFields.value() }); }
      finish(cur_out);
    } }, 'Combinar');
    const cancel = h('button', { type: 'button', class: 'mn-btn mn-btn--quiet', onclick: () => finish(null) }, 'Cancelar');
    for (const e of [merge.input, repl.input, prefer]) e.addEventListener('change', paint);
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); finish(null); });
    dlg.append(
      h('div', { class: 'mn-dialog__head' }, h('h2', { id: tid }, 'Importar respaldo')),
      h('div', { class: 'mn-dialog__body imp-body' },
        info,
        h('fieldset', { class: 'imp-modes' }, h('legend', { class: 'mn-label' }, '¿Cómo quieres importarlo?'), merge.row, preferRow, repl.row),
        preview,
        safeBox),
      h('div', { class: 'mn-dialog__foot' }, cancel, ok));
    document.body.append(dlg);
    paint();
    dlg.showModal();
    merge.input.focus();
  });
}

/**
 * Flujo completo de "Descargar respaldo" (G05): diálogo (con o sin contraseña) -> genera -> descarga.
 * `store`: js/store.js. -> 'plain' | 'encrypted' | null (canceló). Lanza el error del cifrado/exportación (con userMessage) para que quien llama lo muestre.
 */
export async function downloadBackupFlow(store) {
  const choice = await openExportDialog();
  if (!choice) return null;
  const { downloadJson } = await import('./export.js');
  if (choice.passphrase) { downloadJson(await store.exportBackupEncrypted(choice.passphrase), 'hv-datos-cifrado.json'); return 'encrypted'; }
  downloadJson(await store.exportBackup(), 'hv-datos.json');
  return 'plain';
}
