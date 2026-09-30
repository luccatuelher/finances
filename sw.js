// Service worker do app de finanças: deixa o próprio arquivo (e as bibliotecas das CDNs)
// abrirem sem rede. Estratégia "rede primeiro": com internet o usuário sempre recebe a
// versão nova do index.html (nunca fica preso numa versão antiga em cache); sem internet
// usa a última cópia guardada. Dados do usuário NÃO passam por aqui (localStorage/Firebase).
const CACHE = 'finances-v1';
const CDNS = ['cdn.jsdelivr.net', 'www.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const mesmaOrigem = url.origin === self.location.origin;
  if (!mesmaOrigem && !CDNS.includes(url.hostname)) return;   // Firebase/Auth/API: direto na rede
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(CACHE); c.put(req, res.clone()).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: mesmaOrigem && req.mode === 'navigate' });
      if (hit) return hit;
      throw err;
    }
  })());
});
