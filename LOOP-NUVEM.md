# Loop de melhoria contínua — guia para sessão na nuvem

Este arquivo é o **prompt e o manual** do loop de melhoria do app de finanças. Uma sessão
na nuvem começa sem nenhum contexto: tudo o que ela precisa saber está aqui ou no próprio
`index.html` (changelog em `CHANGELOG.md`). Ao fim de cada iteração, a sessão atualiza a seção 8
deste arquivo.

---

## 0. Antes de abrir a sessão (feito por você, uma vez)

(Já feito: o repositório está em `luccatuelher/finances` e tudo está commitado.)
Abrir a sessão na nuvem apontando para esse repositório e colar o prompt da seção 1.

---

## 1. Prompt para colar

```
Você vai continuar o loop de melhoria contínua do app de finanças deste repositório
(index.html + app.js, pt-BR; sem build). Leia LOOP-NUVEM.md inteiro antes de qualquer coisa e
siga-o: comece pela "Iteração 0" (preparar o ambiente de testes e confirmar que tudo passa
ANTES de mudar código) e depois faça iterações seguindo o passo a passo da seção 4.

Em cada iteração: escolha a próxima área ainda não revisada (ou um risco encontrado),
procure bugs/otimizações, corrija de forma ESTRUTURAL (entender a causa, nunca hardcode do
caso específico), valide sintaxe com node, teste num navegador headless em modo ?preview=1
e registre o que mudou (CHANGELOG.md e seção 8 do LOOP-NUVEM.md).
Um commit por iteração, direto na main (autorizado pelo dono do repositório): faça push
para origin main ao fim de cada iteração, com a bateria verde.
Pare quando eu pedir ou quando não houver mais melhoria relevante a fazer.
```

---

## 2. O projeto em 1 minuto

- **`index.html`** (marcação + CSS), **`app.js`** (~6.900 linhas, todo o código), `handlers.js` (executor de `data-onclick`...; NUNCA use `onclick=` inline: a CSP bloqueia), `tema.js`. Testes em `tools/testes.js`, bateria `node tools/checks.mjs`, lint `node tools/lint.mjs`.
  Sem build, sem dependências locais. CDNs: Chart.js 4.5.1 e Firebase 10.12.2 (com SRI).
  Sem rede o app continua funcionando (sem gráficos e sem sync).
- **Dados**: estado `{ tx, cats, goals, cards, budget }` (lançamentos, categorias, metas,
  cartões, orçamento), salvo no `localStorage` e sincronizado no Firebase Realtime Database
  (login Google).
- **Modo preview** (`index.html?preview=1`): sem login e sem nuvem, dados de exemplo (`SEED`),
  armazenamento isolado no prefixo `preview:`. É onde TODO teste acontece.
  Os testes ficam em `tools/testes.js` (fora do app publicado); `node tools/checks.mjs` os injeta. À mão: abra `?preview=1` e cole o conteúdo de `tools/testes.js` no console, depois `await runSelfTests()`.

### Conceitos que o código já usa (reaproveite, não duplique)

| Tema | Onde / nome |
|---|---|
| Validação única de dados externos e internos | `sanitizeState()`, `_sanTx()`; inválidos vão para a quarentena (`_quarantine`, visível na seção Backup) |
| Persistência | `lsKey/lsGet/lsSet/lsDel` (namespace), `_persist()` marca o dashboard para re-render |
| Período filtrado | `filtro()` — nunca devolve NaN; use sempre ele, não leia os `<select>` direto |
| Salvar lançamento (todos os formulários) | `readTxForm(FORM_*) → submitTx() → makeTx()` |
| Tipo/pagamento/cartão nos 4 formulários | `formTipoChange / formPagChange / formFaturaInfo` + descritores `FORM_DESKTOP`, `FORM_MOBILE`, `FORM_MOB_EDIT`, `formInline(id)` |
| Fatura do cartão | `_calcFatura(card, data)` (dias 1–31, último dia em meses curtos) |
| Desfazer | `pushUndo(rótulo, grupo)` — grupo agrupa edições seguidas do mesmo campo |
| Sync | modelo de 3 vias: `_reconcileOnce`, `mergeStates(base, local, remoto, prefer)`, `_pushCAS` (gravação condicional), meta/base por usuário `fb_sync_<uid>` / `fb_base_<uid>`; conflito resolvido por item |
| Porcentagens e cores | `pctDoLimite`, `pctPartes`, `fmtPct`, `coresCategorias`, `corLegivel` (contraste AA) |
| Acessibilidade | `_a11y(root)` aplicado ao DOM e a tudo que é renderizado depois (MutationObserver) |
| Boot | `bootApp() → init() → showApp()`; `loadLocalState()` roda no carregamento do script |

