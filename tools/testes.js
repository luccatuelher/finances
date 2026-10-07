// Testes embutidos do app (autoteste, fuzz de interface, fuzz de sincronização, caixa de entrada).
// NÃO fazem parte do app publicado: o tools/checks.mjs injeta este arquivo antes do index.html carregar
// (page.addInitScript). Para rodar à mão num navegador, cole o arquivo no console de index.html?preview=1.
// Dependem das funções/variáveis globais do app (só são chamadas depois do carregamento).
// ── AUTOTESTE (?selftest) ────────────────────────────────────────────────────
// Abra index.html?preview&selftest para verificar as funções puras depois de qualquer
// mudança no código (parsers, datas, fatura, sanitização, sync). Não altera dados.
// Resultado: tabela no console + toast. Também disponível como runSelfTests() no console.
function runSelfTests() {
    const results = [];
    const eq = (name, got, exp) => results.push({ name, ok: JSON.stringify(got) === JSON.stringify(exp), got, exp });
    const nan = (name, got) => results.push({ name, ok: Number.isNaN(got), got, exp: NaN });

    // Valores
    eq('parseValor BR milhar', parseValor('1.800,50'), 1800.5);
    eq('parseValor US', parseValor('1,234.56'), 1234.56);
    eq('parseValor ponto decimal', parseValor('10.5'), 10.5);
    eq('parseValor milhar sem decimal', parseValor('1.800'), 1800);
    eq('parseValor negativo OFX', parseValor('-50.00'), -50);
    eq('parseValor moeda', parseValor('R$ 10,50'), 10.5);
    eq('parseValor parênteses', parseValor('(12,00)'), -12);
    eq('parseValor sinal no fim', parseValor('50,00-'), -50);
    // Meta/aporte são texto (inputmode decimal): num <input type=number> "1.500" virava 1,5 (R$ 1,50 em vez de 1.500)
    eq('meta e aporte aceitam milhar/vírgula BR', ['goalMeta', 'aporteValor'].map(id => { const el = $(id); const v0 = el.value; el.value = '1.500,50'; const n = numInput(el); el.value = v0; return [el.type, n]; }), [['text', 1500.5], ['text', 1500.5]]);
    nan('parseValor lixo', parseValor('abc'));
    nan('parseValor malformado', parseValor('1.2.3'));
    eq('roundMoney float', roundMoney(0.1 + 0.2), 0.3);
    eq('roundMoney simétrico', [roundMoney(12.345), roundMoney(-12.345)], [12.35, -12.35]);
    eq('roundMoney -0', Object.is(roundMoney(-1e-17), 0), true);
    {   // pilha de desfazer: agrupa edições seguidas do mesmo campo (usa pilha temporária)
        const pilhaReal = undoStack; undoStack = []; redoStack = [];
        try {
            pushUndo('a', 'g1'); pushUndo('b', 'g1'); pushUndo('c', 'g2'); pushUndo('d'); pushUndo('e');
            pushUndo('x', 'g3'); undoStack[undoStack.length - 1].at -= UNDO_GRUPO_MS + 1; pushUndo('y', 'g3');
            eq('undo agrupa edições do mesmo campo', undoStack.map(u => u.label), ['a', 'c', 'd', 'e', 'x', 'y']);
        } finally { undoStack = pilhaReal; _updateUndoBtn(); }
    }
    {   // contraste: cor do usuário escurece até 4,5:1 com branco; o que já passa não muda
        const razao = h => 1.05 / (_lumRel([1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))) + 0.05);
        eq('corLegivel', [razao(corLegivel('#f59e0b')) >= 4.5, razao(corLegivel('#16a34a')) >= 4.5, razao(corLegivel('#fff')) >= 4.5,
                          corLegivel('#1d4ed8'), corLegivel('var(--credit)'), corLegivel('#18181b')],
           [true, true, true, '#1d4ed8', 'var(--credit)', '#18181b']);
    }
    {   // acessibilidade: rótulo associado, clicável no Tab, fundo de modal/container ignorados, glifo nomeado
        const d = document.createElement('div');
        d.innerHTML = '<div class="field"><label>Valor</label><input id="__a11yT"></div><div onclick="f()">Abrir</div>'
            + '<div onclick="event.stopPropagation()"><input></div><div class="overlay" onclick="if(event.target===this)x()"></div><button>✕</button>';
        _a11y(d);
        const [, clic, stop, ov] = d.children;
        eq('acessibilidade (_a11y)', [d.querySelector('label').htmlFor, clic.getAttribute('role'), clic.tabIndex, stop.hasAttribute('role'), ov.hasAttribute('tabindex'), d.querySelector('button').getAttribute('aria-label')],
           ['__a11yT', 'button', 0, false, false, 'Fechar']);
    }
    eq('descrição da quarentena', [_descQuarentena({ desc: 'Mercado', data: '' }), _descQuarentena({ aporteDe: 'Viagem', valor: 1 }), _descQuarentena({})],
       ['Mercado', 'Aporte em "Viagem"', '(sem descrição)']);
    eq('erros de login em pt-BR', [_authErroMsg({ code: 'auth/popup-closed-by-user' }), _authErroMsg({ code: 'auth/network-request-failed' }).startsWith('Sem conexão'),
        _authErroMsg({ code: 'auth/xyz' }), _authErroMsg({})], [null, true, 'Não foi possível entrar (xyz). Tente de novo.', 'Não foi possível entrar. Tente de novo.']);
    {   // filtro() sem selects montados/valor inválido = mês atual (antes NaN travava o boot)
        const selM = $('filtroMes'), selA = $('filtroAno'), vM = selM.value, vA = selA.value, now = new Date();
        try { selM.value = '__x'; selA.value = '__x'; eq('filtro() nunca NaN', filtro(), { m: now.getMonth(), a: now.getFullYear() }); }
        finally { selM.value = vM; selA.value = vA; }
    }
    {   // aporte editado com índice desatualizado (sync removeu um anterior) é relocalizado
        const A = { data: '2026-01-05', valor: 100, nota: '' }, B = { data: '2026-02-05', valor: 200, nota: 'x' }, C = { data: '2026-03-05', valor: 300, nota: '' };
        const sigC = _aporteSig(C), g1 = { aportes: [A, B, C] }, g2 = { aportes: [B, C] }, g3 = { aportes: [A, B] };
        eq('aporte relocalizado por assinatura', [_localizarAporte(g1, 2, sigC), _localizarAporte(g2, 2, sigC), _localizarAporte(g3, 2, sigC)], [2, 1, -1]);
    }
    eq('pctPartes soma 100', [pctPartes([1, 1, 1]), pctPartes([50, 30, 20]), pctPartes([0, 0]), pctPartes([2, 1, 1, 1, 1, 1, 1]).reduce((s, v) => s + v, 0)],
       [[34, 33, 33], [50, 30, 20], [0, 0], 100]);
    {   // cor estável: independe da ordem/ranking e do subconjunto exibido
        const [c0, c1] = (cats.saida || []).concat(['__a', '__b']);
        const [x0, x1] = coresCategorias([c0, c1]), [y1, y0] = coresCategorias([c1, c0]);
        eq('cor da categoria estável', [x0 === y0, x1 === y1, x0 !== x1, coresCategorias(['(sem categoria)'])[0]], [true, true, true, COR_SEM_CATEGORIA]);
    }
    eq('fmtPct pt-BR', [fmtPct(107.8584), fmtPct(50), fmtPct(0.005), fmtPct(NaN)], ['107,86%', '50%', '0,01%', '0%']);
    eq('pctDoLimite não cruza 100', [pctDoLimite(99.6, 100), pctDoLimite(100, 100), pctDoLimite(100.2, 100), pctDoLimite(0.1 + 0.2, 0.3), pctDoLimite(5, 0)], [99, 100, 101, 100, 0]);
    const hj = new Date('2026-09-25T12:00:00');
    eq('periodoFase', [periodoFase(2026, 8, hj), periodoFase(2026, 7, hj), periodoFase(2026, 9, hj), periodoFase(2025, 11, hj), periodoFase(2027, 0, hj),
                       periodoFase(2026, null, hj), periodoFase(2025, null, hj), periodoFase(2027, null, hj)],
       ['atual', 'passado', 'futuro', 'passado', 'futuro', 'atual', 'passado', 'futuro']);
    eq('fmt sem -0', fmt(0.3 - 0.1 - 0.2), fmt(0));

    // Datas
    eq('isValidISODate 30/fev', isValidISODate('2026-02-30'), false);
    eq('addMonths fim de mês', addMonthsISO('2026-01-31', 1), '2026-02-28');
    eq('addMonths virada de ano', addMonthsISO('2026-11-15', 3), '2027-02-15');
    eq('addMonths negativo', addMonthsISO('2026-01-15', -1), '2025-12-15');
    eq('parseFlexDate formatos', ['01/02/2026', '2026-02-01 10:00', '1/2/26', '31/02/2026'].map(d => parseFlexDate(d)),
       ['2026-02-01', '2026-02-01', '2026-02-01', null]);
    const ref = new Date('2026-01-10T12:00:00');
    eq('parseFlexDate sem ano (infere)', ['15/12', '05/01', '20/02'].map(d => parseFlexDate(d, ref)), ['2025-12-15', '2026-01-05', '2026-02-20']);
    eq('parseFlexDate mês por extenso', ['15 SET 2026', '3 dez', '07/jan/25', '15 xyz'].map(d => parseFlexDate(d, ref)), ['2026-09-15', '2025-12-03', '2025-01-07', null]);
    eq('parseFlexDate ISO com / e .', ['2026/09/15', '2026.09.15 08:00', '2026/02/30'].map(d => parseFlexDate(d, ref)), ['2026-09-15', '2026-09-15', null]);
    eq('parseFlexDate mês antes do dia', ['Sep 15, 2026', 'SET 15 2026', 'dez 3', 'Mar 3 10:00', 'Total 12'].map(d => parseFlexDate(d, ref)), ['2026-09-15', '2026-09-15', '2025-12-03', '2026-03-03', null]);
    // Ilegível = tem dígito mas não lê; sem dígito ("Total", vazio, "-") é linha informativa
    eq('CSV conta linhas ilegíveis', (_extParseCSV('data,descricao,valor\n10/01/2026,A,5\n32/13/2026,B,7\n11/01/2026,C,1O\nTotal,,12\n12/01/2026,Saldo,\n13/01/2026,D,-\n') || {}).skipped, 2);
    eq('CSV crédito/débito: saldo vazio não é ilegível', (() => { const r = _extParseCSV('data;historico;credito;debito\n10/01/2026;A;5;\n11/01/2026;Saldo;;\n12/01/2026;B;;3,5\n'); return [r.map(x => x.valor), r.skipped]; })(), [[5, -3.5], 0]);
    eq('CSV só com linhas ilegíveis → lista vazia com contagem', (() => { const r = _extParseCSV('data,descricao,valor\n2026/99/99,A,5\n45/45/2026,B,7\n'); return r && [r.length, r.skipped]; })(), [0, 2]);

    // Fatura
    const cVF = { fechamento: 25, vencimento: 5 }, cFV = { fechamento: 3, vencimento: 10 };
    eq('fatura venc<fech antes do fechamento', _calcFatura(cVF, '2026-01-20'), '2026-02-05');
    eq('fatura venc<fech depois do fechamento', _calcFatura(cVF, '2026-01-27'), '2026-03-05');
    eq('fatura venc>fech', [_calcFatura(cFV, '2026-01-02'), _calcFatura(cFV, '2026-01-05')], ['2026-01-10', '2026-02-10']);
    eq('fatura virada de ano', _calcFatura(cVF, '2026-12-28'), '2027-02-05');
    eq('fatura legada (migração)', _calcFaturaLegacy(cVF, '2026-01-20'), '2026-01-05');
    // Fechamento/vencimento 29–31: em meses curtos vale o último dia
    const c30 = { fechamento: 30, vencimento: 7 }, c31 = { fechamento: 31, vencimento: 10 }, cV31 = { fechamento: 25, vencimento: 31 };
    eq('fatura fecha dia 30', [_calcFatura(c30, '2026-02-28'), _calcFatura(c30, '2026-04-30'), _calcFatura(c30, '2026-05-31')], ['2026-03-07', '2026-05-07', '2026-07-07']);
    eq('fatura fecha dia 31', [_calcFatura(c31, '2026-04-30'), _calcFatura(c31, '2026-05-31')], ['2026-05-10', '2026-06-10']);
    eq('fatura vence dia 31 em fevereiro', _calcFatura(cV31, '2026-02-10'), '2026-02-28');
    eq('sanitize: dias do cartão 1–31', sanitizeState({ k: [{ id: 1, nome: 'X', fechamento: 30, vencimento: 45 }] }).cards.map(c => [c.fechamento, c.vencimento]), [[30, 31]]);

    // Texto / categorias / segurança
    eq('splitCatName emoji ZWJ', splitCatName('👨‍👩‍👧 Família'), { icon: '👨‍👩‍👧', label: 'Família' });
    eq('splitCatName dígitos', splitCatName('Contas 2024'), { icon: null, label: 'Contas 2024' });
    eq('splitCatName símbolo', splitCatName('₿ Cripto'), { icon: '₿', label: 'Cripto' });
    eq('fold acentos', fold('Farmácia SÃO'), 'farmacia sao');
    eq('cmpText pt-BR', ['Item 10', 'Farmácia', 'Ágape', 'Item 2'].sort(cmpText), ['Ágape', 'Farmácia', 'Item 2', 'Item 10']);
    eq('jsStr aspas', jsStr(`a'b"c`), '&quot;a&#39;b\\&quot;c&quot;');
    eq('safeColor injeção', safeColor('#fff" onclick="x'), '#6d28d9');

    // Importação
    eq('CSV aspas escapadas', (_extParseCSV('date,title,amount\n2026-09-02,"iFood, ""X""",45.5\n') || [])[0]?.desc, 'iFood, "X"');
    eq('CSV preâmbulo + crédito/débito', (_extParseCSV('Conta 1\n\nData;Lançamento;Crédito;Débito\n02/09/2026;TARIFA;;29,90\n') || []).map(r => r.valor), [-29.9]);
    eq('CSV coluna D/C (valor sempre positivo)', (_extParseCSV('Data;Histórico;Valor;D/C\n01/09/2026;TARIFA;29,90;D\n02/09/2026;PIX RECEBIDO;100,00;C\n03/09/2026;X;5;PIX\n') || []).map(r => r.valor), [-29.9, 100, 5]);
    eq('CSV "Tipo de pagamento" não vira sinal', (_extParseCSV('Data;Descrição;Valor;Tipo de pagamento\n01/09/2026;Loja;-50;Crédito\n') || []).map(r => r.valor), [-50]);
    eq('CSV do próprio app volta com sinal, texto e categoria', (_extParseCSV('data;tipo;descricao;categoria;pagamento;cartao;fixo;valor\n2026-09-01;saida;"\'=cmd";"🍔 Alimentação";debito;"";;12,50\n2026-09-02;entrada;"Salário";"💰 Salário";;"";sim;5000,00\n') || []).map(r => [r.valor, r.desc, r.catHint]),
       [[-12.5, '=cmd', '🍔 Alimentação'], [5000, 'Salário', '💰 Salário']]);
    // Impressão: regra @media print esconde o painel lateral (senão o formulário e o backup saem no papel)
    eq('estilos de impressão escondem o painel lateral', [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => r.type === CSSRule.MEDIA_RULE && r.conditionText === 'print' && [...r.cssRules].some(x => (x.selectorText || '').includes('.sidebar') && x.style.display === 'none')); } catch { return false; } }), true);
    { // Quarentena acompanha o dono dos dados (não vaza para outra conta no mesmo navegador)
        const K = ['fin5_quarantine', _quarKey('QA'), _quarKey('QB')], salvo = K.map(k => lsGet(k));
        try {
            storeJSON('fin5_quarantine', [{ id: 1, desc: 'da conta A' }]);
            _trocarQuarentena('QA', 'QB');
            const naB = loadJSON('fin5_quarantine', []).length;
            _trocarQuarentena('QB', 'QA');
            eq('quarentena: some para a conta nova e volta ao dono', [naB, (loadJSON('fin5_quarantine', [])[0] || {}).desc], [0, 'da conta A']);
        } finally { K.forEach((k, i) => salvo[i] == null ? lsDel(k) : lsSet(k, salvo[i])); renderQuarentena(); }
    }
    { // Tabela mais larga que a tela rola dentro da caixa (antes cortava as últimas colunas no celular)
        const bx = document.createElement('div'); bx.className = 'data-table-box'; document.body.appendChild(bx);
        const ox = getComputedStyle(bx).overflowX; bx.remove();
        eq('caixa de tabela rola na horizontal', ox, 'auto');
    }
    // Colunas dos KPIs anuais na CSS: um style inline vencia o @media e o 5º cartão saía da tela (iPad, janela estreita)
    eq('KPIs anuais sem grid inline', $('view-anual').querySelector('.annual-kpis').style.gridTemplateColumns, '');
    { // Limites: valor absurdo vai para a quarentena (visível) e descrição gigante é cortada
        const dT = todayLocalISO(), sl = sanitizeState({ t: [{ id: 1, desc: 'X'.repeat(5000), valor: 10, data: dT, tipo: 'saida' }, { id: 2, desc: 'ok', valor: 1e30, data: dT, tipo: 'saida' }, { id: 3, desc: 'ok', valor: VALOR_MAX, data: dT, tipo: 'saida' }] });
        eq('limites: valor absurdo quarentena, descrição cortada', [sl.tx.length, sl.report.dropped.length, sl.tx[0].desc.length], [2, 1, DESC_MAX]);
        eq('limites: _valorOk (teto e NaN)', [_valorOk(VALOR_MAX), _valorOk(VALOR_MAX * 10), _valorOk(NaN)], [true, false, false]);
    }
    { // Nomes de categoria/cartão limitados (categoria do lançamento e do rol truncam igual, sem órfã)
        const dT = todayLocalISO(), longa = 'Z'.repeat(300), sn = sanitizeState({ t: [{ id: 1, desc: 'a', valor: 1, data: dT, tipo: 'saida', cat: longa }], c: { saida: [longa], entrada: [], investimento: [] }, k: [{ id: 2, nome: longa, fechamento: 5, vencimento: 10 }] });
        eq('limites: categoria e cartão truncados de forma consistente', [sn.tx[0].cat.length, sn.cats.saida.every(c => c.length <= CAT_MAX), sn.cats.saida.includes(sn.tx[0].cat), sn.cards[0].nome.length], [CAT_MAX, true, true, CARD_MAX]);
    }
    { // Eixo dos gráficos: pt-BR compacto, sem rótulos repetidos, com negativos
        const tk = vs => vs.map(value => ({ value })), rot = vs => vs.map((v, i, arr) => fmtEixo(v, i, tk(arr)));
        const curto = rot([3000, 3050, 3100, 3150, 3200]), neg = rot([-2000, -1000, 0, 1000]), grande = rot([0, 5e8, 1e9, 1.5e9]);
        eq('eixo: faixa curta sem rótulos repetidos', new Set(curto).size, curto.length);
        eq('eixo: negativo e pt-BR', [neg[0].startsWith('R$ -') || neg[0].startsWith('R$ −'), /^R\$ [\d.,\s\u00a0]+/.test(grande[3]), !/\d\.\d/.test(curto.join(''))], [true, true, true]);
    }
    { // CSV do ano = os 12 meses juntos, em ordem de data, e volta pelo importador
        const ya = filtro().a, listaA = _listaCSV('ano', 0, ya), soma = Array.from({ length: 12 }, (_, k) => txMes(k, ya).length).reduce((x, y) => x + y, 0);
        eq('CSV do ano: todos os meses, em ordem', [listaA.length === soma, listaA.every((t, i) => !i || listaA[i - 1].data <= t.data), listaA.every(t => t.data.startsWith(String(ya)))], [true, true, true]);
        const volta = listaA.length ? _extParseCSV(_csvDe(listaA)) : [];
        eq('CSV do ano volta pelo importador', volta.length, listaA.length);
    }
    eq('CSV export neutraliza fórmula', ['=SOMA(A1)', '+1', '-2', '@x', 'Mercado', "'=já"].map(_csvSeguro), ["'=SOMA(A1)", "'+1", "'-2", "'@x", 'Mercado', "'=já"]);
    const c0 = (cats.saida || [])[0] || '';
    eq('categoria do arquivo casa pelo rótulo', [_extCatDoArquivo(splitCatName(c0).label.toUpperCase(), 'saida'), _extCatDoArquivo('Inexistente XYZ', 'saida'), _extCatDoArquivo('', 'saida')], [c0 ? c0 : '', '', '']);
    eq('OFX SGML', (_extParseOFX('<STMTTRN><DTPOSTED>20260910<TRNAMT>-1.234,56<FITID>A1<MEMO>X</STMTTRN>') || [])[0], { date: '2026-09-10', desc: 'X', valor: -1234.56, extId: 'ofx:A1' });
    eq('transferência vs tarifa', [_extDetectTransfer('Pagamento de fatura'), _extDetectTransfer('TARIFA PACOTE'), _extDetectTransfer('PIX ENVIADO')], ['transfer', null, 'maybe']);

    // Sanitização / sync
    const raw = {
        t: [{ id: '7', desc: ' A ', valor: '10,50', data: '2026-01-20T00:00', tipo: 'saida', pagamento: 'credito', cartaoId: '9', faturaData: '2026-01-05', fixo: true },
            { id: 7, desc: 'dup', valor: 1, data: '2026-01-02', tipo: 'entrada', cat: 'Nova' },
            { id: 8, desc: 'sem data', valor: 1, data: '' }],
        k: [{ id: 9, nome: 'Nu', fechamento: 25, vencimento: 5, cor: 'red' }],
        b: { total: 100 },
    };
    const s1 = sanitizeState(raw, 2);
    eq('sanitize: descarta inválido', s1.report.dropped.length, 1);
    eq('sanitize: ids únicos', new Set(s1.tx.map(t => t.id)).size, 2);
    eq('sanitize: tipos normalizados', [s1.tx[0].valor, s1.tx[0].cartaoId, s1.tx[0].data, s1.tx[0].desc], [10.5, 9, '2026-01-20', 'A']);
    eq('sanitize: migra fatura v2', s1.tx[0].faturaData, '2026-02-05');
    eq('sanitize: série de fixo', s1.tx[0].serie, 'L:saida:A');
    eq('sanitize: categoria usada existe', s1.cats.entrada.includes('Nova'), true);
    eq('sanitize: orçamento completo', Object.keys(s1.budget).sort(), ['allocs', 'allocsDe', 'locks', 'monthTotals', 'needsWants', 'off', 'total']);
    eq('sanitize: cor segura', s1.cards[0].cor, '#6d28d9');
    const asRaw = s => ({ t: s.tx, c: s.cats, g: s.goals, k: s.cards, b: s.budget, l: s.loans });
    const s2 = sanitizeState(asRaw(s1));
    eq('sanitize idempotente (hash estável)', _stateHash(s2), _stateHash(s1));
    // Ida e volta pelo Firebase: chaves codificadas, vazios removidos, chaves reordenadas
    s1.budget.allocs['📡 Internet/Telefone'] = 5;
    const wire = _canon(_mapKeys(JSON.parse(JSON.stringify(asRaw(s1))), _fbKeyEnc));
    const allKeys = v => (v && typeof v === 'object') ? Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)]) : [];
    eq('chaves válidas no Firebase', allKeys(wire).filter(k => /[.#$[\]\/]/.test(k)), []);
    eq('ida e volta Firebase (hash estável)', _stateHash(sanitizeState(_mapKeys(wire, _fbKeyDec))), _stateHash(s1));
    // Merge de 3 vias
    const mkS = (txs, catsSaida = ['A'], allocs = {}) => sanitizeState({ t: txs, c: { saida: catsSaida, entrada: [], investimento: [] }, b: { total: 100, allocs } });
    const T = (id, desc, valor = 10) => ({ id, desc, valor, data: '2026-01-10', tipo: 'saida' });
    const mBase = mkS([T(1, 'um'), T(2, 'dois'), T(3, 'três')], ['A', 'X']);
    const mL = mkS([T(1, 'um editado'), T(2, 'dois'), T(3, 'três'), T(10, 'novo local')], ['A', 'Y'], { A: 10 });
    const mR = mkS([T(1, 'um'), T(3, 'três', 99), T(20, 'novo remoto')], ['A', 'X', 'Z'], { B: 5 });
    const mm = mergeStates(mBase, mL, mR);
    eq('merge: combina mudanças independentes', mm.merged.tx.map(t => t.desc + ':' + t.valor).sort(),
       ['novo local:10', 'novo remoto:10', 'três:99', 'um editado:10']);
    eq('merge: categorias (renomeio + nova)', mm.merged.cats.saida.sort(), ['A', 'Y', 'Z']);
    eq('merge: alocações', mm.merged.budget.allocs, { A: 10, B: 5 });
    eq('merge: sem conflitos', mm.conflicts, []);
    const mc = mergeStates(mBase, mkS([T(1, 'local'), T(2, 'dois')]), mkS([T(1, 'remoto'), T(2, 'dois editado'), T(3, 'três')]));
    // tx1 editado nos dois lados = conflito; tx2 só remoto mudou; tx3 removido local e intacto no remoto = removido
    eq('merge: mesmo item alterado nos dois = conflito', mc.conflicts, ['lançamento 1']);
    eq('merge: edição remota + remoção local sem conflito', mc.merged.tx.map(t => t.desc), ['dois editado']);
    eq('merge: remover x editar = conflito', mergeStates(mBase, mkS([T(1, 'um'), T(3, 'três')]), mkS([T(1, 'um'), T(2, 'dois mudou'), T(3, 'três')])).conflicts.length, 1);
    // Resolver conflito: a escolha vale só para o item em conflito; o resto da mescla fica
    const cL = mkS([T(1, 'local'), T(2, 'dois')]), cR = mkS([T(1, 'remoto'), T(2, 'dois editado'), T(3, 'três')]);
    eq('merge: conflito resolvido pelo local mantém o resto', mergeStates(mBase, cL, cR, 'local').merged.tx.map(t => t.desc).sort(), ['dois editado', 'local']);
    eq('merge: conflito resolvido pelo remoto mantém o resto', mergeStates(mBase, cL, cR, 'remote').merged.tx.map(t => t.desc).sort(), ['dois editado', 'remoto']);
    eq('merge: conflito com nome legível', mc.nomes, ['lançamento "local"']);
    const gp = (meta, vals, prazo = '') => goalProgress({ meta, prazo, aportes: vals.map(valor => ({ valor, data: '2026-01-01' })) });
    eq('meta 99,6% não vira 100%', [gp(1000, [996]).pct, gp(1000, [996]).done], [99, false]);
    eq('meta completa', [gp(1000, [600, 400]).pct, gp(1000, [600, 400]).done, gp(1000, [1500]).falta], [100, true, 0]);
    eq('meta prazo vencido', gp(1000, [10], '2000-01-01').ritmo, '⚠️ prazo vencido');
    eq('total de fixos ignora entradas', fixoSaidaTotal([{ tipo: 'entrada', total: 5000 }, { tipo: 'saida', total: 1800 }, { tipo: 'investimento', valor: 100 }]), 1900);
    {   // caixa de entrada do Claude: operações idempotentes e protegidas por "espera"
        const base = sanitizeState({ t: [
            { id: 501, desc: 'Mercado', valor: 50, data: '2026-09-01', tipo: 'saida', cat: '🍔 Alimentação' },
            { id: 502, desc: 'Uber', valor: 20, data: '2026-09-02', tipo: 'saida', cat: '🚗 Transporte' },
            { id: 503, desc: 'Café', valor: 9, data: '2026-09-03', tipo: 'saida', cat: '🍔 Alimentação' }] });
        const ops = [
            { id: 'a1', op: 'add', tx: { id: 601, desc: 'Farmácia', valor: 33.67, data: '2026-09-26', tipo: 'saida', cat: '💊 Saúde' } },
            { id: 'a2', op: 'add', tx: { id: 503, desc: 'duplicado', valor: 1, data: '2026-09-01', tipo: 'saida' } },
            { id: 'u1', op: 'update', txId: 502, espera: { valor: 20 }, muda: { valor: 25.5, desc: 'Uber (corrigido)' } },
            { id: 'u2', op: 'update', txId: 503, espera: { valor: 10 }, muda: { valor: 1 } },
            { id: 'd1', op: 'delete', txId: 501, espera: { desc: 'Mercado', valor: 50 } },
            { id: 'd2', op: 'delete', txId: 999 },
            { id: 'a3', op: 'add', tx: { id: 602, desc: 'sem data', valor: 5 } },
            { id: 'x1', op: 'renomear' },
            { op: 'add', tx: { id: 603, desc: 'operação sem id', valor: 1, data: '2026-09-01' } },
        ];
        const r1 = inboxAplicar(base, ops);
        eq('caixa de entrada: resultado de cada operação', r1.resultados.map(x => x.id + '=' + x.resultado), [
            'a1=aplicado', 'a2=ignorado: já existe', 'u1=aplicado', 'u2=ignorado: mudou desde então', 'd1=aplicado',
            'd2=ignorado: já não existe', 'a3=ignorado: inválido (quarentena)', 'x1=ignorado: operação desconhecida']);
        eq('caixa de entrada: estado final', r1.state.tx.map(t => [t.id, t.desc, t.valor, t.extId || '']).sort((a, b) => a[0] - b[0]),
           [[502, 'Uber (corrigido)', 25.5, ''], [503, 'Café', 9, ''], [601, 'Farmácia', 33.67, 'claude:a1']]);
        const r2 = inboxAplicar(r1.state, ops);
        eq('caixa de entrada: reaplicar não muda nada', [_stateHash(r2.state) === _stateHash(r1.state), r2.resultados.filter(x => x.resultado === 'aplicado').length], [true, 0]);
        const txt = '🍔 Alimentação — "Pão" ç ã 😀';
        eq('caixa de entrada: base64 UTF-8 ida e volta', _utf8B64(_b64Utf8(txt)), txt);
        // Orçamento, empréstimo e ligação de parcelas pela caixa
        const b0 = sanitizeState({ t: [{ id: 701, desc: 'Mercado', valor: 50, data: '2026-08-10', tipo: 'saida', cat: 'C' },
            { id: 702, desc: 'Loja parcela 1 de 2', valor: 30, data: '2026-09-10', tipo: 'saida', cat: 'C' },
            { id: 703, desc: 'Loja parcela 2 de 2', valor: 30, data: '2026-10-10', tipo: 'saida', cat: 'C' }],
            b: { total: 4000, allocs: { C: 10 }, monthTotals: { '2026-11': 5000 } } });
        const r3 = inboxAplicar(b0, [
            { id: 'o1', op: 'orcamento', total: { valor: 6000, de: '2026-10' }, planejamento: { de: '2026-10', reais: { C: 1500, D: 600 } }, grupos: { D: 'needs' }, fixos: { D: true } },
            { id: 'e1', op: 'emprestimo', acao: 'add', loan: { id: 801, nome: 'Giro', valor: 1000, taxa: 0, n: 4, parcela: 300, primeira: '2026-10-15' }, lancar: 'juros' },
            { id: 'e2', op: 'emprestimo', acao: 'add', loan: { id: 801, nome: 'Giro', valor: 1000, n: 4, parcela: 300, primeira: '2026-10-15' } },
            { id: 'p1', op: 'update', txId: 702, espera: { parcela: null }, muda: { parcela: { serie: 'P9', k: 1, n: 2 } } },
            { id: 'p2', op: 'update', txId: 703, espera: { parcela: null }, muda: { parcela: { serie: 'P9', k: 2, n: 2 } } },
            { id: 'o2', op: 'orcamento', planejamento: { de: '2026-13', pct: {} } }]);
        const bb = r3.state.budget;
        eq('caixa de entrada: orçamento a partir de um mês (passado congelado)', [bb.total, bb.monthTotals['2026-08'], bb.monthTotals['2026-09'], bb.monthTotals['2026-11'], bb.allocs.C, bb.allocsDe['2026-10'], bb.needsWants.D, bb.locks.D],
           [6000, 4000, 4000, undefined, 10, { C: 25, D: 10 }, 'needs', true]);
        eq('caixa de entrada: empréstimo e parcelas ligadas', [r3.resultados.map(x => x.resultado), r3.state.loans.length, r3.state.tx.filter(t => t.parcela && t.parcela.serie === 'E801').length,
            r3.state.tx.filter(t => t.parcela && t.parcela.serie === 'P9').map(t => t.parcela.k)],
           [['aplicado', 'aplicado', 'ignorado: já existe', 'aplicado', 'aplicado', 'ignorado: planejamento inválido'], 1, 4, [1, 2]]);
    }
    {   // modal de confirmação próprio: Enter/botão escolhe, Cancelar/Esc devolve null, mensagem como texto
        const c0 = window.confirm; window.confirm = _confirmNativo;
        const ab = () => $('ovConfirmar').classList.contains('open');
        try {
            let got = 'x';
            perguntar('Apagar <img src=x onerror=1>?', [{ label: 'Sim', valor: 'a' }, { label: 'Outra', valor: 'b' }], v => { got = v; });
            const r1 = [ab(), $('confMsg').querySelector('img') === null, $('confBotoes').children.length];
            _confirmarPrimaria(); const r2 = [got, ab()];
            perguntar('de novo', [{ label: 'Sim', valor: 'a' }], v => { got = v; }); MODALS.ovConfirmar.close();
            const r3 = [got, ab()];
            perguntar('de novo', [{ label: 'Sim', valor: 'a' }, { label: 'Outra', valor: 'b' }], v => { got = v; }); $('confBotoes').children[2].click();
            eq('confirmar: modal próprio (abre, escolhe, cancela, sem HTML)', [r1, r2, r3, got], [[true, true, 3], ['a', false], [null, false], 'b']);
            window.confirm = () => false; let sync = 'x'; perguntar('m', [{ label: 'A', valor: 1 }, { label: 'B', valor: 2 }], v => { sync = v; });
            eq('confirmar: com window.confirm trocado responde na hora', sync, 2);
        } finally { window.confirm = c0; if (ab()) $('ovConfirmar').classList.remove('open'); }
    }
    {   // CONFIG congelado e UNDO_MAX respeitado
        const uBak = undoStack; undoStack = [];
        for (let i = 0; i < CONFIG.UNDO_MAX + 5; i++) pushUndo('t' + i);
        eq('CONFIG: congelado e desfazer limitado', [Object.isFrozen(CONFIG), undoStack.length], [true, CONFIG.UNDO_MAX]);
        undoStack = uBak;
    }
    eq('trava de esquema: servidor mais novo', [_remotoMaisNovo({ v: SCHEMA_VERSION + 1 }), _remotoMaisNovo({ v: String(SCHEMA_VERSION) }), _remotoMaisNovo({}), _remotoMaisNovo(null), _buildPayload().appV === APP_BUILD], [true, false, false, false, true]);
    {   // empréstimo pela caixa: ids das parcelas derivados do contrato (dois aparelhos processando juntos não duplicam)
        const b0 = sanitizeState({}), op = { id: 'e9', op: 'emprestimo', acao: 'add', loan: { id: 1850000000001, nome: 'Giro', valor: 1000, taxa: 2, n: 4, parcela: 300, primeira: '2026-10-15' }, lancar: 'parcela' };
        const ids = st => inboxAplicar(st, [op]).state.tx.map(t => t.id).sort((x, y) => x - y);
        eq('caixa: parcelas do empréstimo têm ids determinísticos', [ids(b0).join() === ids(b0).join(), ids(b0).length, ids(b0)[0]], [true, 4, 1850000000001001]);
    }
    {   // caixa de entrada: espera obrigatória e limite de exclusões por rodada
        const mk = n => sanitizeState({ t: Array.from({ length: n }, (_, i) => ({ id: 3000 + i, desc: 'L' + i, valor: 10 + i, data: '2026-09-01', tipo: 'saida', cat: 'C' })) });
        const b = mk(12), dl = (i, esp) => ({ id: 'd' + i, op: 'delete', txId: 3000 + i, ...(esp === undefined ? { espera: { desc: 'L' + i, valor: 10 + i } } : esp ? { espera: esp } : {}) });
        const res = (st, ops, o) => inboxAplicar(st, ops, o).resultados.map(x => x.resultado);
        eq('caixa: delete sem espera / só com valor / espera inválida', res(b, [dl(0, null), dl(1, { valor: 11 }), dl(2, { foo: 1 }), dl(3, { desc: 'L3', valor: null })]),
           ['ignorado: delete exige espera com desc e valor', 'ignorado: delete exige espera com desc e valor', 'ignorado: espera inválida', 'ignorado: delete exige espera com desc e valor']);
        eq('caixa: update sem espera / vazia', res(b, [{ id: 'u0', op: 'update', txId: 3000, muda: { valor: 1 } }, { id: 'u1', op: 'update', txId: 3001, espera: {}, muda: { valor: 1 } }]),
           ['ignorado: update exige espera', 'ignorado: update exige espera']);
        const onze = Array.from({ length: 11 }, (_, i) => dl(i)).concat({ id: 'a1', op: 'add', tx: { id: 3500, desc: 'Novo', valor: 5, data: '2026-09-02', tipo: 'saida', cat: 'C' } });
        const r11 = inboxAplicar(b, onze);
        eq('caixa: 11 exclusões numa rodada não apagam nada (add segue)', [r11.resultados.filter(x => /exclusões numa rodada/.test(x.resultado)).length, r11.resultados[11].resultado, r11.state.tx.length], [11, 'aplicado', 13]);
        const dez = inboxAplicar(b, Array.from({ length: 10 }, (_, i) => dl(i)));
        eq('caixa: 10 exclusões passam e reaplicar é idempotente', [dez.resultados.every(x => x.resultado === 'aplicado'), dez.state.tx.length, _stateHash(inboxAplicar(dez.state, Array.from({ length: 10 }, (_, i) => dl(i))).state) === _stateHash(dez.state)], [true, 2, true]);
    }
    // Planejamento por período: cada mês usa o último planejamento que começou até ele
    {
        const bk = budget;
        try {
            budget = _sanBudget({ total: 1000, allocs: { I: 10 }, allocsDe: { '2026-10': { I: 30 }, '2027-02': { I: 5 } } });
            const c0 = cats; cats = { ...cats, investimento: ['I'] };
            eq('planejamento por período: vigente em cada mês', [_allocVersao('2026-09'), _allocVersao('2026-12'), _allocVersao('2027-03'), allocsDoMes('2026-09').I, allocsDoMes('2026-11').I, spendBudgetOf(1000, '2026-11'), spendBudgetOf(1000, '2026-01')],
               [null, '2026-10', '2027-02', 10, 30, 700, 900]);
            cats = c0;
        } finally { budget = bk; }
        const ctx = { prefer: null, reg: () => {} };
        eq('planejamento por período: mescla', _mergeVersoes({ '2026-10': { A: 1, B: 2 } }, { '2026-10': { A: 5, B: 2 } }, { '2026-10': { A: 1, B: 9 }, '2027-01': { A: 3 } }, ctx),
           { '2026-10': { A: 5, B: 9 }, '2027-01': { A: 3 } });
    }

    // Roda do orçamento: regras de redistribuição (centavos), sobre modelos falsos — não toca nos dados
    {
        const mk = () => ({ T: 1000, Tc: 100000, cats: [
            { nome: 'A', grupo: 'needs', vc: 30000 }, { nome: 'B', grupo: 'needs', vc: 20000 },
            { nome: 'C', grupo: 'needs', vc: 10000, locked: true }, { nome: 'D', grupo: 'wants', vc: 20000 },
            { nome: 'R', grupo: 'invest', vc: 0 }] });
        const vals = mod => mod.cats.map(c => c.vc);
        let mod = mk();
        _orcMudaCat(mod, mod.cats[0], 1000);
        eq('roda: categoria cresce tirando da irmã (a fixa não muda)', vals(mod), [31000, 19000, 10000, 20000, 0]);
        _orcMudaCat(mod, mod.cats[0], 25000);
        eq('roda: sem irmã para tirar, usa o sem destino', [vals(mod), _orcLivre(mod)], [[56000, 0, 10000, 20000, 0], 14000]);
        _orcMudaCat(mod, mod.cats[0], -6000);
        eq('roda: diminuir devolve ao grupo', vals(mod), [50000, 6000, 10000, 20000, 0]);
        mod = mk();
        _orcMudaGrupo(mod, 'wants', 30000);
        eq('roda: grupo cresce pelo sem destino e depois pelos outros grupos', [vals(mod), _orcLivre(mod)], [[24000, 16000, 10000, 50000, 0], 0]);
        const pool = [{ vc: 33333 }, { vc: 33333 }, { vc: 33334 }];
        _orcTirar(pool, 1000);
        eq('roda: valor redondo é repartido em reais inteiros', [pool.every(c => (33333 - c.vc) % 100 === 0 || (33334 - c.vc) % 100 === 0), 100000 - _orcSoma(pool)], [true, 1000]);
        mod = mk(); mod.cats[4].vc = 5000;
        _orc503020(mod);
        eq('roda: guia 50/30/20 (respeita o valor fixo)', [_orcSoma(mod.cats.filter(c => c.grupo === 'needs')), _orcSoma(mod.cats.filter(c => c.grupo === 'wants')), mod.cats[4].vc, mod.cats[2].vc], [50000, 30000, 20000, 10000]);
        eq('roda: % com 6 casas volta ao mesmo centavo', [56133, 1, 99999, 777700].map(vc => Math.round(7777 * +(vc / 7777).toFixed(6)) === vc), [true, true, true, true]);

        // Alça de uma ponta: a fronteira com o vizinho daquele lado anda e só os dois mudam
        mod = mk();
        _orcMudaBorda(mod, mod.cats[1], 'ini', 5000);   // B cresce 50 pelo lado de A
        eq('roda: ponta inicial cresce tirando só do vizinho de trás', vals(mod), [25000, 25000, 10000, 20000, 0]);
        mod = mk();
        _orcMudaBorda(mod, mod.cats[0], 'fim', 5000);   // A cresce 50 pelo lado de B (C é fixa, D é de outro grupo)
        eq('roda: ponta final cresce tirando só do vizinho da frente', vals(mod), [35000, 15000, 10000, 20000, 0]);
        _orcMudaBorda(mod, mod.cats[0], 'fim', -2000);
        eq('roda: ponta final diminui devolvendo ao vizinho', vals(mod), [33000, 17000, 10000, 20000, 0]);
        mod = mk();
        _orcMudaBorda(mod, mod.cats[3], 'fim', 10000);  // D é a única do grupo: cai na regra de sempre (sem destino)
        eq('roda: ponta sem vizinho livre usa a regra de sempre', [vals(mod), _orcLivre(mod)], [[30000, 20000, 10000, 30000, 0], 10000]);
        mod = mk(); mod.cats[1].off = true; mod.cats[1].locked = true;
        eq('roda: categoria fora do mês não se ajusta', [_orcMudaCat(mod, mod.cats[1], 1000), _orcMudaBorda(mod, mod.cats[1], 'fim', 1000)], [0, 0]);
    }
    // Categoria fora do orçamento (só neste mês / daqui pra frente): faixas de meses
    {
        const guarda = budget;
        try {
            budget = sanitizeState({ b: { off: { A: [{ de: '2026-05' }, { de: 'x' }, { de: '2026-03', ate: '2026-01' }], B: 'lixo' } } }).budget;
            eq('fora do orçamento: sanitização descarta faixa inválida', budget.off, { A: [{ de: '2026-05' }] });
            budget.off = {};
            ocultarCategoriaNoOrcamento('A', '2026-03', '2026-03');
            eq('fora do orçamento: só neste mês', ['2026-02', '2026-03', '2026-04'].map(ym => _catOff('A', ym)), [false, true, false]);
            ocultarCategoriaNoOrcamento('A', '2026-06');
            eq('fora do orçamento: daqui pra frente', ['2026-05', '2026-06', '2031-01'].map(ym => _catOff('A', ym)), [false, true, true]);
            mostrarCategoriaNoOrcamento('A', '2026-08', '2026-08');
            eq('fora do orçamento: voltar um mês no meio parte a faixa', ['2026-07', '2026-08', '2026-09'].map(ym => _catOff('A', ym)), [true, false, true]);
            mostrarCategoriaNoOrcamento('A', '2026-09');
            eq('fora do orçamento: voltar daqui pra frente corta a faixa aberta', [_catOff('A', '2026-07'), _catOff('A', '2026-09'), _catOff('A', '2030-01'), JSON.stringify(budget.off.A)],
               [true, false, false, '[{"de":"2026-03","ate":"2026-03"},{"de":"2026-06","ate":"2026-07"}]']);
            mostrarCategoriaNoOrcamento('A', '2000-01');
            eq('fora do orçamento: sem faixas a chave some', Object.keys(budget.off), []);
            // Investimento fora do mês não reduz o limite de gastos daquele mês
            const catsGuarda = cats;
            cats = { ...cats, investimento: ['I'] }; budget.allocs = { I: 20 };
            eq('fora do orçamento: limite de gastos ignora investimento fora do mês', [spendBudgetOf(1000, '2026-03'), (ocultarCategoriaNoOrcamento('I', '2026-03', '2026-03'), spendBudgetOf(1000, '2026-03')), spendBudgetOf(1000, '2026-04')], [800, 1000, 800]);
            cats = catsGuarda;
            const sB = sanitizeState({ c: { saida: ['A'] }, b: { off: {} } }), sL = sanitizeState({ c: { saida: ['A'] }, b: { off: { A: [{ de: '2026-03' }] } } });
            eq('fora do orçamento: merge leva a mudança de um lado', mergeStates(sB, sL, sB).merged.budget.off, { A: [{ de: '2026-03' }] });
        } finally { budget = guarda; }
    }
    // Parcelas automáticas, juros embutidos e empréstimos
    {
        const soma = a => roundMoney(a.reduce((x, y) => x + y, 0));
        eq('parcelas: centavos exatos (o resto vai para as primeiras)', [parcelasDividir(100, 3), soma(parcelasDividir(100, 3)), parcelasDividir(10, 4)], [[33.34, 33.33, 33.33], 100, [2.5, 2.5, 2.5, 2.5]]);
        eq('parcelas: nome sem o sufixo "Parcela k/n"', ['Geladeira - Parcela 2/6', 'Amazon Prime – parcela 3/12', 'Mercado'].map(_descSemParcela), ['Geladeira', 'Amazon Prime', 'Mercado']);
        const f0 = { desc: 'Geladeira', valor: 1000, data: '2026-01-31', tipo: 'saida', cat: '🏠 Casa', pagamento: 'debito', cartaoId: null, juros: 30 };
        const ps = gerarParcelas(f0, 3);
        eq('parcelas: datas (fim de mês), nomes e série', [ps.map(t => t.data), ps.map(t => t.desc), new Set(ps.map(t => t.parcela.serie)).size, ps.map(t => t.parcela.k + '/' + t.parcela.n)],
           [['2026-01-31', '2026-02-28', '2026-03-31'], ['Geladeira - Parcela 1/3', 'Geladeira - Parcela 2/3', 'Geladeira - Parcela 3/3'], 1, ['1/3', '2/3', '3/3']]);
        eq('parcelas: soma do total e dos juros embutidos', [soma(ps.map(t => t.valor)), soma(ps.map(t => t.juros)), ps.every(t => t.cat === '🏠 Casa' && !t.fixo)], [1000, 30, true]);
        eq('parcelas: valor informado é o da parcela', gerarParcelas({ ...f0, valor: 150, juros: 0 }, 4, 'parcela').map(t => t.valor), [150, 150, 150, 150]);
        // Edição aplicada às parcelas seguintes (valor, categoria e nome); as anteriores não mudam
        const alvo = { ...ps[0], valor: 400, cat: '📦 Outros', desc: 'Geladeira nova - Parcela 1/3' };
        const pr = _propagarParcelas([alvo, ps[1], ps[2]], ps[0], alvo);
        eq('parcelas: editar aplica às seguintes', pr.map(t => [t.desc, t.valor, t.cat]), [['Geladeira nova - Parcela 1/3', 400, '📦 Outros'], ['Geladeira nova - Parcela 2/3', 400, '📦 Outros'], ['Geladeira nova - Parcela 3/3', 400, '📦 Outros']]);
        eq('parcelas: editar sem "seguintes" não mexe nas outras', _propagarParcelas([ps[0], ps[1]], ps[1], { ...ps[1], valor: 1 }).map(t => t.valor), [ps[0].valor, ps[1].valor]);
        const sn = sanitizeState({ t: [
            { id: 1, desc: 'a', valor: 10, data: '2026-01-01', tipo: 'saida', juros: 50, parcela: { serie: 'P1', k: 5, n: 3 } },
            { id: 2, desc: 'b', valor: 10, data: '2026-01-01', tipo: 'entrada', juros: 5, parcela: { serie: 'P2', k: 1, n: 2 } },
            { id: 3, desc: 'c', valor: 10, data: '2026-01-01', tipo: 'saida', juros: '4,5', parcela: { serie: 'P3', k: 1, n: 2 } }] }).tx;
        eq('sanitize: juros limitados ao valor, parcela inválida e entrada sem eles', [sn[0].juros, sn[0].parcela, sn[1].juros, sn[1].parcela, sn[2].juros, sn[2].parcela], [10, undefined, undefined, undefined, 4.5, { serie: 'P3', k: 1, n: 2 }]);
        eq('mensal: juros embutidos somam com os lançamentos de juros', _mesJuros([{ desc: 'Juros do cartão', valor: 20 }, { desc: 'Condomínio', valor: 108, juros: 8 }, { desc: 'Uber', valor: 10 }]), { v: 28, n: 2 });
        // Empréstimos
        eq('empréstimo: parcela pela tabela Price', [loanPmt(1200, 0, 12), loanPmt(10000, 1.99, 12), loanPmt(0, 1, 12)], [100, 945.02, 0]);
        const lo = { valor: 10000, taxa: 1.99, n: 12, parcela: 945.02, primeira: '2026-01-31' }, cr = loanCronograma(lo);
        eq('empréstimo: datas e soma dos juros = parcelas − emprestado', [cr.slice(0, 3).map(x => x.data), soma(cr.map(x => x.juros)), cr.every(x => x.juros >= 0 && x.juros <= x.valor)],
           [['2026-01-31', '2026-02-28', '2026-03-31'], roundMoney(945.02 * 12 - 10000), true]);
        const rs = loanResumo(lo, '2026-03-31');
        eq('empréstimo: pago/falta pela data', [rs.pagas, rs.faltam, rs.falta, rs.pago, rs.fim], [3, 9, roundMoney(945.02 * 9), roundMoney(945.02 * 3), '2026-12-31']);
        eq('empréstimo sem taxa: juros rateados', soma(loanCronograma({ valor: 1000, taxa: 0, n: 4, parcela: 300, primeira: '2026-01-10' }).map(x => x.juros)), 200);
        const lt = loanTx({ ...lo, id: 7, nome: 'Carro', serie: 'E7' }, 'parcela');
        eq('empréstimo: parcela inteira com os juros embutidos', [lt.length, lt[0].desc, lt[0].cat, lt[0].parcela, soma(lt.map(t => t.juros))], [12, 'Carro - Parcela 1/12', LOAN_CAT, { serie: 'E7', k: 1, n: 12 }, roundMoney(945.02 * 12 - 10000)]);
        const lj = loanTx({ ...lo, id: 7, nome: 'Carro', serie: 'E7' });
        eq('empréstimo: só os juros (o principal não é gasto) e contam como juros no Mensal', [lj[0].desc, soma(lj.map(t => t.valor)), lj.every(t => _mesTipoGasto(t) === 'juros' && !t.juros)], ['Carro - Juros - Parcela 1/12', roundMoney(945.02 * 12 - 10000), true]);
        eq('empréstimo sem juros e "só juros" não lança nada', loanTx({ valor: 1200, taxa: 0, n: 12, parcela: 100, primeira: '2026-01-10', nome: 'X', serie: 'E1' }).length, 0);
        const sl = _sanLoans([{ id: 5, nome: ' ', valor: '1.000,00', taxa: 'abc', n: 'x', parcela: 0, primeira: 'x' }])[0];
        eq('sanitize: empréstimo com dados ruins', [sl.nome, sl.valor, sl.taxa, sl.n, sl.parcela, sl.primeira, sl.serie], ['Empréstimo', 1000, 0, 1, 0, '', 'E5']);
        const L = (id, nome) => ({ id, nome, valor: 1000, n: 4, parcela: 300, primeira: '2026-01-10' });
        const lb = sanitizeState({ l: [] }), ll = sanitizeState({ l: [L(1, 'A')] }), lr = sanitizeState({ l: [L(2, 'B')] });
        eq('merge: empréstimos criados nos dois lados', mergeStates(lb, ll, lr).merged.loans.map(l => l.nome).sort(), ['A', 'B']);
        eq('hash do estado inclui os empréstimos', _stateHash(lb) !== _stateHash(ll), true);
    }
    {   // parcelas lançadas à mão entram na série; compras diferentes de mesmo nome ficam soltas
        const T3 = (id, desc, k) => ({ id, desc: `${desc} - Parcela ${k}/3`, valor: 10, data: `2026-0${k}-10`, tipo: 'saida' });
        const a = sanitizeState({ t: [T3(1, 'Fone', 1), T3(2, 'Fone', 2), T3(3, 'Outro', 1), T3(4, 'Outro', 1)] }).tx;
        eq('parcelas soltas: ligadas só quando cada k aparece uma vez', [a[0].parcela && a[0].parcela.serie === a[1].parcela.serie, a[0].parcela && a[0].parcela.k, a[1].parcela.n, a[2].parcela, a[3].parcela], [true, 1, 3, undefined, undefined]);
        eq('parcelas soltas: sanitizar de novo não muda', _stateHash(sanitizeState({ t: a })) === _stateHash(sanitizeState({ t: sanitizeState({ t: a }).tx })), true);
    }
    // Análise mensal: tipo de gasto na cascata (juros vencem parcela e fixo)
    eq('mensal: tipo de gasto da cascata', [
        { desc: 'Juros/encargos - parcelamento fatura (Parcela 2/3)' }, { desc: 'Story Curso', fixo: true }, { desc: 'Multa/atraso - Story Curso', fixo: true },
        { desc: 'Amazon Prime - Parcela 3/12' }, { desc: 'IOF - limite Itaú' }, { desc: 'Uber' }, { desc: 'Iofresh sabonete' },
    ].map(_mesTipoGasto), ['juros', 'fixos', 'juros', 'parcelas', 'juros', 'dia', 'dia']);
    eq('mensal: mês relativo atravessa o ano', [_mesRel(0, 2026, -1), _mesRel(11, 2026, 1), _mesRel(1, 2026, -5)], [[11, 2025], [0, 2027], [8, 2025]]);

    const fails = results.filter(r => !r.ok);
    console.table(results.map(r => ({ teste: r.name, ok: r.ok ? '✓' : '✗', obtido: JSON.stringify(r.got), esperado: JSON.stringify(r.exp) })));
    toast(fails.length ? `❌ Autoteste: ${fails.length} falha(s) de ${results.length} — veja o console` : `✅ Autoteste: ${results.length} verificações OK`,
          fails.length ? '#dc2626' : '#16a34a');
    return { total: results.length, fails };
}

// ── FUZZ (só no modo preview) ────────────────────────────────────────────────
// runFuzz() no console de index.html?preview: executa centenas de ações aleatórias
// pela UI (lançar, editar, remover, desfazer, fixos, categorias, cartões, metas,
// orçamento, navegação) e após CADA uma verifica as invariantes do modelo. Restaura
// estado e localStorage no fim. Use depois de mudanças grandes.
// Uma rodada de fuzz por vez: duas simultâneas (ex.: chamada no console que estourou o
// tempo e foi repetida) salvavam como "original" o estado já bagunçado pela outra e o
// deixavam gravado ao terminar — os dados de exemplo do preview ficaram poluídos.
let _fuzzAtivo = null;
async function _exclusivo(nome, fn) {
    if (_fuzzAtivo) { console.warn(`${nome}: ${_fuzzAtivo} ainda está rodando — aguarde terminar.`); return null; }
    _fuzzAtivo = nome;
    try { return await fn(); } finally { _fuzzAtivo = null; }
}
function runFuzz(...args)     { return _exclusivo('runFuzz', () => _runFuzzImpl(...args)); }
function runSyncFuzz(...args) { return _exclusivo('runSyncFuzz', () => _runSyncFuzzImpl(...args)); }

async function _runFuzzImpl(seeds = [11, 23, 97, 1234], steps = 400) {
    if (!PREVIEW_MODE) { console.warn('runFuzz só roda em ?preview (nunca com dados reais sincronizados)'); return; }
    const saved = snapshotState(), savedLS = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); savedLS[k] = localStorage.getItem(k); }
    // Campos de formulário também voltam ao que eram (o fuzz digita neles — antes o
    // "Novo lançamento" ficava com "Café"/10/Investimento depois da rodada)
    const savedForm = [...document.querySelectorAll('input:not([type=file]), select, textarea')].map(el => [el, el.value, el.checked]);
    const origConfirm = window.confirm, origErr = console.error, errs = [];
    window.confirm = () => true;
    console.error = (...a) => { errs.push(a.map(String).join(' ')); };
    const violations = [];
    try {
        for (const S of seeds) {
            let seed = S;
            const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
            const pick = arr => arr[Math.floor(rnd() * arr.length)], ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
            // qualquer dia válido (29–31 incluídos) e cartões que fecham/vencem até dia 31
            const date = () => { const y = pick([2025, 2026]), mm = ri(1, 12); return `${y}-${pad2(mm)}-${pad2(ri(1, new Date(y, mm, 0).getDate()))}`; };
            restoreState(sanitizeState({ t: SEED })); undoStack = []; redoStack = [];
            cards = [{ id: newId(), nome: 'Fuzz', fechamento: ri(1, 31), vencimento: ri(1, 31), cor: '#6d28d9' }];
            const closeRep = () => { if ($('ovFixoRep').classList.contains('open')) closeFixoRep(pick(['sim', 'nao'])); };
            const actions = {
                add() { const tipo = pick(TIPOS); $('tipo').value = tipo; onTipoChange(); $('desc').value = pick(['Café', "Mc'Do", 'Ágape "x"']); $('valor').value = pick(['10', '1.234,56', '0,99', '-5', 'abc']); $('data').value = pick([date(), '']); $('fixo').checked = rnd() < 0.2; if (tipo === 'saida') { $('pagamento').value = pick(['debito', 'credito']); onPagChange(); } adicionar(); closeRep(); },
                edit() { if (!tx.length) return; const t = pick(tx); openInlineEdit(t.id); if (!$('ie-valor-' + t.id)) return; $('ie-valor-' + t.id).value = pick([String(ri(1, 999)), 'x']); $('ie-tipo-' + t.id).value = pick(TIPOS); ieUpdateCats(t.id); $('ie-fixo-' + t.id).checked = rnd() < 0.3; const ij = $('ie-juros-' + t.id); if (ij) ij.value = pick(['', '3', 'x', '99999']); const ip = $('ie-prox-' + t.id); if (ip) ip.checked = rnd() < 0.5; saveInlineEdit(t.id); closeRep(); closeInlineEdit(); },
                remove() { if (tx.length) remover(pick(tx).id); if ($('ovParcRemover').classList.contains('open')) closeParcRemover(); },
                // Compra parcelada (com/sem juros, débito/crédito) pelo formulário e remoção de parcelas por escopo
                parcelado() { $('tipo').value = 'saida'; onTipoChange(); $('desc').value = pick(['Parc', 'Geladeira - Parcela 2/6']); $('valor').value = pick(['100', '1.234,56', '0,99', '7']);
                    $('data').value = date(); $('parcelas').value = pick(['2', '3', '12', '1', '0', 'x', '121']); $('parcelasModo').value = pick(['total', 'parcela']);
                    $('juros').value = pick(['', '5', '0', '999999', 'x']); $('fixo').checked = rnd() < 0.1;
                    if (rnd() < 0.5) { $('pagamento').value = 'credito'; onPagChange(); } adicionar(); closeRep(); $('fixo').checked = false; $('parcelas').value = '1'; $('juros').value = ''; },
                remParc() { const l = tx.filter(x => x.parcela); if (!l.length) return; remover(pick(l).id);
                    if ($('ovParcRemover').classList.contains('open')) { document.querySelector(`input[name="parcRemEscopo"][value="${pick(['esta', 'proximas', 'todas'])}"]`).checked = true; if (rnd() < 0.8) confirmarRemoverParcela(); else closeParcRemover(); } },
                loan() { if (rnd() < 0.6) { abrirNovoLoan(); $('loanNome').value = 'L'; $('loanValor').value = pick(['1000', '5.000,50', 'x']); $('loanTaxa').value = pick(['', '1,5', '0', '200']);
                        $('loanN').value = pick(['2', '12', '1', '601', 'x']); $('loanParcela').value = pick(['', '100', '0']); $('loanPrimeira').value = pick([date(), '']); $('loanLancar').value = pick(['juros', 'parcela', 'nada']); salvarLoan(); closeLoan(); }
                    else if (loans.length) removerLoan(pick(loans).id); },
                undo() { undo(); },
                nav() { setFiltro(ri(-1, 12), pick([2025, 2026])); navTo(pick(['dashboard', 'anual', 'mensal', 'metas'])); },
                renameCat() { const tp = pick(TIPOS); if (cats[tp].length) renameCategory(tp, pick(cats[tp]), pick(['Nova', '🍕 Pizza', "Mc'Do", ''])); },
                deleteCat() { const tp = pick(TIPOS); if (!cats[tp].length) return; deleteCategoryFlow(tp, pick(cats[tp])); if ($('ovCatDelete').classList.contains('open')) confirmCatDelete(); },
                fixo() { renderPopupFixos(); if (!_fixosPopup.length) return; const r = rnd(); if (r < 0.4) { abrirEditFixo(0); $('editFixoVal').value = String(ri(1, 500)); $('editFixoFuturo').checked = rnd() < 0.5; confirmarEdicaoFixo(); } else if (r < 0.7) renovarFixo(0); else removerFixo(0); },
                goal() { abrirNovaGoal(); $('goalNome').value = 'G'; $('goalMeta').value = String(ri(100, 5000)); salvarGoal(); const g = pick(goals); abrirAporte(g.id); $('aporteValor').value = String(ri(1, 300)); $('aporteData').value = date(); confirmarAporte(); },
                card() { $('cartaoEditId').value = String(cards[0].id); $('cartaoNome').value = 'Fuzz'; $('cartaoFech').value = String(ri(1, 31)); $('cartaoVenc').value = String(ri(1, 31)); salvarCartao(); if ($('ovRecalcFatura').classList.contains('open')) doRecalcFaturas(pick(['all', 'future', 'none'])); },
                planejamento() { _budgetMonth = ri(0, 11); _budgetYear = 2026; if (rnd() < 0.6) orcNovoPlanejamento(); else orcJuntarPlanejamento(); if (cats.saida.length) updateBudgetCatPct(encodeURIComponent(pick(cats.saida)), String(ri(0, 40))); },
                budget() { _budgetMonth = ri(0, 11); _budgetYear = 2026; $('budgetTotal').value = String(ri(0, 9000)); onBudgetTotalChange(true); if (cats.saida.length) updateBudgetCatPct(encodeURIComponent(pick(cats.saida)), String(ri(0, 60))); },
                // Caminho mobile (formulários do celular) — usados também no desktop, onde o DOM existe
                mobAdd() { openMobForm(); $('mob-tipo').value = pick(TIPOS); mobOnTipoChange(); $('mob-desc').value = pick(['Pão', "D'Ávila"]); $('mob-valor').value = pick(['12,5', '0', '3.000']); $('mob-data').value = pick([date(), '']); $('mob-fixo').checked = rnd() < 0.2; mobAdicionar(); closeRep(); closeMobForm(); },
                mobEdit() { if (!tx.length) return; const t = pick(tx); openMobEdit(t.id); $('mob-edit-valor').value = pick([String(ri(1, 900)), '-1']); $('mob-edit-tipo').value = pick(TIPOS); mobEditTipoChange(); $('mob-edit-fixo').checked = rnd() < 0.3; if (rnd() < 0.8) mobEditSave(); else mobEditDelete(); closeRep(); closeMobEdit(); },
                // Importação de extrato (assíncrona: leitura do arquivo)
                async importar() {
                    const linhas = Array.from({ length: ri(1, 6) }, () => `${date()},${pick(['Loja', 'PIX ENVIADO', 'Pagamento de fatura', 'Uber'])} ${ri(1, 9)},${pick(['10.5', '-20,00', '1.234,56', '-7'])}`);
                    abrirExtrato(); $('extAccType').value = pick(['debito', 'credito']); extOnAccTypeChange(); $('extCardId').value = pick(['', String(cards[0].id)]);
                    await extHandleFile(new File(['date,title,amount\n' + linhas.join('\n')], 'fuzz.csv'));
                    if (_extParsed.length) { if (rnd() < 0.5) extSelectAll(true); if (_extParsed[0]) _extChangeType(0, pick(TIPOS)); extConfirmImport(); }
                    closeExtrato();
                },
            };
            const names = Object.keys(actions);
            for (let step = 0; step < steps && violations.length < 10; step++) {
                const act = pick(names), e0 = errs.length, v = m => violations.push(`seed ${S} passo ${step} (${act}): ${m}`);
                try { await actions[act](); } catch (e) { v('exceção ' + e.message); }
                if (errs.length > e0) v('console.error ' + errs.slice(e0).join(' | ').slice(0, 150));
                const ids = tx.map(t => t.id);
                if (new Set(ids).size !== ids.length) v('ids duplicados');
                const bad = tx.find(t => (t.cat && !(cats[t.tipo] || []).includes(t.cat)) || (t.faturaData && t.faturaData < t.data)
                    || !(t.valor > 0) || !isValidISODate(t.data) || (t.fixo && !t.serie));
                if (bad) v('lançamento inválido ' + JSON.stringify(bad));
                // Parcelas e juros embutidos: k dentro de n, série coerente, juros ≤ valor; empréstimos válidos
                const badP = tx.find(t => t.parcela && !(t.tipo === 'saida' && t.parcela.n >= 2 && t.parcela.k >= 1 && t.parcela.k <= t.parcela.n));
                if (badP) v('parcela inválida ' + JSON.stringify(badP));
                const badJ = tx.find(t => t.juros !== undefined && !(t.tipo === 'saida' && t.juros > 0 && t.juros <= t.valor));
                if (badJ) v('juros inválidos ' + JSON.stringify(badJ));
                const series = new Map(); tx.forEach(t => { if (t.parcela) { const a = series.get(t.parcela.serie) || []; a.push(t.parcela); series.set(t.parcela.serie, a); } });
                for (const [sr, a] of series) if (new Set(a.map(q => q.n)).size > 1 || new Set(a.map(q => q.k)).size !== a.length) v('série de parcelas incoerente ' + sr);
                const badL = loans.find(l => !(l.valor > 0 && l.parcela > 0 && l.n >= 2 && l.serie && l.nome));
                if (badL) v('empréstimo inválido ' + JSON.stringify(badL));
                if (_stateHash() !== _stateHash(sanitizeState({ t: tx, c: cats, g: goals, k: cards, b: budget, l: loans }))) v('estado não-sanitizado');
            }
        }
    } finally {
        window.confirm = origConfirm; console.error = origErr;
        try { localStorage.clear(); Object.entries(savedLS).forEach(([k, val]) => localStorage.setItem(k, val)); } catch (e) {}
        restoreState(saved); undoStack = []; redoStack = []; _updateUndoBtn();
        savedForm.forEach(([el, val, chk]) => { if (el.isConnected) { el.value = val; el.checked = chk; } });
        renderAll(); renderGoals(); renderCartoesMini();
    }
    const total = seeds.length * steps;
    console[violations.length ? 'warn' : 'info'](`runFuzz: ${total} ações, ${violations.length} violação(ões)`, violations);
    toast(violations.length ? `❌ Fuzz: ${violations.length} violação(ões) — veja o console` : `✅ Fuzz: ${total} ações sem violações`, violations.length ? '#dc2626' : '#16a34a');
    return violations;
}

