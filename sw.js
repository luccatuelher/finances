// Service worker do app de finanças: deixa o próprio arquivo (e as bibliotecas das CDNs)
// abrirem sem rede. Estratégia "rede primeiro": com internet o usuário sempre recebe a
// versão nova do index.html (nunca fica preso numa versão antiga em cache); sem internet
// usa a última cópia guardada. Dados do usuário NÃO passam por aqui (localStorage/Firebase).
// Na instalação já guarda o app, o manifest e os ícones: a 1ª visita também abre offline.
const CACHE = 'finances-v3';
const CDNS = ['cdn.jsdelivr.net', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
// Obrigatórios: o app só vale com TODOS (versões misturadas de index.html/app.js quebrariam os handlers).
const ESSENCIAIS = ['./', './index.html', './app.js', './handlers.js', './tema.js'];
const OPCIONAIS = ['./manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const MAX_ITENS = 60;   // limite do cache de terceiros (fontes/CDN) e das cópias de navegação

self.addEventListener('install', e => {
  // 'reload' ignora o cache HTTP do navegador (GitHub Pages: max-age=600), senão index.html e app.js poderiam vir de versões diferentes.
  // Falha em qualquer essencial = instalação falha e o service worker antigo continua valendo.
  e.waitUntil(caches.open(CACHE).then(async c => {
    await Promise.all(ESSENCIAIS.map(u => c.add(new Request(u, { cache: 'reload' }))));
    await Promise.all(OPCIONAIS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  }).then(() => self.skipWaiting()));
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
      // mesma origem: sempre revalida (index.html e app.js precisam ser da mesma versão)
      const res = await fetch(mesmaOrigem ? new Request(req, { cache: 'no-cache' }) : req);
      if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(CACHE); c.put(req, res.clone()).then(() => aparar(c)).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: mesmaOrigem && req.mode === 'navigate' });
      if (hit) return hit;
      throw err;
    }
  })());
});