O mapa completo está nos cabeçalhos `// ── NOME ──` do script (`grep -n "^// ── " app.js`).

---

## 3. Regras de trabalho

1. **Correção estrutural**: entenda a causa e corrija na origem (helper compartilhado,
   token de CSS, descritor). Nunca trate só o caso que você viu.
2. **Prove antes de corrigir**: reproduza o problema (teste que falha, ou medição) e mostre
   que passa depois. Quando for possível, mostre também que o teste pegaria a versão antiga.
3. **Todo fix ganha autoteste** em `runSelfTests()` (em `tools/testes.js`, seção `// ── AUTOTESTE`) e o
   contador da linha "AUTOTESTE" do changelog é atualizado.
4. **Nada de regressão**: a bateria da seção 5 passa inteira antes de registrar a iteração.
5. **Iterações pequenas**: uma área (ou um risco) por vez, um commit por iteração.
6. **Português (pt-BR)** em textos da interface, comentários novos e changelog, no estilo
   do código ao redor (comentário explica o "porquê" e o que dava errado antes).
7. **Não mexa em dados reais**: testes só em `?preview=1`. Não chame `save()`/`persistAll()`
   com dados sintéticos; se acontecer, restaure os dados de exemplo (seção 5.6).
8. Decisões já tomadas (não refazer): a heurística necessidade/desejo do orçamento
   (`_budgetGroup`) fica como está — é um palpite que o usuário sobrescreve.

---

## 4. Passo a passo de uma iteração

1. **Escolher a área**: leia o changelog no `<head>` (seção "Loop de melhoria contínua")
   e a seção 8 deste arquivo. Pegue um candidato da lista ou um risco que você encontrou.
2. **Ler o código da área** inteira, incluindo quem chama e quem é chamado.
3. **Auditar riscos** (lista de verificação):
   - estados vazios, primeiro uso, aparelho novo, dados antigos/legados;
   - datas e fuso (sempre `isoDate`/`todayLocalISO`, nunca `toISOString` para data local);
   - dinheiro (`roundMoney`, centavos antes de decidir sinal/cor, `-0`);
   - sync: o que acontece com a mudança no outro dispositivo, conflito, offline;
   - segurança: texto do usuário em HTML (`escHtml`, `jsStr`), CSV (fórmulas), cores (`safeColor`);
   - acessibilidade e contraste; celular (375 px) e desktop;
   - código executado no carregamento do script (ordem de declaração / TDZ);
   - dados extremos: texto longo sem espaço, valores enormes, listas vazias/gigantes (medir overflow).
4. **Reproduzir** o problema no navegador headless (ou por medição).
5. **Corrigir pela causa**; reaproveite os conceitos da seção 2.
6. **Validar sintaxe** (seção 5.1).
7. **Rodar a bateria** (seção 5) e o **cenário real** do fluxo alterado.
8. **Restaurar** os dados de exemplo do preview se o teste os alterou.
9. **Registrar** (seção 6) e **commitar** no branch.

---

## 5. Como testar (sem o navegador embutido)

### 5.1 Sintaxe (sempre)

