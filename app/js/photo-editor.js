// Editor de foto. openPhotoEditor(fileOrBlob, { spec? }) -> Promise<Blob|null>
// spec = schema.photo del modelo ({ aspect, width, height, maxKB }, todo opcional). Sin spec: carnet 3:4 a 600x800 px, JPEG calidad 0.9.
// La persona puede elegir otro formato (carnet 3x4, pasaporte/visa 35x45, cuadrada 1:1 o medidas propias) y un peso máximo en KB.
import { icon } from './ui.js';
import { PRESETS, LIMITS, normalizeSpec, presetIdOf, parseMaxKB, fitToWeight } from './photo-spec.js';

const SPEC_KEY = 'hv.photo.spec'; // sessionStorage: último formato elegido en esta sesión
const readSaved = () => { try { const o = JSON.parse(sessionStorage.getItem(SPEC_KEY) || 'null'); return o && typeof o === 'object' ? o : null; } catch { return null; } };
const saveSpec = (s) => { try { sessionStorage.setItem(SPEC_KEY, JSON.stringify({ width: s.width, height: s.height, maxKB: s.maxKB })); } catch { /* sin almacenamiento */ } };

(function injectCss() {
  const href = new URL('../css/photo-editor.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === href)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.append(l);
})();

let peSeq = 0; // ids únicos aunque se abra más de un editor
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

async function loadBitmap(src) {
  try { return await createImageBitmap(src, { imageOrientation: 'from-image' }); }
  catch { return await createImageBitmap(src); }
}

export function openPhotoEditor(fileOrBlob, opts = {}) {
  return new Promise((resolve) => {
    const modelSpec = normalizeSpec(opts?.spec);
    const saved = readSaved();
    let spec = saved ? normalizeSpec(saved, modelSpec) : modelSpec;
    let pending = null; // foto que no logró el peso máximo: se acepta con un segundo clic
    const uidp = 'pe' + (++peSeq);
    const dlg = el('dialog', 'pe-dialog mn-dialog');
    dlg.setAttribute('aria-labelledby', uidp + '-title');
    const wrap = el('div', 'pe-wrap');
    const title = el('h2', 'pe-title', 'Ajusta tu fotografía'); title.id = uidp + '-title';
    const closeB = el('button', 'mn-btn mn-btn--quiet mn-btn--sm mn-btn--icon'); closeB.type = 'button';
    closeB.setAttribute('aria-label', 'Cerrar'); closeB.append(icon('x'));
    const head = el('div', 'mn-dialog__head pe-head'); head.append(title, closeB);
    const stage = el('div', 'pe-stage');
    const canvas = el('canvas', 'pe-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Vista previa de la foto recortada');
    const guide = el('div', 'pe-guide');
    // Guías (tercios, óvalo del rostro, hombros) calculadas para el aspecto elegido; para 3:4 dan el dibujo de siempre.
    const drawGuide = () => {
      const f = (n) => Math.round(n * 100) / 100;
      const H = f(300 * spec.height / spec.width), k = H / 400, ry = f(H * 0.22), rx = f(Math.min(ry * 0.75, 90));
      guide.innerHTML = `<svg viewBox="0 0 300 ${H}" preserveAspectRatio="none" aria-hidden="true">`
        + `<path class="pe-grid" d="M100 0V${H}M200 0V${H}M0 ${f(H / 3)}H300M0 ${f(H * 2 / 3)}H300"/>`
        + `<ellipse cx="150" cy="${f(H * 0.42)}" rx="${rx}" ry="${ry}"/><path d="M45 ${H}C45 ${f(335 * k)} 95 ${f(300 * k)} 150 ${f(300 * k)}S255 ${f(335 * k)} 255 ${H}"/></svg>`;
    };
    stage.append(canvas, guide);

    let rid = 0;
    const mkRange = (label, min, max, step, val) => {
      const id = uidp + '-r' + (++rid);
      const lab = el('label', 'mn-label', label); lab.htmlFor = id;
      const inp = el('input', 'mn-range'); inp.type = 'range'; inp.id = id;
      Object.assign(inp, { min, max, step, value: val });
      const box = el('div', 'mn-field'); box.append(lab, inp);
      return { lab, inp, box };
    };
    const zoomC = mkRange('Zoom', 0.5, 4, 0.01, 1);
    const briC = mkRange('Brillo', 0.5, 1.5, 0.01, 1);
    const conC = mkRange('Contraste', 0.5, 1.5, 0.01, 1);
    const ctrl = el('div', 'pe-ctrl');
    for (const c of [zoomC, briC, conC]) ctrl.append(c.box);

    const mkBtn = (t, kind = '') => {
      const b = el('button', 'mn-btn' + (kind ? ' mn-btn--' + kind : ''), t); b.type = 'button'; return b;
    };
    const rotB = mkBtn('Girar 90°', 'sm'), flipB = mkBtn('Voltear', 'sm'), resetB = mkBtn('Restablecer', 'sm');
    for (const b of [rotB, flipB, resetB]) b.className = 'mn-btn mn-btn--sm';
    const tools = el('div', 'pe-row'); tools.append(rotB, flipB, resetB);
    const cancelB = mkBtn('Cancelar', 'quiet'), okB = mkBtn('Guardar foto', 'primary');
    const actions = el('div', 'mn-dialog__foot pe-foot'); actions.append(cancelB, okB);
    const hint = el('p', 'mn-help pe-hint');
    const err = el('p', 'mn-error pe-err'); err.setAttribute('role', 'alert');

    // Formato de salida: predefinido o propio, y peso máximo opcional.
    const fmtId = uidp + '-fmt', wId = uidp + '-w', hId = uidp + '-h', kbId = uidp + '-kb';
    const fmtSel = el('select', 'mn-select'); fmtSel.id = fmtId;
    const optsList = [
      ...(PRESETS.some((p) => p.width === modelSpec.width && p.height === modelSpec.height) ? [] : [{ id: 'modelo', label: `Del formato (${modelSpec.width} × ${modelSpec.height} px)` }]),
      ...PRESETS, { id: 'custom', label: 'Personalizada (medidas en px)' },
    ];
    for (const o of optsList) { const op = el('option', '', o.label); op.value = o.id; fmtSel.append(op); }
    const fmtLab = el('label', 'mn-label', 'Formato de la foto'); fmtLab.htmlFor = fmtId;
    const numIn = (id, min, max, ph) => { const i = el('input', 'mn-input'); Object.assign(i, { id, type: 'number', min, max, step: 1, inputMode: 'numeric', placeholder: ph || '' }); return i; };
    const wIn = numIn(wId, LIMITS.minPx, LIMITS.maxPx), hIn = numIn(hId, LIMITS.minPx, LIMITS.maxPx), kbIn = numIn(kbId, LIMITS.minKB, LIMITS.maxKB, 'Sin límite');
    const labelFor = (t, id) => { const l = el('label', 'mn-label', t); l.htmlFor = id; return l; };
    const field = (...kids) => { const d = el('div', 'mn-field'); d.append(...kids); return d; };
    const dimsBox = el('div', 'pe-dims'); dimsBox.append(field(labelFor('Ancho (px)', wId), wIn), field(labelFor('Alto (px)', hId), hIn));
    const kbHelp = el('p', 'mn-help pe-kbhelp', 'La app baja la calidad (y, si hace falta, el tamaño) hasta que el archivo no pase de este peso.'); kbHelp.id = uidp + '-kbh';
    kbIn.setAttribute('aria-describedby', kbHelp.id);
    const fmtBox = el('div', 'pe-fmt'); fmtBox.append(field(fmtLab, fmtSel), dimsBox, field(labelFor('Peso máximo (KB, opcional)', kbId), kbIn, kbHelp));
    const side = el('div', 'pe-side'); side.append(fmtBox, hint, ctrl, tools, err);
    const body = el('div', 'mn-dialog__body pe-body'); body.append(stage, side);
    wrap.append(head, body, actions);
    dlg.append(wrap);
    document.body.append(dlg);

    let bmp = null, done = false, ro = null;
    const st = { zoom: 1, tx: 0, ty: 0, rot: 0, flip: false, bri: 1, con: 1 };
    const prevFocus = document.activeElement;

    const finish = (val) => {
      if (done) return; done = true;
      try { dlg.close(); } catch { /* ya cerrado */ }
      dlg.remove();
      ro?.disconnect();
      bmp?.close?.();
      try { prevFocus?.focus?.(); } catch { /* sin foco previo */ }
      resolve(val);
    };

    const dims = (fw, fh) => {
      const odd = st.rot % 2 === 1;
      const rw = odd ? bmp.height : bmp.width, rh = odd ? bmp.width : bmp.height;
      const sc = Math.max(fw / rw, fh / rh) * st.zoom;
      return { sc, dw: rw * sc, dh: rh * sc };
    };
    const clamp = (fw, fh) => {
      const { dw, dh } = dims(fw, fh);
      const mx = (dw + fw) / 2 - fw * 0.25, my = (dh + fh) / 2 - fh * 0.25;
      st.tx = Math.max(-mx, Math.min(mx, st.tx));
      st.ty = Math.max(-my, Math.min(my, st.ty));
    };
    const hasFilter = () => 'filter' in CanvasRenderingContext2D.prototype;

    // Dibuja con tamano ow x oh; k = ow / ancho del marco en pantalla.
    const render = (ctx, ow, oh, k, fw, fh) => {
      ctx.save();
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ow, oh);
      const { sc } = dims(fw, fh);
      const useF = hasFilter();
      if (useF) ctx.filter = `brightness(${st.bri}) contrast(${st.con})`;
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(ow / 2 + st.tx * k, oh / 2 + st.ty * k);
      ctx.scale(st.flip ? -1 : 1, 1);
      ctx.rotate(st.rot * Math.PI / 2);
      ctx.scale(sc * k, sc * k);
      ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
      ctx.restore();
      if (!useF && (st.bri !== 1 || st.con !== 1)) {
        const id = ctx.getImageData(0, 0, ow, oh), d = id.data;
        for (let i = 0; i < d.length; i += 4) {
          for (let c = 0; c < 3; c++) d[i + c] = ((d[i + c] * st.bri) - 128) * st.con + 128;
        }
        ctx.putImageData(id, 0, 0);
      }
    };

    const draw = () => {
      pending = null;
      if (!bmp) return;
      const fw = canvas.clientWidth, fh = canvas.clientHeight;
      if (!fw) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pw = Math.round(fw * dpr), ph = Math.round(fh * dpr);
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      clamp(fw, fh);
      render(canvas.getContext('2d'), pw, ph, pw / fw, fw, fh);
    };

    const sync = () => {
      zoomC.inp.value = st.zoom; briC.inp.value = st.bri; conC.inp.value = st.con;
      draw();
    };

    zoomC.inp.addEventListener('input', () => { st.zoom = +zoomC.inp.value; draw(); });
    briC.inp.addEventListener('input', () => { st.bri = +briC.inp.value; draw(); });
    conC.inp.addEventListener('input', () => { st.con = +conC.inp.value; draw(); });
    rotB.onclick = () => { st.rot = (st.rot + 1) % 4; st.tx = st.ty = 0; sync(); };
    flipB.onclick = () => { st.flip = !st.flip; st.tx = -st.tx; sync(); };
    resetB.onclick = () => { Object.assign(st, { zoom: 1, tx: 0, ty: 0, rot: 0, flip: false, bri: 1, con: 1 }); sync(); };
    cancelB.onclick = () => finish(null);
    closeB.onclick = () => finish(null);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener('close', () => finish(null));

    const setZoom = (z) => { st.zoom = Math.max(0.5, Math.min(4, z)); sync(); };
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      setZoom(st.zoom * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    const applySpec = () => {
      pending = null;
      const r = spec.width / spec.height;
      stage.style.aspectRatio = `${spec.width} / ${spec.height}`;
      stage.style.maxWidth = `${(60 * r).toFixed(1)}vh`;
      canvas.setAttribute('aria-label', `Vista previa de la foto recortada, formato ${spec.aspect}`);
      hint.textContent = `Encuadre ${spec.aspect} (${spec.width} × ${spec.height} px)${spec.maxKB ? `, máximo ${spec.maxKB} KB` : ''}. Arrastra para mover y centrar tu rostro; rueda o pellizco para acercar.`;
      const id = presetIdOf(spec);
      const cur = fmtSel.value === 'custom' ? 'custom' : fmtSel.value === 'modelo' && spec.width === modelSpec.width && spec.height === modelSpec.height ? 'modelo' : id;
      fmtSel.value = [...fmtSel.options].some((o) => o.value === cur) ? cur : 'custom';
      dimsBox.hidden = fmtSel.value !== 'custom';
      wIn.value = spec.width; hIn.value = spec.height; kbIn.value = spec.maxKB || '';
      drawGuide();
      saveSpec(spec);
      draw();
    };
    fmtSel.addEventListener('change', () => {
      err.textContent = '';
      const v = fmtSel.value;
      if (v === 'custom') { dimsBox.hidden = false; wIn.focus(); return; }
      const base = v === 'modelo' ? modelSpec : PRESETS.find((p) => p.id === v);
      spec = normalizeSpec({ width: base.width, height: base.height, maxKB: v === 'modelo' ? modelSpec.maxKB : spec.maxKB });
      applySpec();
    });
    const dimsChange = () => { err.textContent = ''; spec = normalizeSpec({ width: wIn.value, height: hIn.value, maxKB: spec.maxKB }, spec); applySpec(); };
    wIn.addEventListener('change', dimsChange); hIn.addEventListener('change', dimsChange);
    kbIn.addEventListener('change', () => {
      const raw = kbIn.value.trim(), kb = parseMaxKB(raw);
      err.textContent = raw && kb == null ? `El peso máximo debe estar entre ${LIMITS.minKB} y ${LIMITS.maxKB} KB; se ignoró.` : '';
      spec = { ...spec, maxKB: kb };
      applySpec();
    });

    const ptrs = new Map();
    let pinch0 = null;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.classList.add('pe-drag');
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: st.zoom };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size >= 2 && pinch0) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0.d > 0) setZoom(pinch0.z * d / pinch0.d);
      } else {
        st.tx += dx; st.ty += dy; draw();
      }
    });
    const up = (e) => {
      ptrs.delete(e.pointerId); pinch0 = null;
      if (!ptrs.size) stage.classList.remove('pe-drag');
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', 'Encuadre de la foto');
    stage.setAttribute('aria-describedby', uidp + '-hint');
    hint.id = uidp + '-hint';
    stage.addEventListener('keydown', (e) => {
      const s = 10, m = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
      if (m) { e.preventDefault(); st.tx += m[0]; st.ty += m[1]; draw(); }
      else if (e.key === '+' || e.key === '=') setZoom(st.zoom * 1.1);
      else if (e.key === '-') setZoom(st.zoom / 1.1);
    });

    okB.onclick = async () => {
      if (!bmp) return;
      if (pending) { finish(pending); return; } // segundo clic: se acepta la foto que no logró el peso
      okB.disabled = true; err.textContent = '';
      const fw = canvas.clientWidth, fh = canvas.clientHeight;
      clamp(fw, fh);
      const encode = (w, h, q) => new Promise((res, rej) => {
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        render(out.getContext('2d', { willReadFrequently: !hasFilter() }), w, h, w / fw, fw, fh);
        out.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', q);
      });
      try {
        const r = await fitToWeight(encode, spec.width, spec.height, spec.maxKB);
        if (done) return;
        if (!r.ok) {
          pending = r.blob;
          err.textContent = `No se logró bajar de ${spec.maxKB} KB sin dejar la foto muy pequeña: quedaría en ${Math.round(r.blob.size / 1024)} KB. Sube el peso máximo o pulsa «Guardar foto» otra vez para usarla así.`;
          okB.disabled = false;
          return;
        }
        finish(r.blob);
      } catch { err.textContent = 'No se pudo generar la imagen.'; okB.disabled = false; }
    };

    ro = new ResizeObserver(draw);
    ro.observe(stage);
    applySpec();
    dlg.showModal();
    okB.disabled = true;
    loadBitmap(fileOrBlob).then((b) => {
      if (done) { b.close?.(); return; }
      bmp = b; okB.disabled = false; draw();
    }).catch(() => { err.textContent = 'No se pudo leer la imagen.'; });
  });
}
