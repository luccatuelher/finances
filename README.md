# Finances

Controle de finanças pessoais (pt-BR): PWA de arquivo único (`index.html`), sem build. Dados no `localStorage` com sincronização opcional via Firebase (login Google).

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

Sobe um servidor local (que injeta `tools/testes.js` no `index.html`: os testes não vão no app publicado), abre o app no Chromium (Playwright) e roda autoteste, fuzz de sincronização e de interface, checagem de XSS, celular e fusos horários. Para também conferir os gráficos, coloque o Chart.js 4.5.1 em `tools/.cache/` (comando no topo do `tools/checks.mjs`). O GitHub Actions (`.github/workflows/checks.yml`) roda tudo isso a cada push.

## Mais documentação

- `CAIXA-DE-ENTRADA.md`: como o Claude lança gastos no app.
- `LOOP-NUVEM.md`: manual do loop de melhoria contínua.
- `CHANGELOG.md`: histórico de mudanças.
- `MELHORIAS.md`: análise do código e melhorias pendentes.
