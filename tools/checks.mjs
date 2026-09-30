// Roda a bateria do app num Chromium headless: boot de aparelho novo, autoteste,
// fuzz de sincronização e fuzz de interface. Sai com código 1 se algo falhar.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const p = join(process.cwd(), decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const body = await readFile(p.endsWith('/') ? p + 'index.html' : p);
    res.writeHead(200, { 'content-type': TIPOS[extname(p)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(5577);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
const erros = [];
// Falha de rede (CDN bloqueada no sandbox) não conta como erro
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: net::/.test(m.text())) erros.push(m.text()); });
page.on('pageerror', e => erros.push(e.message));
const url = 'http://localhost:5577/index.html?preview=1';

// Gráficos: a CDN do Chart.js é bloqueada em sandboxes. Se houver uma cópia local (mesmos bytes da
// versão fixada no app, então o SRI confere), ela é servida no lugar e os gráficos são conferidos:
//   mkdir -p tools/.cache && (cd tools/.cache && npm pack chart.js@4.5.1 && tar xzf chart.js-4.5.1.tgz && cp package/dist/chart.umd.min.js .)
const chartFile = join(process.cwd(), 'tools/.cache/chart.umd.min.js');
const chartjs = await readFile(chartFile).catch(() => null);
if (chartjs) await page.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: chartjs }));

// Boot de aparelho novo: esquema salvo antigo força o caminho de migração no carregamento
await page.goto(url);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('preview:fin5_schema', '2'); });
await page.goto(url);
await page.waitForFunction(() => typeof runSelfTests === 'function');

const r = await page.evaluate(async () => ({
  self: await runSelfTests(),
  sync: await runSyncFuzz(),
  fuzz: await runFuzz(),
}));

// Conferência dos gráficos (só com o Chart.js local): cada tela mostra canvases pintados, sem erros
const graficos = [];
if (chartjs) {
  await page.evaluate(() => setFiltro(1, 2026));   // mês dos dados de exemplo
  for (const v of ['dashboard', 'anual', 'mensal', 'metas']) {
    await page.evaluate(v => navTo(v, [...document.querySelectorAll('.nav-pill')].find(b => (b.getAttribute('onclick') || '').includes("'" + v + "'"))), v);
    await page.waitForTimeout(600);
    const vazios = await page.evaluate(() => [...document.querySelectorAll('canvas')].filter(c => c.offsetParent).filter(c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) return false;
      return true;
    }).map(c => c.id));
    const total = await page.evaluate(() => [...document.querySelectorAll('canvas')].filter(c => c.offsetParent).length);
    if (v !== 'metas' && (!total || vazios.length)) graficos.push(`${v}: ${total} canvas, vazios: ${vazios.join(',') || '(nenhum canvas)'}`);
  }
}

// Fusos e viradas: "hoje" e o autoteste sob relógio simulado (fronteira de dia, mês, ano bissexto, UTC+14, UTC-11)
const fusos = [
  ['America/Sao_Paulo', '2026-01-31T23:59:30-03:00', '2026-01-31'], ['America/Sao_Paulo', '2026-03-01T00:00:30-03:00', '2026-03-01'],
  ['Pacific/Kiritimati', '2026-02-28T23:59:00+14:00', '2026-02-28'], ['Pacific/Pago_Pago', '2026-12-31T23:30:00-11:00', '2026-12-31'],
  ['UTC', '2028-02-29T00:00:10Z', '2028-02-29'],
];
const fusoFalhas = [];
for (const [tz, quando, esperado] of fusos) {
  const ctx = await browser.newContext({ timezoneId: tz }); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.clock.install({ time: new Date(quando) });
  await pg.goto(url); await pg.waitForFunction(() => typeof runSelfTests === 'function');
  const f = await pg.evaluate(async () => { const st = await runSelfTests(); return { hoje: todayLocalISO(), campo: (document.getElementById('data') || {}).value, fails: st.fails }; });
  if (f.hoje !== esperado || f.campo !== esperado || f.fails.length || errs.length) fusoFalhas.push({ tz, quando, esperado, ...f, errs });
  await ctx.close();
}
await browser.close(); server.close();

const falhas = r.self.fails.length + r.sync.length + (r.fuzz || []).length + erros.length + graficos.length + fusoFalhas.length;
console.log(`autoteste ${r.self.total - r.self.fails.length}/${r.self.total} · sync ${r.sync.length} problema(s) · fuzz ${(r.fuzz || []).length} violação(ões) · console ${erros.length} erro(s) · fusos ${fusoFalhas.length ? fusoFalhas.length + ' problema(s)' : fusos.length + ' ok'} · gráficos ${chartjs ? (graficos.length ? graficos.length + ' problema(s)' : 'ok') : 'não verificados (sem tools/.cache/chart.umd.min.js)'}`);
if (falhas) { console.log(JSON.stringify({ fails: r.self.fails, sync: r.sync, fuzz: r.fuzz, erros, graficos, fusoFalhas }, null, 2)); process.exit(1); }
