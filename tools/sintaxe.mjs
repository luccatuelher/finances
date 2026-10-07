// Confere só a sintaxe do <script> principal do index.html (rápido, sem navegador): node tools/sintaxe.mjs
import { readFileSync } from 'node:fs';
const s = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const i = s.lastIndexOf('<script>\n'), j = s.lastIndexOf('</script>');
try { new Function(s.slice(i + 9, j)); console.log('sintaxe ok'); } catch (e) { console.error('ERRO de sintaxe:', e.message); process.exit(1); }
