# Análise do código e melhorias possíveis

Análise de 07/10/2026 sobre o estado atual da `main` (commit `5c2379f`). Sem dados financeiros neste arquivo.

## Resumo

O app é um único `index.html` (9.895 linhas, 654 KB: ~34 KB de changelog no `<head>`, ~101 KB de CSS, ~451 KB de JS) mais `sw.js`, manifest e `tools/checks.mjs`. A bateria passa limpa (autoteste 151/151, sync 0 problemas, fuzz 0 violações, segurança ok, celular ok, 5 fusos ok). A parte de dados (sanitização, sync de 3 vias, migração) é sólida e bem testada.

Os pontos fracos são de **manutenção e entrega**, não de correção: arquivo monolítico, testes/changelog embarcados no que o usuário baixa, sem CI, sem CSP, e alguns detalhes de acessibilidade e PWA.

Prioridade: 🔴 alta · 🟡 média · 🟢 baixa. Esforço: P (horas) · M (1–2 dias) · G (semana+).

---

## 1. Segurança

| # | Prioridade | Esforço | Item |
|---|---|---|---|
| 1.1 | 🔴 | P | **Sem Content-Security-Policy.** O app usa ~150 `onclick=` inline e `innerHTML` em 97 pontos; a defesa é só `escHtml`/`jsStr` (bem aplicados e testados com fuzz de XSS). Qualquer escape esquecido executa script — e o script tem acesso ao token do GitHub e aos dados. Adicionar `<meta http-equiv="Content-Security-Policy">` com `script-src` limitado às 4 CDNs. Hoje isso exige `'unsafe-inline'` por causa dos handlers; o ganho real vem junto com o item 3.2 (trocar `onclick` inline por delegação de eventos). |
| 1.2 | 🔴 | P | **Token do GitHub (caixa de entrada) em `localStorage`**, em texto puro (`fin5_inbox_<uid>`). Mitigações já boas (fine-grained, só um repositório). Melhorar: documentar expiração curta (ex.: 90 dias) no `CAIXA-DE-ENTRADA.md`, avisar na UI quando o token estiver perto de vencer (a API devolve `github-authentication-token-expiration`), e só permitir `Contents: read/write` (já documentado). |
| 1.3 | 🟡 | P | **Regras do Firebase dependem de configuração fora do repositório.** O app detecta regra aberta e avisa 1×/dia (ótimo), mas a regra correta só existe como texto no console. Versionar um `database.rules.json` no repositório (sem segredo) como fonte da verdade. A `apiKey` pública no código é normal no Firebase; o que protege é a regra e a restrição de domínio da chave (conferir no Google Cloud que a chave só aceita o domínio de hospedagem). |
| 1.4 | 🟡 | P | `<meta name="referrer" content="no-referrer">` e `rel="noopener"` onde houver links externos — evita vazar a URL do app para as CDNs/GitHub. |
| 1.5 | 🟢 | M | Modo `?preview` e funções `runFuzz`/`runSelfTests` ficam globais em produção. Não vaza dado (namespace `preview:`), mas aumenta a superfície. Ver 2.2. |

## 2. Entrega e desempenho

| # | Prioridade | Esforço | Item |
|---|---|---|---|
| 2.1 | 🟡 | P | **Changelog de 34 KB dentro do `<head>`** é baixado a cada abertura. Mover para `CHANGELOG.md` e deixar no HTML só um resumo de 5 linhas. Reduz ~5% do arquivo sem tocar em lógica. |
| 2.2 | 🟡 | M | **~690 linhas de teste (autoteste, fuzz, sync fuzz — linhas 9204–9890) vão para o usuário.** Extrair para `tools/` (ex.: `tools/testes.js`, injetado pelo `checks.mjs` via `page.addScriptTag`). O app em produção fica menor e sem código de teste que reescreve estado. Cuidado: o fuzz usa funções internas — serve como lista do que precisa ficar acessível. |
| 2.3 | 🟡 | G | **Sem build.** Opção leve: um `build.mjs` que concatena `src/*.js`/`src/*.css` em `index.html` e minifica (esbuild). O CSS (~101 KB) e JS (~451 KB) comprimem bem em gzip, mas minificar corta mais ~35%. Manter “sem build” é uma escolha legítima; só vale se o item 3.1 for feito. |
| 2.4 | 🟢 | P | `sw.js`: o cache `finances-v1` nunca muda de versão e **não faz pré-cache** de `manifest`, ícones e do próprio `index.html` na instalação — a 1ª visita offline falha. Adicionar `cache.addAll([...])` no `install`. Respostas opacas de CDN também entram no cache sem limite; limitar o tamanho/quantidade. |
| 2.5 | 🟢 | P | `renderAll()` re-renderiza a view ativa a cada `commit`. Está rápido (29 ms medido com 5.800 lançamentos), então só voltar a olhar se o volume passar de ~20 mil lançamentos. |

