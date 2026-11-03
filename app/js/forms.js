// Helpers compartidos de formularios y adjuntos (perfil / documentos).
import { h, icon, toast } from './ui.js';
import { MAX_FILE, ALLOWED_TYPES, isAllowedType, isAllowedImageType, sniffMime } from './backup-validate.js';
import { check, normalize, worst } from './validators.js';

export { MAX_FILE };
// Solo PDF, JPG, PNG y WebP: nunca SVG/HTML (un blob con ese tipo ejecutaría script con el origen de la app al abrirlo).
export const ACCEPT = ALLOWED_TYPES.join(',');
export const ACCEPT_IMAGES = ALLOWED_TYPES.filter((t) => t.startsWith('image/')).join(',');

/** Tipo real del archivo según sus primeros bytes (el File.type puede venir vacío o mentir). null si no es un tipo permitido. */
export async function detectType(f) {
  try {
    const head = new Uint8Array(await f.slice(0, 1024).arrayBuffer());
    const t = sniffMime(head);
    return t && isAllowedType(t) ? t : null;
  } catch { return null; }
}
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

/** Id del archivo de certificado: ítem repetible -> cert:<item.id>; campo con certificate -> cert:<sec>:<campo>; sección simple con certificate -> cert:<sec>. */
export function certFileId(section, item, field) {
  if (section.repeatable) return `cert:${item.id}`;
  return field ? `cert:${section.id}:${field.id}` : `cert:${section.id}`;
}

export function fmtSize(n = 0) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** Bolsa de object URLs para revocarlos todos al limpiar. */
export function urlBag() {
  const urls = new Set();
  return {
    make(blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; },
    revoke(u) { if (urls.delete(u)) URL.revokeObjectURL(u); },
    revokeAll() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); },
  };
}

let seq = 0;
export const nextId = (p = 'f') => `${p}-${++seq}`;

/**
 * Slot de un archivo (certificado, documento, foto): zona de carga .mn-slot
 * (vacía: borde punteado; con archivo: chip + insignia). Acepta arrastrar y soltar.
 * opts: { store, fileId, label, bag, accept?, buttonLabel?, dropText?, compact?, onChange?(fileId|null),
 *         prepare?(file)->Promise<Blob|File|null>, analyze?(file)->Promise<object> (se funde en el meta), preview? }
 * compact: sin recuadro ni insignia (la fila que lo contiene ya muestra el estado).
 * Devuelve { el, refresh() }.
 */
