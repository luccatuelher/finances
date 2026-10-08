# finances — preferências do dono

- Pode commitar e dar push direto na `main`. Não precisa criar branch nem abrir PR, e não precisa pedir confirmação para isso.
- Isso vale para todas as sessões (nuvem inclusive) e sobrepõe o padrão de "desenvolver em branch separado" quando a tarefa não pedir um branch específico.
- Lançamentos que o dono mandar no chat (gastos, extratos, prints): gravar na caixa de entrada — repositório privado `luccatuelher/finances-inbox` — seguindo `CAIXA-DE-ENTRADA.md`. Dados financeiros nunca vão para este repositório (é público).

## Fluxo advisor/executor/subagentes
- **Opus (advisor):** antes de implementar qualquer mudança não trivial, chame um subagente com `model: opus` para planejar e revisar a abordagem. Ao terminar, chame outro `model: opus` para revisar o diff e apontar bugs.
- **Sonnet (executor):** você mesmo (modelo da sessão) implementa a mudança.
- **Haiku 5.5 (subagentes):** delegue a subagentes com `model: haiku` as tarefas mecânicas, de baixo risco e bem delimitadas: buscar/mapear arquivos e ocorrências, ler e resumir código ou logs, rodar testes/lint/build e reportar o resultado, conferir links/textos/formatação, edições repetitivas em vários arquivos com instrução exata. Dê a cada um um escopo claro e peça resposta curta; você confere o resultado antes de usar.
- Não use Haiku para decisões de design, lógica nova, segurança ou revisão de bugs — isso fica com Opus/Sonnet.
- Pule o Opus em tarefas triviais: typo, tradução, renomear, ajuste de texto.

## Language
- **Always write in English**, even when the owner writes in Portuguese. This is about how Claude communicates (replies, explanations, commit messages); do not translate the product's existing user-facing text (the app UI stays in pt-BR) unless asked.
