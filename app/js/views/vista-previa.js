import { h, icon, pageHead, toast } from '../ui.js';
import { uid } from '../forms.js';
import { shownDocIds } from '../doc-sources.js';
import { summarizeVigencia, vigenciaWarning } from '../doc-parse.js';
import { loadFiles, neededFileIds, standaloneHtml, downloadHtml, downloadJson, download, printWithTitle, slug } from '../export.js';
import { isPlainObject, MAX_BACKUP_JSON, MAX_ENVELOPE_JSON } from '../backup-validate.js';
import { prepareBackup, mergeSummaryText } from '../backup-merge.js';
import { openImportDialog, openPassphraseDialog, downloadBackupFlow } from '../import-dialog.js';
import { isEncryptedEnvelope, validateEnvelope, decryptBackup } from '../backup-crypto.js';
import { normalizeTemplate, templateMaxAge } from '../template-model.js';
import { docSelected } from '../template-check.js';
import { validateProfile, issueText } from '../validators.js';

/** Vista "Vista previa": HV renderizada, impresión y exportación. ctx = { model, store, router }. */
export function mount(el, ctx) {
  const { model, store, router } = ctx;
  let alive = true, files = {}, zoom = 1, paper = 'letter';
  try { zoom = Number(sessionStorage.getItem('hv.pv.zoom')) || 1; paper = sessionStorage.getItem('hv.pv.paper') || 'letter'; } catch {}

  const queryId = () => router?.query?.().get('template') || '';
  const templates = () => store.getTemplates().filter((t) => !t.modelId || t.modelId === model.id);
  const current = () => templates().find((t) => t.id === queryId()) || null;

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
  const zoomBox = h('div', { class: 'pv-zoom' });
  stage.append(zoomBox);

  function fillSelect() {
    const id = queryId();
    sel.replaceChildren(h('option', { value: '' }, 'Hoja de vida completa (sin plantilla)'),
      ...templates().map((t) => h('option', { value: t.id }, t.name || t.id)));
    sel.value = templates().some((t) => t.id === id) ? id : '';
  }

  const docName = () => {
    const p = store.getProfile().personales || {};
    return [p.nombres, p.apellidos].filter(Boolean).join(' ') || 'Sin nombre';
  };
  const title = () => `HV - ${docName()}`;
  const build = () => model.render(store.getProfile(), current(), files);
  // Carga perezosa: solo se codifican los binarios que esta plantilla usa (foto y anexos incluidos); `files` anterior queda libre.
  let loadedKey = null;
  const wantIds = () => neededFileIds(model, store.getProfile(), current());
  const keyOf = (ids) => (ids ? [...new Set(ids)].sort().join('|') : '*');
  async function reloadFiles() {
    const ids = wantIds();
    files = await loadFiles(store, ids);
    loadedKey = keyOf(ids);
  }

  function update() {
    if (!alive) return;
    const profile = store.getProfile(), t = current();
    zoomBox.innerHTML = build();
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
    banner.className = 'pv-banner' + (miss.length || vigBad.length || review.length ? '' : ' ok') + (vig.vencidos.length ? ' danger' : '');
    banner.append(icon(miss.length || vigBad.length || review.length ? 'alert' : 'check', 16));
    const msgBox = h('div', { class: 'pv-banner__body' });
    banner.append(msgBox);
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
    const info = model.annexInfo?.(profile, t, files);
    if (info && (info.images || info.others)) {
      msgBox.append(h('p', { class: 'pv-help' }, `Anexos: ${info.images} imagen(es) incluidas al final de la impresión.` +
        (info.others ? ` ${info.others} archivo(s) PDF no salen al imprimir: use «Descargar paquete PDF» para obtener un solo archivo con la HV y todos los anexos (imágenes y PDF), o adjúntelos aparte.` : '')));
    }
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
      const profile = store.getProfile(), t = current();
      const annexList = model.annexList ? model.annexList(profile, t, files) : [];
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
      h('label', { class: 'pv-field' }, h('span', { class: 'mn-label' }, 'Plantilla'), sel), h('label', { class: 'pv-field' }, h('span', { class: 'mn-label' }, 'Papel'), paperSel)),
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
  return () => { alive = false; unsub(); files = {}; };
}
