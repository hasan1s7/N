/* Self-contained HTML release. Never cache API responses or personal library data. */
const BUILD = 'nabu-graph-pages-20261105-r2';
const BASE = new URL('./', self.location.href);
const INDEX = new URL('./index.html', BASE).href;
const CACHE = 'nabu-translate-shell-' + encodeURIComponent(BASE.pathname) + '-' + BUILD;
const DOCUMENTS = new Set(['','index.html','translate','read','words','library','review','friends','settings'].map(p=>BASE.pathname+p));
function appDocument(pathname){return DOCUMENTS.has(pathname)||pathname.startsWith(BASE.pathname+'w/')&&/^w\/[a-z0-9][a-z0-9-]{0,63}-[A-Za-z0-9_-]{16}$/.test(pathname.slice(BASE.pathname.length));}
async function validShell(response) {
  return response.ok && (response.headers.get('content-type') || '').includes('text/html') &&
    (await response.clone().text()).includes('data-nabu-build="' + BUILD + '"');
}
self.addEventListener('install', event => event.waitUntil((async () => {
  const response = await fetch(INDEX, {cache:'reload'});
  if (!(await validShell(response))) throw new Error('Matching Nabu entry page has not deployed yet.');
  await (await caches.open(CACHE)).put(INDEX, response);
  // There is no split module graph in this release. Update stuck tabs promptly.
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Remove only this app's cached shell requests, never IndexedDB or another path.
  for (const name of await caches.keys()) {
    if (!name.startsWith('nabu-translate-shell-') || name === CACHE) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (url.origin === BASE.origin && url.pathname.startsWith(BASE.pathname)) await cache.delete(request);
    }
  }
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== BASE.origin ||
      event.request.mode !== 'navigate' || !appDocument(url.pathname)) return;
  // In particular, nabu-repair.html must always bypass the offline shell.
  event.respondWith((async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(event.request, {cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error('The server could not serve the app.');
      if (await validShell(response)) {
        try { await (await caches.open(CACHE)).put(INDEX, response.clone()); } catch {}
      }
      return response;
    } catch {
      try { const saved = await (await caches.open(CACHE)).match(INDEX); if (saved) return saved; } catch {}
      return new Response('Nabu could not load. Reconnect, then reload this page. Your saved library has not been removed.', {status:503, headers:{'Content-Type':'text/plain; charset=utf-8'}});
    } finally { clearTimeout(timeout); }
  })());
});
