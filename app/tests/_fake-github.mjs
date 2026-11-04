// GitHub falso (solo los endpoints de Gist que usa js/sync/gist.js), en memoria. Lo usan las pruebas unitarias (como `fetch`) y las e2e
// (tests-e2e/specs/sync.spec.mjs, con page.route). NUNCA se llama a la API real ni se usa un token real.
export const FAKE_TOKEN = 'ghp_' + 'FAKE0TOKEN0FOR0TESTS0ONLY0000000';

export function createFakeGitHub({ token = FAKE_TOKEN, login = 'aspirante-prueba', scopes = 'gist' } = {}) {
  const gists = new Map();
  let seq = 0, clock = Date.parse('2026-11-01T00:00:00Z');
  const calls = [];
  const opts = { rateLimited: false, fail: null };
  const etag = (g) => `W/"v${g.version}"`;
  const view = (g, withContent) => ({
    id: g.id, description: g.description, public: g.public, updated_at: g.updated_at,
    files: Object.fromEntries(Object.entries(g.files).map(([n, f]) => [n, withContent
      ? { filename: n, size: f.content.length, truncated: f.content.length > 1048576, content: f.content.slice(0, 1048576) }
      : { filename: n, size: f.content.length }])),
  });
  const res = (status, body, headers = {}) => ({ status, body: body === undefined ? '' : JSON.stringify(body), headers: { 'content-type': 'application/json; charset=utf-8', 'x-ratelimit-remaining': '4999', ...headers } });
  const touch = (g) => { g.version++; clock += 1000; g.updated_at = new Date(clock).toISOString(); };

  /** handle({method, url, headers, body}) -> {status, headers, body(texto)} */
  function handle({ method, url, headers = {}, body = null }) {
    const u = new URL(url);
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method, path: u.pathname + u.search, auth: !!h.authorization, bytes: body ? body.length : 0 });
    if (u.origin !== 'https://api.github.com') return res(599, { message: 'host inesperado' });
    if (h.authorization !== `Bearer ${token}`) return res(401, { message: 'Bad credentials' });
    if (opts.rateLimited) return res(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.parse('2026-11-01T15:30:00Z') / 1000)) });
    if (opts.fail) { const f = opts.fail; if (!f.method || f.method === method) return res(f.status, { message: f.message || 'fallo simulado' }); }
    const path = u.pathname;
    if (method === 'GET' && path === '/user') return res(200, { login }, scopes === null ? {} : { 'x-oauth-scopes': scopes });
    if (method === 'GET' && path === '/gists') {
      const per = Number(u.searchParams.get('per_page') || 30), page = Number(u.searchParams.get('page') || 1);
      const list = [...gists.values()].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice((page - 1) * per, page * per);
      return res(200, list.map((g) => view(g, false)));
    }
    if (method === 'POST' && path === '/gists') {
      const b = JSON.parse(body || '{}');
      const files = {};
      for (const [n, f] of Object.entries(b.files || {})) { if (!f || typeof f.content !== 'string' || !f.content) return res(422, { message: 'Validation Failed' }); files[n] = { content: f.content }; }
      if (!Object.keys(files).length) return res(422, { message: 'Validation Failed' });
      const id = (++seq).toString(16).padStart(32, 'a');
      const g = { id, description: b.description || '', public: !!b.public, files, version: 0, updated_at: '' };
      touch(g); gists.set(id, g);
      return res(201, view(g, true), { etag: etag(g) });
    }
    const m = /^\/gists\/([0-9a-f]+)$/.exec(path);
    if (m) {
      const g = gists.get(m[1]);
      if (!g) return res(404, { message: 'Not Found' });
      if (method === 'GET') {
        if (h['if-none-match'] && h['if-none-match'] === etag(g)) return { status: 304, body: '', headers: { etag: etag(g) } };
        return res(200, view(g, true), { etag: etag(g) });
      }
      if (method === 'PATCH') {
        const b = JSON.parse(body || '{}');
        const next = { ...g.files };
        for (const [n, f] of Object.entries(b.files || {})) {
          if (f === null) { if (!next[n]) return res(422, { message: 'Validation Failed' }); delete next[n]; }
          else if (typeof f.content === 'string' && f.content) next[n] = { content: f.content };
          else return res(422, { message: 'Validation Failed' });
        }
        if (!Object.keys(next).length) return res(422, { message: 'Validation Failed' });
        g.files = next; touch(g);
        return res(200, view(g, true), { etag: etag(g) });
      }
    }
    return res(404, { message: 'Not Found' });
  }

  /** `fetch` compatible para Node (Response global). */
  async function fetch(url, init = {}) {
    const r = handle({ method: init.method || 'GET', url: String(url), headers: init.headers || {}, body: init.body ?? null });
    return new Response(r.status === 304 || r.status === 204 ? null : r.body, { status: r.status === 599 ? 500 : r.status, headers: r.headers });
  }
  return { handle, fetch, gists, calls, opts, token };
}
