# Caixa de entrada do Claude

Como o Claude lança gastos direto no app, sem o dono precisar exportar/importar backup.

## Como funciona

1. O dono manda os gastos no chat (texto, prints, extratos).
2. O Claude grava **operações** no arquivo `inbox.json` do repositório **privado**
   `luccatuelher/finances-inbox` (este repositório, `finances`, é público — nada de dados aqui).
3. O app (`index.html`), no navegador do dono e já logado no Firebase, lê `inbox.json` com um
   token *fine-grained* do GitHub (só esse repositório, Contents: leitura e escrita), aplica as
   operações pelo fluxo normal (sanitização → estado → sync de 3 vias com o Firebase) e move o que
   tratou para `processados`, com o resultado de cada uma.
4. Se o dono ligou a opção **"Guardar cópia dos meus dados"**, o app também grava `estado.json`
   (mesmo formato do backup) no repositório privado — use-o para conferir duplicados antes de lançar.

O app **recusa repositório público** (confere `private: true` no GitHub a cada rodada, ao salvar a
configuração e antes de gravar `estado.json`): um dono/nome errado nunca publica os dados.

O app checa a caixa ao abrir (depois da 1ª sincronização), ao voltar para a aba/janela e a cada
5 minutos (no máximo a cada 2 min). Configuração: seção Backup → "📥 Caixa de entrada do Claude"
(no celular: formulário de lançamento → link no rodapé). O token fica só no aparelho (localStorage,
por conta Google) e nunca vai para o Firebase nem para o chat.

## Formato do `inbox.json`

```json
{
  "versao": 1,
  "ops": [
    { "id": "2026-10-02-001", "op": "add",
      "tx": { "id": 1800000000500, "desc": "Droga Raia", "valor": 33.67, "data": "2026-09-26",
              "tipo": "saida", "cat": "💊 Saúde", "fixo": false,
              "pagamento": "credito", "cartaoId": 1774016467302, "faturaData": "2026-10-25" } },
    { "id": "2026-10-02-002", "op": "update", "txId": 1799000000588,
      "espera": { "valor": 166.8 }, "muda": { "valor": 13.9 } },
    { "id": "2026-10-02-003", "op": "delete", "txId": 1799000000643,
      "espera": { "desc": "Google One", "valor": 14.99 } }
  ],
  "processados": []
}
```

- `id` da operação: texto único (use data + sequência). Sem `id` a operação é ignorada.
- `add`: `tx` no formato do backup (`t`). O `tx.id` é obrigatório e deve ser novo — use números
  acima dos existentes (ex.: 18000000xxxxx), nunca reaproveite id apagado. O app marca
  `extId: "claude:<id da operação>"`. Id que já existe → `ignorado: já existe`.
  `faturaData` pode ser omitida: o app calcula pelo cartão.
  Campos opcionais do app: `juros` = parte do `valor` que é juros/multa (boleto pago com atraso:
  um lançamento só, na categoria do boleto, com `valor` = total pago); `parcela` =
  `{ "serie": "P<id>", "k": 2, "n": 6 }` liga as parcelas de uma compra (todas com a mesma
  `serie`; o app usa para remover/editar em grupo). Sem `parcela` a entrada continua valendo,
  só que solta.
- `update`: `espera` = valores atuais que precisam bater (ex.: o valor antigo); `muda` = campos
  novos. Campos aceitos: desc, valor, data, tipo, cat, pagamento, cartaoId, faturaData, fixo, juros,
  parcela (liga lançamentos soltos numa série; `null` desliga), serie (recorrência de um fixo).
  `espera` compara também objetos (`"parcela": null` = ainda solta).
  **`espera` é obrigatória** no `update` (ao menos um campo da lista acima; sem ela → `ignorado: update exige espera`)
  e chaves fora dessa lista → `ignorado: espera inválida`.
  Se o dono editou o lançamento depois, `espera` não bate → `ignorado: mudou desde então`.
- Fixo: `fixo: true` + a mesma `serie` em todos os meses (ex.: `"serie": "S<id>"`); o app replica
  12 meses quando o dono cria pela tela — pela caixa, mande um `add` por mês.
