import { h, icon, pageHead, emptyState, toast } from '../ui.js';
import { newTemplate, templateMaxAge } from '../template-model.js';
import { uid, certFileId, nextId } from '../forms.js';
import { SOURCES, shownDocIds } from '../doc-sources.js';
import { docVigencia, vigenciaWarning, validMaxAge } from '../doc-parse.js';
import { docSelected, docFlag, certGaps, fieldIncluded } from '../template-check.js';
import { pruneProfile, createVisibility } from '../conditions.js';
import { registry, templatesFor, templateModelId } from '../models/index.js';

const has = (v) => v != null && v !== '' && v !== false;
const on = (map, k) => map?.[k] !== false; // ausente = incluido

/** Vista "Plantillas": CRUD de plantillas que eligen qué datos del aspirante entran a la HV. */
export function mount(el, ctx) {
  const { model, store, router } = ctx;
  const sections = model.schema.sections;
  const allDocs = model.schema.documents || [];
  let draft = null, isNew = false, fileIds = new Set(), fileMeta = {}, alive = true;

  const profile = () => store.getProfile();
  // Perfil solo con lo que aplica según las respuestas (campos con showIf oculto fuera): lo que cuenta para datos y certificados pendientes.
  const applicable = () => pruneProfile(sections, profile()).profile;
  // Ids de los documentos que la persona muestra en Documentos (ver profile.documentsShown). El editor lista TODOS los disponibles:
  // los ocultos llevan una etiqueta y, si se marcan, la plantilla los anexa (G27).
  const shownSet = () => new Set(shownDocIds(profile(), allDocs.map((d) => d.id)));
  const selectedDocs = (t) => { const s = shownSet(); return allDocs.filter((d) => docSelected(t, d.id, s)); };
  const vigOpts = (t) => ({ maxAgeDays: templateMaxAge(t) });
  const listFields = (s) => s.fields.filter((f) => f.type !== 'photo');
  const itemsOf = (s) => (s.repeatable ? (profile()[s.id] || []) : []);
  const itemLabel = (s, it, i) => {
    const keys = [...s.fields.filter((f) => f.required).map((f) => f.id), 'institucion'];
    let parts = [...new Set(keys)].map((k) => it[k]).filter((v) => typeof v === 'string' && v).slice(0, 2);
    if (!parts.length) parts = s.fields.map((f) => it[f.id]).filter((v) => typeof v === 'string' && v).slice(0, 1);
    return parts.length ? parts.join(' · ') : `Registro ${i + 1} (vacío)`;
  };
  const sectionHasData = (s) => (s.repeatable ? (applicable()[s.id] || []).length > 0 : Object.values(applicable()[s.id] || {}).some(has));
  const docUploaded = (d) => (profile().documents?.[d.id] || []).length > 0;
  const hasAnyData = () => sections.some(sectionHasData);

  function counts(t) {
    let secs = 0, items = 0;
    for (const s of sections) {
      if (!on(t.include.sections, s.id)) continue;
      secs++;
      for (const it of itemsOf(s)) if (on(t.include.items, it.id)) items++;
    }
    const dcount = selectedDocs(t).length;
    return { secs, items, dcount };
  }

  function warnings(t) {
    const out = [];
    // Documentos seleccionados (también los ocultos en Documentos): sin archivo, o con vigencia vencida / por vencer
    // (con el límite de antigüedad de esta plantilla si lo tiene).
    const shown = shownSet();
    for (const d of selectedDocs(t)) {
      const ids = profile().documents?.[d.id] || [];
      const hid = shown.has(d.id) ? '' : ' (oculto en Documentos)';
      if (!ids.some((id) => fileIds.has(id))) { if (docFlag(t, d.id) === true) out.push(`Documento ${d.label}${hid}: seleccionado pero sin archivos cargados.`); continue; }
      const v = docVigencia(SOURCES[d.id], ids, fileMeta, new Date(), vigOpts(t));
      if (v && (v.state === 'vencido' || v.state === 'por_vencer')) out.push(vigenciaWarning(d.label + hid, v));
    }
    // Certificados que la plantilla promete y no existen: registros repetibles, campos con certificado (libreta, licencia, título) y secciones simples.
    for (const g of certGaps(sections, t, applicable(), (id) => fileIds.has(id))) {
      const s = sections.find((x) => x.id === g.secId);
      if (g.kind === 'item') out.push(`${s.title}: "${itemLabel(s, g.item, g.index)}" no tiene certificado cargado.`);
      else if (g.kind === 'field') out.push(`${s.title}: el certificado de "${g.label}" no está cargado.`);
      else out.push(`${s.title}: falta el certificado de la sección.`);
    }
    return out;
  }

  const root = h('div', { class: 'plantillas' });
  el.replaceChildren(root);

  // ---------- Lista ----------
  function renderList() {
    draft = null;
    // Cada plantilla es de un formato (template.modelId): aquí solo las del formato activo; las demás se ven al cambiar el selector del encabezado.
    const all = store.getTemplates(), list = templatesFor(all, model.id);
    const others = all.filter((t) => templateModelId(t) !== model.id);
    const otherNames = [...new Set(others.map((t) => registry[templateModelId(t)]?.name).filter(Boolean))];
    const q = (t) => encodeURIComponent(t.id);
    const cards = list.length
      ? h('ul', { class: 'tpl-list' }, list.map((t) => {
        const c = counts(t);
        return h('li', { class: 'mn-card tpl-card', 'data-id': t.id },
          h('span', { class: 'mn-eyebrow' }, t.jobType || 'Sin tipo de cargo'),
          h('h2', {}, t.name || 'Sin nombre'),
          h('p', { class: 'tpl-counts' }, `${c.secs} secciones · ${c.items} registros · ${c.dcount} documentos`),
          h('div', { class: 'tpl-actions' },
            h('button', { type: 'button', class: 'mn-btn mn-btn--sm', onclick: () => startEdit(t), 'aria-label': `Editar plantilla: ${t.name || 'Sin nombre'}` }, 'Editar'),
            h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm', onclick: () => duplicate(t), 'aria-label': `Duplicar plantilla: ${t.name || 'Sin nombre'}` }, 'Duplicar'),
            h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm', onclick: () => router.go('/vista-previa?template=' + q(t)), 'aria-label': `Vista previa: ${t.name || 'Sin nombre'}` }, 'Vista previa'),
            h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm', onclick: () => router.go('/vista-previa?template=' + q(t) + '&print=1'), 'aria-label': `Imprimir: ${t.name || 'Sin nombre'}` }, 'Imprimir'),
            h('button', { type: 'button', class: 'mn-btn mn-btn--danger mn-btn--quiet mn-btn--sm', onclick: () => remove(t), 'aria-label': `Eliminar plantilla: ${t.name || 'Sin nombre'}` }, 'Eliminar')));
      }))
      : emptyState({
        level: 2,
        title: 'Aún no hay plantillas propias',
        text: hasAnyData()
          ? 'Crea una para elegir qué información va en cada hoja de vida, por ejemplo una por tipo de cargo.'
          : 'Primero completa tus datos en el perfil; luego podrás crear plantillas con ellos.',
        action: hasAnyData()
          ? h('button', { type: 'button', class: 'mn-btn mn-btn--primary', onclick: startNew }, icon('plus'), 'Crear plantilla')
          : h('a', { class: 'mn-btn mn-btn--primary', href: '#/perfil' }, 'Ir a Perfil'),
      });
    root.replaceChildren(
      pageHead({
        eyebrow: 'Plantillas', title: 'Tus formatos', text: 'Elige qué secciones llevará cada formato.',
        aside: h('button', { type: 'button', class: 'mn-btn' + (list.length ? ' mn-btn--primary' : ''), onclick: startNew }, icon('plus'), 'Nueva plantilla'),
      }),
      h('div', { class: 'tpl-body' },
        !hasAnyData() && list.length ? h('p', { class: 'mn-help' }, 'Tu perfil aún no tiene datos. ', h('a', { href: '#/perfil' }, 'Completa tu perfil')) : null,
        others.length ? h('p', { class: 'mn-help tpl-others' }, `Formato activo: ${model.name}. Hay ${others.length} plantilla(s) de otro formato${otherNames.length ? ' (' + otherNames.join(', ') + ')' : ''}: elígelo en el selector «Modelo» del encabezado para verlas.`) : null,
        cards));
  }

  // Tras guardar, cancelar, duplicar o eliminar el foco vuelve al título (si no, se pierde al reemplazar el DOM).
  function backToList() { renderList(); root.querySelector('h1')?.focus(); }
  function duplicate(t) {
    const copy = structuredClone(t);
    const now = new Date().toISOString();
    Object.assign(copy, { id: uid(), name: (t.name || 'Plantilla') + ' (copia)', createdAt: now, updatedAt: now });
    store.saveTemplate(copy);
    backToList();
    toast('Plantilla duplicada.');
  }
  function remove(t) {
    if (!confirm(`¿Eliminar la plantilla "${t.name || 'Sin nombre'}"? Esta acción no se puede deshacer.`)) return;
    store.deleteTemplate(t.id);
    backToList();
    toast('Plantilla eliminada.');
  }
  async function open(t, fresh) {
    try { const list = await store.listFiles(); fileIds = new Set(list.map((f) => f.id)); fileMeta = Object.fromEntries(list.map((f) => [f.id, f.meta || {}])); } catch { fileIds = new Set(); fileMeta = {}; }
    if (!alive) return;
    draft = t; isNew = fresh; renderEdit();
  }
  // Una plantilla nueva solo marca los documentos mostrados (no agrega en silencio los ocultos).
  const startNew = () => {
    const t = newTemplate(model), s = shownSet();
    t.include.documents = Object.fromEntries(allDocs.map((d) => [d.id, s.has(d.id)]));
    return open(t, true);
  };
  // Plantillas anteriores: sin bandera para un documento = solo si está mostrado (comportamiento previo); se fija de forma explícita.
  const startEdit = (t) => {
    const c = structuredClone(t), s = shownSet();
    c.include.documents ??= {};
    for (const d of allDocs) if (typeof c.include.documents[d.id] !== 'boolean') c.include.documents[d.id] = s.has(d.id);
    return open(c, false);
  };

  // ---------- Edición ----------
  function renderEdit() {
    const t = draft;
    const summary = h('div', { class: 'mn-card tpl-summary', role: 'status', 'aria-live': 'polite' });
    const nameErr = h('p', { class: 'mn-error field-err', id: 'tpl-name-err', role: 'alert' });
    const updateSummary = () => {
      const c = counts(t), w = warnings(t);
      summary.replaceChildren(
        h('span', { class: 'mn-eyebrow' }, 'Resumen'),
        h('p', {}, `${c.secs} secciones · ${c.items} registros · ${c.dcount} documentos${t.options.showPhoto && model.features?.photo !== false ? ' · con foto' : ''}`),
        ...(w.length ? [h('ul', { class: 'tpl-warn' }, w.map((x) => h('li', {}, icon('alert', 14), 'Advertencia: ' + x)))] : []));
    };

    const nameIn = h('input', { id: 'tpl-name', class: 'mn-input', type: 'text', value: t.name, required: true, 'aria-describedby': 'tpl-name-err', maxlength: 80, oninput: (e) => { t.name = e.target.value; } });
    const jobIn = h('input', { id: 'tpl-job', class: 'mn-input', type: 'text', value: t.jobType, maxlength: 80, placeholder: 'Ej.: Auxiliar administrativo', oninput: (e) => { t.jobType = e.target.value; } });

    const checkbox = (label, checked, onchange) => {
      const cb = h('input', { type: 'checkbox', checked: checked ? true : null, onchange: (e) => { onchange(e.target.checked); updateSummary(); } });
      return { cb, el: h('label', { class: 'chk mn-check' }, cb, label) };
    };

    const tree = sections.map((s) => {
      const items = itemsOf(s), fields = listFields(s);
      const inc = on(t.include.sections, s.id);
      const body = h('div', { class: 'tpl-sec-body' });
      const secBox = checkbox(s.title, inc, (v) => { t.include.sections[s.id] = v; body.hidden = !v; });
      const itemBoxes = [], fieldBoxes = [];
      const setAll = (v) => {
        t.include.sections[s.id] = v; secBox.cb.checked = v; body.hidden = !v;
        for (const b of itemBoxes) { b.cb.checked = v; t.include.items[b.id] = v; }
        for (const b of fieldBoxes) { b.cb.checked = v; t.include.fields[b.key] = v; }
        updateSummary();
      };
      if (s.repeatable) {
        if (!items.length) body.append(h('p', { class: 'mn-help' }, 'Sin registros en el perfil. ', h('a', { href: '#/perfil' }, 'Agregar en Perfil')));
        else {
          const ul = h('ul', { class: 'tpl-items' });
          items.forEach((it, i) => {
            const b = checkbox(itemLabel(s, it, i), on(t.include.items, it.id), (v) => { t.include.items[it.id] = v; });
            b.id = it.id; itemBoxes.push(b);
            const missing = s.certificate && !fileIds.has(certFileId(s, it));
            ul.append(h('li', {}, b.el, missing ? h('span', { class: 'mn-badge mn-badge--warn' }, 'Sin certificado') : null));
          });
          body.append(ul);
        }
      } else if (!sectionHasData(s)) body.append(h('p', { class: 'mn-help' }, 'Sin datos en el perfil. ', h('a', { href: '#/perfil' }, 'Completar en Perfil')));
      if (fields.length) {
        const wrap = h('div', { class: 'tpl-fields' });
        const data = s.repeatable ? null : (applicable()[s.id] || {});
        const V = createVisibility(sections, profile());
        // Campo condicional (showIf) que hoy no aplica: sigue en la lista (la elección de la plantilla se conserva) pero marcado y sin avisos.
        const naNow = (f) => !!f.showIf && (s.repeatable ? itemsOf(s).length > 0 && itemsOf(s).every((it) => !V.fieldVisible(s, it, f)) : !V.fieldVisible(s, profile()[s.id] || {}, f));
        for (const f of fields) {
          const key = `${s.id}.${f.id}`;
          const b = checkbox(f.label, fieldIncluded(t, s.id, f), (v) => { t.include.fields[key] = v; });
          b.key = key; fieldBoxes.push(b);
          const na = naNow(f);
          const noCert = !na && f.certificate && data && has(data[f.id]) && !fileIds.has(certFileId(s, null, f));
          wrap.append(h('span', { class: 'tpl-field' + (na ? ' is-na' : data && !has(data[f.id]) ? ' is-empty' : '') }, b.el,
            na ? h('span', { class: 'mn-badge', title: 'No aplica según las respuestas de tu perfil; no se imprime ni se cuenta como pendiente.' }, 'Condicional: no aplica') : null,
            noCert ? h('span', { class: 'mn-badge mn-badge--warn' }, 'Sin certificado') : null));
        }
        body.append(h('details', { class: 'tpl-fd' }, h('summary', {}, s.repeatable ? 'Campos de cada registro' : 'Campos'), wrap));
      }
      body.hidden = !inc;
      return h('section', { class: 'mn-card tpl-sec', 'data-sec': s.id },
        h('div', { class: 'tpl-sec-head' }, secBox.el,
          !s.repeatable && s.certificate && sectionHasData(s) && !fileIds.has(certFileId(s, null, null)) ? h('span', { class: 'mn-badge mn-badge--warn' }, 'Sin certificado') : null,
          h('span', { class: 'tpl-sec-btns' },
            h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm', onclick: () => setAll(true), 'aria-label': `Todo: ${s.title}` }, 'Todo'),
            h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm', onclick: () => setAll(false), 'aria-label': `Ninguno: ${s.title}` }, 'Ninguno'))),
        body);
    });

    const docHost = h('div', { class: 'tpl-docs' });
    const renderDocs = () => {
      const shown = shownSet();
      docHost.replaceChildren(
        h('p', { class: 'mn-help' }, 'Se listan todos los documentos disponibles. Los marcados «oculto en Documentos» no están en tu lista de Documentos: si los eliges aquí, la plantilla los anexa cuando tengan archivos y avisa cuando no los tengan. ', h('a', { href: '#/documentos' }, 'Ir a Documentos')),
        h('ul', { class: 'tpl-items' }, allDocs.map((d) => {
          const up = docUploaded(d);
          const b = checkbox(d.label, docSelected(t, d.id, shown), (v) => { t.include.documents[d.id] = v; });
          const v = up ? docVigencia(SOURCES[d.id], profile().documents?.[d.id], fileMeta, new Date(), vigOpts(t)) : null;
          const bad = v && (v.state === 'vencido' || v.state === 'por_vencer');
          return h('li', { 'data-doc': d.id }, b.el, shown.has(d.id) ? null : h('span', { class: 'mn-badge doc-hidden' }, 'oculto en Documentos'),
            h('span', { class: 'mn-badge ' + (up ? 'mn-badge--ok' : 'mn-badge--warn') }, ...(up ? [icon('check', 12), 'Listo'] : ['Pendiente'])),
            bad ? h('span', { class: 'mn-badge vig ' + (v.state === 'vencido' ? 'mn-badge--danger' : 'mn-badge--warn') }, icon(v.state === 'vencido' ? 'x' : 'alert', 12), v.label) : null);
        })));
    };
    renderDocs();
    const docList = docHost;

    // Antigüedad máxima de los documentos con vigencia (G20): vacío = la regla de cada documento.
    const maxId = nextId('maxage'), maxNId = nextId('maxagen');
    const curMax = templateMaxAge(t);
    const maxSel = h('select', { id: maxId, class: 'mn-select', 'aria-describedby': maxId + '-help' },
      h('option', { value: '' }, 'La regla de cada documento'), ...[30, 60, 90].map((n) => h('option', { value: String(n) }, `${n} días`)), h('option', { value: 'otro' }, 'Otro valor…'));
    maxSel.value = curMax == null ? '' : [30, 60, 90].includes(curMax) ? String(curMax) : 'otro';
    const maxNum = h('input', { id: maxNId, class: 'mn-input', type: 'number', min: 1, max: 365, inputmode: 'numeric', 'aria-label': 'Días de antigüedad máxima', hidden: maxSel.value === 'otro' ? null : true });
    maxNum.value = curMax != null && maxSel.value === 'otro' ? String(curMax) : '';
    const maxErr = h('p', { class: 'mn-error field-err', role: 'alert' });
    const setMax = (n) => { if (n == null) delete t.options.maxAgeDays; else t.options.maxAgeDays = n; renderDocs(); updateSummary(); };
    maxSel.addEventListener('change', () => {
      maxErr.replaceChildren(); maxNum.setAttribute('aria-invalid', 'false');
      maxNum.hidden = maxSel.value !== 'otro';
      if (maxSel.value === '') setMax(null);
      else if (maxSel.value === 'otro') { maxNum.focus(); setMax(validMaxAge(maxNum.value)); }
      else setMax(Number(maxSel.value));
    });
    maxNum.addEventListener('input', () => {
      const n = validMaxAge(maxNum.value);
      maxErr.replaceChildren(...(maxNum.value && n == null ? [icon('alert', 14), 'Escribe un número de días entre 1 y 365.'] : []));
      maxNum.setAttribute('aria-invalid', maxNum.value && n == null ? 'true' : 'false');
      setMax(n);
    });
    const maxField = h('div', { class: 'mn-field field wide' },
      h('label', { for: maxId, class: 'mn-label' }, 'Antigüedad máxima de los documentos con vigencia'),
      h('div', { class: 'tpl-maxage' }, maxSel, maxNum),
      h('p', { class: 'mn-help', id: maxId + '-help' }, 'Úsalo si quien recibe la hoja de vida pide, por ejemplo, antecedentes de máximo 30 días. Se cuenta desde la fecha de expedición. En judiciales, RNMC y fiscales reemplaza los días de referencia; en disciplinarios y REDAM solo puede acortar el límite de la norma citada (no lo alarga; la vista previa y Documentos lo dicen). No afecta a documentos sin vigencia, como la cédula. La vigencia real la define la entidad.'),
      maxErr);

    const optBox = (key, label) => checkbox(label, t.options[key], (v) => { t.options[key] = v; }).el;
    const objective = h('textarea', { id: 'tpl-obj', class: 'mn-textarea', rows: 4, placeholder: 'Opcional. Si se deja vacío se usa el perfil profesional.', oninput: (e) => { t.options.objective = e.target.value; } });
    objective.value = t.options.objective || '';

    const save = () => {
      if (!t.name.trim()) { nameErr.replaceChildren(icon('alert', 14), 'Falta el nombre: escribe uno para poder guardar la plantilla.'); nameIn.setAttribute('aria-invalid', 'true'); nameIn.focus(); return; }
      t.name = t.name.trim(); t.jobType = t.jobType.trim(); t.updatedAt = new Date().toISOString();
      for (const s of sections) {
        t.include.sections[s.id] = on(t.include.sections, s.id);
        for (const it of itemsOf(s)) t.include.items[it.id] = on(t.include.items, it.id);
        for (const f of listFields(s)) t.include.fields[`${s.id}.${f.id}`] = fieldIncluded(t, s.id, f);
      }
      const sh = shownSet();
      for (const d of allDocs) t.include.documents[d.id] = docSelected(t, d.id, sh);
      if (validMaxAge(t.options.maxAgeDays) == null) delete t.options.maxAgeDays; else t.options.maxAgeDays = validMaxAge(t.options.maxAgeDays);
      store.saveTemplate(t);
      backToList();
      toast('Plantilla guardada.');
    };

    const secTitle = (n, text) => h('div', { class: 'sec-title' }, h('span', { class: 'mn-num' }, n), h('h2', {}, text));
    root.replaceChildren(
      pageHead({ eyebrow: 'Plantillas', title: isNew ? 'Nueva plantilla' : 'Editar plantilla', text: 'Elige qué información de tu perfil llevará esta hoja de vida.' }),
      h('form', { class: 'tpl-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
        h('section', { class: 'mn-card grid' },
          h('div', { class: 'mn-field field' }, h('label', { for: 'tpl-name', class: 'mn-label' }, 'Nombre ', h('span', { class: 'mn-req req' }, '*')), nameIn, nameErr),
          h('div', { class: 'mn-field field' }, h('label', { for: 'tpl-job', class: 'mn-label' }, 'Tipo de cargo'), jobIn)),
        !hasAnyData() ? h('div', { class: 'mn-card empty-state' }, h('p', {}, 'Tu perfil aún no tiene datos para incluir. ', h('a', { href: '#/perfil' }, 'Ir a Perfil'))) : null,
        secTitle('01', 'Información a incluir'), h('div', { class: 'stack' }, ...tree),
        secTitle('02', 'Documentos adjuntos'), h('section', { class: 'mn-card' }, docList),
        secTitle('03', 'Opciones'),
        h('section', { class: 'mn-card tpl-opts' },
          // Opciones que el formato no tiene (el Formato Único no lleva foto ni objetivo: model.features) no se ofrecen.
          model.features?.photo === false ? null : optBox('showPhoto', 'Mostrar fotografía'),
          optBox('attachCertificates', 'Adjuntar certificados'),
          optBox('attachDocuments', 'Adjuntar documentos'),
          maxField,
          model.features?.objective === false ? null : h('div', { class: 'mn-field field wide' }, h('label', { for: 'tpl-obj', class: 'mn-label' }, 'Objetivo / perfil (sustituye al perfil profesional)'), objective)),
        summary,
        h('div', { class: 'tpl-actions sticky' },
          h('button', { type: 'submit', class: 'mn-btn mn-btn--primary' }, 'Guardar plantilla'),
          h('button', { type: 'button', class: 'mn-btn mn-btn--quiet', onclick: backToList }, 'Cancelar'))));
    updateSummary();
    nameIn.focus();
  }

  renderList();
  return () => { alive = false; };
}
