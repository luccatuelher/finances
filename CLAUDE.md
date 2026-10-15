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