```bash
node tools/sintaxe.mjs      # app.js, handlers.js, tema.js, sw.js e testes
node tools/lint.mjs         # ESLint (variáveis indefinidas, duplicadas...)
```

### 5.2 Iteração 0 — preparar o navegador headless

`tools/checks.mjs` já existe (testado na nuvem: Playwright global + Chromium em
`/opt/pw-browsers`; ignora falhas de rede das CDNs, que o sandbox bloqueia). Rode e confirme
que o estado de partida passa (o modelo abaixo é o original, só de referência):

```bash
node tools/checks.mjs   # ~1 min; CHROMIUM_PATH=... se o Chromium estiver em outro lugar
```

Modelo de `tools/checks.mjs`:

```js
// Roda a bateria do app num Chromium headless: boot de aparelho novo, autoteste,
// fuzz de sincronização e fuzz de interface. Sai com código 1 se algo falhar.
import { chromium } from 'playwright';
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

const browser = await chromium.launch();
const page = await browser.newPage();
const erros = [];
page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
page.on('pageerror', e => erros.push(e.message));
const url = 'http://localhost:5577/index.html?preview=1';

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
await browser.close(); server.close();

const falhas = r.self.fails.length + r.sync.length + (r.fuzz || []).length + erros.length;
console.log(`autoteste ${r.self.total - r.self.fails.length}/${r.self.total} · sync ${r.sync.length} problema(s) · fuzz ${(r.fuzz || []).length} violação(ões) · console ${erros.length} erro(s)`);
if (falhas) { console.log(JSON.stringify({ fails: r.self.fails, sync: r.sync, fuzz: r.fuzz, erros }, null, 2)); process.exit(1); }
```

**Gráficos (Chart.js)**: a CDN é bloqueada no sandbox, então sem preparação a bateria diz
"gráficos não verificados". Prepare uma vez por sessão (o arquivo tem os mesmos bytes da
versão fixada no app, o SRI confere; `tools/.cache/` está no `.gitignore`):

```bash
mkdir -p tools/.cache && (cd tools/.cache && npm pack chart.js@4.5.1 && tar xzf chart.js-4.5.1.tgz \
  && cp package/dist/chart.umd.min.js .)
```

A bateria também roda autoteste + fuzz de interface com user-agent de iPhone (layout de celular,
formulários `mob-*`) e o autoteste sob 5 combinações de fuso/relógio (virada de dia, mês e ano, 29/02, UTC+14 e UTC−11).

Há ainda uma checagem de segurança: nomes/descrições hostis (HTML, aspas, `</script>`) em todas as
telas, clicando em tudo que os carrega no handler; nada pode executar nem injetar elementos.
A bateria completa leva ~1–2 min; rode-a em segundo plano e não faça espera ativa (laço sem sleep).

Com isso `tools/checks.mjs` serve o Chart.js real e exige canvases pintados nas telas
Visão Geral, Anual e Mensal (mês dos dados de exemplo). O Firebase continua não carregando.

Estado de partida esperado (fim da iteração 42, reconfirmado na sessão de nuvem): **autoteste 100/100**, `runSyncFuzz` → `[]`,
`runFuzz` → `[]`, nenhum erro no console. Se não bater, investigue o ambiente antes de
mudar código.

### 5.3 A bateria (toda iteração)

| Verificação | Como | Esperado |
|---|---|---|
| Sintaxe | 5.1 | `SYNTAX OK` e changelog sem `--` |
| Boot de aparelho novo | `preview:fin5_schema = '2'` + recarregar (o runner já faz) | nenhum erro no console |
| Autoteste | `await runSelfTests()` → `{ total, fails }` | `fails` vazio |
| Fuzz de sync | `await runSyncFuzz()` → lista de problemas | `[]` (2 dispositivos + servidor em memória; exige convergência, que nenhum lançamento criado suma e que edição de um só dispositivo prevaleça) |
| Fuzz de interface | `await runFuzz()` → violações | `[]` (~1.600 ações aleatórias pela UI, invariantes após cada uma) |
| Cenário real | reproduzir o fluxo alterado pela UI (clicar, digitar, trocar de tela) | comportamento novo confirmado |

