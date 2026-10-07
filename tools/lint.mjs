// Lint do <script> principal do index.html e do tools/testes.js (ESLint). Uso: node tools/lint.mjs
// Instala o ESLint em tools/.cache/lint na primeira vez (fora do repositório, como o Chart.js).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
const raiz = process.cwd(), cache = join(raiz, 'tools/.cache/lint');
mkdirSync(cache, { recursive: true });
if (!existsSync(join(cache, 'node_modules/.bin/eslint'))) {
  writeFileSync(join(cache, 'package.json'), '{"private":true}');
  execSync('npm i eslint@9 globals@15 --no-audit --no-fund', { cwd: cache, stdio: 'inherit' });
}
const html = readFileSync(join(raiz, 'index.html'), 'utf8');
const i = html.lastIndexOf('<script>\n') + 9, j = html.lastIndexOf('</script>');
// app.js + testes.js viram UM arquivo (compartilham o escopo global, como no navegador)
writeFileSync(join(cache, 'app.js'), html.slice(i, j) + '\n' + readFileSync(join(raiz, 'tools/testes.js'), 'utf8'));
writeFileSync(join(cache, 'eslint.config.mjs'), `import globals from 'globals';
export default [{ files: ['app.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, Chart: 'readonly', firebase: 'readonly' } },
  linterOptions: { reportUnusedDisableDirectives: false },
  rules: { 'no-undef': 'error', 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-unreachable': 'error', 'no-const-assign': 'error',
           'no-self-assign': 'error', 'no-unsafe-finally': 'error', 'no-cond-assign': ['error', 'except-parens'], 'use-isnan': 'error',
           'valid-typeof': 'error', 'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }] } }];
`);
try { execSync('npx eslint --no-warn-ignored app.js', { cwd: cache, stdio: 'inherit' }); console.log('lint ok'); }
catch { process.exit(1); }