export function fileSlot(opts) {
  const { store, fileId, label, bag, accept = ACCEPT, buttonLabel = 'Elegir archivo', dropText = 'Arrastra el archivo aquí o', compact = false, onChange, prepare, analyze, preview = false } = opts;
  const root = h('div', { class: 'file-slot mn-slot' });
  const msg = h('p', { class: 'file-msg', role: 'status', 'aria-live': 'polite' });
  const input = h('input', { type: 'file', accept, class: 'mn-sr', tabindex: '-1', 'aria-hidden': 'true' });
  let thumb = null;

  // Al reconstruir el slot el botón que tenía el foco desaparece: el foco pasa al primer botón nuevo (si no, se pierde en <body>).
  const refreshKeepingFocus = async () => { const had = root.contains(document.activeElement); await refresh(); if (had) root.querySelector('button')?.focus(); };

  async function refresh() {
    if (thumb) { bag.revoke(thumb); thumb = null; }
    let rec;
    try { rec = await store.getFile(fileId); } catch (e) { console.error(e); }
    root.replaceChildren();
    root.className = 'file-slot mn-slot' + (rec ? ' mn-slot--filled' : '') + (compact ? ' mn-slot--compact' : '');
    const pick = (text, extra = '', ic = null) => h('button', { type: 'button', class: 'mn-btn mn-btn--sm' + extra, 'aria-label': `${text}: ${label}`, onclick: () => input.click() }, ic ? icon(ic) : null, text);
    if (!rec) {
      root.append(...[
        compact ? null : icon('upload', 18),
        compact ? null : h('span', { class: 'mn-slot__text' }, dropText),
        pick(buttonLabel, '', compact ? 'upload' : null),
        compact ? null : h('span', { class: 'mn-badge mn-badge--warn mn-slot__state' }, 'Pendiente'),
        msg, input].filter(Boolean));
      return;
    }
    const m = rec.meta || {};
    const kids = [];
    if (preview && isAllowedImageType(rec.blob?.type)) {
      thumb = bag.make(rec.blob);
      kids.push(h('img', { class: 'thumb', src: thumb, alt: `Vista previa: ${m.name || label}` }));
    }
    kids.push(
      h('span', { class: 'mn-chip' }, icon('clip'), h('span', { class: 'file-name' }, `${m.name || 'archivo'} · ${fmtSize(m.size ?? rec.blob.size)}`),
        h('button', { type: 'button', 'aria-label': `Eliminar archivo: ${label}`, title: 'Quitar archivo', onclick: async () => {
          await store.deleteFile(fileId);
          onChange?.(null);
          await refreshKeepingFocus();
        } }, icon('x', 12))),
      compact ? null : h('span', { class: 'mn-badge mn-badge--ok' }, icon('check', 12), 'Adjunto'),
      h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm', 'aria-label': `Ver archivo: ${label}`, onclick: () => {
        // Nunca abrir un blob cuyo tipo no sea PDF/imagen permitida (p. ej. datos antiguos o manipulados con text/html o svg).
        if (!isAllowedType(rec.blob?.type)) { fail('Este archivo no se puede abrir por seguridad. Reemplázalo por un PDF, JPG o PNG.'); return; }
        const u = bag.make(rec.blob);
        window.open(u, '_blank', 'noopener');
        setTimeout(() => bag.revoke(u), 60000);
      } }, 'Ver'),
      pick('Reemplazar', ' mn-btn--quiet'),
      msg, input,
    );
    root.append(...kids.filter(Boolean));
  }

  const fail = (t) => { msg.textContent = t; msg.className = 'file-msg err'; };
  async function handle(f) {
    if (!f) return;
    msg.textContent = ''; msg.className = 'file-msg';
    const realType = await detectType(f);
    if (!realType) return fail(`"${f.name}" no es un PDF ni una imagen JPG, PNG o WebP. Elige otro archivo.`);
    if (f.type !== realType) f = new File([f], f.name, { type: realType, lastModified: f.lastModified });
    if (f.size > MAX_FILE) return fail(`"${f.name}" pesa ${fmtSize(f.size)}; el máximo permitido es ${fmtSize(MAX_FILE)}. Comprímelo e inténtalo de nuevo.`);
    try {
      if (prepare) {
        const p = await prepare(f); if (!p) return; f = p;
        // prepare() puede devolver otro archivo (p. ej. foto recortada): se vuelve a comprobar tipo y tamaño.
        if (!isAllowedType(f.type)) return fail('El archivo resultante no es un PDF ni una imagen permitida.');
        if (f.size > MAX_FILE) return fail(`El archivo resultante pesa ${fmtSize(f.size)}; el máximo permitido es ${fmtSize(MAX_FILE)}.`);
      }
      let extra = {};
      if (analyze) { msg.textContent = 'Leyendo el archivo en este equipo…'; try { extra = (await analyze(f)) || {}; } catch (e) { console.warn(e); } msg.textContent = ''; }
      await store.putFile(fileId, f, { name: f.name || 'archivo', type: f.type, size: f.size, label, ...extra });
      onChange?.(fileId);
      await refreshKeepingFocus();
      toast('Archivo adjuntado.');
    } catch (e) {
      if (!e.userMessage) console.error(e);
      fail(e.userMessage || 'No se pudo guardar el archivo.');
    }
  }
  input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; handle(f); });
  root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); root.setAttribute('data-drag', ''); } });
  root.addEventListener('dragleave', () => root.removeAttribute('data-drag'));
  root.addEventListener('drop', (e) => { e.preventDefault(); root.removeAttribute('data-drag'); handle(e.dataTransfer?.files?.[0]); });

  refresh();
  return { el: root, refresh };
}