`runFuzz` e `runSyncFuzz` são exclusivos (uma rodada por vez) e restauram estado,
`localStorage` e formulários ao terminar.

### 5.4 Contraste, acessibilidade e celular (quando mexer em interface)

- Contraste: texto ≥ 4,5:1 (grande ≥ 3:1) contra o fundo efetivo; ajuste **tokens** do
  `:root`, não elementos soltos. Cores escolhidas pelo usuário passam por `corLegivel()`.
- Acessibilidade: todo campo com nome, todo clicável alcançável por Tab; conteúdo fechado
  (modais, folhas do celular) com `visibility:hidden`.
- Celular: viewport 375×812 (`page.setViewportSize`), sem rolagem horizontal.

### 5.5 Desempenho (quando mexer em render/sync)

Gere ~6.000 lançamentos em memória, `restoreState(sanitizeState({ t: … }))`, meça
`renderAll()` e `_stateHash()` com `performance.now()`. Referência atual: renderAll ≈ 13 ms,
salvar + render ≈ 25 ms. **Não salve** esses dados.

### 5.6 Restaurar os dados de exemplo do preview

Se algum teste gravou no preview: remova as chaves com prefixo `preview:` e recarregue
(o app volta ao `SEED`), ou `tx = sanitizeState({ t: SEED }).tx; persistAll();`.

---

## 6. Registro

1. **Changelog no `<head>`** (comentário HTML no topo), na seção "Loop de melhoria
   contínua", antes da linha "Ferramentas de manutenção". Formato:
   ```
         • TÍTULO EM CAIXA ALTA: o que estava errado (com o efeito para o usuário), o que
           mudou e como foi verificado. Números quando houver (antes → depois).
   ```
   Regras: indentação de 6 espaços + `•`, linhas de até ~90 colunas, **nunca `--`** dentro
   do comentário (quebraria o HTML).
2. **Contador do autoteste**: atualize "NN verificações" na linha "AUTOTESTE".
3. **Seção 8 deste arquivo**: acrescente a iteração e atualize os candidatos.
4. **Commit direto na `main`** (autorização permanente do dono), um por iteração, e `git push origin HEAD:main`:
   ```
   Iteração NN: <resumo curto>

   <o problema, a causa e a correção em 2–4 linhas; como foi verificado>

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```

---

## 7. Armadilhas conhecidas (aprendidas no loop)

- **Boot**: `loadLocalState()` e `_quarantine()` rodam no carregamento do script, antes de
  várias declarações `const/let` → cuidado com TDZ. Mudanças em flags globais lidas no boot
  exigem o teste de aparelho novo (a iteração 29 fez o app travar ao abrir por isso;
  corrigido na 34 com `filtro()` total e `init()` antes de `showApp()`).
- **`setFiltro(-1, a)`** significa dezembro de `a − 1` (o mês "dá a volta"); para escolher
  um ano use `setFiltro(0, a)`.
- **Buffer do console sobrevive ao recarregar** em alguns ambientes: registre um marcador
  (`console.error('MARCADOR')`) antes e conte só os erros depois dele.
- **Página oculta** congela animações e desacelera timers (medições de `opacity`/tempo
  ficam erradas); `:focus-visible` não dispara com eventos sintéticos — verifique a regra
  CSS em vez do estilo computado.
- **Seletores CSS novos** (ex.: `:has()`) podem lançar erro em navegadores antigos: use
  JavaScript equivalente em código que roda no `init()`, e proteja com `safeRender`.
- **Firebase offline** não falha, fica pendurado: toda chamada de rede passa por
  `_comPrazo()`.
- **Dados do preview** são compartilhados entre testes: sempre restaure (5.6).
- O fuzz não pode rodar em paralelo com outra rodada (já é exclusivo — mantenha assim).