- `delete`: remove se `espera` bater; se já não existe → `ignorado: já não existe`. **`espera` precisa ter `desc` e
  `valor`** (senão `ignorado: delete exige espera com desc e valor`). **Limite: 10 exclusões por rodada**
  (lançamentos + empréstimos); com mais, NENHUMA exclusão é feita (`ignorado: N exclusões numa rodada…`) e
  as demais operações seguem — confirme com o dono e reenvie em lotes de até 10.
- `orcamento` (aplicado nesta ordem; mande só as partes que quer mudar):
  ```json
  { "id": "2026-10-02-010", "op": "orcamento",
    "total": { "valor": 6500, "de": "2026-10" },
    "meses": { "2026-12": 7000, "2027-01": null },
    "planejamento": { "de": "2026-10", "reais": { "🛒 Compras": 600, "📦 Reserva": 500 } },
    "grupos": { "🌟 Ela": "needs" }, "fixos": { "📚 Educação": true } }
  ```
  `total.de` = novo total padrão daquele mês em diante: os meses anteriores (desde o 1º lançamento)
  ficam com o total que tinham e os totais próprios de meses ≥ `de` saem (sem `de`: só muda o padrão).
  `meses` = total só daquele mês (`null` volta ao padrão). `planejamento` = quanto vai para cada
  categoria, em `reais` (convertido pelo total do mês `de`) ou `pct`; com `de` vale daquele mês em
  diante (até o próximo planejamento) e **substitui** o que valia — categoria fora da lista fica com
  0; sem `de` troca o planejamento base (meses antes do primeiro período). `grupos` = Necessidade
  (`needs`) ou Desejo (`wants`); `fixos` = trava o valor da categoria na roda (`false` destrava). `fora: { "🐶 Pets": "2026-10" }` tira a categoria do orçamento daquele mês em diante.
- `emprestimo`:
  ```json
  { "id": "2026-10-02-020", "op": "emprestimo", "acao": "add", "lancar": "juros",
    "loan": { "id": 1800000000900, "nome": "Capital de giro PJ", "valor": 4000, "taxa": 3.5,
              "n": 12, "parcela": 413.2, "primeira": "2026-10-15", "nota": "" } }
  ```
  `lancar`: `juros` (padrão — lança só os juros de cada parcela, regra do dono), `parcela` (a parcela
  inteira, com os juros embutidos) ou `nada` (só o contrato; ligue lançamentos que já existem com
  `update` + `parcela: { "serie": "E<id do empréstimo>", "k", "n" }`). `taxa` = % ao mês (0 = juros
  rateados: parcelas × n − valor). `acao: "update"` com `loanId` e `muda: { nome, nota }`;
  `acao: "delete"` com `loanId` (os lançamentos ficam).
- Tudo é idempotente: reprocessar o mesmo arquivo não duplica nem desfaz nada.
- Não apague `processados`: é o histórico do que o app aplicou (o app guarda os últimos 300).
- Ao gravar, **acrescente** em `ops` (o app pode estar processando ao mesmo tempo; ele relê e
  preserva operações novas se o arquivo mudou no meio).

## Regras de lançamento do dono (resumo)

- Namorada (Laura) e pai (Valber): um lançamento **líquido por mês** ("Laura — líquido do mês",
  "Pai — líquido do mês"): entrada se veio mais do que foi, saída se foi mais do que veio.
- Zen Telecom e supermercado acima de R$ 100 → categoria 👨 ‍Família.
- Transferências entre contas próprias, caixinhas/RDB e pagamento de fatura não são gasto.
- Empréstimo: o valor recebido não é receita; só juros/encargos entram como gasto, quando pagos.
  (O app tem a seção Empréstimos: cadastra o contrato e lança sozinho só os juros de cada parcela.)
- Pix no crédito / limite convertido em saldo para conta própria: só os encargos são gasto.
- Compra parcelada: uma entrada por parcela ("Nome - Parcela k/N"), na data de cada mês e com a
  fatura certa. BTG mostra o valor TOTAL da compra parcelada; Nubank mostra o da parcela.
- Lançamentos manuais do dono podem ter nome diferente do extrato e às vezes somam várias
  compras: mesmo valor/data próxima = provavelmente já lançado.
- Story Curso = boletos para Augusto Bicalho Roque (R$ 410; R$ 420 = com R$ 10 de multa).
