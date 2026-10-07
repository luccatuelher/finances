// Service worker do app de finanças: deixa o próprio arquivo (e as bibliotecas das CDNs)
// abrirem sem rede. Estratégia "rede primeiro": com internet o usuário sempre recebe a
// versão nova do index.html (nunca fica preso numa versão antiga em cache); sem internet
// usa a última cópia guardada. Dados do usuário NÃO passam por aqui (localStorage/Firebase).
// Na instalação já guarda o app, o manifest e os ícones: a 1ª visita também abre offline.
const CACHE = 'finances-v2';
const CDNS = ['cdn.jsdelivr.net', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const MAX_ITENS = 60;   // limite do cache de terceiros (fontes/CDN) e das cópias de navegação

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function aparar(cache) {
  const ks = await cache.keys();
  if (ks.length > MAX_ITENS) await Promise.all(ks.slice(0, ks.length - MAX_ITENS).map(k => cache.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const mesmaOrigem = url.origin === self.location.origin;
  if (!mesmaOrigem && !CDNS.includes(url.hostname)) return;   // Firebase/Auth/API: direto na rede
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(CACHE); c.put(req, res.clone()).then(() => aparar(c)).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: mesmaOrigem && req.mode === 'navigate' });
      if (hit) return hit;
      throw err;
    }
  })());
});
