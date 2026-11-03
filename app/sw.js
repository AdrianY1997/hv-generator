// Service worker de HV Minerva (G16): uso sin conexión.
// - Precache del "shell" (index, css, fuentes, módulos js) en la instalación.
// - En ejecución: cache-first para GET del mismo origen (incluye vendor/pdfjs, vendor/pdf-lib y lo que se cargue después).
// - Cache versionada; las anteriores se borran al activar. La versión nueva espera hasta que la persona pulse "Recargar".
// - Todas las rutas son relativas al scope (sirve bajo /<repo>/ en GitHub Pages).
//
// VERSION: el workflow de Pages reemplaza __BUILD__ por el SHA del commit. Sin sustituir (desarrollo local) el worker
// va "red primero" para no servir código viejo; con versión real va "cache primero".
const VERSION = '__BUILD__';
const DEV = VERSION.startsWith('__');
const PREFIX = 'hv-app-';
const CACHE = PREFIX + VERSION;

// Mínimo imprescindible: si falla, la instalación falla (no se activa una versión incompleta).
const CORE = ['./', 'index.html', 'css/tokens.css', 'css/styles.css', 'js/main.js'];
// El resto se intenta; un archivo que no exista (módulo renombrado) no impide instalar y se cachea al usarse.
const MORE = [
  'css/print.css', 'css/paper.css', 'css/photo-editor.css', 'css/import-dialog.css',
  'fonts/Inter-var.woff2', 'fonts/Newsreader-var.woff2', 'fonts/Newsreader-italic-var.woff2',
  'js/router.js', 'js/ui.js', 'js/store.js', 'js/migrate.js', 'js/orphans.js', 'js/notices.js', 'js/sw-register.js', 'js/backup-validate.js', 'js/backup-crypto.js', 'js/backup-merge.js', 'js/import-dialog.js',
  'js/template-model.js', 'js/forms.js', 'js/photo-editor.js', 'js/export.js', 'js/doc-parse.js', 'js/doc-sources.js', 'js/pdf-ingest.js',
  'js/package-plan.js', 'js/pdf-package.js',
  'js/validators.js', 'js/conditions.js', 'js/photo-spec.js', 'js/template-check.js', 'js/a11y.js',
  'js/models/index.js', 'js/models/minerva.js', 'js/models/minerva-layout.js', 'js/models/minerva-fit.js',
  'js/views/perfil.js', 'js/views/documentos.js', 'js/views/plantillas.js', 'js/views/vista-previa.js', 'js/views/ajustes.js',
];
const abs = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE.map((p) => new Request(abs(p), { cache: 'reload' })));
    await Promise.allSettled(MORE.map((p) => cache.add(new Request(abs(p), { cache: 'reload' }))));
    if (DEV) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function store(cache, request, response) {
  if (response && response.ok && response.status === 200 && response.type === 'basic') {
    try { await cache.put(request, response.clone()); } catch { /* cuota llena: se sirve sin cachear */ }
  }
  return response;
}

async function handle(request) {
  const cache = await caches.open(CACHE);
  const isNav = request.mode === 'navigate';
  const opts = isNav ? { ignoreSearch: true } : undefined;
  if (DEV) {
    try { return await store(cache, request, await fetch(request)); }
    catch { return (await cache.match(request, opts)) || (isNav && (await cache.match(abs('index.html')))) || Response.error(); }
  }
  const hit = await cache.match(request, opts);
  if (hit) return hit;
  try { return await store(cache, request, await fetch(request)); }
  catch {
    if (isNav) { const shell = await cache.match(abs('index.html')); if (shell) return shell; }
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const r = event.request;
  if (r.method !== 'GET' || r.headers.has('range')) return;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(handle(r));
});
