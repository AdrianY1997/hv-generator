import { h, icon, pageHead, emptyState } from '../ui.js';
import { fieldControl, fileSlot, certFileId, uid, urlBag, nextId, ACCEPT_IMAGES } from '../forms.js';
import { createVisibility, refsOf } from '../conditions.js';
import { normalizeProfile } from '../backup-validate.js';
import { deriveShared, derivedValue } from '../models/shared-fields.js';
import { serviceTime } from '../service-time.js';
import { todayIso } from '../validators.js';

const isEmptyVal = (v) => v == null || v === '' || v === false;
// Los títulos del schema llevan el número del formato oficial (I., IV., ... en Minerva; 1., 2., ... en el Formato Único): en pantalla se numeran 01, 02, ...
const plain = (t) => t.replace(/^(?:[IVXL]+|\d+)\.\s+/, '');
const num = (i) => String(i + 1).padStart(2, '0');
const ADD = { superior: 'Agregar estudio', cursos: 'Agregar curso', sistemas: 'Agregar conocimiento', idiomas: 'Agregar idioma', experiencia: 'Agregar experiencia', referencias: 'Agregar referencia', hermanos: 'Agregar hermano o hermana' };

/** Vista "Perfil": formulario generado desde model.schema.sections. */
export function mount(el, ctx) {
  const { model, store } = ctx;
  const sections = model.schema.sections;
  const bag = urlBag();
  const profile = normalizeProfile(structuredClone(store.getProfile()), sections);
  let active = sections[0].id;
  try { active = sessionStorage.getItem('hv.perfil.sec') || active; } catch {}
  if (!sections.some((s) => s.id === active)) active = sections[0].id;
  let timer = null, dirty = new Set();

  const status = h('span', { class: 'mn-badge save-state', 'aria-hidden': 'true' }, 'Guardado automático');
  const live = h('span', { class: 'mn-sr', role: 'status' }); // anuncia solo el resultado, no cada "Guardando…"
  const condLive = h('span', { class: 'mn-sr', role: 'status' }); // anuncia los campos que aparecen o se ocultan según las respuestas
  const setStatus = (text, ok, bad = false) => {
    status.className = 'mn-badge save-state' + (ok ? ' mn-badge--ok' : bad ? ' mn-badge--danger' : '');
    status.replaceChildren(...(ok ? [icon('check', 12), text] : [text]));
    if (ok || bad) live.textContent = text;
  };
  const nav = h('nav', { class: 'mn-sidenav sec-nav', 'aria-label': 'Secciones del perfil' });
  const panel = h('div', { class: 'sec-panel' });

  function flush() {
    clearTimeout(timer); timer = null;
    if (!dirty.size) return;
    // `dirty` solo se vacía si el guardado tuvo éxito; nunca debe lanzar (se llama desde pagehide/visibilitychange).
    try {
      const ids = [...dirty], patch = {};
      for (const id of ids) patch[id] = profile[id];
      store.updateProfile(patch);
      for (const id of ids) dirty.delete(id);
      setStatus('Guardado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), true);
    } catch (e) {
      // StorageError (store.js) ya se avisó con toast y banner global; los cambios siguen en memoria y se reintentan al seguir editando.
      if (e?.name === 'StorageError') console.warn(e.message); else console.error(e);
      setStatus(e?.quota ? 'No se guardó: almacenamiento lleno (ver aviso)' : e?.name === 'StorageError' ? 'No se guardó: almacenamiento no disponible' : 'No se pudo guardar los cambios; se reintentará al seguir editando.', false, true);
    }
  }
  function touch(secId) {
    dirty.add(secId);
    setStatus('Guardando…', false);
    clearTimeout(timer);
    timer = setTimeout(flush, 400);
    updateNav();
  }

  // Obligatorios pendientes: solo cuentan los campos que aplican según las respuestas (showIf).
  function missing(sec) {
    const req = sec.fields.filter((f) => f.required);
    if (!req.length) return 0;
    const V = createVisibility(sections, profile);
    if (!V.sectionVisible(sec)) return 0;
    const pending = (d) => req.filter((f) => V.fieldVisible(sec, d, f) && isEmptyVal(d[f.id])).length;
    if (sec.repeatable) return (profile[sec.id] || []).reduce((n, it) => n + pending(it), 0);
    return pending(deriveShared(profile)[sec.id] || {}); // un dato escrito en otro formato (p. ej. «Apellidos» de Minerva) cuenta como lleno
  }
  function updateNav() {
    const V = createVisibility(sections, profile);
    for (const b of nav.querySelectorAll('button')) {
      const sec = sections.find((s) => s.id === b.dataset.sec);
      b.hidden = sec.id !== active && !V.sectionVisible(sec); // sección con showIf que no aplica (la activa nunca desaparece bajo el cursor)
      const n = missing(sec);
      const badge = b.querySelector('.n');
      badge.replaceChildren(...(n ? [h('span', { 'aria-hidden': 'true' }, String(n)), h('span', { class: 'mn-sr' }, ` (${n} campo(s) obligatorio(s) pendiente(s))`)] : []));
      badge.title = n ? `${n} campo(s) obligatorio(s) pendiente(s)` : '';
      badge.hidden = !n;
    }
  }
  function buildNav() {
    nav.replaceChildren(...sections.map((s) => h('button', {
      type: 'button', 'data-sec': s.id, class: 'sec-tab',
      'aria-current': s.id === active ? 'true' : null,
      onclick: () => {
        flush(); active = s.id;
        try { sessionStorage.setItem('hv.perfil.sec', active); } catch {}
        buildNav(); renderPanel(); panel.querySelector('h2')?.focus();
      },
    }, h('span', { class: 'sec-tab__t' }, plain(s.title)), h('span', { class: 'n' }))));
    updateNav();
  }

  const certSlot = (sec, item, field) =>
    fileSlot({ store, bag, fileId: certFileId(sec, item, field), label: field ? field.label : sec.title, dropText: 'Arrastra el certificado aquí o', preview: true });

  function photoField(sec, data, field) {
    const wrap = h('div', { class: 'mn-field field wide photo-field' }, h('span', { class: 'mn-label' }, field.label), field.hint ? h('p', { class: 'mn-help hint' }, field.hint) : null);
    const slot = fileSlot({
      store, bag, fileId: 'photo', label: field.label, accept: ACCEPT_IMAGES, buttonLabel: 'Elegir fotografía', dropText: 'Arrastra la fotografía aquí o', preview: true,
      onChange: (id) => { data[field.id] = id ? 'photo' : ''; touch(sec.id); },
      prepare: async (f) => {
        if (!f.type.startsWith('image/')) throw Object.assign(new Error('no-image'), { userMessage: 'La fotografía debe ser una imagen (JPG o PNG).' });
        let mod = null;
        try { mod = await import('../photo-editor.js'); } catch { /* editor ausente: se guarda la imagen original */ }
        if (mod && typeof mod.openPhotoEditor === 'function') {
          const out = await mod.openPhotoEditor(f, { spec: model.schema.photo });
          if (!out) return null; // cancelado
          return out instanceof File ? out : new File([out], f.name.replace(/\.\w+$/, '') + (out.type === 'image/png' ? '.png' : '.jpg'), { type: out.type || 'image/jpeg' });
        }
        return f;
      },
    });
    wrap.append(slot.el);
    return wrap;
  }

  function buildFields(sec, data, item) {
    const grid = h('div', { class: 'grid' });
    const ctrls = [];
    const entries = []; // { f, c, wrap, vis }: cada campo con su contenedor, para mostrarlo u ocultarlo según `showIf`
    // Reglas `validate` del schema: ven los demás campos del registro y el resto del perfil (p. ej. fecha de nacimiento). Nunca bloquean el guardado.
    const vctx = { get: (id) => data[id], root: (s, f) => profile[s]?.[f], others: sec.repeatable ? () => (Array.isArray(profile[sec.id]) ? profile[sec.id] : []).filter((r) => r !== data) : undefined };
    const note = h('p', { class: 'cond-note mn-help' });
    let svc = null; // tiempo servido calculado (sección con `serviceTime`): se actualiza al escribir las fechas
    // Campos condicionales (showIf): se ocultan con `hidden` (salen del orden de tabulación y del árbol de accesibilidad), sin perder su valor.
    function applyConditions(origin, announce) {
      const V = createVisibility(sections, profile);
      const shown = [], hid = [];
      let off = 0;
      for (const e of entries) {
        const vis = V.fieldVisible(sec, data, e.f);
        if (!vis) off++;
        if (vis === e.vis) continue;
        const first = e.vis === undefined;
        e.vis = vis;
        if (!vis && e.wrap.contains(document.activeElement)) (origin?.input || origin?.el)?.focus?.(); // el foco nunca se pierde en <body>
        e.wrap.hidden = !vis;
        if (vis && !first) { e.wrap.classList.add('cond-in'); e.wrap.addEventListener('animationend', () => e.wrap.classList.remove('cond-in'), { once: true }); }
        if (!vis) e.c.reset?.();
        if (!first) (vis ? shown : hid).push(e.f.label);
      }
      note.hidden = !off;
      note.replaceChildren(...(off ? [icon('info', 14), `${off} campo${off > 1 ? 's' : ''} oculto${off > 1 ? 's' : ''} según tus respuestas. Lo que ya escribiste se conserva.`] : []));
      if (announce && (shown.length || hid.length)) {
        condLive.textContent = [shown.length ? `Ahora se ${shown.length > 1 ? 'muestran' : 'muestra'}: ${shown.join(', ')}.` : '', hid.length ? `Se ${hid.length > 1 ? 'ocultaron' : 'ocultó'}: ${hid.join(', ')}.` : ''].filter(Boolean).join(' ');
      }
    }
    for (const f of sec.fields) {
      if (f.type === 'photo') { grid.append(photoField(sec, data, f)); continue; }
      const fit = model.fitLimit && ['text', 'tel', 'email', 'textarea'].includes(f.type) ? model.fitLimit(sec.id, f.id) : null;
      const c = fieldControl(f, data[f.id], (v) => {
        data[f.id] = v; if (item) item.updatedAt = new Date().toISOString(); touch(sec.id);
        if (entries.some((e) => e.f.showIf)) applyConditions(c, true);
        svc?.();
        for (const o of ctrls) if (o !== c && !o.el.closest('[hidden]')) o.revalidate?.();
      }, fit ? { ...vctx, fit } : vctx);
      ctrls.push(c);
      // Dato equivalente escrito en otro formato (docs/MODELOS.md): se muestra como marcador y es lo que se imprime si el campo queda vacío.
      const dv = !item && c.input?.tagName !== 'SELECT' && f.type !== 'checkbox' ? derivedValue(profile, sec.id, f.id) : '';
      if (dv) c.input.placeholder = `Se usará: ${dv}`;
      // Campo que reemplaza a otro en este modelo (`replaces`, p. ej. Minerva: cargoJefe en lugar de cargo): si está vacío se imprime el dato anterior.
      const old = item && f.replaces && isEmptyVal(data[f.id]) && typeof data[f.replaces] === 'string' && data[f.replaces].trim() ? data[f.replaces].trim() : '';
      if (old && c.input) c.input.placeholder = `Se usará: ${old} (dato anterior)`;
      let wrap = c.el;
      if (f.certificate && !sec.repeatable) { wrap = h('div', { class: 'field-with-cert' }, c.el, certSlot(sec, item, f).el); grid.append(wrap); }
      else grid.append(c.el);
      entries.push({ f, c, wrap });
    }
    // aria-controls: cada controlador (del mismo registro) apunta a los campos que muestra u oculta.
    const controls = new Map();
    for (const e of entries) {
      if (!e.f.showIf) continue;
      for (const ref of refsOf(e.f.showIf)) if (!ref.includes('.')) {
        if (!e.wrap.id) e.wrap.id = nextId('cnd');
        controls.set(ref, [...(controls.get(ref) || []), e.wrap.id]);
      }
    }
    for (const [ref, ids] of controls) {
      const src = entries.find((e) => e.f.id === ref);
      if (!src) continue;
      (src.c.el.tagName === 'FIELDSET' ? src.c.el : src.c.input).setAttribute('aria-controls', ids.join(' '));
    }
    if (entries.some((e) => e.f.showIf)) { grid.append(note); applyConditions(null, false); }
    if (sec.serviceTime && item) svc = serviceTimeBox(entries, data, typeof sec.serviceTime === 'string' ? sec.serviceTime : null, grid);
    return grid;
  }

  // Tiempo servido de un empleo, calculado con las fechas (service-time.js) y mostrado en vivo, de solo lectura. `manualId`: campo que, si se
  // escribe, reemplaza al calculado al imprimir (Minerva: «Total tiempo servido»; su marcador muestra el calculado). Devuelve la función que lo refresca.
  function serviceTimeBox(entries, data, manualId, grid) {
    const lid = nextId('svc');
    const out = h('output', { class: 'svc-time__v', 'aria-labelledby': lid, 'aria-live': 'polite' });
    const help = h('p', { class: 'mn-help hint svc-time__n' });
    const box = h('div', { class: 'mn-field field svc-time' }, h('span', { class: 'mn-label', id: lid }, 'Tiempo servido (calculado)'), out, help);
    const at = (id) => entries.find((e) => e.f.id === id);
    const anchor = at(manualId) || at('fechaFin') || at('fechaInicio');
    if (anchor) anchor.wrap.after(box); else grid.append(box);
    const manual = manualId ? at(manualId) : null;
    const refresh = () => {
      const v = serviceTime(data, todayIso());
      out.textContent = v || 'Sin calcular';
      help.textContent = !v ? 'Escribe la fecha de ingreso y la de retiro (o marca que es tu trabajo actual) y se calcula solo.'
        : manual && !isEmptyVal(data[manualId]) ? `Se imprimirá lo que escribiste en «${manual.f.label}»; bórralo para imprimir el calculado.`
        : manual ? `Es lo que se imprime en «${manual.f.label}». Cuenta meses completos, con las dos fechas incluidas.`
        : 'Informativo: este formato no lo pide por empleo (el total va en «Tiempo total de experiencia»). Cuenta meses completos, con las dos fechas incluidas.';
      if (manual?.c.input) manual.c.input.placeholder = v ? `Se calculará: ${v}` : '';
    };
    refresh();
    return refresh;
  }

  function renderPanel() {
    panel.replaceChildren();
    const sec = sections.find((s) => s.id === active);
    const idx = sections.indexOf(sec);
    const head = h('div', { class: 'sec-title' }, h('span', { class: 'mn-num' }, num(idx)), h('h2', { tabindex: '-1' }, plain(sec.title)));
    panel.append(head);
    if (!sec.repeatable) {
      profile[sec.id] ||= {};
      const card = h('section', { class: 'mn-card' }, buildFields(sec, profile[sec.id], null));
      if (sec.certificate) card.append(h('div', { class: 'cert-row' }, h('span', { class: 'mn-label' }, 'Certificado de la sección'), certSlot(sec, null, null).el));
      panel.append(card);
      return;
    }
    const list = h('ul', { class: 'items' });
    const items = (profile[sec.id] ||= []);
    const addText = ADD[sec.id] || 'Agregar registro';
    const addItem = () => {
      items.push({ id: uid() }); touch(sec.id); renderItems();
      list.querySelector('.item:last-child input, .item:last-child select, .item:last-child textarea')?.focus();
    };
    const addBtn = h('button', { type: 'button', class: 'mn-btn mn-btn--sm sec-title__act', onclick: addItem }, icon('plus'), addText);
    head.append(addBtn);
    const renderItems = () => {
      list.replaceChildren();
      addBtn.hidden = !items.length;
      items.forEach((it, i) => {
        const title = sec.fields.map((f) => it[f.id]).find((v) => typeof v === 'string' && v) || '';
        const label = `Registro ${i + 1}`;
        const mv = (d) => () => {
          const j = i + d; if (j < 0 || j >= items.length) return;
          [items[i], items[j]] = [items[j], items[i]]; touch(sec.id); renderItems();
        };
        const del = async () => {
          if (!confirm(`¿Eliminar ${label.toLowerCase()}${title ? ' (' + title + ')' : ''}? Se borrará también su certificado.`)) return;
          items.splice(i, 1);
          try { await store.deleteFile(certFileId(sec, it)); } catch (e) { console.error(e); }
          touch(sec.id); renderItems();
        };
        const body = [buildFields(sec, it, it)];
        if (sec.certificate) body.push(h('div', { class: 'cert-row' }, h('span', { class: 'mn-label' }, 'Certificado'), certSlot(sec, it, null).el));
        list.append(h('li', { class: 'mn-card mn-card--item item', 'data-id': it.id },
          h('div', { class: 'mn-card__head item-head' },
            h('div', { class: 'item-title' }, h('span', { class: 'mn-eyebrow' }, label), h('h3', {}, title || 'Sin título aún')),
            h('div', { class: 'item-actions' },
              h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm mn-btn--icon ico-up', disabled: i === 0 ? true : null, 'aria-label': `Subir ${label}`, onclick: mv(-1) }, icon('chevron')),
              h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm mn-btn--icon ico-down', disabled: i === items.length - 1 ? true : null, 'aria-label': `Bajar ${label}`, onclick: mv(1) }, icon('chevron')),
              h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm mn-btn--icon item-del', 'aria-label': `Eliminar ${label}`, title: 'Eliminar', onclick: del }, icon('trash')))),
          ...body));
      });
      if (!items.length) {
        list.append(h('li', { class: 'empty' }, emptyState({
          title: `Aún no hay ${plain(sec.title).toLowerCase()}`,
          text: 'Agrega el primer registro; luego podrás reordenarlo o quitarlo.',
          action: h('button', { type: 'button', class: 'mn-btn mn-btn--primary', onclick: addItem }, icon('plus'), addText),
        })));
      }
      updateNav();
    };
    renderItems();
    panel.append(list);
  }

  el.replaceChildren(h('div', { class: 'perfil' },
    pageHead({ eyebrow: 'Perfil', title: 'Cuéntanos quién eres', text: 'Escribe una vez; úsalo en todos tus formatos. Todo se guarda en este equipo.', aside: h('div', {}, status, live, condLive) }),
    h('div', { class: 'perfil-grid' }, nav, panel)));
  buildNav(); renderPanel();

  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);
  addEventListener('pagehide', flush);
  return () => {
    flush();
    document.removeEventListener('visibilitychange', onHide);
    removeEventListener('pagehide', flush);
    bag.revokeAll();
  };
}
