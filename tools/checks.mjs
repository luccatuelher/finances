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
// CSP: nenhuma violação (script inline, origem não permitida) em nenhuma das cargas desta página
await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
const erros = [];
// Falha de rede (CDN bloqueada no sandbox) não conta como erro
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: net::|Refused to execute inline (script|event handler)/.test(m.text())) erros.push(m.text()); });
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

const r = await page.evaluate(async () => ({ csp: window.__csp,
  self: await runSelfTests(),
  sync: await runSyncFuzz(),
  fuzz: await runFuzz(),
}));

// Conferência dos gráficos (só com o Chart.js local): cada tela mostra canvases pintados, sem erros
const graficos = [];
if (chartjs) {
  await page.evaluate(() => setFiltro(1, 2026));   // mês dos dados de exemplo
  for (const v of ['dashboard', 'anual', 'mensal', 'metas']) {
    await page.evaluate(v => navTo(v, [...document.querySelectorAll('.nav-pill')].find(b => (b.getAttribute('data-onclick') || '').includes("'" + v + "'"))), v);
    await page.waitForTimeout(600);
    const vazios = await page.evaluate(() => [...document.querySelectorAll('canvas')].filter(c => c.offsetParent).filter(c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) return false;
      return true;
    }).map(c => c.id));
    const total = await page.evaluate(() => [...document.querySelectorAll('canvas')].filter(c => c.offsetParent).length);
    // Acessibilidade: todo gráfico do Chart.js tem alternativa em texto (role=img + tabela com uma linha por rótulo)
    const semAlt = await page.evaluate(() => [...document.querySelectorAll('canvas')].filter(c => c.offsetParent && window.Chart && Chart.getChart(c)).filter(c => {
      const t = document.getElementById(c.getAttribute('aria-describedby') || '');
      return c.getAttribute('role') !== 'img' || !c.getAttribute('aria-label') || !t || t.rows.length - 1 !== Chart.getChart(c).data.labels.length; }).map(c => c.id));
    if (semAlt.length) graficos.push(`${v}: sem alternativa em texto: ${semAlt.join(',')}`);
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
// Celular: a confirmação de excluir abre POR CIMA da folha de edição (z-index) e dá para tocar nos botões
const mobConf = await mpg.evaluate(async () => {
  restoreState(sanitizeState({ t: SEED })); commitAll(); setFiltro(1, 2026);
  openMobEdit(tx[0].id); mobEditDelete(); await new Promise(r => setTimeout(r, 300));
  const b = document.querySelector('#confBotoes button:last-child'), r = b.getBoundingClientRect();
  const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const ok = !!topo && !!topo.closest('#ovConfirmar');
  _confirmarFechar(null); closeMobEdit();
  return ok;
});
if (!mobConf) mob.self.push({ name: 'celular: confirmação de excluir fica atrás da folha de edição' });
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
    navTo(v, [...document.querySelectorAll('.nav-pill')].find(b => (b.getAttribute('data-onclick') || '').includes("'" + v + "'")) || null); await new Promise(r => setTimeout(r, 250));
    for (const e of [...document.querySelectorAll('[data-onclick], [data-onchange]')].filter(e => /xss|img|svg|script/i.test((e.getAttribute('data-onclick') || '') + (e.getAttribute('data-onchange') || '')))) { try { e.click(); cliques++; } catch {} }
    // Orçamento: sem handlers inline (delegação por índice); clica nas linhas, fatias e ações que levam os nomes hostis
    if (v === 'metas') for (const sel of ['#budgetCatList .orc-row', '#orcSlices path[data-kind]', '#orcSel [data-act]:not([data-act="excluir"])', '#orcEntradasList [data-ent-act="renomear"]'])
      for (let i = 0, n = document.querySelectorAll(sel).length; i < n; i++) {   // cada clique redesenha: busca de novo
        const e = document.querySelectorAll(sel)[i]; if (!e) break;
        try { e.dispatchEvent(new MouseEvent('click', { bubbles: true })); cliques++; } catch {}
      }
    await new Promise(r => setTimeout(r, 150));
  }
  // Todo handler declarativo (inclusive com os nomes hostis) precisa ser aceito pelo executor e chamar função existente
  const ruinsHx = [];
  for (const v of ['dashboard', 'anual', 'mensal', 'metas']) {
    navTo(v, null); await new Promise(r => setTimeout(r, 120));
    for (const e of document.querySelectorAll('*')) for (const at of e.getAttributeNames().filter(n => /^data-on(click|change|input|keydown|focus|mouseenter)$/.test(n))) {
      const c = e.getAttribute(at); if (!c) continue;
      try { const ast = __hx.analisar(c); for (const st of ast) { const f = st.t === 'if' ? st.s : st; if (f.t === 'call' && f.f.t === 'id' && typeof window[f.f.n] !== 'function') ruinsHx.push(`${c.slice(0, 40)} → função "${f.f.n}" não existe`); } }
      catch (er) { ruinsHx.push(`${c.slice(0, 50)}: ${er.message}`); }
    }
  }
  const injetados = [...document.querySelectorAll('img[src="x"], svg[onload], [onerror], [onmouseover], [onload]')].length;
  return { executou: window.__xss || null, injetados, cliques, ruinsHx: [...new Set(ruinsHx)] };
});
await xctx.close();
const xssFalhas = (xss.executou ? 1 : 0) + xss.injetados + xerros.length + (xss.cliques ? 0 : 1) + xss.ruinsHx.length;