---

## 8. Estado atual e próximos candidatos

**Última iteração concluída: 58** (orçamento por período e caixa de entrada com orçamento, empréstimos e parcelas) (01/10/2026). Detalhes de cada uma no changelog do `<head>`.
Iterações 40–42 foram feitas após o commit `a50cd5c`.

Resumo das mais recentes:
- 34 — travamento ao abrir em aparelho novo; formulários com uma só implementação.
- 35 — editor inline no mesmo fluxo de pagamento/cartão.
- 36 — troca de conta sem perder alterações não sincronizadas; login com erros em pt-BR.
- 37 — quarentena visível (baixar/descartar) e incluída no backup.
- 38 — acessibilidade (`_a11y`): rótulos, nomes, teclado.
- 39 — contraste WCAG AA (tokens + `corLegivel`); conteúdo fechado fora do Tab.
- 40 — conflito de sync resolvido por item (antes descartava mudanças não conflitantes).
- 41 — invariante de edições no fuzz de sync; seletor de ícones pelo teclado.
- 42 — estado "Offline" e prazo nas chamadas ao Firebase; desempenho re-medido (ok).
- 43 — valor da meta/aporte era `type=number`: "1.500" salvava R$ 1,50; agora texto + `parseValor` (autoteste 89).
- 44 — botão "CSV do ano" (`_listaCSV`/`_csvDe` compartilhados com o CSV do mês; autoteste 91).
- 45 — estilos de impressão (`@media print`): só a tela atual, sem painel/botões; gráficos não verificados no papel (CDN bloqueada no sandbox) (autoteste 92).
- 46 — PWA: `manifest.webmanifest`, `icon.svg`, `sw.js` (rede primeiro, cópia local offline); testado offline por http. Ao publicar, os 4 arquivos precisam ir juntos.
- 47 — quarentena acompanha o dono ao trocar de conta (`_trocarQuarentena`; autoteste 93).
- 48 — tabelas largas rolam dentro da caixa no celular (`.data-table-box`; autoteste 94). Teste de celular: user-agent de iPhone (o modo `body.mobile` vem do UA, não da largura).
- 49 — layout de desktop em janela estreita/iPad: KPIs anuais (grid inline vencia o @media) e histórico a 375 px (autoteste 95). Varredura de overflow: 4 telas x 375/768/1024 px.
- 50 — tetos (`VALOR_MAX` R$ 100 bi, `DESC_MAX` 200) e texto longo sem quebrar o layout (autoteste 97). Auditoria nova: usar dados extremos (200 caracteres sem espaço, R$ 99 bi) e medir overflow.
- 51 — tetos de nome: categoria `CAT_MAX` 60, cartão `CARD_MAX` 40, meta 200 (autoteste 98).
- 52 — ícones PNG (192/512/maskable/apple-touch 180) gerados do `icon.svg` com Playwright; o PWA agora tem 7 arquivos para publicar juntos (index, manifest, sw, icon.svg, 3 PNG).
- 53 — eixo dos gráficos: `fmtEixo` único, pt-BR compacto, sem rótulos repetidos (autoteste 100). Primeira iteração conferida com o Chart.js real.
- 54 — caixa de entrada do Claude (pedido do dono): operações em `inbox.json` num repositório privado do GitHub, aplicadas pelo app com token fine-grained (`inboxAplicar`, `checkInbox`; ver `CAIXA-DE-ENTRADA.md`). Autoteste 104; `runSyncFuzz` inclui `_testeInbox` (GitHub simulado: gravação concorrente/409, reprocesso, cópia `estado.json`, token inválido).
- 55 — Orçamento refeito (pedido do dono, estudo em artifact "Roda do Orçamento"): abas Orçamento/Metas, cartão azul, roda SVG editável (`_orcMudaCat`/`_orcMudaGrupo`/`_orc503020` em centavos, allocs continuam em %), tabela com planejado editável, valor fixo `budget.locks` (sanitização/merge/renomeação), entradas recolhidas. Mensal com cartão azul. `_moveBudgetKeys` só olha categorias orçáveis. Autoteste 111. O computador é a tela principal do dono: conferir 1440/1280/1024 px além do celular.
- 56 — Mensal refeito como revisão do mês (Visão Geral = dia a dia): comparação com a média dos 3 meses anteriores com ≥ 5 lançamentos (`_mesResumo(m, a, ateDia)`; mês atual só até hoje), cascata por tipo de gasto (`_mesTipoGasto`: juros > fixos > parcelas > dia a dia), destaques, calendário, maiores gastos, lugares repetidos e "o que mudou" com sparklines. Sem Chart.js (a bateria agora só exige canvas no dashboard e no anual). Autoteste 113.
- 57 — pedidos do dono em lote (ver o changelog do `<head>`): tabela de categorias sem reajuste + faixa "falta/passou", cadeado por linha, donut com alça nas duas pontas (`_orcMudaBorda`), excluir categoria por escopo (`budget.off`, `_catOff`), metas fixas no fim, caixinhas por categoria, patrimônio na Anual, hero plota a folga, **parcelas automáticas** (`gerarParcelas`, `tx.parcela`), **juros embutidos** (`tx.juros`) e **empréstimos** (estado `loans`, chave `l`: `_sanLoans`, `loanCronograma`, `renderLoans`). Autoteste 143. Estado novo = passar por TODOS os pontos de persistência (sanitizeState, snapshot, export/import, inbox, pendentes, hash, base do merge, `mergeStates`, payload): ver `grep -n "loans"`.
- 58 — orçamento por período (`budget.allocsDe`, `allocsDoMes(ym)`, `_allocVersao`, `_mergeVersoes`; a roda grava no planejamento vigente do mês aberto) e caixa de entrada com `orcamento`, `emprestimo` e `parcela`/`serie` no update (`_inboxOrcamento`; ver CAIXA-DE-ENTRADA.md). Autoteste 149.

