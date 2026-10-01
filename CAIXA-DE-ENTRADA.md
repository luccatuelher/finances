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
  novos. Campos aceitos: desc, valor, data, tipo, cat, pagamento, cartaoId, faturaData, fixo, juros.
  Se o dono editou o lançamento depois, `espera` não bate → `ignorado: mudou desde então`.
- `delete`: remove se `espera` bater; se já não existe → `ignorado: já não existe`.
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
