import { h, icon, pageHead, emptyState, toast } from '../ui.js';
import { fileSlot, urlBag, nextId } from '../forms.js';
import { SOURCES, VIGENCIA_AVISO, VIGENCIA_BASIS, EMPLOYER_LABEL, EMPLOYER_CHIP_NO, CONFIANZA_LABEL, LEGAL_STATUS_LABEL, DISCLAIMER, shownDocIds } from '../doc-sources.js';
import { computeVigencia, summarizeVigencia, normCedula, cedulaMatch, fmtDMY } from '../doc-parse.js';
import { templateMaxAge } from '../template-model.js';
import { analyzeFile } from '../pdf-ingest.js';
import { templatesFor } from '../models/index.js';

const STATE_ICON = { vigente: 'check', por_vencer: 'alert', vencido: 'x', sin_vigencia: 'clock', no_leido: 'alert' };
const STATE_CLASS = { vigente: 'mn-badge--ok', por_vencer: 'mn-badge--warn', vencido: 'mn-badge--danger', sin_vigencia: '', no_leido: 'mn-badge--warn' };
const FALLO = {
  imagen: 'Es una imagen: no se lee sola. Escribe la fecha de expedición.',
  sin_texto: 'El PDF no trae texto (parece escaneado). Escribe la fecha de expedición.',
  sin_fecha: 'No se encontró una fecha en el PDF. Escríbela a mano.',
  error_pdf: 'No se pudo leer el PDF en este equipo. Escribe la fecha de expedición.',
};
const ESTADO = { sin_registros: 'No registra', registra: 'Registra (revisa el documento)' };

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* sin permiso: se prueba el método clásico */ }
  const ta = h('textarea', { 'aria-hidden': 'true', tabindex: '-1', style: 'position:fixed;opacity:0;left:-1000px' });
  ta.value = text; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* nada */ }
  ta.remove(); return ok;
}

/** Vista "Documentos": uno o varios slots (páginas/caras) por documento mostrado.
 *  Archivos: doc:<id>, doc:<id>:2, ...; lista en profile.documents[docId] = [fileIds].
 *  Documentos visibles: profile.documentsShown (ausente = conjunto base + los que ya tienen archivos). */