Áreas já revisadas: importação (CSV/OFX), exportação, backup/restauração, hero e ritmo,
orçamento, metas/aportes, cartões/faturas, fixos, categorias, análise mensal e anual,
distribuição, tabela de débito, sync/merge/conflitos, login/logout/troca de conta,
quarentena, acessibilidade, contraste, offline, desempenho.

Auditadas depois da 53 **sem achados** (não repetir sem motivo): fusos e virada de dia/mês/ano
(6 fusos, 29/02; agora na bateria); encaixe dos 11 modais em 375×667; acessibilidade do botão
novo; fuzz de interface no layout de celular (agora na bateria); arredondamento valor↔% do
orçamento; XSS em todas as telas com clique nos handlers (agora na bateria); importador CSV/OFX
com 8.000 entradas hostis aleatórias (sem exceção); escala com 30.000 lançamentos
(sanitizar 49 ms, renderAll 57 ms, merge 210 ms — linear).

Candidatos restantes (a lista anterior foi toda concluída nas iterações 43–53):
- o pill de folga/ritmo do hero anual encosta no gráfico (cosmético);
- **sync real com o Firebase**: só é testado por simulação em memória (`runSyncFuzz`); a SDK e o
  banco não carregam no sandbox. Qualquer defeito novo aqui virá do uso real (relatos do dono);
- achados vindos do uso: peça ao dono exemplos concretos (tela, dados, o que esperava).

Estado: as auditorias sistemáticas (seção acima) já não encontram defeitos. Sem relato novo do
uso real, as próximas iterações tendem a ser só cosméticas — ver seção 9.

---

## 9. Quando parar

Pare quando o usuário pedir, ou quando as próximas melhorias forem só cosméticas/de gosto.
Ao parar: bateria completa verde, changelog e seção 8 atualizados, tudo commitado e enviado para a main,
e um resumo curto do que mudou (com o que foi verificado e o que ficou pendente).