// ── FUZZ DE SINCRONIZAÇÃO (só no modo preview) ───────────────────────────────
// runSyncFuzz() no console de ?preview: simula DOIS dispositivos (estado, meta e base
// próprios) contra um Firebase em memória que imita o real (remove vazios, reordena
// chaves, transaction com cache vazio na 1ª chamada). Edições e sincronizações
// aleatórias; conflitos resolvidos ao acaso. Invariante: após sincronizar sem edições
// novas, dispositivo A, dispositivo B e servidor convergem para o mesmo estado.
async function _runSyncFuzzImpl(seeds = [1, 2, 3, 4, 5, 6, 7, 8], steps = 120) {
    if (!PREVIEW_MODE) { console.warn('runSyncFuzz só roda em ?preview'); return; }
    const saved = snapshotState(), savedLS = {}, savedUser = _currentUser, savedRef = _userRef, savedToast = toast, savedConfirm = window.confirm;
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); savedLS[k] = localStorage.getItem(k); }
    const server = { data: null }, norm = v => _canon(v) ?? null, clone = v => JSON.parse(JSON.stringify(v));
    const mockRef = {
        once: async () => ({ val: () => server.data ? clone(server.data) : null }),
        transaction: async fn => {
            let r = fn(null);
            if (r !== undefined && server.data !== null) r = fn(clone(server.data));
            if (r === undefined) return { committed: false, snapshot: { val: () => server.data } };
            server.data = norm(r);
            return { committed: true, snapshot: { val: () => server.data } };
        },
        child: () => ({ on() {}, off() {} }),
    };
    const problems = [], stats = { merged: 0, conflict: 0 };
    _userRef = () => mockRef; _currentUser = { uid: 'syncfuzz' }; toast = () => {}; window.confirm = () => true;
    const MK = _syncKey('syncfuzz'), BK = _baseKey('syncfuzz');
    const use = d => { restoreState(_clone(d.state)); undoStack = []; redoStack = []; for (const [k, v] of [[MK, d.meta], [BK, d.base]]) v ? lsSet(k, JSON.stringify(v)) : lsDel(k); };
    const keep = d => { d.state = snapshotState(); d.meta = loadJSON(MK, null); d.base = loadJSON(BK, null); };
    try {
        for (const S of seeds) {
            let seed = S * 7919;
            const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
            const pick = a => a[Math.floor(rnd() * a.length)], ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
            server.data = null;
            const A = { n: 'A', state: sanitizeState({ t: SEED }) }, B = { n: 'B', state: sanitizeState({}) };
            // Lançamento criado nunca está em conflito (id único): só pode sumir se alguém o
            // apagou — nenhuma escolha no diálogo de conflito pode descartá-lo
            const criados = new Set(), apagados = new Set(), lCriados = new Set(), lApagados = new Set();   // l* = empréstimos
            // Edição feita por UM só dispositivo (o outro nunca tocou no item) não tem como
            // conflitar: se ninguém apagou o item, o valor final tem de ser a última edição dele
            const editores = new Map();   // id → Map(dispositivo → último valor)
            const sync = async d => {
                use(d);
                const r = await _reconcileOnce();
                if (r in stats) stats[r]++;
                if (r === 'conflict') await resolveConflict(pick(['local', 'remote']));
                keep(d);
            };
            const ops = [
                d => { const t = makeTx({ desc: d.n + ri(1, 99), valor: ri(1, 500), data: `2026-${pad2(ri(1, 12))}-${pad2(ri(1, 28))}`, tipo: pick(TIPOS), cat: '', fixo: false, pagamento: undefined, cartaoId: null }); tx = tx.concat(t); criados.add(t.id); },
                d => { if (tx.length) { const t = pick(tx), v = ri(1, 900); tx = tx.map(x => x.id === t.id ? makeTx({ ...x, valor: v }, x) : x);
                                        if (!editores.has(t.id)) editores.set(t.id, new Map()); editores.get(t.id).set(d.n, v); } },
                () => { if (tx.length) { const t = pick(tx); tx = tx.filter(x => x.id !== t.id); apagados.add(t.id); } },
                d => { ensureCat(pick(TIPOS), 'Cat' + d.n + ri(1, 5)); },
                () => { if (cats.saida.length) { budget.allocs[pick(cats.saida)] = ri(1, 40); } },
                d => { const l = _sanLoans([{ id: newId(), nome: d.n + ri(1, 99), valor: ri(1000, 9000), n: ri(2, 24), parcela: ri(100, 900), primeira: `2026-0${ri(1, 9)}-10` }])[0]; loans = loans.concat(l); lCriados.add(l.id); },
                () => { if (loans.length) { const l = pick(loans); loans = loans.filter(x => x.id !== l.id); lApagados.add(l.id); } },
                d => { if (loans.length) { const l = pick(loans), nota = d.n + ri(1, 99); loans = loans.map(x => x.id === l.id ? { ...x, nota } : x); } },
                () => { if (cats.saida.length) { const c = pick(cats.saida), de = `2026-0${ri(1, 9)}`; if (rnd() < 0.5) ocultarCategoriaNoOrcamento(c, de, rnd() < 0.5 ? de : null); else mostrarCategoriaNoOrcamento(c, de, null); } },
            ];
            await sync(A); await sync(B);
            for (let step = 0; step < steps; step++) {
                const d = rnd() < 0.5 ? A : B;
                if (rnd() < 0.35) await sync(d);
                else { use(d); pick(ops)(d); _invalidateTxCache(); keep(d); }
                if (_stateHash(d.state) !== _stateHash(sanitizeState({ t: d.state.tx, c: d.state.cats, g: d.state.goals, k: d.state.cards, b: d.state.budget, l: d.state.loans })))
                    problems.push(`seed ${S} passo ${step}: estado inválido em ${d.n}`);
            }
            for (let k = 0; k < 4; k++) { await sync(A); await sync(B); }
            const hS = server.data ? _stateHash(sanitizeState(_mapKeys(server.data, _fbKeyDec))) : null;
            if (!(_stateHash(A.state) === _stateHash(B.state) && _stateHash(B.state) === hS)) problems.push(`seed ${S}: dispositivos/servidor NÃO convergiram`);
            const noServidor = new Set(server.data ? sanitizeState(_mapKeys(server.data, _fbKeyDec)).tx.map(t => t.id) : []);
            const finais = new Map(server.data ? sanitizeState(_mapKeys(server.data, _fbKeyDec)).tx.map(t => [t.id, t.valor]) : []);
            const edicoesPerdidas = [...editores].filter(([id, porDisp]) => !apagados.has(id) && porDisp.size === 1 && finais.get(id) !== [...porDisp.values()][0]);
            if (edicoesPerdidas.length) problems.push(`seed ${S}: ${edicoesPerdidas.length} edição(ões) feita(s) por um só dispositivo não prevaleceram`);
            const lNoServidor = new Set(server.data ? sanitizeState(_mapKeys(server.data, _fbKeyDec)).loans.map(l => l.id) : []);
            const lPerdidos = [...lCriados].filter(id => !lApagados.has(id) && !lNoServidor.has(id));
            if (lPerdidos.length) problems.push(`seed ${S}: ${lPerdidos.length} empréstimo(s) criado(s) e nunca apagado(s) sumiram`);
            const perdidos = [...criados].filter(id => !apagados.has(id) && !noServidor.has(id));
            if (perdidos.length) problems.push(`seed ${S}: ${perdidos.length} lançamento(s) criado(s) e nunca apagado(s) sumiram (conflito descartou mudança não conflitante)`);
        }
        {   // app antigo: servidor com esquema mais novo nunca é sobrescrito nem mesclado
            const novo = { t: {}, v: SCHEMA_VERSION + 1, ts: Date.now() + 5000, appV: 99999999, campoFuturo: { x: 1 } };
            server.data = norm(novo); use({ state: snapshotState(), meta: null, base: null });
            tx = tx.concat(makeTx({ desc: 'local pendente', valor: 7, data: '2026-01-02', tipo: 'saida', cat: '', fixo: false, pagamento: undefined, cartaoId: null }));
            const antes = JSON.stringify(server.data), nTx = tx.length;
            const r1 = await _reconcileOnce(), r2 = await _pushCAS(server.data.ts), r3 = await _mergeOrConflict(clone(server.data));
            if (![r1, r2, r3].every(r => r === 'stale')) problems.push('app antigo: esperava "stale", veio ' + [r1, r2, r3].join('/'));
            if (JSON.stringify(server.data) !== antes) problems.push('app antigo: sobrescreveu um servidor com esquema mais novo');
            if (tx.length !== nTx) problems.push('app antigo: perdeu edição local pendente');
            if (!_appDesatualizado) problems.push('app antigo: flag de desatualizado não ficou ligada (a caixa de entrada depende dela)');
            // Servidor compatível de novo (ex.: outra conta): a flag desliga e a sync volta ao normal
            server.data = null; use({ state: snapshotState(), meta: null, base: null });
            if (await _reconcileOnce() === 'stale' || _appDesatualizado) problems.push('app antigo: não voltou ao normal com servidor compatível');
            // Trava dentro da transação: o ts confere, mas o servidor virou esquema novo no meio do caminho
            await _pushCAS(null); const ts0 = server.data.ts;
            server.data = norm({ ...server.data, v: SCHEMA_VERSION + 1 }); const aposNovo = JSON.stringify(server.data);
            if (await _pushCAS(ts0) !== 'stale' || JSON.stringify(server.data) !== aposNovo) problems.push('app antigo: a transação sobrescreveu esquema mais novo com ts igual');
            _appDesatualizado = false;
        }
        problems.push(...await _testeInbox());
    } finally {
        _userRef = savedRef; _currentUser = savedUser; toast = savedToast; window.confirm = savedConfirm;
        $('ovConflict').classList.remove('open'); _conflictOpen = false; _pendingConflictRemote = null;
        try { localStorage.clear(); Object.entries(savedLS).forEach(([k, v]) => localStorage.setItem(k, v)); } catch (e) {}
        restoreState(saved); undoStack = []; redoStack = []; _updateUndoBtn(); renderAll(); renderGoals(); renderCartoesMini();
    }
    console[problems.length ? 'warn' : 'info'](`runSyncFuzz: ${seeds.length} cenários, ${stats.merged} merges, ${stats.conflict} conflitos resolvidos, ${problems.length} problema(s)`, problems);
    toast(problems.length ? `❌ Sync fuzz: ${problems.length} problema(s) — veja o console` : `✅ Sync fuzz: ${seeds.length} cenários convergiram (${stats.merged} merges)`, problems.length ? '#dc2626' : '#16a34a');
    return problems;
}