export function mount(el, ctx) {
  const { model, store } = ctx;
  const all = model.schema.documents;
  const allIds = all.map((d) => d.id);
  const bag = urlBag();
  let alive = true;
  const summary = h('p', { class: 'summary mn-sr', role: 'status', 'aria-live': 'polite' });
  const countNum = h('span', { class: 'doc-count__n' });
  const stamp = h('span', { class: 'mn-stamp', 'aria-hidden': 'true' });
  const fill = h('i');
  const bar = h('div', { class: 'mn-progress progress', role: 'progressbar', 'aria-valuemin': 0 }, fill);
  const banner = h('div', { class: 'pv-banner doc-banner', role: 'status', hidden: true });
  const toolbar = h('div', { class: 'doc-toolbar' });
  const listHost = h('div', {});
  // Aviso legal (docs/VERIFICACION-LEGAL.md, sección 7): compacto y descartable; el descarte vale solo para esta sesión.
  const DISC_KEY = 'hv.docs.disclaimer';
  let discHidden = false;
  try { discHidden = sessionStorage.getItem(DISC_KEY) === '1'; } catch { /* sin almacenamiento: se muestra */ }
  const discHost = h('div', { class: 'doc-disclaimer-host' });
  let rows = new Map();

  const profile = () => store.getProfile();
  // Plantilla con la que se evalúa la vigencia (G20): si fija una antigüedad máxima, el semáforo y el resumen la usan. Solo se recuerda en esta sesión.
  let tplId = '';
  try { tplId = sessionStorage.getItem('hv.docs.tpl') || ''; } catch { /* sin almacenamiento */ }
  const tplList = () => templatesFor(store.getTemplates(), model.id);
  const tplCur = () => tplList().find((t) => t.id === tplId) || null;
  const vigOpts = () => ({ maxAgeDays: templateMaxAge(tplCur()) });
  const tplBox = h('div', { class: 'doc-tpl' });
  const ids = (d) => profile().documents?.[d] || [];
  const setIds = (d, arr) => store.updateProfile({ documents: { ...(profile().documents || {}), [d]: arr } });
  const shownList = () => { const s = new Set(shownDocIds(profile(), allIds)); return all.filter((d) => s.has(d.id)); };
  const cedula = () => normCedula(profile().personales?.numeroDocumento);
  // Los documentos que solo tiene otro formato (p. ej. bienes y rentas del Formato Único) conservan su estado al editar la lista en este.
  const setShown = (idList) => {
    const cur = profile().documentsShown, docs = profile().documents || {};
    const prev = Array.isArray(cur) ? cur : Object.keys(docs).filter((id) => Array.isArray(docs[id]) && docs[id].length); // sin lista: los que tienen archivos
    const keep = prev.filter((id) => !allIds.includes(id));
    store.updateProfile({ documentsShown: [...keep, ...allIds.filter((id) => idList.includes(id))] });
  };

  function renderDisclaimer() {
    discHost.replaceChildren();
    if (discHidden) return;
    const tid = nextId('discl');
    discHost.append(h('div', { class: 'doc-disclaimer', role: 'note', 'aria-labelledby': tid },
      icon('info', 16),
      h('div', { class: 'doc-disclaimer__body' },
        h('p', {}, h('strong', { id: tid }, DISCLAIMER.title), ' Cada entidad o convocatoria define qué soportes exige; verifica siempre con quien te contrata.'),
        h('details', { class: 'doc-disclaimer__more' }, h('summary', {}, 'Leer el aviso completo'), h('p', {}, DISCLAIMER.body))),
      h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm doc-disclaimer__close', 'aria-label': 'Ocultar el aviso legal durante esta sesión', onclick: () => {
        discHidden = true;
        try { sessionStorage.setItem(DISC_KEY, '1'); } catch { /* sin almacenamiento */ }
        renderDisclaimer();
        document.getElementById('doc-add')?.focus();
      } }, icon('x', 12), 'Ocultar')));
  }

  // ---------- Resumen y avance ----------
  async function metasOf(docs) {
    const out = {};
    const files = await store.listFiles().catch(() => []);
    const byId = new Map(files.map((f) => [f.id, f.meta || {}]));
    for (const d of docs) for (const id of ids(d.id)) if (byId.has(id)) out[id] = byId.get(id);
    return out;
  }
  async function updateBanner() {
    const docs = shownList();
    const sum = summarizeVigencia(docs, profile(), await metasOf(docs), new Date(), vigOpts());
    if (!alive) return;
    const dated = docs.some((d) => ids(d.id).length && SOURCES[d.id]?.vigencia?.tipo !== 'ninguna');
    banner.replaceChildren();
    banner.hidden = !(sum.vencidos.length || sum.porVencer.length || sum.noLeidos.length || dated);
    if (banner.hidden) return;
    const bad = sum.vencidos.length, warn = sum.porVencer.length || sum.noLeidos.length;
    banner.className = 'pv-banner doc-banner' + (bad ? ' danger' : warn ? '' : ' ok');
    const body = h('div', { class: 'pv-banner__body' });
    const li = (x) => h('li', {}, `${x.label}: ${x.v.state === 'vencido' ? 'vencido' : x.v.label.toLowerCase()}.`);
    if (bad || warn) {
      body.append(h('strong', {}, [bad ? `${bad} vencido${bad === 1 ? '' : 's'}` : '', sum.porVencer.length ? `${sum.porVencer.length} por vencer` : '', sum.noLeidos.length ? `${sum.noLeidos.length} sin fecha` : ''].filter(Boolean).join(' · ')),
        h('ul', {}, [...sum.vencidos, ...sum.porVencer, ...sum.noLeidos].map(li)));
    } else body.append('Los documentos con vigencia están al día.');
    const mx = templateMaxAge(tplCur());
    body.append(h('p', { class: 'pv-help' }, (mx ? `Evaluado con la plantilla «${tplCur().name || 'Sin nombre'}»: documentos de máximo ${mx} días desde su expedición. ` : '') + VIGENCIA_AVISO));
    banner.append(icon(bad || warn ? 'alert' : 'check', 16), body);
  }

  function progress() {
    const docs = shownList();
    const n = docs.filter((d) => ids(d.id).length).length;
    const pct = docs.length ? Math.round((n / docs.length) * 100) : 0;
    summary.textContent = `${n} de ${docs.length} documentos cargados`;
    countNum.replaceChildren(String(n), h('span', {}, ` / ${docs.length}`));
    stamp.textContent = `${pct}%`;
    bar.setAttribute('aria-valuemax', docs.length);
    bar.setAttribute('aria-valuenow', n);
    bar.setAttribute('aria-label', summary.textContent);
    bar.style.setProperty('--value', `${pct}%`);
    for (const d of docs) {
      const r = rows.get(d.id); if (!r) continue;
      const ok = ids(d.id).length > 0;
      r.li.dataset.state = ok ? 'done' : 'pending';
      r.mark.replaceChildren(...(ok ? [icon('check', 14)] : []));
      r.badge.className = 'mn-badge ' + (ok ? 'mn-badge--ok' : 'mn-badge--warn');
      r.badge.replaceChildren(...(ok ? [icon('check', 12), 'Listo'] : ['Pendiente']));
    }
    updateBanner();
  }

  // ---------- Panel de vigencia de un archivo ----------
  async function renderPanel(fileId, d, panel) {
    const rec = await store.getFile(fileId).catch(() => null);
    if (!alive) return;
    panel.replaceChildren();
    if (!rec) return;
    const src = SOURCES[d.id], m = rec.meta || {};
    const v = computeVigencia(src, m, new Date(), vigOpts());
    const chip = h('span', { class: `mn-badge vig vig--${v.state} ${STATE_CLASS[v.state]}` }, icon(STATE_ICON[v.state], 12), v.label);
    const facts = [];
    if (m.emitidoEn) facts.push(`Expedido: ${fmtDMY(m.emitidoEn)}${m.fechaManual ? ' (corregido a mano)' : m.fechaConfianza === 'baja' ? ' (detectado con poca seguridad: revísalo)' : ' (leído del PDF)'}`);
    if (m.validaHasta) facts.push(`Válida hasta: ${fmtDMY(m.validaHasta)} (impreso en el PDF)`);
    if (m.codigo) facts.push(`Código: ${m.codigo}`);
    if (m.estado) facts.push(`Estado: ${ESTADO[m.estado]}`);
    const top = h('div', { class: 'vig-row' }, chip, v.detail && v.state !== 'sin_vigencia' ? h('span', { class: 'vig-detail' }, v.detail) : null);
    panel.append(top);
    if (src && src.vigencia.tipo !== 'ninguna' && v.basis && v.state !== 'sin_vigencia') panel.append(h('p', { class: 'mn-help vig-basis' }, 'Regla aplicada: ' + (v.basis === 'plantilla' ? 'límite de la plantilla.' : (VIGENCIA_BASIS[v.basis] || '') + '.')));
    if (facts.length) panel.append(h('ul', { class: 'vig-facts' }, facts.map((x) => h('li', {}, x))));
    const match = cedulaMatch(m.cedulasLeidas, profile().personales?.numeroDocumento);
    if (match === false) {
      const last = (m.cedulasLeidas?.[0] || '').slice(-4);
      panel.append(h('p', { class: 'mn-error vig-warn', role: 'alert' }, icon('alert', 14),
        `La cédula que aparece en el PDF (termina en ${last}) no coincide con la de tu perfil. Comprueba que sea tu documento.`));
    } else if (match === true) panel.append(h('p', { class: 'vig-ok' }, icon('check', 14), 'La cédula del PDF coincide con tu perfil.'));
    if (m.lectura === 'fallo' && src?.vigencia?.tipo !== 'ninguna') panel.append(h('p', { class: 'mn-help vig-note' }, FALLO[m.motivo] || FALLO.sin_fecha));
    if (src && src.vigencia.tipo !== 'ninguna') {
      const idD = nextId('vdate'), idN = nextId('vdias');
      const dateIn = h('input', { id: idD, class: 'mn-input', type: 'date', value: m.emitidoEn || '', max: new Date().toISOString().slice(0, 10) });
      const edit = async (patch, msg) => { await store.updateFileMeta(fileId, patch); toast(msg); await renderPanel(fileId, d, panel); updateBanner(); };
      dateIn.addEventListener('change', () => edit({ emitidoEn: dateIn.value || null, validaHasta: null, fechaManual: !!dateIn.value, fechaConfianza: null, lectura: dateIn.value ? 'manual' : m.lectura }, dateIn.value ? 'Fecha de expedición actualizada.' : 'Fecha borrada.'));
      const ctrls = [h('div', { class: 'mn-field field' }, h('label', { for: idD, class: 'mn-label' }, 'Fecha de expedición (corregir)'), dateIn)];
      if (src.vigencia.tipo === 'practica') {
        const nIn = h('input', { id: idN, class: 'mn-input', type: 'number', min: 1, max: 365, inputmode: 'numeric', value: String(v.dias ?? src.vigencia.dias) });
        nIn.addEventListener('change', () => { const n = Math.round(Number(nIn.value)); if (n >= 1 && n <= 365) edit({ vigenciaDias: n }, 'Días de vigencia actualizados.'); else nIn.value = String(v.dias); });
        ctrls.push(h('div', { class: 'mn-field field' }, h('label', { for: idN, class: 'mn-label' }, 'Vigencia que exige la entidad (días)'), nIn));
      }
      panel.append(h('div', { class: 'vig-ctrls' }, ctrls));
    }
  }

  // ---------- Fila ----------
  function sourceBlock(d) {
    const s = SOURCES[d.id];
    if (!s) return null;
    const actions = [];
    if (s.url) actions.push(h('a', { class: 'mn-btn mn-btn--sm', href: s.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Abrir sitio oficial', h('span', { class: 'mn-sr' }, ' (se abre en una pestaña nueva)')));
    if (s.cedulaCopy) {
      actions.push(h('button', { type: 'button', class: 'mn-btn mn-btn--sm', onclick: async () => {
        const c = cedula();
        if (!c) { toast('Primero escribe tu número de documento en Perfil.'); return; }
        toast((await copyText(c)) ? 'Cédula copiada. Pégala en el sitio oficial.' : 'No se pudo copiar. Cópiala a mano desde Perfil.');
      } }, icon('copy'), 'Copiar cédula'));
    }
    if (s.email) {
      actions.push(h('button', { type: 'button', class: 'mn-btn mn-btn--sm', onclick: async () => toast((await copyText(s.email)) ? 'Correo de la DIJIN copiado.' : 'No se pudo copiar el correo.') }, icon('copy'), 'Copiar correo oficial'));
    }
    if (s.validatorUrl) actions.push(h('a', { class: 'mn-btn mn-btn--quiet mn-btn--sm', href: s.validatorUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Verificar certificado', h('span', { class: 'mn-sr' }, ' (se abre en una pestaña nueva)')));
    const links = [...(s.urlInfo ? [{ label: 'Información oficial', url: s.urlInfo }] : []), ...(s.alt || [])];
    const how = h('details', { class: 'doc-how' },
      h('summary', {}, 'Cómo obtenerlo'),
      h('div', { class: 'doc-how__body' },
        h('p', {}, h('strong', {}, 'Lo que harás tú: '), s.action),
        s.inputs.length ? h('p', {}, h('strong', {}, 'Te pedirán: '), s.inputs.join('; ') + '.') : null,
        h('ol', {}, s.steps.map((x) => h('li', {}, x))),
        s.manualNote ? h('p', { class: 'doc-manual' }, icon('info', 14), s.manualNote) : null,
        ...(s.notes || []).map((x) => h('p', { class: 'mn-help' }, x)),
        s.urlNota ? h('p', { class: 'mn-help' }, 'Aviso: ' + s.urlNota) : null,
        links.length ? h('p', { class: 'mn-help' }, 'Otras rutas: ', links.map((l, i) => [i ? ' · ' : '', h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label)])) : null,
        h('p', { class: 'mn-help' }, h('strong', {}, 'Vigencia: '), s.vigencia.tipo === 'ninguna' ? s.vigencia.fuente : `${s.vigencia.dias} días (${VIGENCIA_BASIS[s.vigencia.basis] || 'regla oficial'}). ${s.vigencia.fuente}${s.vigencia.nota ? ' ' + s.vigencia.nota : ''} ${VIGENCIA_AVISO}`),
        h('p', { class: 'mn-help' }, 'Esta app nunca envía tus datos a esos sitios: solo abre su página y copia tu cédula a tu portapapeles.')));
    const em = s.employerMayRequire;
    const legal = h('details', { class: 'doc-how doc-legal' },
      h('summary', {}, 'Base legal'),
      h('div', { class: 'doc-how__body' },
        em ? h('p', {}, h('strong', {}, '¿Puede exigirlo un empleador? '), `${EMPLOYER_LABEL[em.value]} (${CONFIANZA_LABEL[em.confianza]}). ${em.nota}`) : null,
        s.publicEntityNote ? h('p', {}, h('strong', {}, 'Si el empleador es una entidad pública: '), s.publicEntityNote) : null,
        s.legalBasis?.length ? h('ul', { class: 'doc-legal__refs' }, s.legalBasis.map((r) => h('li', {}, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.text, h('span', { class: 'mn-sr' }, ' (se abre en una pestaña nueva)'))))) : null,
        s.legalNote ? h('p', { class: 'mn-help', 'data-legal-note': s.id }, s.legalNote) : null,
        h('p', { class: 'mn-help' }, `${LEGAL_STATUS_LABEL[s.legalStatus] || ''}. Información orientativa, no es asesoría jurídica: verifica con la entidad.`)));
    return h('div', { class: 'doc-source' },
      h('div', { class: 'doc-tags' },
        h('span', { class: 'mn-badge doc-verdict', title: s.verdict === 'Asistido' ? 'La app te lleva al sitio y lee el PDF; el paso en el sitio lo haces tú.' : 'Solo enlace e instrucciones: no se puede acercar más.' }, s.verdict),
        s.optional ? h('span', { class: 'mn-badge' }, 'Si lo exige el cargo') : null,
        em?.value === 'no' ? h('span', { class: 'mn-badge mn-badge--warn doc-employer', 'data-employer': 'no' }, icon('info', 12), em.chip || EMPLOYER_CHIP_NO) : null,
        h('span', { class: 'doc-entity' }, s.entidad)),
      actions.length ? h('div', { class: 'doc-actions' }, actions) : null,
      how, legal);
  }

  function row(d) {
    const slots = h('div', { class: 'slots' });
    const badge = h('span', { class: 'mn-badge mn-badge--warn' }, 'Pendiente');
    const mark = h('span', { class: 'mn-doc__mark', 'aria-hidden': 'true' });
    const addSlot = (fileId) => {
      const wrap = h('div', { class: 'slot-row', 'data-fid': fileId });
      const panel = h('div', { class: 'vig-panel' });
      const n = slots.children.length + 1;
      const s = fileSlot({
        store, bag, fileId, label: n > 1 ? `${d.label} (página ${n})` : d.label, buttonLabel: 'Adjuntar', compact: true, preview: true,
        analyze: (f) => analyzeFile(f, d.id, cedula()),
        onChange: (id) => {
          const cur = ids(d.id);
          if (id) { if (!cur.includes(fileId)) setIds(d.id, [...cur, fileId]); renderPanel(fileId, d, panel); }
          else {
            setIds(d.id, cur.filter((x) => x !== fileId));
            panel.replaceChildren();
            if (slots.children.length > 1) wrap.remove();
          }
          progress();
        },
      });
      wrap.append(s.el, panel);
      slots.append(wrap);
      renderPanel(fileId, d, panel);
    };
    const have = ids(d.id);
    (have.length ? have : [`doc:${d.id}`]).forEach(addSlot);
    const more = h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm', onclick: () => {
      const used = new Set([...ids(d.id), ...[...slots.children].map((x) => x.dataset.fid)]);
      let n = 2; while (used.has(`doc:${d.id}:${n}`)) n++;
      addSlot(`doc:${d.id}:${n}`);
    } }, icon('plus'), 'Agregar página o cara');
    const quit = h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm doc-quit', 'aria-label': `Quitar de la lista: ${d.label}`, onclick: () => {
      if (!hide([d.id])) return;
      toast('Documento quitado de la lista.');
    } }, icon('x', 12), 'Quitar');
    const hid = nextId('doc');
    const li = h('li', { class: 'mn-doc doc', 'data-state': 'pending', 'data-doc': d.id },
      mark,
      h('div', { class: 'doc-body' },
        h('h2', { id: hid, class: 'mn-doc__title' }, d.label),
        d.hint ? h('div', { class: 'mn-doc__meta hint' }, d.hint) : null,
        sourceBlock(d),
        h('div', { class: 'doc-slots', role: 'group', 'aria-labelledby': hid }, slots, h('div', { class: 'doc-row-actions' }, more, quit))),
      badge);
    rows.set(d.id, { li, mark, badge });
    return li;
  }

  // ---------- Lista y selección de documentos ----------
  /** Quita ids de la lista visible; con archivos pide confirmación y NUNCA borra archivos. Devuelve true si se quitó. */
  function hide(idList) {
    const withFiles = idList.map((id) => all.find((d) => d.id === id)).filter((d) => d && ids(d.id).length);
    if (withFiles.length) {
      const names = withFiles.map((d) => `"${d.label}"`).join(', ');
      if (!confirm(`${names} ${withFiles.length > 1 ? 'tienen' : 'tiene'} archivos cargados. Quitarlo de la lista no los borra (se conservan en este equipo y en tu respaldo), pero dejará de aparecer aquí y en la lista de documentos de las plantillas. ¿Quitarlo?`)) return false;
    }
    const cur = new Set(shownList().map((d) => d.id));
    idList.forEach((id) => cur.delete(id));
    setShown([...cur]);
    renderList();
    return true;
  }

  function renderTplPicker() {
    const list = tplList();
    if (!list.length) { tplBox.replaceChildren(); tplBox.hidden = true; return; }
    tplBox.hidden = false;
    const id = nextId('doctpl');
    const sel = h('select', { id, class: 'mn-select', 'aria-describedby': id + '-help' },
      h('option', { value: '' }, 'Ninguna: la regla de cada documento'),
      ...list.map((t) => { const n = templateMaxAge(t); return h('option', { value: t.id }, (t.name || 'Sin nombre') + (n ? ` (máx. ${n} días)` : ''));}));
    sel.value = list.some((t) => t.id === tplId) ? tplId : '';
    sel.addEventListener('change', () => {
      tplId = sel.value;
      try { sessionStorage.setItem('hv.docs.tpl', tplId); } catch { /* sin almacenamiento */ }
      renderList();
      tplBox.querySelector('select')?.focus();
    });
    tplBox.replaceChildren(h('label', { for: id, class: 'mn-label' }, 'Evaluar la vigencia con la plantilla'), sel,
      h('p', { class: 'mn-help', id: id + '-help' }, 'Si la plantilla fija una antigüedad máxima (por ejemplo 30 días), el semáforo y el resumen la usan. Se define al editar la plantilla.'));
  }

  function renderToolbar() {
    const n = shownList().length;
    toolbar.replaceChildren(
      h('p', { class: 'mn-help' }, `Mostrando ${n} de ${all.length} documentos disponibles.`),
      h('button', { type: 'button', class: 'mn-btn mn-btn--sm', id: 'doc-add', 'aria-haspopup': 'dialog', onclick: openPicker }, icon('plus'), 'Añadir documento'));
  }

  function renderList() {
    bag.revokeAll();
    rows = new Map();
    const docs = shownList();
    renderToolbar();
    renderTplPicker();
    if (!docs.length) {
      listHost.replaceChildren(emptyState({
        icon: 'folder', level: 2, title: 'No hay documentos en la lista', text: 'Elige cuáles necesitas para tu cargo.',
        action: h('button', { type: 'button', class: 'mn-btn mn-btn--primary', onclick: openPicker }, icon('plus'), 'Añadir documento'),
      }));
    } else listHost.replaceChildren(h('ul', { class: 'docs mn-card' }, docs.map(row)));
    progress();
  }

  function openPicker() {
    const opener = document.getElementById('doc-add');
    const tid = nextId('picker');
    const dlg = h('dialog', { class: 'mn-dialog doc-picker', 'aria-labelledby': tid });
    const boxes = new Map();
    const refreshBoxes = () => { const s = new Set(shownList().map((d) => d.id)); boxes.forEach((cb, id) => { cb.checked = s.has(id); }); };
    const apply = (id, on) => {
      const cur = new Set(shownList().map((d) => d.id));
      if (on) {
        cur.add(id); setShown([...cur]); renderList(); toast('Documento añadido a la lista.');
      } else if (hide([id])) toast('Documento quitado de la lista.');
      refreshBoxes();
    };
    const item = (d) => {
      const s = SOURCES[d.id];
      const cb = h('input', { type: 'checkbox', value: d.id, onchange: (e) => apply(d.id, e.target.checked) });
      boxes.set(d.id, cb);
      return h('li', {}, h('label', { class: 'mn-check doc-pick' }, cb, h('span', {}, h('span', { class: 'doc-pick__t' }, d.label),
        s ? h('span', { class: 'doc-pick__s' }, `${s.entidad} · ${s.verdict}${s.optional ? ' · si lo exige el cargo' : ''}`) : null)));
    };
    const tierOf = (d) => SOURCES[d.id]?.tier || 'otros';
    const core = all.filter((d) => tierOf(d) === 'core'), opt = all.filter((d) => tierOf(d) === 'optional'), rest = all.filter((d) => tierOf(d) === 'otros');
    const bulk = (on) => {
      if (on) { setShown(allIds); renderList(); toast('Todos los documentos están en la lista.'); }
      else if (hide(shownList().map((d) => d.id))) toast('Lista de documentos vaciada.');
      refreshBoxes();
    };
    const close = () => dlg.close();
    dlg.append(
      h('div', { class: 'mn-dialog__head' }, h('h2', { id: tid }, 'Documentos de tu lista'),
        h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm mn-btn--icon', 'aria-label': 'Cerrar', onclick: close }, icon('x'))),
      h('div', { class: 'mn-dialog__body' },
        h('p', { class: 'mn-help' }, 'Marca los documentos que necesitas para tu cargo. Los desmarcados se ocultan; los archivos ya cargados nunca se borran.'),
        h('div', { class: 'doc-pick__bulk' },
          h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm', onclick: () => bulk(true) }, 'Todos'),
          h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm', onclick: () => bulk(false) }, 'Ninguno')),
        h('fieldset', { class: 'doc-pick__set' }, h('legend', { class: 'mn-label' }, 'Principales'), h('ul', {}, core.map(item))),
        h('fieldset', { class: 'doc-pick__set' }, h('legend', { class: 'mn-label' }, 'Opcionales (si la convocatoria los exige)'), h('ul', {}, opt.map(item))),
        h('fieldset', { class: 'doc-pick__set' }, h('legend', { class: 'mn-label' }, 'Otros (ocultos por defecto)'), h('ul', {}, rest.map(item)))),
      h('div', { class: 'mn-dialog__foot' }, h('button', { type: 'button', class: 'mn-btn mn-btn--primary', onclick: close }, 'Listo')));
    dlg.addEventListener('close', () => { dlg.remove(); (document.getElementById('doc-add') || opener)?.focus(); });
    refreshBoxes();
    document.body.append(dlg);
    dlg.showModal();
  }

  el.replaceChildren(h('div', { class: 'documentos' },
    pageHead({
      eyebrow: 'Documentos', title: 'Documentos requeridos', text: 'Reúne estos soportes antes de radicar tu hoja de vida. Todo se guarda en este equipo y la lectura de los PDF también ocurre aquí.',
      aside: h('div', { class: 'doc-progress' }, h('div', { class: 'doc-count' }, h('span', { class: 'mn-eyebrow' }, 'Avance'), countNum), stamp),
    }),
    summary, bar, discHost, banner, tplBox, toolbar, listHost));
  renderDisclaimer();
  renderList();
  return () => { alive = false; bag.revokeAll(); document.querySelectorAll('dialog.doc-picker').forEach((x) => x.remove()); };
}