## 3. Arquitetura e manutenção

| # | Prioridade | Esforço | Item |
|---|---|---|---|
| 3.1 | 🔴 | G | **Arquivo único de ~10 mil linhas, 426 funções globais, ~48 variáveis `let` globais.** Editar exige rolar/grep em 654 KB e qualquer função pode tocar qualquer estado. Dividir em módulos ES (`state.js`, `sync.js`, `inbox.js`, `render-*.js`, `import.js`, `form.js`, `budget.js`) carregados via `<script type="module">` — funciona sem build em GitHub Pages. O fuzz atual serve de rede de segurança para a migração. Fazer um módulo por vez (começar pelos puros: datas, dinheiro, parsers). |
| 3.2 | 🔴 | G | **~150 handlers inline (`onclick="fn(...)"`)** misturam HTML e lógica, exigem `jsStr()` para passar texto, impedem CSP estrita e já causaram bugs de segurança no histórico. O Orçamento já usa delegação (`data-act`); estender o mesmo padrão ao resto. |
| 3.3 | 🟡 | M | **Funções gigantes**: `runSelfTests` (406 linhas), `_orcLigar` (114). Quebrar `_orcLigar` em handlers nomeados. |
| 3.4 | 🟡 | M | **HTML montado por template string em 97 `innerHTML`.** Padronizar um helper (`html\`...\`` com escape automático) para que escapar seja o padrão e não uma lembrança. Reduz o risco do item 1.1 na raiz. |
| 3.5 | 🟡 | P | **Constantes mágicas** (30 desfazer, 300 processados, 500 quarentena, 5 min de sync, 12 meses de fixo) espalhadas. Agrupar em um objeto `CONFIG` no topo do script. |
| 3.6 | 🟢 | M | `!important` em 17 regras de CSS e 281 `style="..."` inline: migrar para classes. |
| 3.7 | 🟢 | P | Sem JSDoc/tipos. Se for modularizar, adicionar `// @ts-check` + JSDoc nas funções de dados (`sanitizeState`, `makeTx`, `inboxAplicar`) dá checagem de tipos sem TypeScript. |

## 4. Testes e qualidade

| # | Prioridade | Esforço | Item |
|---|---|---|---|
| 4.1 | 🔴 | P | **Sem CI.** A bateria (`node tools/checks.mjs`) só roda quando alguém lembra, e como o fluxo é push direto na `main`, nada barra uma regressão. Adicionar `.github/workflows/checks.yml` (Playwright + Chart.js local via `npm pack`) rodando em todo push. Mesmo sem bloquear, avisa rápido. |
| 4.2 | 🟡 | P | **Gráficos não são verificados** quando `tools/.cache/chart.umd.min.js` não existe (a saída dessa análise mostrou “gráficos não verificados”). No CI, baixar o Chart.js sempre; isso fecha o buraco. |
| 4.3 | 🟡 | M | Testes de interface (clicar em fluxos reais: lançar gasto, editar, excluir, trocar mês, importar CSV) via Playwright com asserções. Hoje a cobertura de UI vem do fuzz aleatório + checagem de XSS; fluxos principais não têm teste determinístico nomeado. |
| 4.4 | 🟡 | M | **Teste visual** (screenshots em 375 px e 1280 px das 4 telas) para pegar quebras de layout — o changelog cita várias correções de sobreposição que só foram achadas manualmente. |
| 4.5 | 🟢 | P | `tools/checks.mjs` tem 127 linhas densas; separar em blocos nomeados (boot, fusos, celular, XSS) e imprimir cada um, para falha apontar logo o bloco. |
| 4.6 | 🟢 | P | Lint (ESLint) sobre o JS extraído: o changelog menciona “análise estática: 327 funções, nenhuma sem uso” feita à mão e já desatualizada (hoje são 426). |

## 5. Acessibilidade e UX