// Navegação: URL com hash restaura a tela; voltar/avançar troca de tela; modal fecha antes de voltar de tela
const nctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const npg = await nctx.newPage(); const nerros = [], navFalhas = [];
npg.on('pageerror', e => nerros.push(e.message));
if (chartjs) await npg.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: chartjs }));
await npg.goto(url + '#mensal'); await npg.waitForFunction(() => typeof runSelfTests === 'function');
const cv = () => npg.evaluate(() => currentView), hash = () => npg.evaluate(() => location.hash), ativa = () => npg.evaluate(() => (document.querySelector('.nav-pill.active') || {}).textContent);
const confere = async (nome, got, exp) => { if (JSON.stringify(got) !== JSON.stringify(exp)) navFalhas.push(`${nome}: ${JSON.stringify(got)} ≠ ${JSON.stringify(exp)}`); };
await confere('abre no hash', [await cv(), await ativa()], ['mensal', 'Mensal']);
await npg.evaluate(() => navTo('anual')); await confere('navTo muda o hash', [await cv(), await hash()], ['anual', '#anual']);
await npg.evaluate(() => navTo('metas')); await npg.goBack(); await npg.waitForTimeout(150); await confere('voltar → anual', [await cv(), await hash()], ['anual', '#anual']);
await npg.goBack(); await npg.waitForTimeout(150); await confere('voltar → mensal', await cv(), 'mensal');
await npg.goForward(); await npg.waitForTimeout(150); await confere('avançar → anual', await cv(), 'anual');
// modal: voltar fecha o modal e não muda de tela
await npg.evaluate(() => document.getElementById('ovCartoes').classList.add('open')); await npg.waitForTimeout(100);
await npg.goBack(); await npg.waitForTimeout(150);
await confere('voltar com modal fecha o modal', [await npg.evaluate(() => document.getElementById('ovCartoes').classList.contains('open')), await cv()], [false, 'anual']);
await nctx.close();
const navProblemas = navFalhas.length + nerros.length;

