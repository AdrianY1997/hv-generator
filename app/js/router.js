// Router por hash. routes: { '/perfil': { title, load: () => import(...) } }
export function createRouter(routes, { onChange, fallback = '/perfil' } = {}) {
  const current = () => {
    const p = (location.hash.replace(/^#/, '').split('?')[0]) || fallback;
    return routes[p] ? p : fallback;
  };
  const run = () => onChange?.(current(), routes[current()]);
  addEventListener('hashchange', run);
  return {
    start: run,
    current,
    query: () => new URLSearchParams(location.hash.split('?')[1] || ''),
    go: (path) => { location.hash = '#' + path; },
  };
}
