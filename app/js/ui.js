// Pequeños helpers de DOM.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
export const clear = (el) => { el.replaceChildren(); return el; };
export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function placeholderView(title, todo) {
  return h('section', { class: 'mn-card' }, h('h1', {}, title), h('p', { class: 'muted' }, todo));
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Icono del sprite de index.html (<symbol id="i-NAME">). Decorativo (aria-hidden). */
export function icon(name, size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

/** Aviso breve (tinta invertida, role=status, 4 s). kind='error': tarjeta con borde de peligro, role=alert, 9 s. */
export function toast(text, ms = 4000, kind = 'ok') {
  const box = document.getElementById('toasts');
  if (!box) return null;
  const err = kind === 'error';
  const t = h('div', { class: 'mn-toast' + (err ? ' mn-toast--error' : ''), role: err ? 'alert' : 'status' }, icon(err ? 'alert' : 'check'), text);
  box.append(t);
  setTimeout(() => t.remove(), err && ms === 4000 ? 9000 : ms);
  return t;
}

/** Aviso persistente con una acción (p. ej. "Recargar"); se cierra al pulsar la acción o la X. */
export function toastAction(text, actionLabel, onAction) {
  const box = document.getElementById('toasts');
  if (!box) return null;
  const t = h('div', { class: 'mn-toast mn-toast--action', role: 'status' }, icon('info'), h('span', { class: 'mn-toast__t' }, text),
    h('button', { type: 'button', class: 'mn-btn mn-btn--sm', onclick: () => { t.remove(); onAction(); } }, actionLabel),
    h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--icon mn-btn--sm', 'aria-label': 'Cerrar aviso', onclick: () => t.remove() }, icon('x', 14)));
  box.append(t);
  return t;
}

/** Estado vacío (.mn-empty): icono, título serif, una frase y una sola acción. */
export function emptyState({ icon: ic = 'folder', title, text, action, level = 3 }) {
  const el = h('div', { class: 'mn-empty' }, icon(ic, 36), h('h' + level, {}, title), text ? h('p', {}, text) : null, action || null);
  el.firstChild.classList.add('mn-empty__icon');
  return el;
}

/** Cabecera de vista: eyebrow + h1 serif + frase, y un bloque opcional a la derecha. */
export function pageHead({ eyebrow, title, text, aside }) {
  return h('div', { class: 'page-head view-head' },
    h('div', {}, eyebrow ? h('span', { class: 'mn-eyebrow' }, eyebrow) : null, h('h1', { tabindex: '-1' }, title), text ? h('p', { class: 'page-head__text' }, text) : null),
    aside || null);
}
