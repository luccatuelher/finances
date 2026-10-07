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
    // Só os arquivos do app: nada de .git/.claude nem caminhos fora da pasta
    if (!p.startsWith(process.cwd() + '/') || /\/\.(git|claude)(\/|$)/.test(p)) { res.writeHead(404); res.end(); return; }
    let body = await readFile(p.endsWith('/') ? p + 'index.html' : p);
    // Os testes (tools/testes.js) não fazem parte do app publicado: entram só aqui, como <script> comum
    // depois do script do app (escopo global compartilhado com as funções e variáveis do app)
    if (extname(p) === '.html') body = Buffer.from(body.toString().replace('</body>', '<script src="/tools/testes.js"></script>\n</body>'));
    res.writeHead(200, { 'content-type': TIPOS[extname(p)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(5577, '127.0.0.1');

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
    // Orçamento (roda) e Mensal (cascata, calendário) são desenhados sem o Chart.js
    if (v !== 'metas' && v !== 'mensal' && (!total || vazios.length)) graficos.push(`${v}: ${total} canvas, vazios: ${vazios.join(',') || '(nenhum canvas)'}`);
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
// Celular: o modo body.mobile vem do user-agent (não da largura) e usa outras telas/formulários
const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
const mpg = await mctx.newPage(); const merros = [];
mpg.on('pageerror', e => merros.push(e.message));
mpg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: net::/.test(m.text())) merros.push(m.text()); });
if (chartjs) await mpg.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: chartjs }));
await mpg.goto(url); await mpg.waitForFunction(() => typeof runSelfTests === 'function');
const mob = await mpg.evaluate(async () => ({ mobile: IS_MOBILE, self: (await runSelfTests()).fails, fuzz: await runFuzz() }));
const mobilFalhas = (mob.mobile ? 0 : 1) + mob.self.length + (mob.fuzz || []).length + merros.length;
await mctx.close();
// Segurança: nomes/descrições hostis (HTML, aspas, </script>) em todas as telas + clique em tudo que os carrega no handler
const xctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const xpg = await xctx.newPage(); const xerros = [];
xpg.on('pageerror', e => xerros.push(e.message)); xpg.on('dialog', d => d.dismiss());
if (chartjs) await xpg.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: chartjs }));
await xpg.goto(url); await xpg.waitForFunction(() => typeof runSelfTests === 'function');
const xss = await xpg.evaluate(async () => {
  const P = ['"><img src=x onerror=window.__xss=1>', "'-window.__xss=1-'", '</script><img src=x onerror=window.__xss=1>', '<svg onload=window.__xss=1>', '`${window.__xss=1}`', '"onmouseover="window.__xss=1'];
  const d = todayLocalISO(), cat = '🍔 ' + P[0].slice(0, 50), cat2 = '📦 ' + P[1];
  const t = P.map((x, i) => ({ id: 100 + i, desc: x, valor: 10 + i, data: d, tipo: ['saida', 'entrada', 'investimento'][i % 3], cat: i % 2 ? cat2 : cat, fixo: i === 2, pagamento: i % 3 === 0 ? 'credito' : (i % 3 === 1 ? null : 'debito'), cartaoId: i % 3 === 0 ? 900 : null }));
  restoreState(sanitizeState({ t, c: { saida: [cat, cat2], entrada: [cat2], investimento: [cat] }, g: [{ id: 800, nome: P[3], descricao: P[0], meta: 100, cor: '"><x', aportes: [{ valor: 5, data: d, nota: P[1] }] }], k: [{ id: 900, nome: P[2], fechamento: 5, vencimento: 10, cor: 'red;background:url(javascript:1)' }], b: { total: 1000, allocs: { [cat]: 30, [cat2]: 10 } } }));
  renderAll(); renderGoals(); renderCartoesMini();
  let cliques = 0;
  for (const v of ['dashboard', 'anual', 'mensal', 'metas']) {
    navTo(v, [...document.querySelectorAll('.nav-pill')].find(b => (b.getAttribute('onclick') || '').includes("'" + v + "'")) || null); await new Promise(r => setTimeout(r, 250));
    for (const e of [...document.querySelectorAll('[onclick], [onchange]')].filter(e => /xss|img|svg|script/i.test((e.getAttribute('onclick') || '') + (e.getAttribute('onchange') || '')))) { try { e.click(); cliques++; } catch {} }
    // Orçamento: sem handlers inline (delegação por índice); clica nas linhas, fatias e ações que levam os nomes hostis
    if (v === 'metas') for (const sel of ['#budgetCatList .orc-row', '#orcSlices path[data-kind]', '#orcSel [data-act]:not([data-act="excluir"])', '#orcEntradasList [data-ent-act="renomear"]'])
      for (let i = 0, n = document.querySelectorAll(sel).length; i < n; i++) {   // cada clique redesenha: busca de novo
        const e = document.querySelectorAll(sel)[i]; if (!e) break;
        try { e.dispatchEvent(new MouseEvent('click', { bubbles: true })); cliques++; } catch {}
      }
    await new Promise(r => setTimeout(r, 150));
  }
  const injetados = [...document.querySelectorAll('img[src="x"], svg[onload], [onerror], [onmouseover], [onload]')].length;
  return { executou: window.__xss || null, injetados, cliques };
});
await xctx.close();
const xssFalhas = (xss.executou ? 1 : 0) + xss.injetados + xerros.length + (xss.cliques ? 0 : 1);

const falhas = r.self.fails.length + r.sync.length + (r.fuzz || []).length + erros.length + graficos.length + fusoFalhas.length + mobilFalhas + xssFalhas;
console.log(`autoteste ${r.self.total - r.self.fails.length}/${r.self.total} · sync ${r.sync.length} problema(s) · fuzz ${(r.fuzz || []).length} violação(ões) · console ${erros.length} erro(s) · segurança ${xssFalhas ? xssFalhas + ' problema(s)' : 'ok (' + xss.cliques + ' cliques)'} · celular ${mobilFalhas ? mobilFalhas + ' problema(s)' : 'ok'} · fusos ${fusoFalhas.length ? fusoFalhas.length + ' problema(s)' : fusos.length + ' ok'} · gráficos ${chartjs ? (graficos.length ? graficos.length + ' problema(s)' : 'ok') : 'não verificados (sem tools/.cache/chart.umd.min.js)'}`);
if (falhas) console.log(JSON.stringify({ fails: r.self.fails, sync: r.sync, fuzz: r.fuzz, erros, graficos, fusoFalhas, mobil: { ...mob, merros }, xss, xerros }, null, 2));
// Sem fechar o navegador e o servidor o processo nunca terminava quando tudo passava (parecia travado)
await browser.close(); server.close();
process.exit(falhas ? 1 : 0);
