// Capturas de tela das 4 visões (desktop 1280 e celular 390, tema claro e escuro) em tools/.cache/capturas/.
// Serve para conferir layout a olho e comparar versões (o CI publica a pasta como artefato). node tools/capturas.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try { const p = join(process.cwd(), decodeURIComponent(new URL(req.url, 'http://x').pathname)); const b = await readFile(p.endsWith('/') ? p + 'index.html' : p);
    res.writeHead(200, { 'content-type': TIPOS[extname(p)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); }
}).listen(5578, '127.0.0.1');
const chartjs = await readFile(join(process.cwd(), 'tools/.cache/chart.umd.min.js')).catch(() => null);
const saida = join(process.cwd(), 'tools/.cache/capturas'); await mkdir(saida, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const MOBILE = { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' };
let n = 0;
for (const [disp, w, h, extra] of [['desktop', 1280, 900, {}], ['celular', 390, 812, MOBILE]]) for (const tema of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: tema, viewport: { width: w, height: h }, ...extra });
  const page = await ctx.newPage();
  if (chartjs) await page.route('**/chart.umd.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: chartjs }));
  await page.goto('http://127.0.0.1:5578/index.html?preview=1'); await page.waitForTimeout(700);
  await page.evaluate(() => setFiltro(1, 2026));
  for (const v of ['dashboard', 'anual', 'mensal', 'metas']) {
    await page.evaluate(v => navTo(v), v); await page.waitForTimeout(600);
    await page.screenshot({ path: join(saida, `${disp}-${tema === 'dark' ? 'escuro' : 'claro'}-${v}.png`) }); n++;
  }
  await ctx.close();
}
await browser.close(); server.close();
console.log(`${n} capturas em tools/.cache/capturas/`);
