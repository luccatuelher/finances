# Finances

Controle de finanças pessoais (pt-BR): PWA estático, sem build (`index.html` + `app.js` + `handlers.js` + `tema.js`). Dados no `localStorage` com sincronização opcional via Firebase (login Google).

Este repositório é público: **nenhum dado financeiro vai para cá** (lançamentos enviados pelo chat vão para um repositório privado, ver `CAIXA-DE-ENTRADA.md`).

## Rodar

```
python3 -m http.server 8000      # ou qualquer servidor estático
# abrir http://localhost:8000/index.html?preview=1
```

`?preview=1` abre sem login e sem sincronizar; usa um namespace próprio do `localStorage` (`preview:`), sem tocar nos dados reais.

## Testes

```
node tools/checks.mjs
```

Sobe um servidor local (que injeta `tools/testes.js` no `index.html`: os testes não vão no app publicado), abre o app no Chromium (Playwright) e roda autoteste, fuzz de sincronização e de interface, checagem de XSS, celular e fusos horários. Para também conferir os gráficos, coloque o Chart.js 4.5.1 em `tools/.cache/` (comando no topo do `tools/checks.mjs`). `node tools/lint.mjs` roda o ESLint (instala sozinho em `tools/.cache/lint`). O GitHub Actions (`.github/workflows/checks.yml`) roda tudo isso a cada push.

## Mais documentação

- `CAIXA-DE-ENTRADA.md`: como o Claude lança gastos no app.
- `LOOP-NUVEM.md`: manual do loop de melhoria contínua.
- `CHANGELOG.md`: histórico de mudanças.
- `COST-PROTOCOL.md`: steps to avoid surprise cloud bills (plan, rules, budget alert, emergency stop).
- `MELHORIAS.md`: análise do código e melhorias pendentes.

## Arquitetura em 5 linhas

- `index.html`: marcação e CSS (tema claro/escuro por variáveis). Nenhum script inline: a CSP (meta) só aceita scripts do próprio site e das CDNs fixadas.
- `app.js`: todo o código do app (estado, sync, telas). `tema.js`: aplica o tema antes de pintar.
- `handlers.js`: executor de `data-onclick`/`data-onchange`/... (subconjunto restrito de JS, sem eval) — é por isso que o HTML não usa `onclick=`.
- `sw.js`: service worker (rede primeiro, pré-cache do app para abrir offline). `database.rules.json`: regras do Firebase para publicar no console.
- `tools/`: bateria (`checks.mjs`), testes embutidos (`testes.js`), lint, capturas de tela.

## Custos e limites (evitar conta surpresa)

- Hospedagem: GitHub Pages (estático, sem cobrança por uso). CI: GitHub Actions em repositório público (grátis).
- Firebase: **use o plano Spark (gratuito, sem cartão)** — ao passar do limite ele para em vez de cobrar. No plano Blaze não existe teto automático: configure alerta de orçamento no Google Cloud (Billing → Budgets & alerts) e um limite baixo.
- O app tem um **disjuntor** na sincronização (`SYNC_DISJUNTOR_*` em `CONFIG`): se aparelhos entrarem em laço de leitura/gravação, a sincronização pausa sozinha (a pausa dobra a cada nova abertura) e avisa na tela.
- A base inteira é enviada/baixada a cada sincronização; o painel Backup mostra o tamanho e avisa acima de 1,5 MB.
