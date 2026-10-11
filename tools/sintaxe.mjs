// Confere só a sintaxe do app.js / handlers.js / tema.js / sw.js / testes (rápido, sem navegador): node tools/sintaxe.mjs
import { readFileSync } from 'node:fs';
let ok = true;
for (const f of ['app.js', 'handlers.js', 'tema.js', 'sw.js', 'tools/testes.js']) {
  try { new Function(readFileSync(new URL('../' + f, import.meta.url), 'utf8')); } catch (e) { console.error(`ERRO de sintaxe em ${f}: ${e.message}`); ok = false; }
}
if (ok) console.log('sintaxe ok'); else process.exit(1);