// Caixa de entrada do Claude contra um GitHub em memória (API de conteúdo com sha): aplica,
// marca como processadas mesmo com gravação concorrente do Claude (409), não reaplica, grava
// a cópia dos dados e trata token inválido. Roda dentro do runSyncFuzz (usuário simulado,
// toast mudo, estado e localStorage restaurados no fim).
async function _testeInbox() {
    const problemas = [], p = m => problemas.push('caixa de entrada: ' + m);
    const arquivos = {};   // arquivo → { sha, content (base64) }
    let n = 0, concorrente = null, statusForcado = 0, repoPrivado = true;
    const resp = (st, body) => ({ status: st, ok: st >= 200 && st < 300, json: async () => body });
    const origFetch = _inboxFetch, cfgKey = _inboxKey(_currentUser.uid);
    _inboxFetch = async (url, init = {}) => {
        if (statusForcado) return resp(statusForcado, {});
        const m = url.match(/\/repos\/dono\/caixa(?:\/contents\/(.+))?$/);
        if (!m) return resp(404, {});
        if (!m[1]) return resp(200, { private: repoPrivado });
        const arq = m[1];
        if ((init.method || 'GET') === 'GET') return arquivos[arq] ? resp(200, { sha: arquivos[arq].sha, content: arquivos[arq].content }) : resp(404, {});
        const body = JSON.parse(init.body);
        if (arq === INBOX_ARQ && concorrente) { const f = concorrente; concorrente = null; f(); }   // o Claude grava no meio
        if ((arquivos[arq] ? arquivos[arq].sha : undefined) !== (body.sha || undefined)) return resp(409, {});
        arquivos[arq] = { sha: 's' + (++n), content: body.content };
        return resp(200, { content: { sha: arquivos[arq].sha } });
    };
    const grava = (arq, obj) => { arquivos[arq] = { sha: 's' + (++n), content: _b64Utf8(JSON.stringify(obj)) }; };
    const le = arq => arquivos[arq] ? JSON.parse(_utf8B64(arquivos[arq].content)) : null;
    try {
        storeJSON(cfgKey, { repo: 'dono/caixa', token: 't', copia: true });
        lsDel(cfgKey + '_copia');
        restoreState(sanitizeState({ t: SEED }));
        const [t1, t2] = tx;
        const iniciais = [
            { id: 'op1', op: 'add', tx: { id: 1900000000001, desc: 'Raia ✓', valor: 33.67, data: '2026-09-26', tipo: 'saida', cat: '💊 Saúde' } },
            { id: 'op2', op: 'update', txId: t1.id, espera: { valor: t1.valor }, muda: { valor: roundMoney(t1.valor + 1) } },
            { id: 'op3', op: 'delete', txId: t2.id, espera: { desc: t2.desc, valor: t2.valor } },
        ];
        grava(INBOX_ARQ, { versao: 1, ops: iniciais, processados: [] });
        concorrente = () => { const d = le(INBOX_ARQ); d.ops.push({ id: 'op4', op: 'add', tx: { id: 1900000000002, desc: 'Nova', valor: 5, data: '2026-09-27', tipo: 'saida' } }); grava(INBOX_ARQ, d); };
        const r1 = await _inboxProcessar(inboxCfg()), d1 = le(INBOX_ARQ);
        if (r1.aplicadas !== 3) p(`1ª rodada aplicou ${r1.aplicadas} de 3`);
        if (!tx.some(t => t.id === 1900000000001 && t.extId === 'claude:op1')) p('lançamento novo não entrou');
        if (!tx.some(t => t.id === t1.id && t.valor === roundMoney(t1.valor + 1))) p('correção não entrou');
        if (tx.some(t => t.id === t2.id)) p('exclusão não aconteceu');
        if (JSON.stringify(d1.ops.map(o => o.id)) !== '["op4"]') p('marcação errada após gravação concorrente: ' + JSON.stringify(d1.ops.map(o => o.id)));
        if (d1.processados.length !== 3) p('histórico de processadas errado');
        const copia = le(ESTADO_ARQ);
        if (!copia || copia.t.length !== tx.length) p('cópia dos dados não foi gravada');
        const r2 = await _inboxProcessar(inboxCfg());
        if (r2.aplicadas !== 1 || !tx.some(t => t.id === 1900000000002)) p('operação gravada no meio não entrou na rodada seguinte');
        const antes = _stateHash();
        const r3 = await _inboxProcessar(inboxCfg());
        if (r3.processadas !== 0 || _stateHash() !== antes) p('rodada sem operações mudou algo');
        // Reprocessar as mesmas operações (ex.: falha ao marcar) não duplica nem desfaz
        grava(INBOX_ARQ, { versao: 1, ops: iniciais, processados: [] });
        const r4 = await _inboxProcessar(inboxCfg());
        if (r4.aplicadas !== 0 || _stateHash() !== antes) p('reprocessar operações já aplicadas alterou os dados');
        delete arquivos[INBOX_ARQ];
        const r5 = await _inboxProcessar(inboxCfg());
        if (r5.processadas !== 0) p('sem inbox.json deveria ser "nada novo"');
        // Repositório público (ou sem o campo `private`): recusa e não grava nada
        grava(INBOX_ARQ, { versao: 1, ops: [{ id: 'pub1', op: 'add', tx: { id: 1900000000009, desc: 'Pub', valor: 1, data: '2026-09-28', tipo: 'saida' } }], processados: [] });
        const antesPub = [_stateHash(), 0, arquivos[INBOX_ARQ].sha];
        for (const forma of [false, undefined]) {
            repoPrivado = forma;
            try { await _inboxProcessar(inboxCfg()); p('repositório público não foi recusado'); }
            catch (e) { if (!/PÚBLICO/.test(e.message)) p('erro inesperado (público): ' + e.message); }
        }
        lsDel(cfgKey + '_copia'); delete arquivos[ESTADO_ARQ];
        try { await _inboxCopiaEstado(inboxCfg()); p('cópia dos dados foi gravada em repositório público'); } catch (e) {}
        if (arquivos[ESTADO_ARQ] || _stateHash() !== antesPub[0] || arquivos[INBOX_ARQ].sha !== antesPub[2]) p('algo foi gravado em repositório público');
        repoPrivado = true;
        delete arquivos[INBOX_ARQ];
        try { await _inboxProcessar({ repo: 'outro/repo', token: 't' }); p('repositório inexistente não deu erro'); }
        catch (e) { if (!/repositório não encontrado/.test(e.message)) p('erro inesperado (repositório): ' + e.message); }
        statusForcado = 401;
        try { await _inboxProcessar(inboxCfg()); p('token inválido não deu erro'); }
        catch (e) { if (!/token inválido/.test(e.message)) p('erro inesperado (token): ' + e.message); }
    } catch (e) { p('exceção ' + e.message); }
    finally { _inboxFetch = origFetch; lsDel(cfgKey); lsDel(cfgKey + '_copia'); }
    return problemas;
}