/** Campo 'multiselect': grupo de casillas; el valor es un array con los `value` marcados. */
function multiControl(field, value, onInput) {
  const id = nextId('fld');
  const chosen = new Set(Array.isArray(value) ? value : []);
  const boxes = (field.options || []).map((o) => {
    const input = h('input', { type: 'checkbox', value: o.value });
    input.checked = chosen.has(o.value);
    input.addEventListener('change', () => {
      if (input.checked) chosen.add(o.value); else chosen.delete(o.value);
      onInput((field.options || []).map((x) => x.value).filter((v) => chosen.has(v)));
    });
    return h('label', { class: 'check-opt mn-check' }, input, o.label);
  });
  const el = h('fieldset', { class: 'mn-field field wide check-group', id }, h('legend', { class: 'mn-label' }, field.label), field.hint ? h('p', { class: 'mn-help hint' }, field.hint) : null, h('div', { class: 'check-grid' }, boxes));
  return { el, input: el.querySelector('input'), validate: () => true, reset() {}, isEmpty: () => !chosen.size };
}

/**
 * Control de un campo del schema. Devuelve {el, input, validate(), revalidate(), isEmpty()}.
 * ctx (opcional) = { get(fieldId) -> valor de otro campo del mismo registro, root(secId, fieldId) -> valor del perfil, today?, fit? }:
 * lo usan las reglas declaradas en `field.validate` (js/validators.js). Los errores y avisos NUNCA bloquean el guardado:
 * el error va en rojo con aria-invalid; la advertencia en ámbar, sin aria-invalid. Ambos se anuncian (aria-live) y
 * se enlazan al control con aria-describedby. `ctx.fit` = { comfort, max } (caracteres que caben en la casilla del formato impreso, ver model.fitLimit):
 * si el texto pasa de `comfort` avisa (sin bloquear) que se imprimirá con letra menor y, si pasa de `max`, que se recortará. `reset()` limpia errores y avisos
 * (cuando el campo se oculta por una condición `showIf`). Al salir del campo se normaliza el texto (cédula sin puntos, celular con espacios, correo en minúsculas).
 */