// Fluxos de ponta a ponta pela interface (cliques e campos reais): lançar, excluir (com o modal próprio), desfazer, trocar mês
const fctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const fpg = await fctx.newPage(); const fprob = [];
fpg.on('pageerror', e => fprob.push('erro: ' + e.message));
if (chartjs) await fpg.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: chartjs }));
await fpg.goto(url); await fpg.waitForFunction(() => typeof runSelfTests === 'function');
await fpg.evaluate(() => { restoreState(sanitizeState({})); commitAll(); setFiltro(new Date().getMonth(), new Date().getFullYear()); });
const nTx = () => fpg.evaluate(() => tx.length);
await fpg.fill('#desc', 'Teste e2e <b>x</b>'); await fpg.fill('#valor', '12,34');
await fpg.selectOption('#tipo', 'saida');
await fpg.click('button.btn-save');
if (await nTx() !== 1) fprob.push('lançar: não criou o lançamento');
else {
  const t = await fpg.evaluate(() => tx[0]);
  if (t.valor !== 12.34 || t.desc !== 'Teste e2e <b>x</b>') fprob.push('lançar: dados errados ' + JSON.stringify(t));
  if (!(await fpg.locator('#tbody tr', { hasText: 'Teste e2e' }).count())) fprob.push('lançar: linha não apareceu na tabela');
  if (await fpg.locator('#tbody b').count()) fprob.push('lançar: HTML do usuário foi interpretado');
  await fpg.locator('#tbody tr', { hasText: 'Teste e2e' }).locator('button[title="Remover"]').click();
  if (!(await fpg.locator('#ovConfirmar.open').count())) fprob.push('excluir: modal de confirmação não abriu');
  else {
    await fpg.locator('#confBotoes button', { hasText: 'Remover' }).click();
    if (await nTx() !== 0) fprob.push('excluir: não removeu');
    await fpg.evaluate(() => undo()); if (await nTx() !== 1) fprob.push('desfazer: não restaurou');
    await fpg.locator('#tbody tr', { hasText: 'Teste e2e' }).locator('button[title="Remover"]').click();
    await fpg.keyboard.press('Escape');
    if (await nTx() !== 1 || await fpg.locator('#ovConfirmar.open').count()) fprob.push('excluir: Esc deveria cancelar');
  }
}
await fpg.evaluate(() => { setFiltro(0, 2025); });
if (await fpg.evaluate(() => [$('filtroMes').value, $('filtroAno').value].join('/')) !== '0/2025') fprob.push('trocar mês: seletores não mudaram');
if (await fpg.locator('#tbody tr', { hasText: 'Teste e2e' }).count()) fprob.push('trocar mês: lançamento de outro mês apareceu');
await fctx.close();
const fluxoProblemas = fprob.length;

// Tema escuro: segue o sistema, o botão alterna e a escolha persiste; nenhum texto visível com contraste < 3:1
const dctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
const dpg = await dctx.newPage(); const dprob = [];
dpg.on('pageerror', e => dprob.push('erro: ' + e.message));
if (chartjs) await dpg.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: chartjs }));
await dpg.goto(url); await dpg.waitForFunction(() => typeof runSelfTests === 'function');
const tema = () => dpg.evaluate(() => document.documentElement.getAttribute('data-tema'));
if (await tema() !== 'escuro') dprob.push('não seguiu o sistema escuro');
await dpg.evaluate(() => setFiltro(1, 2026));
for (const v of ['dashboard', 'anual', 'mensal', 'metas']) {
  await dpg.evaluate(v => navTo(v), v); await dpg.waitForTimeout(500);
  const ruins = await dpg.evaluate(() => {
    const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [r, g, b, a]; };
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const bgOf = el => { const L = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { L.push(c); if (c[3] >= .99) break; } }
      const base = L.length && L[L.length - 1][3] >= .99 ? [0, 0, 0] : [11, 16, 32]; return L.reverse().reduce((acc, c) => acc.map((x, i) => x * (1 - c[3]) + c[i] * c[3]), base); };
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const t = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' '); if (!t) continue;
      const fg = parse(getComputedStyle(el).color); if (!fg) continue; const bg = bgOf(el);
      const L1 = lum(fg.slice(0, 3).map((x, i) => x * fg[3] + bg[i] * (1 - fg[3]))), L2 = lum(bg), cr = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
      if (cr < 3) out.push(cr.toFixed(1) + ' ' + (el.className || el.tagName) + ' "' + t.slice(0, 24) + '"');
    }
    return out;
  });
  if (ruins.length) dprob.push(`${v}: contraste baixo em ${ruins.length}: ${ruins.slice(0, 3).join(' | ')}`);
}
await dpg.evaluate(() => ciclarTema());   // auto → claro
if (await tema() !== 'claro') dprob.push('botão não mudou para claro');
await dpg.reload(); await dpg.waitForFunction(() => typeof runSelfTests === 'function');
if (await tema() !== 'claro') dprob.push('escolha do tema não persistiu');
await dctx.close();
const temaProblemas = dprob.length;

