// Registro del service worker (G16). Solo en https o localhost; ruta relativa (sirve bajo /<repo>/).
import { toastAction } from './ui.js';

const secure = () => location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

export function registerSW() {
  if (!('serviceWorker' in navigator) || !secure()) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  // Tras "Recargar" el worker nuevo toma el control: se recarga una sola vez (y no en la primera instalación).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  const offer = (worker) => toastAction('Nueva versión disponible.', 'Recargar', () => worker.postMessage({ type: 'SKIP_WAITING' }));
  const start = async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js'); // relativo al documento: /<repo>/sw.js, scope /<repo>/
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    } catch (e) { console.warn('Service worker no disponible:', e); }
  };
  if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });
}