export function fieldControl(field, value, onInput, ctx = {}) {
  if (field.type === 'multiselect') return multiControl(field, value, onInput);
  const id = nextId('fld');
  const errId = id + '-err';
  const warnId = id + '-warn';
  const err = h('p', { class: 'mn-error field-err', id: errId, 'aria-live': 'polite' });
  const warn = h('p', { class: 'field-warn', id: warnId, 'aria-live': 'polite' });
  const rules = Array.isArray(field.validate) && field.validate.length ? field.validate : null;
  const t0 = field.type;
  const fit = ctx.fit && ctx.fit.max > 0 && (t0 === 'text' || t0 === 'tel' || t0 === 'email' || t0 === 'textarea' || !t0) ? ctx.fit : null;
  const fitId = id + '-fit';
  const attrs = { id, name: field.id, 'aria-describedby': errId + (rules ? ' ' + warnId : '') + (fit ? ' ' + fitId : '') + (field.hint ? ' ' + id + '-hint' : '') };
  if (field.required) attrs['aria-required'] = 'true';
  let input;
  const t = field.type;
  if (t === 'textarea') input = h('textarea', { ...attrs, class: 'mn-textarea', rows: 4 });
  else if (t === 'select') {
    input = h('select', { ...attrs, class: 'mn-select' }, h('option', { value: '' }, 'Seleccione…'),
      (field.options || []).map((o) => h('option', { value: o.value }, o.label)));
  } else if (t === 'checkbox') input = h('input', { ...attrs, type: 'checkbox' });
  else input = h('input', { ...attrs, class: 'mn-input', type: t || 'text' });

  if (t === 'checkbox') input.checked = !!value;
  else input.value = value ?? '';
  const read = () => (t === 'checkbox' ? input.checked : t === 'number' && input.value !== '' ? Number(input.value) : input.value);
  const isEmpty = () => (t === 'checkbox' ? !input.checked : String(input.value).trim() === '');
  let touched = false;
  const validate = () => {
    const bad = field.required && isEmpty();
    const issue = !bad && rules ? worst(check(rules, read(), ctx)) : null;
    const asError = bad || issue?.level === 'error';
    err.replaceChildren(...(bad ? [icon('alert', 14), `${field.label} es obligatorio; complétalo para continuar.`] : issue?.level === 'error' ? [icon('alert', 14), issue.message] : []));
    warn.replaceChildren(...(issue?.level === 'warn' ? [icon('info', 14), h('span', { class: 'mn-sr' }, 'Aviso: '), issue.message] : []));
    if (asError) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    return !bad;
  };
  input.addEventListener(t === 'select' || t === 'checkbox' ? 'change' : 'input', () => { onInput(read()); if (touched) validate(); });
  input.addEventListener('blur', () => {
    touched = true;
    if (rules && (t === 'text' || t === 'tel' || t === 'email' || !t)) {
      const n = normalize(rules, input.value, ctx);
      if (n !== input.value) { input.value = n; onInput(read()); updateFit(); }
    }
    validate();
  });
  // Aviso de texto largo respecto de la casilla del formato impreso (no bloquea). El texto vivo solo cambia al cambiar de estado.
  const fitMsg = fit ? h('span', { class: 'field-fit__msg', id: fitId, 'aria-live': 'polite' }) : null;
  const fitN = fit ? h('span', { class: 'field-fit__n', 'aria-hidden': 'true' }) : null;
  const fitEl = fit ? h('p', { class: 'field-fit is-ok' }, fitMsg, fitN) : null;
  let fitState = '';
  const updateFit = () => {
    if (!fit) return;
    const n = input.value.length, st = n > fit.max ? 'clip' : n > fit.comfort ? 'small' : 'ok';
    fitN.textContent = st === 'ok' ? '' : `${n} / ${st === 'clip' ? fit.max : fit.comfort}`;
    if (st === fitState) return;
    fitState = st;
    fitEl.className = 'field-fit is-' + st;
    fitMsg.replaceChildren(...(st === 'clip' ? [icon('alert', 14), `No cabe en la casilla del PDF (unos ${fit.max} caracteres): se recortará al imprimir. Abrévialo.`]
      : st === 'small' ? [icon('info', 14), `Texto largo: en el PDF se imprimirá con letra más pequeña (cómodo hasta unos ${fit.comfort} caracteres).`] : []));
  };
  if (fit) input.addEventListener('input', updateFit);
  // Otro campo del mismo registro cambió (p. ej. la fecha de ingreso): se vuelve a evaluar si este ya tiene valor o se tocó.
  const revalidate = () => { if (touched || !isEmpty()) validate(); };

  const label = h('label', { for: id, class: 'mn-label' }, field.label, field.required ? h('span', { class: 'mn-req req', 'aria-hidden': 'true' }, ' *') : null);
  const hint = field.hint ? h('p', { class: 'mn-help hint', id: id + '-hint' }, field.hint) : null;
  const el = t === 'checkbox'
    ? h('div', { class: 'mn-field field check' }, h('label', { for: id, class: 'mn-check' }, input, field.label), hint, err, warn)
    : h('div', { class: 'mn-field field' + (t === 'textarea' ? ' wide' : '') }, label, input, hint, err, warn, fitEl);
  updateFit();
  const reset = () => { touched = false; err.replaceChildren(); warn.replaceChildren(); input.removeAttribute('aria-invalid'); };
  return { el, input, validate: () => { touched = true; return validate(); }, revalidate, reset, isEmpty };
}
