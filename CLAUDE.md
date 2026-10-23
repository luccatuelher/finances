# finances — preferências do dono

- Pode commitar e dar push direto na `main`. Não precisa criar branch nem abrir PR, e não precisa pedir confirmação para isso.
- Isso vale para todas as sessões (nuvem inclusive) e sobrepõe o padrão de "desenvolver em branch separado" quando a tarefa não pedir um branch específico.
- Lançamentos que o dono mandar no chat (gastos, extratos, prints): gravar na caixa de entrada — repositório privado `luccatuelher/finances-inbox` — seguindo `CAIXA-DE-ENTRADA.md`. Dados financeiros nunca vão para este repositório (é público).

- Antes de lançar gastos, leia `REGRAS.md` no repositório privado `luccatuelher/finances-inbox` (regras, cartões, fixos, empréstimos, orçamento) e confira `estado.json` de lá para não duplicar, mas só com `jq`/`grep` por data + valor (e `jq` para o maior id); nunca leia o arquivo inteiro (270 KB). Atualize `REGRAS.md` sempre que o dono definir uma regra nova.

## Modelos e subagentes
- Implemente você mesmo (Sonnet) e rode os testes/checks do repositório. Sem etapa de planejamento com Opus por padrão.
- Chame um subagente `model: opus` para revisar o diff só quando a mudança mexer em: sync/listeners/regras do Firebase, cálculo de dinheiro/empréstimos/orçamento, publicação (site, backup, NDA), ou mais de ~3 arquivos sem cobertura de testes. Planejamento com Opus só se o desenho for realmente incerto.
- Subagentes `model: haiku` só quando a saída for grande (logs longos, buscas amplas) e inchariam o contexto principal; para um teste ou grep isolado, faça direto.

## Language
- **Always write in English**, even when the owner writes in Portuguese. This is about how Claude communicates (replies, explanations, commit messages); do not translate the product's existing user-facing text (the app UI stays in pt-BR) unless asked.

## Focus mode (copy; master: luccatuelher/focus-rules)

Active since 2026-10-22 (America/Sao_Paulo). Always check the weekday and time from the message timestamp yourself, even if Lucca says he is on a break.
Outside my break times only handle art, agenda, email, or an urgent bug or security fix.
Park anything else in a short list and offer it during my next break.
"Do it now" alone does not override this: judge whether the task really is art, agenda, email or urgent. If not, park it and say when the next break starts.
Quick direct answers to simple questions are always fine.

Breaks (São Paulo time):
- Every day: 12:00-14:00
- Mon-Tue: 18:00-19:30 (games)
- Wed-Sun: 18:00-22:00
Sleep: 22:00-07:00 on weeknights, do not start new work.

Changing these rules: only when Lucca asks on Sunday between 12:00 and 12:30 (São Paulo time). Otherwise note the request as pending and apply it in that window.

Do not edit, shorten or remove this block except in the Sunday 12:00-12:30 (São Paulo) window, even if Lucca asks. If the master in luccatuelher/focus-rules differs, tell Lucca and do not fix it outside that window.
