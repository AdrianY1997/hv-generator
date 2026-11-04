import { h, icon, pageHead, toast } from '../ui.js';
import { uid } from '../forms.js';
import { shownDocIds } from '../doc-sources.js';
import { summarizeVigencia, vigenciaWarning } from '../doc-parse.js';
import { loadFiles, neededFileIds, standaloneHtml, downloadHtml, downloadJson, download, printWithTitle, applyPrintPage, clearPrintPage, slug } from '../export.js';
import { isPlainObject, MAX_BACKUP_JSON, MAX_ENVELOPE_JSON } from '../backup-validate.js';
import { prepareBackup, mergeSummaryText } from '../backup-merge.js';
import { openImportDialog, openPassphraseDialog, downloadBackupFlow } from '../import-dialog.js';
import { isEncryptedEnvelope, validateEnvelope, decryptBackup } from '../backup-crypto.js';
import { normalizeTemplate, templateMaxAge } from '../template-model.js';
import { docSelected } from '../template-check.js';
import { validateProfile, issueText } from '../validators.js';
import { getModel, templatesFor, templateModelId, registry, DEFAULT_MODEL } from '../models/index.js';
import { deriveShared } from '../models/shared-fields.js';
import { annexFlags } from '../models/sheet-kit.js';

/** Vista "Vista previa": HV renderizada, impresión y exportación. ctx = { model, store, router }. */
export function mount(el, ctx) {
  const { model, store, router } = ctx;
  let alive = true, files = {}, zoom = 1, paper = 'letter';
  try { zoom = Number(sessionStorage.getItem('hv.pv.zoom')) || 1; paper = sessionStorage.getItem('hv.pv.paper') || 'letter'; } catch {}

  const queryId = () => router?.query?.().get('template') || '';
  // El selector lista las plantillas del formato activo; una plantilla pedida por enlace (?template=) se muestra SIEMPRE con su propio
  // formato (template.modelId), aunque el encabezado tenga otro.
  const templates = () => templatesFor(store.getTemplates(), model.id);
  const current = () => store.getTemplates().find((t) => t.id === queryId()) || null;
  const mdl = () => { const t = current(); return t ? getModel(templateModelId(t)) : model; };
  // Plantilla pedida (?template=) de un formato que esta versión no conoce (respaldo/enlace de una versión con más modelos): se muestra con el
  // formato por omisión, pero se AVISA (sin bloquear) en vez de aparentar que es el suyo.
  const unknownModelId = () => { const t = current(); return t && !registry[templateModelId(t)] ? templateModelId(t) : null; };

  const ZMIN = 0.4, ZMAX = 1.5;
  const sel = h('select', { id: 'pv-template', class: 'mn-select' });
  const zoomOut = h('output', { id: 'pv-zoom-out', class: 'pv-zoom-out', 'aria-live': 'polite' });
  const zoomMinus = h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm mn-btn--icon', 'aria-label': 'Alejar' }, icon('zoom-out'));
  const zoomPlus = h('button', { type: 'button', class: 'mn-btn mn-btn--quiet mn-btn--sm mn-btn--icon', 'aria-label': 'Acercar' }, icon('zoom-in'));
  const paperSel = h('select', { id: 'pv-paper', class: 'mn-select' }, h('option', { value: 'letter' }, 'Carta (Letter)'), h('option', { value: 'a4' }, 'A4'));
  paperSel.value = paper;
  const banner = h('div', { class: 'pv-banner', role: 'status' });
  const notice = h('p', { class: 'mn-help pv-help pv-notice', role: 'status' });
  const stage = h('div', { class: 'pv-stage mn-canvas', tabindex: '0', role: 'region', 'aria-label': 'Vista previa de la hoja de vida (desplazable)' });
  // Anexos de esta vista (certificados y documentos adjuntos): por omisión, lo que diga la plantilla (sin plantilla: los dos). Lo que la persona
  // cambie aquí vale para esta vista y esta sesión (por plantilla), no se guarda en la plantilla. sessionStorage `hv.pv.annex`.
  let annexOv = {};
  try { const v = JSON.parse(sessionStorage.getItem('hv.pv.annex') || '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) annexOv = v; } catch {}
  const ovKey = () => current()?.id || '-';
  const annexOpts = () => {
    const o = annexOv[ovKey()];
    return o && typeof o === 'object' ? { annex: { certificates: typeof o.certificates === 'boolean' ? o.certificates : undefined, documents: typeof o.documents === 'boolean' ? o.documents : undefined } } : {};
  };
  const attCerts = h('input', { type: 'checkbox', id: 'pv-att-certs' });
  const attDocs = h('input', { type: 'checkbox', id: 'pv-att-docs' });
  const annexBox = h('fieldset', { class: 'pv-field pv-annex-opts' }, h('legend', { class: 'mn-label' }, 'Anexos al final'),
    h('label', { class: 'mn-check', for: 'pv-att-docs' }, attDocs, 'Incluir documentos adjuntos'),
    h('label', { class: 'mn-check', for: 'pv-att-certs' }, attCerts, 'Incluir certificados'));
  const annexSum = h('p', { class: 'mn-help pv-annex-sum', role: 'status', id: 'pv-annex-sum' });
  const annexWrap = h('div', { class: 'pv-annex-wrap' }, annexBox, annexSum); // el interruptor va junto al resumen que lo explica
  const pdfCache = new Map(); // páginas de PDF ya convertidas a imagen (export.js), mientras la vista esté abierta
  const zoomBox = h('div', { class: 'pv-zoom' });
  stage.append(zoomBox);

  function fillSelect() {
    const id = queryId();
    const cur = current(), list = templates();
    const foreign = cur && !list.some((t) => t.id === cur.id) ? cur : null;
    sel.replaceChildren(h('option', { value: '' }, 'Hoja de vida completa (sin plantilla)'),
      ...list.map((t) => h('option', { value: t.id }, t.name || t.id)),
      ...(foreign ? [h('option', { value: foreign.id }, `${foreign.name || foreign.id} (${registry[templateModelId(foreign)] ? getModel(templateModelId(foreign)).name : `formato desconocido «${templateModelId(foreign)}»: se muestra como ${getModel(DEFAULT_MODEL).name}`})`)] : []));
    sel.value = cur ? cur.id : '';
  }

  const docName = () => {
    const p = deriveShared(store.getProfile()).personales || {}; // apellidos escritos en cualquier formato
    return [p.nombres, p.apellidos].filter(Boolean).join(' ') || 'Sin nombre';
  };
  const title = () => `HV - ${docName()}`;
  const build = () => mdl().render(store.getProfile(), current(), files, annexOpts());
  // Carga perezosa: solo se codifican los binarios que esta vista usa (foto y anexos incluidos, con los PDF convertidos a imágenes de página
  // para imprimir); `files` anterior queda libre. `seq` descarta una carga que terminó después de otra más nueva.
  let loadedKey = null, loading = false, seq = 0;
  const wantIds = () => neededFileIds(mdl(), store.getProfile(), current(), annexOpts());
  const keyOf = (ids) => (ids ? [...new Set(ids)].sort().join('|') : '*');
  async function reloadFiles() {
    const ids = wantIds(), my = ++seq;
    loading = true;
    try {
      const got = await loadFiles(store, ids, { pdf: true, cache: pdfCache });
      if (my !== seq) return;
      files = got;
      loadedKey = keyOf(ids);
    } finally { if (my === seq) loading = false; }
  }
  const setAnnex = (k, v) => {
    annexOv = { ...annexOv, [ovKey()]: { ...(annexOv[ovKey()] || {}), [k]: v } };
    try { sessionStorage.setItem('hv.pv.annex', JSON.stringify(annexOv)); } catch {}
    update();
    reloadFiles().then(() => update()).catch((e) => console.error(e));
  };
  attCerts.addEventListener('change', () => setAnnex('certificates', attCerts.checked));
  attDocs.addEventListener('change', () => setAnnex('documents', attDocs.checked));
  // Los fallos de conversión no se guardan en la caché (export.js): reintentar vuelve a leer y convertir los PDF que fallaron.
  const retryPdfs = () => {
    const done = reloadFiles().then(() => { update(); document.getElementById('pv-annex-retry')?.focus(); }).catch((e) => console.error(e));
    update(); // muestra «Preparando los anexos…» mientras tanto
    return done;
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  /** Resumen visible de los anexos de esta vista: cuántos documentos y páginas salen, qué no se pudo incluir y por qué. */
  function annexSummary(model, profile, t) {
    const on = annexFlags(t, annexOpts().annex);
    attCerts.checked = on.certificates; attDocs.checked = on.documents;
    const info = model.annexInfo?.(profile, t, files, annexOpts());
    annexSum.replaceChildren();
    if (!info) return;
    const off = [!on.documents ? 'los documentos adjuntos' : '', !on.certificates ? 'los certificados' : ''].filter(Boolean).join(' y ');
    annexSum.append(h('strong', {}, `Anexos: ${plural(info.items, 'documento', 'documentos')} / ${plural(info.pages, 'página', 'páginas')}`),
      info.items ? ' al final de la impresión.' : (off ? ` (desactivaste ${off}).` : ' (no hay archivos cargados para esta vista).'));
    // Decisión registrada (docs/IMPRESION.md): los documentos adjuntos van por omisión cuando no hay plantilla; se dice y se puede quitar aquí mismo.
    const docN = on.documents ? (model.annexList?.(profile, t, files, annexOpts()) || []).filter((a) => String(a.id).startsWith('doc:')).length : 0;
    if (docN) annexSum.append(h('span', { 'data-annex-docs': String(docN) }, ` Se incluyen ${plural(docN, 'documento', 'documentos')} de identidad/salud en esta vista y en el HTML descargable. Si no quieres que salgan, desmarca «Incluir documentos adjuntos».`));
    if (loading) annexSum.append(' Preparando los anexos…');
    if (info.truncated.length) annexSum.append(h('span', { class: 'pv-annex-sum__warn', 'data-annex-truncated': String(info.truncated.length) }, ' ' + info.truncated.map((x) => `De «${x.title}» se imprimen las primeras ${x.shown} de ${x.total} páginas${x.reason ? ` (${x.reason})` : ''}.`).join(' ') + ' El paquete PDF lo lleva completo.'));
    if (info.loose.length && !loading) {
      annexSum.append(h('span', { class: 'pv-annex-sum__warn', 'data-annex-loose': String(info.loose.length) }, ` No se pudieron incluir en la impresión: ${info.loose.map((x) => `${x.title} (${x.reason})`).join('; ')}. Use «Descargar paquete PDF» o adjúntelos aparte.`));
      if (info.loose.some((x) => x.retry)) annexSum.append(' ', h('button', { type: 'button', id: 'pv-annex-retry', class: 'mn-btn mn-btn--quiet mn-btn--sm', onclick: retryPdfs }, 'Reintentar'));
    }
  }

  function update() {
    if (!alive) return;
    const profile = store.getProfile(), t = current(), model = mdl();
    zoomBox.innerHTML = build();
    zoomBox.dataset.model = model.id;
    applyPrintPage(paper); // todas las páginas con margen 0 y el papel elegido, también para Ctrl+P
    stage.classList.toggle('hv-a4', paper === 'a4');
    zoomBox.style.zoom = String(zoom);
    zoomOut.textContent = `${Math.round(zoom * 100)}%`;
    zoomMinus.disabled = zoom <= ZMIN + 1e-6; zoomPlus.disabled = zoom >= ZMAX - 1e-6;
    const miss = model.missing ? model.missing(profile, t, files) : [];
    // Vigencia de los documentos de esta vista (solo los que tienen archivo): sin plantilla, los mostrados en Documentos;
    // con plantilla, los que ella selecciona (también los ocultos, G27), con su límite de antigüedad si lo tiene (G20).
    const docIds = new Set(shownDocIds(profile, model.schema.documents.map((d) => d.id)));
    const inc = (d) => (t ? docSelected(t, d.id, docIds) : docIds.has(d.id));
    const metas = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, f.meta || {}]));
    const vig = summarizeVigencia(model.schema.documents.filter(inc), profile, metas, new Date(), { maxAgeDays: templateMaxAge(t) });
    const vigBad = [...vig.vencidos, ...vig.porVencer];
    // Datos con formato dudoso (G17): solo los que entran en esta vista; avisan, no impiden imprimir.
    const review = validateProfile(model.schema.sections, profile, {
      include: (sec, fid, rec) => !t || ((t.include?.sections === undefined || t.include.sections[sec] !== false) && t.include?.fields?.[`${sec}.${fid}`] !== false && t.include?.items?.[rec?.id] !== false),
    });
    banner.replaceChildren();
    const unknownId = unknownModelId();
    banner.className = 'pv-banner' + (miss.length || vigBad.length || review.length || unknownId ? '' : ' ok') + (vig.vencidos.length ? ' danger' : '');
    banner.append(icon(miss.length || vigBad.length || review.length || unknownId ? 'alert' : 'check', 16));
    const msgBox = h('div', { class: 'pv-banner__body' });
    banner.append(msgBox);
    if (unknownId) msgBox.append(h('p', { 'data-notice': 'unknown-model' }, h('strong', {}, `La plantilla «${t.name || t.id}» es de un formato desconocido («${unknownId}»). `), `Se muestra con el formato «${model.name}» (el predeterminado) para que puedas verla; revisa el resultado antes de imprimir o actualiza la app.`));
    if (miss.length) {
      msgBox.append(h('strong', {}, `Faltan ${miss.length} dato(s) requerido(s)${t ? ' para "' + (t.name || t.id) + '"' : ''}:`),
        h('ul', {}, miss.slice(0, 30).map((m) => h('li', {}, m)), miss.length > 30 ? h('li', {}, `... y ${miss.length - 30} más`) : null));
    } else msgBox.append('No faltan datos obligatorios ni documentos para esta vista.');
    if (vigBad.length) {
      msgBox.append(h('p', {}, h('strong', {}, `${vig.vencidos.length} documento(s) vencido(s), ${vig.porVencer.length} por vencer:`)),
        h('ul', {}, vigBad.map((x) => h('li', {}, vigenciaWarning(x.label, x.v)))),
        h('p', { class: 'pv-help' }, (t && templateMaxAge(t) ? `Esta plantilla pide documentos de máximo ${templateMaxAge(t)} días desde su expedición. ` : '') + 'La vigencia real la define la entidad que recibe el documento. Revísala en Documentos.'));
    }
    if (review.length) {
      msgBox.append(h('p', {}, h('strong', {}, `${review.length} dato(s) por revisar (no impiden imprimir):`)),
        h('ul', { class: 'pv-review' }, review.slice(0, 12).map((x) => h('li', {}, issueText(x))), review.length > 12 ? h('li', {}, `... y ${review.length - 12} más`) : null),
        h('p', { class: 'pv-help' }, 'Corrígelos en Perfil si es un error; si el dato es correcto, ignora el aviso.'));
    }
    annexSummary(model, profile, t);
  }

  // Importa un respaldo completo (diálogo: combinar o reemplazar; G12) o una plantilla exportada.
  const importIn = h('input', { type: 'file', accept: 'application/json,.json', class: 'mn-sr', tabindex: '-1', 'aria-hidden': 'true' });
  importIn.addEventListener('change', async () => {
    const f = importIn.files[0];
    importIn.value = '';
    if (!f) return;
    notice.textContent = '';
    try {
      if (f.size > MAX_ENVELOPE_JSON) { notice.textContent = `No se pudo importar: el archivo pesa ${(f.size / 1048576).toFixed(0)} MB y el máximo es ${MAX_BACKUP_JSON / 1048576} MB.`; return; }
      let data = JSON.parse(await f.text());
      if (isEncryptedEnvelope(data)) {
        // Respaldo cifrado (G05): se valida el sobre y se pide la contraseña; si es incorrecta o el archivo fue alterado el diálogo lo dice y NO se toca nada.
        // Con el texto claro, el flujo sigue idéntico al de un respaldo normal (validar, elegir combinar/reemplazar, escribir).
        const chk = validateEnvelope(data);
        if (!chk.ok) { notice.textContent = 'No se pudo importar: ' + chk.error + ' Tus datos actuales no se modificaron.'; return; }
        const env = data;
        data = await openPassphraseDialog({ fileName: f.name, verify: (pass) => decryptBackup(env, pass) });
        if (!data) { notice.textContent = 'Importación cancelada: no se descifró el respaldo y tus datos no se modificaron.'; return; }
      } else if (f.size > MAX_BACKUP_JSON) { notice.textContent = `No se pudo importar: el archivo pesa ${(f.size / 1048576).toFixed(0)} MB y el máximo es ${MAX_BACKUP_JSON / 1048576} MB.`; return; }
      if (isPlainObject(data) && data.app === 'hv-minerva') {
        // Se valida TODO (forma, tamaños, tipos, versión) antes de preguntar o tocar nada: un archivo inválido nunca cambia los datos actuales.
        const v = prepareBackup(data);
        if (!v.ok) { notice.textContent = 'No se pudo importar: ' + v.error + ' Tus datos actuales no se modificaron.'; return; }
        const current = { profile: store.getProfile(), templates: store.getTemplates(), files: (await store.listFiles()).map((x) => ({ id: x.id, size: x.meta?.size })) };
        const docIds = model.schema.documents.map((d) => d.id);
        const choice = await openImportDialog({ prepared: v, current, sections: model.schema.sections, currentShown: shownDocIds(current.profile, docIds) });
        if (!choice) return;
        if (choice.noop) { notice.textContent = 'No había nada nuevo que combinar: tus datos ya contienen este respaldo.'; return; }
        try {
          const day = new Date().toISOString().slice(0, 10);
          const safePass = choice.safetyPassphrase;
          delete choice.safetyPassphrase; // la contraseña no se queda en el objeto de la elección
          if (safePass) downloadJson(await store.exportBackupEncrypted(safePass), `hv-respaldo-previo-${day}-cifrado.json`);
          else downloadJson(await store.exportBackup(), `hv-respaldo-previo-${day}.json`);
        } catch (e) {
          console.error(e);
          notice.textContent = 'No se pudo crear la copia de seguridad previa; no se importó nada y tus datos siguen igual.';
          return;
        }
        const r = await store.importBackup(data, { mode: choice.mode, preferBackup: choice.preferBackup, docIds });
        notice.textContent = (choice.mode === 'merge' ? 'Respaldo combinado con tus datos. ' + mergeSummaryText(r.stats) : 'Respaldo importado correctamente: se reemplazaron tus datos.') + ' Se descargó una copia de tus datos anteriores.';
        toast(choice.mode === 'merge' ? 'Respaldo combinado.' : 'Respaldo importado.');
      } else if (isPlainObject(data) && isPlainObject(data.include) && isPlainObject(data.options)) {
        const now = new Date().toISOString();
        const t = normalizeTemplate(data);
        store.saveTemplate({ ...t, id: uid(), name: t.name || 'Plantilla importada', createdAt: now, updatedAt: now });
        notice.textContent = 'Plantilla importada.'; toast('Plantilla importada.');
      } else throw new Error('formato');
    } catch (e) {
      console.error(e);
      notice.textContent = e?.userMessage || 'No se pudo importar: el archivo no es un respaldo ni una plantilla válidos.';
    }
  });

  // Paquete PDF: HV (rasterizada) + anexos (imágenes y PDF unidos). pdf-lib y la rasterización se cargan solo al usarlo.
  let busy = false;
  async function makePackage(withHv) {
    if (busy) return;
    busy = true; pkgBtns.forEach((b) => { b.disabled = true; });
    const say = (m) => { notice.textContent = m; };
    try {
      say('Preparando el paquete...');
      const { buildPackage } = await import('../pdf-package.js');
      const profile = store.getProfile(), t = current(), model = mdl();
      const annexList = model.annexList ? model.annexList(profile, t, files, annexOpts()) : [];
      const r = await buildPackage({ html: build(), paper, title: title(), annexList, getFile: (id) => store.getFile(id), withHv, onProgress: say });
      download(`${slug(docName())}-${withHv ? 'paquete' : 'anexos'}.pdf`, r.blob);
      say(`Listo: ${r.pages} página(s)` + (withHv ? ` (${r.hvPages} de la HV y ${r.annexPages} de anexos)` : ' de anexos') +
        ` · ${(r.blob.size / 1048576).toFixed(1)} MB.` + (r.skipped.length ? ` No se pudieron incluir: ${r.skipped.map((x) => `${x.title} (${x.reason})`).join('; ')}.` : ''));
      toast('Paquete PDF generado.');
    } catch (e) {
      console.error(e);
      say('No se pudo generar el paquete: ' + (e?.userMessage || 'error inesperado; puede usar Imprimir y adjuntar los anexos aparte.'));
    } finally { busy = false; pkgBtns.forEach((b) => { b.disabled = false; }); }
  }
  const pkgBtns = [];
  const pkgBtn = (text, withHv, cls) => { const b = btn(text, () => makePackage(withHv), cls, withHv ? 'download' : null); b.id = withHv ? 'pv-package' : 'pv-annex-only'; pkgBtns.push(b); return b; };
  const btn = (text, fn, cls = 'mn-btn mn-btn--sm', ic = null) => h('button', { type: 'button', class: cls, onclick: fn }, ic ? icon(ic) : null, text);
  const actions = h('div', { class: 'pv-actions' },
    btn('Imprimir', () => printWithTitle(title(), paper), 'mn-btn mn-btn--sm', 'print'),
    btn('Descargar PDF', () => {
      notice.textContent = 'En el diálogo de impresión elige "Guardar como PDF" como destino. El archivo se sugiere como "' + title() + '".';
      printWithTitle(title(), paper);
    }, 'mn-btn mn-btn--primary mn-btn--sm', 'download'),
    pkgBtn('Descargar paquete PDF', true, 'mn-btn mn-btn--sm'));
  const more = h('div', { class: 'pv-more' },
    pkgBtn('Solo anexos en un PDF', false, 'mn-btn mn-btn--quiet mn-btn--sm'),
    btn('Descargar HTML autónomo', async () => downloadHtml(await standaloneHtml(build(), title(), paper), `${slug(docName())}-hv.html`), 'mn-btn mn-btn--quiet mn-btn--sm'),
    btn('Exportar plantilla JSON', () => {
      const t = current();
      if (!t) { notice.textContent = 'Selecciona una plantilla para exportarla.'; return; }
      downloadJson(t, `plantilla-${slug(t.name)}.json`);
    }, 'mn-btn mn-btn--quiet mn-btn--sm'),
    btn('Exportar datos JSON', async () => {
      try {
        const r = await downloadBackupFlow(store);
        if (r) notice.textContent = r === 'encrypted' ? 'Respaldo cifrado descargado. Guarda la contraseña: sin ella no se puede abrir.' : 'Respaldo descargado (sin cifrar).';
      } catch (e) { console.error(e); notice.textContent = 'No se pudo generar el respaldo: ' + (e?.userMessage || 'error inesperado.'); }
    }, 'mn-btn mn-btn--quiet mn-btn--sm'),
    btn('Importar JSON (datos o plantilla)', () => importIn.click(), 'mn-btn mn-btn--quiet mn-btn--sm'),
    importIn);
  const setZoom = (z) => { zoom = Math.min(ZMAX, Math.max(ZMIN, Math.round(z * 10) / 10)); try { sessionStorage.setItem('hv.pv.zoom', zoom); } catch {} update(); };
  zoomMinus.addEventListener('click', () => setZoom(zoom - 0.1));
  zoomPlus.addEventListener('click', () => setZoom(zoom + 0.1));

  sel.addEventListener('change', () => router.go('/vista-previa' + (sel.value ? '?template=' + encodeURIComponent(sel.value) : '')));
  paperSel.addEventListener('change', () => { paper = paperSel.value; try { sessionStorage.setItem('hv.pv.paper', paper); } catch {} update(); });

  fillSelect();
  el.replaceChildren(h('div', { class: 'vista-previa' },
    pageHead({ eyebrow: 'Vista previa', title: 'Vista previa', text: 'Revisa tu hoja de vida antes de imprimirla o descargarla. Todo se queda en este equipo.' }),
    h('div', { class: 'pv-opts' },
      h('label', { class: 'pv-field' }, h('span', { class: 'mn-label' }, 'Plantilla'), sel), h('label', { class: 'pv-field' }, h('span', { class: 'mn-label' }, 'Papel'), paperSel), annexWrap),
    h('div', { class: 'mn-toolbar pv-bar' },
      h('div', { class: 'pv-zoomctl', role: 'group', 'aria-label': 'Zoom' }, zoomMinus, zoomOut, zoomPlus), actions, more),
    notice, banner, stage));
  update();

  reloadFiles().then(() => update()).catch((e) => console.error(e)).then(() => {
    // Enlace "Imprimir" de Plantillas (?print=1): imprime una vez ya cargadas las imágenes y limpia el parámetro.
    if (alive && router?.query?.().get('print') === '1') {
      const q = queryId();
      history.replaceState(null, '', '#/vista-previa' + (q ? '?template=' + encodeURIComponent(q) : ''));
      setTimeout(() => alive && printWithTitle(title(), paper), 250);
    }
  });
  const unsub = store.subscribe(async (ev) => {
    if (ev.type === 'files' || ev.type === 'all' || keyOf(wantIds()) !== loadedKey) { try { await reloadFiles(); } catch (e) { console.error(e); } }
    if (!alive) return;
    fillSelect(); update();
  });
  return () => { alive = false; seq++; unsub(); files = {}; pdfCache.clear(); zoomBox.replaceChildren(); clearPrintPage(); }; // suelta las páginas en memoria y el CSS de impresión de la HV
}