| # | Prioridade | Esforço | Item |
|---|---|---|---|
| 5.1 | 🔴 | P | **`maximum-scale=1.0` no viewport** impede zoom por pinça — falha WCAG 1.4.4. Trocar por `width=device-width, initial-scale=1.0, viewport-fit=cover` (o zoom automático do iOS em inputs se resolve com `font-size: 16px` nos campos). |
| 5.2 | 🟡 | M | **Sem modo escuro** (não há `prefers-color-scheme`). Os tokens de cor já existem em variáveis CSS, então é um bloco de `:root` alternativo + revisar `corLegivel()` (que assume fundo branco) e as cores fixas dos gráficos. |
| 5.3 | 🟡 | P | Há 42 `aria-label`/`role` para 124 botões e 22 tabelas/cabeçalhos: revisar leitor de tela nas tabelas de lançamentos (cabeçalhos ordenáveis com `aria-sort`) e nos gráficos (canvas sem alternativa textual — oferecer a tabela de dados equivalente via `aria-describedby`). |
| 5.4 | 🟡 | P | **Navegação entre telas não tem URL** (só modais empilham histórico; não há `location.hash`): atualizar a página ou compartilhar link sempre volta ao início. Usar `location.hash` (`#mensal`, `#metas`) e restaurar a view no boot — e fazer o botão voltar do celular navegar entre abas. |
| 5.5 | 🟢 | P | Uso de `confirm()`/`alert()`/`prompt()` nativos em 16 pontos: bloqueiam a thread e fogem do estilo. Trocar pelo registro de modais (`MODALS`) já existente. |
| 5.6 | 🟢 | P | Só 3 `autocomplete=` nos formulários; marcar `autocomplete="off"` nos campos de valor/descrição para o navegador não sugerir dados pessoais. |

## 6. PWA

| # | Prioridade | Esforço | Item |
|---|---|---|---|
| 6.1 | 🟡 | P | Manifest sem `id`, `screenshots`, `categories` (`finance`) e `shortcuts` (ex.: “Novo gasto”). O manifest aponta o mesmo `icon-512.png` para `any` e `maskable`; conferir se o PNG tem o glifo dentro da zona segura (80% central), senão o Android corta. |
| 6.2 | 🟢 | M | Aviso de “nova versão disponível” quando o SW atualiza (hoje `skipWaiting` troca em silêncio, sem o usuário saber que o app mudou no meio do uso). |
| 6.3 | 🟢 | P | `apple-touch-icon.png` e demais ícones: o `<head>` não tem `apple-mobile-web-app-capable`/`-title`/`-status-bar-style`; adicionar para o modo “tela de início” do iOS. |

## 7. Documentação e repositório

| # | Prioridade | Esforço | Item |
|---|---|---|---|
| 7.1 | 🟡 | P | **`.claude/settings.json` está versionado apesar do `.gitignore` listar `.claude/`**, e o JSON tem **chaves duplicadas** (`outputStyle`, `model`, `effortLevel`, `env` aparecem duas vezes; o parser usa a última). Decidir: versionar (tirar do `.gitignore`, limpar duplicatas) ou deixar local (`git rm --cached`). Esse repositório é público — conferir que nada ali é sensível. |
| 7.2 | 🟡 | P | **Docs desatualizados**: `LOOP-NUVEM.md` diz “~7.300 linhas” (são 9.895); o changelog fala em “327 funções” (são 426) e “149 verificações” (são 151). Trocar números por “ver `wc -l`” ou gerar automático. |
| 7.3 | 🟡 | P | **Sem `README.md`**: quem chega ao repositório (público) não vê o que é, como rodar o `?preview`, como rodar a bateria, nem como hospedar. Escrever 30 linhas, sem dado pessoal. |
| 7.4 | 🟢 | P | Sem `LICENSE` (repositório público: sem licença = todos os direitos reservados, o que provavelmente é o desejado; deixar explícito). |
| 7.5 | 🟢 | P | `package.json` mínimo com `"scripts": { "test": "node tools/checks.mjs" }` e `playwright` em `devDependencies`, em vez do `require` com fallback para `npm root -g` em `checks.mjs`. |

## 8. Funcionalidades que o código já sustenta

Ideias de baixo custo, pois a base de dados e as telas já existem:

- **Metas de gasto por categoria com alerta** ao passar de 80% (o Orçamento já calcula `pctDoLimite`).
- **Comparativo ano a ano** na tela Anual (o índice mensal já permite).
- **Exportação para PDF/impressão** do mês (CSV já existe) com CSS `@media print`.
- **Busca salva / filtros combinados** (categoria + cartão + faixa de valor).

---

## Ordem sugerida

1. **Esta semana (horas):** 5.1 (zoom), 4.1+4.2 (CI com gráficos), 7.1 (settings.json), 7.3 (README), 2.1 (changelog fora do HTML), 1.3 (regras do Firebase versionadas).
2. **Próximas semanas:** 2.2 (testes fora da produção), 3.5 (CONFIG), 5.4 (hash por tela), 6.1/2.4 (PWA offline de verdade), 5.2 (modo escuro).
3. **Projeto maior (uma área por vez, com a bateria verde a cada passo):** 3.1 + 3.2 (módulos e fim dos handlers inline) → então 1.1 (CSP estrita) vira viável.

## Limites desta análise

Foi feita por leitura de código e execução da bateria existente; **não** abri o app em navegador para avaliar visual, nem testei o Firebase real ou o token do GitHub. Os gráficos não foram verificados (Chart.js indisponível no sandbox). Contagens (funções, `innerHTML`, handlers inline) vieram de `grep` e podem variar ±alguns por padrões de busca.
