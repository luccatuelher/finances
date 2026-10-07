# Histórico de mudanças do app

(Movido do comentário do `<head>` do `index.html`; texto original preservado.)

```
      Revisão Claude (jun/2026)
      • FIX: replicação de fixos — fixo no dia 31 transbordava pro mês seguinte
        em meses curtos (31/jan virava 03/mar e fevereiro ficava sem o fixo)
      • FIX: parseValor — "10.50" era lido como 1050; agora ponto com 1-2 decimais
        é tratado como decimal, mantendo "1.800" e "1.800,50" como milhar BR
      • NEW: painel "Próximos Vencimentos · 30 dias" no dashboard (fixos + faturas
        de cartão, ordenados por data, com contagem regressiva e total do período)
      • NEW: Δ% vs mês anterior nos KPIs de Entradas, Despesas e Investido
      • NEW: exportar CSV do mês filtrado (BOM + ';', abre direto no Excel pt-BR)

      Revisão Claude (set/2026) — correções estruturais
      • DADOS: todo dado externo (localStorage, Firebase, backup) passa por
        sanitizeState(): tipos normalizados, ids únicos, registros inválidos vão para
        fin5_quarantine (não somem). Esquema v3 com migração versionada.
      • SYNC: modelo de 3 vias (ts + hash por dispositivo) com gravação condicional
        (transaction). Fim do "último que grava vence", do app sobrescrever alterações
        locais ao abrir e da sync parar em silêncio com categorias como
        "📡 Internet/Telefone" (chaves com / . # $ [ ] agora são codificadas).
        Dados locais têm dono (uid): outra conta no mesmo navegador não herda nada.
      • UNDO: snapshot do estado inteiro (categorias, metas, cartões, orçamento).
      • FIXOS: identidade por `serie` (não pela descrição); replicação por 12 meses.
      • CATEGORIAS: identidade (tipo, nome); renomear/remover não vaza para outro tipo
        e leva junto alocação/necessidade-desejo do orçamento. Ícones por grafema.
      • FATURA: cartões com vencimento ≤ fechamento caíam um mês antes (migrado).
      • IMPORTAÇÃO: um só sistema; CSV com aspas/preâmbulo/crédito-débito, OFX SGML,
        Windows-1252, dedupe por id do banco e por contagem, categoria pelo histórico.
      • SEGURANÇA: strings do usuário nunca mais interpoladas cruas em handlers inline.
      Loop de melhoria contínua:
      • GRÁFICOS: upsertChart() único — reaproveita instâncias (sem piscar/reanimar a
        cada salvamento), recria só quando o canvas muda, nunca deixa gráfico órfão.
      • TABELA: editor inline montado só ao abrir (antes: 8 campos + combobox por linha).
      • PATRIMÔNIO: série mensal contínua — meses sem lançamento eram omitidos (eixo
        pulava meses e a projeção extrapolava 1 mês antigo como ritmo mensal).
      • VIRADA DE DIA: com o app aberto após meia-noite, datas sugeridas, hero e
        vencimentos se atualizam sozinhos (antes ficavam em "ontem").
      • VENCIMENTOS: janela de 30 dias cobre todos os meses que toca (faturas do 3º mês
        ficavam de fora) e usa o índice mensal em vez de varrer todos os lançamentos.
      • CSS: ~12 KB de regras de telas removidas (hub, importador antigo, gist...).
      • DINHEIRO: fmt()/roundMoney() normalizam resíduo de float e -0 (saldo zerado
        aparecia "−R$ 0,00" em vermelho); arredondamento simétrico; saldos, limites e
        ritmo calculados em centavos antes de decidir cor/sinal.
      • BUSCA: ignora acentos/maiúsculas e procura também em categoria, cartão e valor;
        filtro único para desktop e mobile. ORDENAÇÃO: collator pt-BR ("Ágape" < "Farmácia",
        "Item 2" < "Item 10").
      • QUARENTENA: sem duplicatas a cada sync e limitada aos 500 registros mais recentes.
      • TECLADO: registro único de modais (MODALS) — Esc fecha o modal do topo com a
        semântica de cada um, Enter confirma; Enter salva o formulário e a edição inline,
        Esc cancela a edição. Conflito de sync continua exigindo decisão.
      • FIXOS: "Gastos Fixos" (orçamento, popup, sidebar) somava entradas fixas como
        gasto (salário inflava o total); agora só saídas somam e entradas aparecem em verde.
      • AUTOTESTE: abra index.html?preview&selftest (ou runSelfTests() no console) após
        qualquer mudança — 149 verificações de parsers, datas, fatura, sanitização
        (idempotência) e ida-e-volta pelo Firebase. Não altera dados.
      • METAS: goalProgress() — % truncado (99,6% não mostra "100%" com "Faltam"),
        ritmo necessário por mês até o prazo e aviso de prazo vencido; histórico por data
        (aporte retroativo ia para o topo) e que continua aberto após re-render.
      • SYNC EM TEMPO REAL: observa só o campo `ts` no Firebase (bytes) e baixa a base
        apenas quando outro dispositivo gravou — mudanças do celular aparecem no PC na
        hora. Gatilhos passivos (foco, visibilidade, timer) têm limite de 1/min quando não
        há nada local pendente (antes cada alt-tab baixava a base inteira).
      • DEPENDÊNCIAS: Chart.js fixado em 4.5.1 (antes "última versão" — uma major nova
        quebraria o site sozinha) e SRI (integrity) nos 4 scripts de CDN.
      • FATURAS: cards abertos (desktop/mobile) não fecham mais a cada re-render; no
        mobile a busca filtra os itens da fatura e esconde faturas sem correspondência.
      • MERGE DE 3 VIAS: com o último estado sincronizado como base (fb_base_<uid>),
        alterações simultâneas em itens diferentes (lançamentos, metas, cartões,
        categorias, orçamento) são combinadas automaticamente. O diálogo "Local ou
        Firebase?" só aparece quando o MESMO item mudou dos dois lados.
      • ANUAL: "Saldo até agora" conta só lançamentos com data ≤ hoje (somava o mês atual
        inteiro, com fixos agendados) e é zero em ano futuro (mostrava o ano todo com
        "Ainda não começou"). Hero anual usa o índice mensal.
      • DUPLICIDADE COM FIXO: "Dispensar" guarda os PARES revisados (persistente);
        antes durava só até recarregar e escondia também sobreposições novas do mês.
        Detecção agrupa fixos por valor (sem recalcular tokens por par).
      • ESCALA: medido com ~5.800 lançamentos (5 anos): salvar+render 29 ms, hash de sync
        16 ms, dados ≈1 M caracteres (limite típico do navegador ≈5 M). Base do merge
        agora carrega o ts da versão e é descartada se não bater com a meta de sync
        (gravação falha por cota nunca deixa um ancestral errado para o merge).
      • FUZZ: runFuzz() no console de ?preview executa ~1.600 ações aleatórias pela UI e
        verifica invariantes após cada uma (ids únicos, categoria existe, fatura ≥ compra,
        valor/data válidos, fixo com série, estado sempre sanitizado, zero console.error).
        Restaura estado e localStorage ao terminar. Rodadas: 5.000 ações, 0 violações.
      • FIXOS QUE ACABAM: cada série mostra "até Mmm/AA"; se a última ocorrência cai no
        mês atual ou no próximo, aparece "⚠️ termina" (popup e lista do orçamento) e o
        botão 🔁 renova por mais 12 meses a partir da última, preservando o dia pretendido
        (série do dia 31 continua 31/out, 30/nov, 31/dez...). Antes a série sumia sem aviso.
      • FONTE ÚNICA DE VALIDAÇÃO: makeTx() agora passa pela mesma normalização da
        sanitização (_sanTx). O fuzzer (estendido com formulários mobile e importação de
        extrato) achou divergência: investimento importado de fatura ficava com cartaoId
        sem pagamento no crédito. Fuzz: 3.600 ações desktop+mobile, 0 violações.
      • SYNC FUZZ: runSyncFuzz() simula 2 dispositivos + Firebase em memória com edições
        e sincronizações aleatórias (conflitos resolvidos ao acaso) e exige convergência
        A = B = servidor. 8 cenários, ~100 merges automáticos, todos convergiram.
      • PRIVACIDADE: camada única de armazenamento (lsKey/lsGet/lsSet/lsDel); o modo
        preview usa o namespace "preview:" — antes, index.html?preview abria as finanças
        salvas no navegador SEM login. Ao sair da conta (com tudo sincronizado) o app
        oferece apagar os dados deste navegador (computador compartilhado).
      • REGRAS DO FIREBASE: após o login o app tenta ler um caminho vizinho inexistente;
        se conseguir, as regras estão abertas (qualquer conta leria as outras) → aviso e
        regra correta no console (finances/$uid: auth.uid === $uid). 1×/dia, não intrusivo.
      • BACKUP: indicador "último backup há N dias" na seção Backup, em alerta após 30
        dias ou se nunca houve backup em arquivo (nuvem não é cópia independente).
        Análise estática: 327 funções declaradas, nenhuma sem uso.
      • FOCO NOS MODAIS: observador único da classe "open" dos modais do registro — ao
        abrir foca o 1º campo (Enter/Esc funcionam sem clicar), ao fechar devolve o foco
        a quem abriu; overlays com role="dialog"/aria-modal. No celular não abre teclado.
      • BOTÃO VOLTAR: cada modal aberto empilha uma entrada no histórico — "voltar" (celular
        ou navegador) fecha o modal do topo em vez de sair do app e perder o que foi
        digitado; aninhados fecham um por vez; conflito de sync exige decisão.
      • PROJEÇÃO DO PATRIMÔNIO: média só de meses COMPLETOS (o mês em andamento — ex.: só
        o salário entrou — virava "ritmo") e exige 2+ meses de histórico; texto informa a
        base ("média de N meses"). Inspeção visual das 4 visões com dados realistas.
      • CABEÇALHO RESPONSIVO: em larguras intermediárias (tablet/janela estreita) as abas
        invadiam os controles da direita (já acontecia no original). Agora as abas rolam
        dentro do espaço, e rótulos/controles redundantes (ano, extrato, "Desfazer",
        nome do usuário) saem por breakpoint. Medido em 640–1440 px: nenhuma sobreposição.
      • CARTÃO PADRÃO: ao escolher "Crédito" num lançamento novo, o cartão sugerido é o
        último usado (ou o único cadastrado) — antes vinha "sem cartão" e a compra ficava
        fora de qualquer fatura/vencimento. Edição respeita "sem cartão" explícito. Vale
        também ao trocar Débito→Crédito na edição inline e registra o cartão de fixos.
        Inspeção visual mobile (375 px): sem overflow horizontal.
      • DATAS NA IMPORTAÇÃO: faturas com data sem ano ("15/09" — ano inferido pelo mais
        próximo de hoje, até ~2 meses à frente), mês por extenso ("15 SET", "02/ago/2026"),
        mês antes do dia ("Sep 15, 2026") e ISO com / ou . ("2026/09/15") eram descartadas
        em silêncio. LINHAS IGNORADAS: a revisão mostra quantas linhas tinham data ou valor
        ilegível (tem dígito mas não lê); rótulos sem dígito ("Total", "Saldo anterior") e
        células de valor vazias/"-" (saldo em extrato crédito/débito) seguem silenciosos.
        Arquivo sem nenhuma linha legível avisa quantas falharam em vez de "verifique o formato".
      • HERO "QUANTO POSSO GASTAR" (mensal e anual): periodoFase() — mês/ano PASSADO vira
        balanço ("Sobrou do limite", "fechou usando N%"), FUTURO vira previsão ("Você poderá
        gastar", só agendados) e ritmo/"por dia até o fim do mês" só aparecem no período em
        andamento (antes: "R$ X por dia até o fim do mês" em mês encerrado e "R$ 0,00 abaixo
        do ritmo" em mês futuro). Sem orçamento, o limite é renda − investimentos (antes só
        a renda: o hero dizia "ainda pode gastar R$ 2.500" com saldo de R$ 500); agora bate
        com o KPI de saldo. pctDoLimite(): % de uso nunca cruza 100 no arredondamento
        (99,6% mostrava "100% gasto" com saldo; categoria com 100,4% não aparecia estourada)
        — hero, painel e blocos do orçamento.
      • CSV: exportação neutraliza fórmulas (descrição de extrato começando com = + - @
        executava no Excel — CSV injection); a importação remove o prefixo. Coluna de
        natureza (D/C, Débito/Crédito, "tipo" saída/entrada — nome exato, valores
        reconhecidos) define o sinal: bancos com valor sempre positivo importavam todo
        débito como ganho. Categoria do arquivo é usada quando já existe no app (casa pelo
        rótulo sem ícone: "Transporte" do Nubank → "🚗 Transporte"). O CSV exportado pelo
        app agora volta pela importação com tipo, texto e categoria (testado ida e volta).
      • ORÇAMENTO: toda gravação local marca o dashboard para re-render (_persist) — mudar
        total/alocações na aba Orçamento e voltar mostrava hero e painel "restante" com o
        orçamento antigo. Alocação digitada em R$ guarda o % com 6 casas (com 2, R$ 1.000
        de R$ 7.777 voltava como R$ 1.000,12). Alocações somando > 100% ficam em vermelho
        com o excedente em R$ (a pizza normaliza e escondia). fmtPct(): % em pt-BR.
      • DESFAZER NO ORÇAMENTO: total, alocações e necessidade/desejo eram as únicas
        gravações sem pushUndo (varredura de todas as funções que salvam estado). pushUndo
        ganhou "grupo": edições seguidas do mesmo campo em até 10 s viram UM passo com o
        estado de antes da primeira (digitar "5000" = 1 passo, não 4 — a pilha tem 30).
        Só empilha quando o valor muda de fato.
      • CORES E % DAS CATEGORIAS: coresCategorias() — cor estável por categoria (posição
        na lista), igual em todos os meses e nos 3 gráficos (distribuição, barras da
        análise mensal, pizza do orçamento); antes vinha do ranking do mês e a mesma
        categoria mudava de cor. "(sem categoria)" em cinza. pctPartes() (maior resto):
        participações somam exatamente 100% (Math.round dava 33+33+33 = 99%).
        runFuzz() também restaura os campos de formulário (ficavam com dados do fuzz).
      • CARTÕES COM FECHAMENTO/VENCIMENTO 29–31: validação, sanitização e formulário
        limitavam a 1–28 — quem tem cartão que fecha dia 30 (ex.: vence dia 7, fecha 7 dias
        antes) cadastrava 28 e as compras dos dias 29–30 caíam na fatura seguinte. Agora
        1–31; o cálculo usa o último dia em meses curtos (vencimento 31 em fevereiro = 28,
        e o aviso "vence dia" mostra o dia real). Fuzz cobre dias 1–31 e datas 29–31.
      • APORTES COM A SYNC EM TEMPO REAL: o modal "Editar aporte" guardava só o índice; a
        sync aplica mudanças de outro dispositivo com o modal aberto e, se um aporte anterior
        sumisse, salvar DUPLICAVA o aporte (índice inexistente caía em "adicionar") ou
        sobrescrevia outro. Agora guarda a assinatura (data|valor|nota) e relocaliza ao
        salvar; se o próprio aporte sumiu, avisa e não grava. Meta removida remotamente
        também avisa (antes o botão não fazia nada). Lançamentos/cartões/metas já usam id.
      • TRAVAMENTO AO ABRIR (regressão da marcação de dashboard sujo): num navegador/aparelho
        novo (esquema salvo < atual) o load grava → dashboard "sujo" → showApp() renderizava
        ANTES de init() montar os selects → filtro() = NaN → hero quebrava e o patrimônio
        entrava em laço infinito ("2026-02" <= "NaN-NaN" é sempre verdadeiro). Correção
        pela origem: filtro() nunca devolve NaN (mês atual como fallback; todas as leituras
        diretas dos selects passam por ele) e init() roda antes de showApp() no preview e no
        login. Reproduzido com fin5_schema = 2 e verificado sem erros.
      • FORMULÁRIOS (desktop, celular, editar no celular): tipo/pagamento/cartão/aviso de
        fatura eram 3 cópias de cada handler; agora formTipoChange/formPagChange/
        formFaturaInfo guiados pelos descritores FORM_*, e o evento da data é ligado pelo
        descritor. Divergência que isso corrigiu: no "editar" do celular trocar a data não
        atualizava o aviso "fatura de X". Estorno (entrada no crédito) não mostra mais um
        seletor de cartão que era ignorado.
      • FUZZ: runFuzz/runSyncFuzz exclusivos — duas rodadas simultâneas (chamada que estoura
        o tempo no console e é repetida) gravavam o estado bagunçado como "original".
      • EDITOR INLINE (desktop): era a 4ª cópia da lógica de pagamento/cartão; agora usa
        formTipoChange/formPagChange pelo descritor formInline (só o combobox de categoria
        é próprio). Mesmo comportamento dos outros formulários: sugestão do último cartão ao
        mudar para crédito, "sem cartão" explícito respeitado ao salvar.
      • TROCA DE CONTA SEM PERDA: ao entrar outra conta no mesmo navegador, os dados do dono
        anterior eram sobrescritos — se ele tinha alterações não sincronizadas (sessão
        expirou sem "Sair", navegador fechado offline), elas se perdiam. Agora ficam em
        fin5_pendente_<uid> e voltam quando ele entrar de novo (a sync de 3 vias mescla com
        a nuvem). "Apagar dados deste navegador" ao sair preserva pendentes/metadados de
        OUTRAS contas (não estão na nuvem). Testado: A pendente → B entra → A volta; B sai
        apagando → A entra com navegador vazio e recupera.
      • LOGIN: erros em pt-BR por código (antes "Firebase: Error (auth/…)" cru); fechar o
        popup não mostra erro; popup bloqueado/sem suporte (celular, navegador embutido) cai
        para login por redirecionamento, cujo erro de retorno aparece na tela de login.
      • QUARENTENA VISÍVEL: registros sem data/valor válido iam para fin5_quarantine só com
        um console.warn — para o usuário o lançamento sumia. Agora: toast quando algo é
        separado, aviso na seção Backup (quantos, lista no tooltip, "baixar" JSON e
        "descartar" com confirmação), e a quarentena vai junto no backup JSON e volta na
        importação. Verificado com registro inválido já no carregamento (sem erros no boot).
      • ACESSIBILIDADE: auditoria achou 47 de 53 campos sem nome acessível (<label> sem
        "for"), 17 botões só com ícone sem nome e 23 clicáveis fora do teclado (inclusive
        "↑ Exportar"/"↓ Importar" backup, cabeçalhos ordenáveis, "Nova Meta"). Uma rotina
        _a11y() aplicada ao DOM inicial e, via MutationObserver, a tudo que é renderizado
        depois: associa rótulo→campo, usa title/placeholder como nome, nomeia botões por
        title ou pelo glifo (✕ Fechar, ◀ Anterior, 🗑 Excluir…), e põe clicáveis não nativos
        no Tab com role="button" e ativação por Enter/Espaço (fundos de modal e containers
        que só barram o clique ficam de fora). Seletores de cor com nome e aria-pressed.
        Depois: 0 campos sem nome, 0 botões sem nome, 0 clicáveis fora do Tab.
      • CONTRASTE (WCAG AA): auditoria mediu texto × fundo efetivo — cinza de rótulos/abas
        2,4:1 (51 textos), verde 3,3:1, vermelho 3,8:1, botão azul-claro 2,8:1. Tokens do
        :root escurecidos o mínimo, na mesma matiz, para ≥ 4,5:1 sobre branco, fundo da página
        e fundos de alerta (text-2, text-3, success, danger, credit). Cores escolhidas pelo
        usuário (metas, cartões) usadas como texto ou fundo de texto branco passam por
        corLegivel() — vale para cores antigas já salvas; toast() aplica o mesmo ao fundo.
        Depois: 0 de 227 textos abaixo de AA.
      • CONTEÚDO FECHADO FORA DO TAB: modais e folhas do celular fechados só tinham opacity:0 —
        no desktop o Tab percorria ~20 campos invisíveis antes do formulário. Agora fechado =
        visibility:hidden (atrasada até o fim da animação de saída). Foco sempre visível nos
        clicáveis que _a11y() põe no Tab (alguns tinham outline:none).
      • CONFLITO DE SYNC POR ITEM: com UM item alterado nos dois dispositivos, o diálogo
        descartava a mescla inteira e a escolha valia para o estado todo — "Manter Local"
        apagava o que o outro dispositivo mudou em OUTROS itens e "Usar Firebase" o que foi
        feito aqui. Agora mergeStates(…, prefer) resolve só os itens em conflito pelo lado
        escolhido e mantém o resto da mescla; o diálogo lista quais itens conflitam ("Manter
        as minhas" / "Usar as do outro dispositivo"). Sem base de merge, segue a escolha do
        estado inteiro. runSyncFuzz ganhou o invariante "lançamento criado e nunca apagado não
        some": com a versão antiga falhou em 5 de 8 cenários; com a nova, 0 de 14.
      • SYNC FUZZ — EDIÇÕES: segundo invariante: lançamento editado por UM só dispositivo e
        não apagado termina com a última edição dele (não há como conflitar). A resolução
        antiga (estado inteiro) falhava em 4 de 8 cenários; a atual passa em 16.
      • SELETOR DE ÍCONES pelo teclado: escolher/fechar devolve o foco ao botão que abriu
        (antes o botão focado sumia e o foco caía no <body>); Esc fecha só o seletor (antes
        não fazia nada ou fechava o modal inteiro); aberto pelo teclado, o foco vai ao ícone
        atual (aria-pressed marca o selecionado).
      • OFFLINE: sem conexão o SDK do Firebase não falha — once()/transaction() ficam
        pendurados; o botão mostrava "Sync…" para sempre e "Sair" com alterações pendentes
        travava sem resposta. Agora: sem rede → estado "Offline" na hora (evento 'offline'
        e checagem antes de sincronizar; 'online' retoma) e aviso claro na sync manual;
        conexão instável → prazo de 20 s vira erro (_comPrazo). Transação que confirme
        depois do prazo é segura (condicional ao ts).
      • ESCALA re-medida após acessibilidade/contraste: 6.000 lançamentos (1,1 MB) —
        renderAll 12,6 ms, salvar+render 25 ms, _a11y no documento inteiro 1 ms, fuzz de
        1.600 ações com a base grande sem violações.
      • VALOR DA META E DO APORTE (it. 43): eram <input autocomplete="off" type="number">, que lê "." como
        decimal: digitar 1.500 (milhar BR) salvava R$ 1,50 sem aviso. Agora são texto com
        inputmode decimal e passam por parseValor (1.500 → 1500; 1.500,50 → 1500,5), como
        os demais formulários; ao editar, o valor volta formatado com vírgula. Autoteste
        cobre os dois campos; bateria completa verde.
      • CSV DO ANO (it. 44): só dava para exportar o mês filtrado (12 arquivos para levar o
        ano à planilha ou ao contador). Novo botão "CSV do ano" (financas-AAAA.csv), mesma
        formatação, proteção contra fórmulas e volta pelo importador; a lista sai de helper
        único (_listaCSV/_csvDe) usado também pelo CSV do mês. Autoteste +2; conferido
        baixando pela UI (mês vazio, ano com 8 lançamentos).
      • IMPRESSÃO (it. 45): não havia @media print — Ctrl+P imprimia o app inteiro (formulário,
        backup, botões, barra do topo) e listas rolantes saíam cortadas na altura da tela.
        Agora sai só a tela atual: painéis/botões/modais ocultos, uma coluna, listas sem
        limite de altura, cartões e linhas sem quebrar no meio, cabeçalho de tabela repetido
        a cada página, cores preservadas. Conferido em PDF A4 das 4 telas (o Chart.js não
        carrega no sandbox, então os gráficos não foram vistos no papel).
      • INSTALAR COMO APP (it. 46): novos manifest.webmanifest, icon.svg e sw.js (publicar os
        4 arquivos juntos). O navegador oferece "Instalar" (janela própria, ícone) e o app
        abre sem rede: o service worker usa rede primeiro (sempre a versão nova quando há
        internet) e a última cópia guardada como reserva; Firebase/Auth nunca passam por ele
        e o preview não o registra. Testado por http: SW ativo, rede desligada, recarregar
        abre o app (bootApp presente, 0 erros).
      • QUARENTENA POR CONTA (it. 47): registros inválidos da conta A continuavam no navegador
        ao entrar com a conta B: apareciam na seção Backup e iam no backup exportado da B.
        Agora a quarentena acompanha o dono dos dados (_trocarQuarentena): guardada à parte
        ao trocar de conta e devolvida quando o dono volta. Reproduzido pela UI (B via 1
        registro da A → agora 0; A recupera o seu); autoteste +1.
      • TABELAS NO CELULAR (it. 48): a caixa .data-table-box (Mês a mês, fixos, faturas...) era
        overflow:hidden; a tabela anual tem 596 px numa tela de 345 e as colunas "Saldo do
        mês" e "Saldo do ano" ficavam cortadas, sem como rolar. Agora rola na horizontal
        dentro da caixa (medido em 375 px: conteúdo 596 > caixa 345, antes inalcançável).
      • JANELA ESTREITA / IPAD (it. 49): layout de desktop em 768 px (iPad moderno se anuncia
        como Mac) e 375 px: os 5 KPIs da visão anual ficavam com colunas fixas num style
        inline, que vencia o @media, e o último saía da tela (815 > 768). Colunas na CSS.
        No histórico de lançamentos, a coluna de ações era cortada em 375 px (380 > 347):
        a caixa rola só nessa largura, sem desligar o cabeçalho fixo das telas largas.
        Varredura de 4 telas x 375/768/1024 px sem sobras.
      • LIMITES E TEXTO LONGO (it. 50): não havia teto algum. Valor de R$ 1e30 entrava (acima de
        ~R$ 90 tri o double perde os centavos e as somas erram) e descrição de 5.000 caracteres
        também. Agora valor > R$ 100 bi vai para a quarentena (visível) ou é recusado no
        formulário (lançamento, meta, aporte) e descrição é limitada a 200 (maxlength + corte
        na sanitização). Além disso, 200 caracteres sem espaço esticavam a tabela para 2.627 px;
        colunas de grid com minmax(0,1fr) e overflow-wrap:anywhere em td, KPIs, gráficos e lista
        de detalhe. Varredura das 4 telas com dados extremos (1280/768 px) sem sobras.
      • NOMES LIMITADOS (it. 51): categoria (60 com o ícone), cartão (40) e meta (200) também não
        tinham teto. Cortados na sanitização (a categoria do lançamento e a do rol truncam
        igual, sem categoria órfã), com maxlength nos campos e aviso nos formulários.
        Limitação: categoria antiga com mais de 60 caracteres perderia o vínculo com o
        orçamento (não esperado; nomes reais são curtos).
      • ÍCONES PNG (it. 52): o app instalado só tinha ícone SVG, que o iOS e alguns Android
        ignoram (ícone genérico na tela inicial). Novos icon-192.png, icon-512.png (também
        maskable, glifo dentro da zona segura) e apple-touch-icon.png (180). Publicar junto
        com manifest.webmanifest, icon.svg e sw.js.
      • EIXO DOS GRÁFICOS (it. 53, primeira com o Chart.js real na bateria): dois formatadores de
        eixo duplicados usavam 1 casa fixa: faixa curta (R$ 3.000–3.150) repetia rótulos
        ("R$3.1k, R$3.1k, R$3.0k, R$3.0k"), negativos saíam sem formato, milhões viravam
        "R$1500.0k" e valores pequenos "R$-0.0094" (ponto decimal). Um único fmtEixo em pt-BR
        compacto ("R$ 6 mil", "R$ 1,5 mi") aumenta as casas até os rótulos ficarem distintos.
        Autoteste +3; conferido com o Chart.js real nas telas Visão Geral, Anual e Mensal.
      • CAIXA DE ENTRADA DO CLAUDE (it. 54): lançar o que o dono mandava no chat exigia exportar
        e importar um backup inteiro (a importação substitui tudo). Agora o Claude grava operações
        (add/update/delete, com "espera" = valores atuais que precisam bater) no inbox.json de um
        repositório PRIVADO do GitHub; o app lê com um token fine-grained guardado só no aparelho,
        aplica pela sanitização + sync de 3 vias e marca como processadas (relê e preserva as
        novas se o arquivo mudou no meio). Idempotente: reprocessar não duplica nem sobrescreve
        edição do dono. Opcional: cópia dos dados (estado.json) para o Claude conferir duplicados.
        Ver CAIXA-DE-ENTRADA.md. Autoteste +4; runSyncFuzz cobre o fluxo com GitHub simulado.
      • ORÇAMENTO COM RODA E CARTÃO AZUL (it. 55, pedido do dono): a página começava pelas metas,
        mostrava 5 números em 4 bases, editava cada categoria às cegas em % num painel escondido,
        a pizza era só leitura (e sumia sem o Chart.js) e os cartões de 124 px cortavam valores.
        Agora: abas Orçamento | Metas; cartão azul com quanto ainda pode gastar e uma barra por
        grupo; roda em SVG (anel interno Necessidades/Desejos/Investimentos, externo categorias)
        com alças arrastáveis, setas do teclado, "de onde veio" e guia 50/30/20; tabela com o
        planejado editável na linha (Enter/Tab) e "resta/passou"; valor fixo por categoria
        (budget.locks: sanitização, merge e renomeação); entradas recolhidas; vencimentos com
        margem. Regras do dono: aumentar tira do mesmo grupo; pode sobrar sem destino. Mensal
        ganhou o cartão azul (saldo, entrou/saiu, débito/crédito). Renomear um gasto com uma
        entrada de mesmo nome perdia o planejado (_moveBudgetKeys). Autoteste +7 (111).
      • MENSAL COMO REVISÃO DO MÊS (it. 56, pedido do dono): a aba repetia a Visão Geral
        (entradas/despesas, débito/crédito, gastos por categoria e listas de lançamentos).
        Agora cada aba tem um uso: Visão Geral = dia a dia; Mensal = revisar o mês. Cartão
        azul compara com a média dos 3 meses anteriores (mês em andamento: só até hoje, contra
        os anteriores no mesmo dia; mês futuro: sem média); cascata entrou, fixos, parcelas,
        juros e tarifas, dia a dia, investido, sobrou; destaques automáticos (maior alta e
        queda, juros/IOF/multas, dia mais caro, dias sem gasto); calendário de gastos (azul
        sequencial, clique mostra o dia); maiores gastos e lugares que se repetiram; o que
        mudou por categoria com os últimos 6 meses. Tudo em HTML, sem depender do Chart.js.
        Autoteste +2 (113).
      • ORÇAMENTO, PARCELAS, JUROS E EMPRÉSTIMOS (it. 57, pedidos do dono): (1) digitar o planejado na
        tabela de categorias muda SÓ aquela categoria (nada é tirado das outras); a faixa no topo mostra
        quanto falta ou passou do total, ao vivo enquanto digita (roda/alças/setas seguem reajustando; no
        celular, onde a tabela não tem campo, o painel da categoria faz o mesmo). (2) cadeado de valor fixo
        em cada linha. (3) donut: a categoria selecionada tem alça nas DUAS pontas; cada ponta move a
        fronteira com o vizinho daquele lado (_orcMudaBorda; sem vizinho livre cai na regra de sempre).
        (4) excluir categoria pergunta onde: só no mês aberto, dali em diante ou tudo — as duas primeiras
        usam budget.off (faixas de meses por categoria: sanitização, merge, renomeação, limite de gastos),
        com "Categorias fora deste mês" para voltar; lançamentos do escopo são movidos como antes.
        (5) abas Orçamento|Metas e o botão de recolher o painel lateral saíram; metas sempre no fim da
        página, com Empréstimos abaixo. (6) ordenação lembrada por aparelho: categorias do orçamento, "o que
        mudou por categoria" (novo seletor) e caixinhas. (7) Visão Geral: ⊞ Categoria vira caixinhas (cor,
        total, % do tipo, lançamentos) com ordenação; "Orçamento do mês" lista as categorias que mais
        apertam; o patrimônio foi para a Visão Anual (ano escolhido, vermelho abaixo de zero). (8) cartão
        azul (mensal e anual) plota a FOLGA (ritmo − gasto acumulado): para cima = gastou menos, para
        baixo = gastou mais. (9) PARCELAS automáticas: "Parcelar" no lançamento novo gera N lançamentos
        ("Nome - Parcela k/N", um por mês, fatura certa, centavos exatos) ligados por parcela:{serie,k,n};
        remover pergunta o escopo (só esta/esta e as seguintes/todas), editar pode valer para as seguintes,
        caixa "Parcelas do mês" no Orçamento. (10) JUROS embutidos: campo "juros/multa incluídos" — o boleto
        atrasado continua UM lançamento na categoria dele, com t.juros (selo "juros", soma em "juros e
        tarifas" e nos destaques do Mensal). (11) EMPRÉSTIMOS (estado novo `loans`, chave l: sanitização,
        sync por id, backup, desfazer, inbox): contrato → lançamentos automáticos, por padrão só os JUROS de
        cada parcela (regra do dono: o valor recebido não é receita e o principal não é gasto), ou a parcela
        inteira; juros pela tabela Price/rateio; painel com falta pagar, pago, juros e próxima parcela. Autoteste 143;
        fuzz e sync fuzz cobrem parcelas, juros, empréstimos e categorias fora do mês.
      • ORÇAMENTO POR PERÍODO E CAIXA DE ENTRADA COMPLETA (it. 58, pedido do dono): o planejamento
        por categoria valia para todos os meses, então montar o orçamento de outubro mudava setembro
        e os anteriores. Agora budget.allocsDe['AAAA-MM'] guarda planejamentos que valem daquele mês
        em diante (sanitização, merge por categoria, renomeação, desfazer); a roda edita o que vale
        no mês aberto e há "Novo planejamento a partir de <mês>" / "Apagar este planejamento". A
        caixa de entrada passou a aceitar `orcamento` (total a partir de um mês congelando os
        anteriores, totais por mês, planejamento em reais ou %, grupos, valor fixo), `emprestimo`
        (add com lançamento dos juros, update, delete) e `parcela`/`serie` no update (ligar parcelas
        e fixos que já existem). Autoteste +4 (149); fuzz cobre os planejamentos.
      • RISCOS DE DADOS (revisão Opus, out/2026): (1) caixa de entrada só usa repositório PRIVADO
        (GET /repos → private === true, a cada rodada, ao salvar e antes de gravar estado.json);
        (2) `espera` obrigatória em update/delete (delete exige desc+valor) e máx. 10 exclusões por
        rodada (tudo-ou-nada); (3) SCHEMA_VERSION 4 + `appV` no payload: app com esquema mais antigo
        que o servidor não aplica, não mescla e não grava ("Atualize"); edições locais ficam pendentes
        e a caixa de entrada pausa. Autoteste +5 (156), cenário "app antigo" no runSyncFuzz.
      Ferramentas de manutenção (use após qualquer mudança, em index.html?preview):
        runSelfTests() · runFuzz() · runSyncFuzz()
```