// A política está valendo de verdade: script inline injetado e handler onclick inline são bloqueados
const cspAtiva = await page.evaluate(() => new Promise(res => {
  const v = []; document.addEventListener('securitypolicyviolation', e => v.push(e.violatedDirective));
  const s = document.createElement('script'); s.textContent = 'window.__ruim = 1'; document.head.appendChild(s);
  const b = document.createElement('button'); b.setAttribute('onclick', 'window.__ruim = 2'); document.body.appendChild(b); b.click();
  setTimeout(() => { b.remove(); s.remove(); res({ rodou: window.__ruim || null, v }); }, 300);
}));
// Requisitos do Firebase na política (long-polling do Realtime Database é <script> de *.firebaseio.com; login usa apis.google.com)
const cspTexto = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
const faltaCsp = ['script-src[^;]*https://\\*\\.firebaseio\\.com', 'script-src[^;]*https://apis\\.google\\.com', 'script-src[^;]*https://www\\.gstatic\\.com', 'connect-src[^;]*wss:', 'frame-src[^;]*https:'].filter(re => !new RegExp(re).test(cspTexto));
const cspFurada = cspAtiva.rodou || !cspAtiva.v.length ? 1 : 0;
const cspProblemas = cspFurada + faltaCsp.length + (r.csp || []).filter(x => !/cdn\.jsdelivr|gstatic/.test(x)).length;   // CDNs bloqueadas por rede no sandbox não são violação
const falhas = cspProblemas + fluxoProblemas + temaProblemas + navProblemas + r.self.fails.length + r.sync.length + (r.fuzz || []).length + erros.length + graficos.length + fusoFalhas.length + mobilFalhas + xssFalhas;
console.log(`autoteste ${r.self.total - r.self.fails.length}/${r.self.total} · sync ${r.sync.length} problema(s) · fuzz ${(r.fuzz || []).length} violação(ões) · console ${erros.length} erro(s) · segurança ${xssFalhas ? xssFalhas + ' problema(s)' : 'ok (' + xss.cliques + ' cliques)'} · celular ${mobilFalhas ? mobilFalhas + ' problema(s)' : 'ok'} · fusos ${fusoFalhas.length ? fusoFalhas.length + ' problema(s)' : fusos.length + ' ok'} · csp ${cspProblemas ? cspProblemas + ' violação(ões): ' + r.csp.join('; ') : 'ok'} · fluxos ${fluxoProblemas ? fluxoProblemas + ' problema(s)' : 'ok'} · tema ${temaProblemas ? temaProblemas + ' problema(s)' : 'ok'} · navegação ${navProblemas ? navProblemas + ' problema(s)' : 'ok'} · gráficos ${chartjs ? (graficos.length ? graficos.length + ' problema(s)' : 'ok') : 'não verificados (sem tools/.cache/chart.umd.min.js)'}`);
if (falhas) console.log(JSON.stringify({ fails: r.self.fails, sync: r.sync, fuzz: r.fuzz, erros, graficos, fprob, dprob, navFalhas, nerros, fusoFalhas, mobil: { ...mob, merros }, xss, xerros }, null, 2));
// Sem fechar o navegador e o servidor o processo nunca terminava quando tudo passava (parecia travado)
await browser.close(); server.close();
process.exit(falhas ? 1 : 0);
