import { createRouter } from './router.js';
import { registry, getModel, DEFAULT_MODEL } from './models/index.js';
import * as store from './store.js';
import { h, icon } from './ui.js';
import { initNotices } from './notices.js';
import { registerSW } from './sw-register.js';
import { focusViewHeading } from './a11y.js';

const routes = {
  '/perfil': { title: 'Perfil', load: () => import('./views/perfil.js') },
  '/documentos': { title: 'Documentos', load: () => import('./views/documentos.js') },
  '/plantillas': { title: 'Plantillas', load: () => import('./views/plantillas.js') },
  '/vista-previa': { title: 'Vista previa', load: () => import('./views/vista-previa.js') },
  '/ajustes': { title: 'Ajustes', load: () => import('./views/ajustes.js') },
};
const app = document.getElementById('app');
const nav = document.getElementById('nav');
const select = document.getElementById('model-select');
let modelId = null;
try { modelId = localStorage.getItem('hv.model'); } catch {}
if (!registry[modelId]) modelId = DEFAULT_MODEL;
let cleanup;
let shownPath = null; // vista ya pintada: el foco solo se mueve al cambiar de vista, no al cargar ni al cambiar de modelo

for (const m of Object.values(registry)) select.append(h('option', { value: m.id }, m.name));
select.value = modelId;
select.addEventListener('change', () => {
  modelId = select.value;
  try { localStorage.setItem('hv.model', modelId); } catch {}
  router.start();
});

for (const [path, r] of Object.entries(routes)) nav.append(h('a', { href: '#' + path, 'data-path': path }, r.title));

const root = document.documentElement;
try { const t = localStorage.getItem('hv.theme'); if (t) root.dataset.theme = t; } catch {}
const themeBtn = document.getElementById('theme-toggle');
const isDark = () => root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
// El icono muestra a qué tema se pasa (luna en claro, sol en oscuro).
const paintTheme = () => themeBtn.replaceChildren(icon(isDark() ? 'sun' : 'moon'));
themeBtn.addEventListener('click', () => {
  root.dataset.theme = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('hv.theme', root.dataset.theme); } catch {}
  paintTheme();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paintTheme);
paintTheme();

const router = createRouter(routes, {
  async onChange(path, route) {
    for (const a of nav.children) {
      if (a.dataset.path === path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    try { cleanup?.(); } catch (e) { console.error(e); }
    cleanup = undefined;
    document.title = `${route.title} · HV Minerva`;
    const mod = await route.load();
    if (router.current() !== path) return;
    cleanup = mod.mount(app, { model: getModel(modelId), store, router }) || undefined;
    if (shownPath && shownPath !== path) focusViewHeading(app);
    shownPath = path;
  },
});
// G15: migrar datos locales a la versión actual antes de pintar la primera vista (idempotente; un fallo no bloquea la app).
try { await Promise.race([store.migrate(), new Promise((r) => setTimeout(r, 5000))]); } catch (e) { console.error(e); }
initNotices({ store });
router.start();
registerSW();
// G04: sincronización automática entre equipos (solo si se configuró en Ajustes; módulos con carga perezosa).
try {
  if (localStorage.getItem('hv.sync.on') === '1') {
    Promise.all([import('./sync/controller.js'), import('./ui.js')])
      .then(([sync, ui]) => sync.startAutoSync({ store, toast: ui.toast }))
      .catch((e) => console.error(e));
  }
} catch { /* sin almacenamiento */ }
