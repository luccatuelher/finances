// ── MOBILE DETECTION ─────────────────────────────────────────────────────────
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
if (IS_MOBILE) document.body.classList.add('mobile');

// ── PREVIEW MODE ──────────────────────────────────────────────────────────────
// Runs the app WITHOUT Google sign-in, for local development / edit previews.
// Activates only when the URL carries ?preview (e.g. index.html?preview=1). The
// normal hosted app (no param) is untouched and still requires login. Firebase
// sync is disabled here so preview edits never reach the real cloud data — it
// works purely off local (localStorage/seed) data.
const PREVIEW_MODE = new URLSearchParams(location.search).has('preview');

// ── TEMA (claro / escuro / automático) ─────────────────────────────────────────
// A escolha fica por aparelho (fin5_tema = 'claro' | 'escuro'; ausente = segue o sistema). O CSS usa só
// variáveis; `data-tema` no <html> troca o conjunto. Gráficos leem as cores pelas variáveis.
const _temaEscuro = () => document.documentElement.getAttribute('data-tema') === 'escuro';
const _cssVar = (n, fb = '') => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || fb;
function _temaSalvo() { try { const t = localStorage.getItem('fin5_tema'); return t === 'claro' || t === 'escuro' ? t : 'auto'; } catch (e) { return 'auto'; } }
function _aplicarTema() {
    const m = _temaSalvo(), escuro = m === 'escuro' || (m === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-tema', escuro ? 'escuro' : 'claro');
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = escuro ? '#0b1020' : '#0b62f0';
    const b = document.getElementById('btnTema');
    if (b) { b.title = 'Tema: ' + (m === 'auto' ? 'automático (sistema)' : m); b.textContent = m === 'auto' ? '🌓' : m === 'escuro' ? '🌙' : '☀️'; }
    if (typeof Chart !== 'undefined') { Chart.defaults.color = _cssVar('--text-2', '#52525b'); Chart.defaults.borderColor = _cssVar('--border', '#ecedf1'); }
}
function ciclarTema() {
    const prox = { auto: 'claro', claro: 'escuro', escuro: 'auto' }[_temaSalvo()];
    try { prox === 'auto' ? localStorage.removeItem('fin5_tema') : localStorage.setItem('fin5_tema', prox); } catch (e) {}
    _aplicarTema();
    try { renderAll(); renderGoals(); } catch (e) {}      // gráficos e cores montadas em JS
    toast('Tema: ' + (prox === 'auto' ? 'automático (segue o sistema)' : prox), '#52525b');
}
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (_temaSalvo() === 'auto') { _aplicarTema(); try { renderAll(); renderGoals(); } catch (e) {} } }); } catch (e) {}

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Limites e prazos do app num lugar só (antes espalhados como números soltos). Congelado.
const CONFIG = Object.freeze({
    UNDO_MAX: 30,                       // passos de desfazer guardados
    UNDO_GRUPO_MS: 10000,               // edições seguidas do mesmo campo viram um passo
    QUARENTENA_MAX: 500,                // registros inválidos guardados (os mais recentes)
    INBOX_PROCESSADOS_MAX: 300,         // histórico de operações da caixa de entrada
    INBOX_MAX_DEL: 10,                  // exclusões por rodada da caixa (acima, nenhuma é feita)
    INBOX_MIN_MS: 2 * 60 * 1000,        // checagens automáticas da caixa
    ESTADO_MIN_MS: 10 * 60 * 1000,      // cópia dos dados (estado.json) no máximo a cada…
    TOKEN_AVISO_DIAS: 14,               // avisa quando o token do GitHub vence em até N dias
    SYNC_INTERVALO_MS: 5 * 60 * 1000,   // sincronização automática periódica
    SYNC_PASSIVA_MIN_MS: 60 * 1000,     // gatilhos passivos (foco/visibilidade) no máximo a cada…
    SYNC_PRAZO_MS: 20000,               // prazo de uma operação com o servidor
    SYNC_DEBOUNCE_MS: 1500,             // várias edições seguidas = 1 envio
    FIXO_REPLICAR_MESES: 12,            // meses gerados ao criar/renovar um fixo
    BACKUP_LEMBRETE_DIAS: 30,           // alerta de "faz tempo que não baixa um backup"
    VIRADA_DIA_MS: 60 * 1000,           // confere virada de dia com o app aberto
    NOTA_MAX: 500,                      // nota de meta/empréstimo
    PAYLOAD_AVISO_KB: 1500,             // avisa quando a base (enviada inteira a cada sync) passa disto
    SYNC_DISJUNTOR_MAX: 60,             // idas ao servidor na janela abaixo que abrem o disjuntor (laço descontrolado)
    SYNC_DISJUNTOR_JANELA_MS: 10 * 60 * 1000,
    SYNC_DISJUNTOR_PAUSA_MS: 15 * 60 * 1000,   // pausa automática da sincronização depois que o disjuntor abre
    BAK_DIAS: 14,                       // backups diários guardados no Firebase (finances_bak)
});

// ── DOM CACHE ─────────────────────────────────────────────────────────────────
// DOM helper
function $(id) { return document.getElementById(id); }

// ── SHARED UTILITIES ──────────────────────────────────────────────────────────
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const pad2 = n => String(n).padStart(2, '0');
// Datas sempre no fuso local, formato YYYY-MM-DD (valueAsDate/toISOString usam UTC
// e viram "amanhã" depois das 21h em UTC-3)
const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
function todayLocalISO() { return isoDate(new Date()); }
const ymKey = (m, a) => `${a}-${pad2(m + 1)}`;          // m é 0-indexado
// Onde um mês (ou ano, com m = null) está em relação a hoje: textos de "ainda pode gastar",
// ritmo e "por dia até o fim do mês" só fazem sentido no período em andamento
function periodoFase(a, m = null, now = new Date()) {
    const ny = now.getFullYear(), nm = now.getMonth();
    if (a !== ny) return a < ny ? 'passado' : 'futuro';
    if (m == null || m === nm) return 'atual';
    return m < nm ? 'passado' : 'futuro';
}
// % de uso de um limite, inteiro que nunca cruza 100 no arredondamento: 99,6% → 99
// (ainda sobra), 100,2% → 101 (estourou). Math.round mostrava "100% gasto" com saldo.
// Participações inteiras que somam EXATAMENTE 100 (maior resto) — com Math.round três
// fatias iguais davam 33% + 33% + 33% = 99% e listas longas passavam de 100%
function pctPartes(valores) {
    const pos = valores.map(v => Math.max(0, +v || 0)), total = pos.reduce((s, v) => s + v, 0);
    if (!(total > 0)) return pos.map(() => 0);
    const brutos = pos.map(v => v / total * 100), out = brutos.map(Math.floor);
    let falta = 100 - out.reduce((s, v) => s + v, 0);
    brutos.map((b, i) => [b - out[i], i]).sort((x, y) => y[0] - x[0] || x[1] - y[1])
        .forEach(([, i]) => { if (falta > 0) { out[i]++; falta--; } });
    return out;
}
// % com até 2 casas no formato pt-BR ("107,86%", não "107.86%")
const fmtPct = p => (+(+p || 0).toFixed(2)).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
function pctDoLimite(parte, limite) {
    if (!(limite > 0)) return 0;
    const p = +(parte / limite * 100).toFixed(6);          // resíduo de float não vira 101%
    return p < 100 ? Math.floor(p) : Math.ceil(p);
}
function isValidISODate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    return m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate();
}
// Soma n meses mantendo o dia, limitado ao último dia do mês (31/jan + 1 → 28/fev)
function addMonthsISO(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const total = (m - 1) + n;
    const yy = y + Math.floor(total / 12), mm = ((total % 12) + 12) % 12;
    return `${yy}-${pad2(mm + 1)}-${pad2(Math.min(d, new Date(yy, mm + 1, 0).getDate()))}`;
}
// Dinheiro em centavos exatos — evita 0.1 + 0.2 = 0.30000000000000004 nos dados salvos.
// `|| 0` normaliza -0: senão 0,30 − 0,10 − 0,20 virava "−R$ 0,00" em vermelho.
// Simétrico: -12,345 → -12,35 (Math.round puro arredondaria o .5 negativo para cima)
const roundMoney = v => (Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON) * 100) / 100) || 0;

// Texto para comparação humana: sem acento e minúsculo ("Farmácia" ≈ "farmacia")
const fold = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Ordenação alfabética pt-BR: "Ágape" antes de "Farmácia", "Item 2" antes de "Item 10"
const _collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const cmpText = (a, b) => _collator.compare(String(a || ''), String(b || ''));

// Parser único de valores monetários (formulário, extratos, backups).
// Aceita "1.800,50", "1,800.50", "10.5", "R$ 10,50", "-50.00", "(12,00)", "50,00-".
// Regra de ambiguidade: vírgula sozinha é decimal (padrão BR); ponto sozinho é decimal
// só com 1–2 casas ou quando não forma grupos de milhar ("1.800" = mil e oitocentos).
function parseValor(s) {
    if (typeof s === 'number') return Number.isFinite(s) ? s : NaN;
    s = String(s == null ? '' : s).trim();
    if (!s) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/R\$|\s|\u00A0/gi, '');
    if (/^[-−–]/.test(s))      { neg = !neg; s = s.slice(1); }
    else if (/[-−–]$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    else if (s[0] === '+')     s = s.slice(1);
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
    const commas = (s.match(/,/g) || []).length, dots = (s.match(/\./g) || []).length;
    let n;
    if (commas && dots) {
        // Os dois presentes: o último separador é o decimal
        n = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (commas) {
        if (commas === 1) n = s.replace(',', '.');
        else if (/^\d{1,3}(,\d{3})+$/.test(s)) n = s.replace(/,/g, '');
        else return NaN;
    } else if (dots) {
        if (/^\d*\.\d{1,2}$/.test(s)) n = s;                                  // "10.5"
        else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = s.replace(/\./g, '');   // "1.800", "1.800.000"
        else if (dots === 1) n = s;                                         // "1234.567"
        else return NaN;
    } else n = s;
    const v = parseFloat(n);
    if (!Number.isFinite(v)) return NaN;
    return neg ? -v : v;
}
// <input autocomplete="off" type="number"> já entrega número com ponto decimal — não passar pelo parser BR
function numInput(el) {
    if (!el) return NaN;
    return el.type === 'number' ? el.valueAsNumber : parseValor(el.value);
}

// IDs: numéricos, únicos e crescentes mesmo com várias criações no mesmo milissegundo
let _lastId = 0;
function newId() { _lastId = Math.max(Date.now(), _lastId + 1); return _lastId; }
function _bumpLastId(id) { if (id > _lastId) _lastId = id; }
// Normaliza ids vindos de <select>.value, backups antigos ou Firebase ("123" → 123)
function toId(v) { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; }

// XSS protection: escape user-supplied strings before injecting into HTML
const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escHtml(s) { return s == null ? '' : String(s).replace(/[&<>"']/g, c => _escMap[c]); }
// String segura como argumento de handler inline: literal JS (JSON) + escape HTML do atributo.
// Uso: data-onclick="fn(${jsStr(nome)})" — funciona com aspas, barras, emojis, etc.
function jsStr(s) { return escHtml(JSON.stringify(String(s == null ? '' : s))); }
// Cores vão para atributos style — só aceita hex
function safeColor(c, fallback = '#6d28d9') { return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback; }
// Cor escolhida pelo usuário (meta, cartão) usada como TEXTO sobre branco ou como FUNDO de
// texto branco: escurece mantendo a matiz até 4,5:1 (WCAG AA). Amarelo/rosa/verde da paleta
// ficavam entre 2:1 e 3,5:1. Variáveis CSS (tokens já ajustados) passam direto.
function _lumRel(c) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function corLegivel(cor, alvo = 4.5) {
    let h = typeof cor === 'string' ? cor.trim() : '';
    if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + [...h.slice(1)].map(x => x + x).join('');
    if (!/^#[0-9a-f]{6}$/i.test(h)) return cor;
    const c0 = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    for (let k = 0; k < 1; k += 0.02) {
        const c = c0.map(v => v * (1 - k));
        if ((1.05) / (_lumRel(c) + 0.05) >= alvo) return k ? '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('') : h;
    }
    return '#000000';
}

// Cor do usuário usada como TEXTO sobre a superfície do tema: no claro escurece (corLegivel); no escuro clareia
// (mistura com branco até 4,5:1 sobre o fundo escuro dos cartões)
function corTexto(cor) {
    if (!_temaEscuro()) return corLegivel(cor);
    let h = typeof cor === 'string' ? cor.trim() : '';
    if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + [...h.slice(1)].map(x => x + x).join('');
    if (!/^#[0-9a-f]{6}$/i.test(h)) return cor;
    const c0 = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), bg = _lumRel([0x14, 0x1a, 0x2b]);
    for (let k = 0; k <= 1; k += 0.05) {
        const c = c0.map(v => v + (255 - v) * k);
        if ((_lumRel(c) + 0.05) / (bg + 0.05) >= 4.5) return '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    }
    return '#ffffff';
}

// structuredClone polyfill for older browsers
const _clone = typeof structuredClone === 'function' ? structuredClone : o => JSON.parse(JSON.stringify(o));

// ── LOCAL STORAGE (tolerante a JSON corrompido e cota cheia) ─────────────────
// Toda leitura/escrita passa por aqui. O modo preview usa um namespace próprio e NUNCA
// toca nos dados reais — antes, abrir index.html?preview num navegador onde alguém já
// tinha usado o app mostrava as finanças salvas sem login (e testes as alteravam).
const LS_PREFIX = PREVIEW_MODE ? 'preview:' : '';
const lsKey = k => LS_PREFIX + k;
function lsGet(k) { try { return localStorage.getItem(lsKey(k)); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(lsKey(k), v); return true; } catch (e) { return false; } }
function lsDel(k) { try { localStorage.removeItem(lsKey(k)); } catch (e) {} }
function loadJSON(key, fallback) {
    let raw;
    try { raw = localStorage.getItem(lsKey(key)); } catch (e) { return fallback; }
    if (raw == null) return fallback;
    try { return JSON.parse(raw); }
    catch (e) {
        // Nunca descarta o original: guarda cópia para recuperação manual
        console.error(`Dados corrompidos em ${key}; cópia salva em ${key}_corrupt`, e);
        lsSet(key + '_corrupt', raw);
        return fallback;
    }
}
let _storageWarned = false;
function storeJSON(key, val) {
    try { localStorage.setItem(lsKey(key), JSON.stringify(val)); return true; }
    catch (e) {
        console.error('Falha ao salvar ' + key, e);
        if (!_storageWarned) { _storageWarned = true; toast('⚠️ Não foi possível salvar no navegador (armazenamento cheio?). Exporte um backup.', '#dc2626'); }
        return false;
    }
}

// ── NOMES DE CATEGORIA: "🍔 Alimentação" → { icon: "🍔", label: "Alimentação" } ──
// Usa segmentação por grafema: emojis compostos (👨‍👩‍👧, 🏋️, bandeiras) e símbolos
// como ₿ contam como UM ícone; dígitos/letras nunca são ícone ("2ª via", "Contas 2024").
const _graphemes = (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? (() => { const sg = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }); return s => [...sg.segment(s)].length; })()
    : s => (s.match(/(?:\p{Extended_Pictographic}|\p{Sc}|\p{So})(?:[\uFE0F\u20E3\p{Emoji_Modifier}]|\u200D(?:\p{Extended_Pictographic}|\p{So})\uFE0F?)*|./gsu) || []).length;
function _isIconToken(tok) { return !!tok && _graphemes(tok) === 1 && !/^[\p{L}\p{N}\p{P}]+$/u.test(tok); }
function splitCatName(name) {
    name = String(name || '').trim();
    const m = name.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    if (m && _isIconToken(m[1])) return { icon: m[1], label: (m[2] || '').trim() };
    return { icon: null, label: name };
}

// Chart colors — always light mode
function _chartColors() {
    if (_temaEscuro()) return {      // fundos translúcidos sobre o fundo escuro, bordas claras
        entBg:  'rgba(74,222,128,.28)',  entBd:  '#4ade80',
        gasBg:  'rgba(248,113,113,.28)', gasBd:  '#f87171',
        invBg:  'rgba(167,139,250,.30)', invBd:  '#a78bfa',
        debBg:  'rgba(96,165,250,.40)',  debBd:  '#60a5fa',
        credBg: 'rgba(56,189,248,.28)',  credBd: '#38bdf8',
    };
    return {
        entBg:  '#dcfce7', entBd:  '#16a34a',
        gasBg:  '#fee2e2', gasBd:  '#dc2626',
        invBg:  '#ede9fe', invBd:  '#6d28d9',
        debBg:  '#93c5fd', debBd:  '#1d4ed8',
        credBg: '#e0f2fe', credBd: '#0284c7',
    };
}
// ── SEARCHABLE CATEGORY COMBOBOX ─────────────────────────────────────────────
function buildCatCombo(id, tipo, currentVal) {
    const list = cats[tipo] || [];
    const safe = encodeURIComponent(id);
    return `
    <input type="text" id="${id}" value="${escHtml(currentVal || '')}" autocomplete="off"
        placeholder="Buscar categoria…"
        data-oninput="catComboFilter('${safe}')"
        data-onfocus="catComboOpen('${safe}')"
        data-onkeydown="catComboKey(event,'${safe}')">
    <div class="cat-combo-drop" id="drop-${safe}">
        ${_catComboItems(list, currentVal, safe)}
    </div>`;
}

function _catComboItems(list, query, safe) {
    const q = (query || '').toLowerCase();
    const filtered = q ? list.filter(c => c.toLowerCase().includes(q)) : list;
    if (!filtered.length && !q) return '<div class="cat-combo-empty">Nenhuma categoria</div>';
    const items = filtered.map((c, i) => `
        <div class="cat-combo-item" data-val="${escHtml(c)}" data-onclick="catComboSelect(${jsStr(safe)}, this.dataset.val)"
            data-onmouseenter="catComboHover(${jsStr(safe)},${i})">
            <span>${escHtml(splitCatName(c).icon || '')}</span>
            <span>${escHtml(c)}</span>
        </div>`).join('');
    const addBtn = q && !list.some(c => c.toLowerCase() === q)
        ? `<div class="cat-combo-add" data-onclick="catComboAddNew(${jsStr(safe)})">＋ Adicionar "${escHtml(query)}"</div>`
        : '';
    return items + addBtn;
}

let _catComboActiveIdx = -1;

// Um único listener global fecha dropdowns (combobox e seletor de ícones) ao clicar
// fora — antes cada abertura registrava um listener novo que se acumulava.
document.addEventListener('mousedown', e => {
    document.querySelectorAll('.cat-combo-drop.open').forEach(drop => {
        const inp = $(decodeURIComponent(drop.id.replace(/^drop-/, '')));
        if (!drop.contains(e.target) && e.target !== inp) drop.classList.remove('open');
    });
    document.querySelectorAll('.icon-picker.open').forEach(p => {
        if (!p.contains(e.target) && !e.target.closest('.ch-icon,.ch-add-icon')) {
            if (_openPickerId === p.id) _closeIconPicker(); else p.classList.remove('open');
        }
    });
});

function catComboOpen(safe) {
    const drop = $('drop-' + safe);
    if (!drop) return;
    const tipo = _getCatComboTipo(safe);
    drop.innerHTML = _catComboItems(cats[tipo] || [], '', safe);
    drop.classList.add('open');
    _catComboActiveIdx = -1;
}

function catComboFilter(safe) {
    const inp  = $(decodeURIComponent(safe));
    const drop = $('drop-' + safe);
    if (!drop || !inp) return;
    const tipo = _getCatComboTipo(safe);
    drop.innerHTML = _catComboItems(cats[tipo] || [], inp.value, safe);
    drop.classList.add('open');
    _catComboActiveIdx = -1;
}

function catComboSelect(safe, val) {
    const inp  = $(decodeURIComponent(safe));
    const drop = $('drop-' + safe);
    if (inp) inp.value = val;
    if (drop) drop.classList.remove('open');
}

function catComboHover(safe, idx) { _catComboActiveIdx = idx; }

function catComboKey(e, safe) {
    const drop  = $('drop-' + safe);
    if (!drop || !drop.classList.contains('open')) return;
    const items = drop.querySelectorAll('.cat-combo-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); _catComboActiveIdx = Math.min(_catComboActiveIdx + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle('active', i === _catComboActiveIdx)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); _catComboActiveIdx = Math.max(_catComboActiveIdx - 1, 0); items.forEach((el, i) => el.classList.toggle('active', i === _catComboActiveIdx)); }
    if (e.key === 'Enter')     { e.preventDefault(); if (_catComboActiveIdx >= 0 && items[_catComboActiveIdx]) { catComboSelect(safe, items[_catComboActiveIdx].dataset.val); } }
    if (e.key === 'Escape')    { drop.classList.remove('open'); }
}

function catComboAddNew(safe) {
    const inp   = $(decodeURIComponent(safe));
    const nome  = inp ? inp.value.trim() : '';
    if (!nome) return;
    const tipo  = _getCatComboTipo(safe);
    if (ensureCat(tipo, nome)) commitCats();
    catComboSelect(safe, nome);
    toast(`✓ Categoria "${nome}" adicionada!`);
}

function _getCatComboTipo(safe) {
    // Infer tipo from context: inline edit uses ie-cat-ID, sidebar uses 'categoria'
    const id = decodeURIComponent(safe);
    if (id === 'categoria') return $('tipo') ? $('tipo').value : 'saida';
    if (id === 'mob-categoria') return $('mob-tipo') ? $('mob-tipo').value : 'saida';
    if (id === 'mob-edit-cat')  return $('mob-edit-tipo') ? $('mob-edit-tipo').value : 'saida';
    // ie-cat-{txId} — look up the tipo select
    const match = id.match(/^ie-cat-(\d+)$/);
    if (match) { const s = $('ie-tipo-' + match[1]); return s ? s.value : 'saida'; }
    return 'saida';
}

// Refresh all open comboboxes after cats changes
function refreshAllCatCombos() {
    document.querySelectorAll('.cat-combo-drop.open').forEach(drop => {
        const safe = drop.id.replace('drop-', '');
        const inp  = $(decodeURIComponent(safe));
        if (!inp) return;
        const tipo = _getCatComboTipo(safe);
        drop.innerHTML = _catComboItems(cats[tipo] || [], inp.value, safe);
    });
}

// Editor inline: só o combobox de categoria é próprio (reconstruído com a lista do novo
// tipo); pagamento/cartão seguem o fluxo comum dos formulários (formTipoChange)
function ieUpdateCats(id) {
    const wrap = $('ie-cat-wrap-' + id);
    if (wrap) wrap.innerHTML = buildCatCombo('ie-cat-' + id, $('ie-tipo-' + id).value, '');
    formTipoChange(formInline(id));
}

function populateCatSelect(el, tipo, selected) {
    if (!el) return;
    // If el is a <select>, keep legacy behaviour (sidebar still uses <select> for now)
    if (el.tagName === 'SELECT') {
        // Sem `selected` explícito mantém a escolha atual: re-renders (sync em segundo
        // plano, salvar em outra tela) não podem trocar a categoria que o usuário escolheu
        // (troca de tipo: a escolha anterior não existe na nova lista → volta à 1ª)
        const list = cats[tipo] || [];
        let want = selected;
        if (want === undefined) {
            want = el.options.length ? el.value : (list[0] ?? '');
            if (want && !list.includes(want)) want = list[0] ?? '';
        }
        el.innerHTML = '';
        list.forEach(c => el.add(new Option(c, c, false, c === want)));
        // Opção "sem categoria" no fim: editar um lançamento sem categoria não pode
        // atribuir a primeira da lista silenciosamente
        el.add(new Option('— sem categoria —', '', false, want === ''));
        if (want && !list.includes(want)) el.add(new Option(want, want, false, true));
        return;
    }
    // For combobox inputs, just update value
    if (selected) el.value = selected;
}
function closeOverlay(id, e) { if (!e || e.target === $(id)) $(id).classList.remove('open'); }

// ── MOBILE HELPERS ────────────────────────────────────────────────────────────
const MOB_VIEW_LABELS = { dashboard: 'Visão Geral', anual: 'Visão Anual', mensal: 'Mensal', metas: 'Orçamento' };
const MOB_TYPE_ICON   = { entrada: '💰', saida: '💸', investimento: '📈' };

function mobNavTo(view, btn) { navTo(view); }

function mobFiltroChange() { setFiltro($('mobFiltroMes').value, $('mobFiltroAno').value); }

function openMobForm() {
    $('mobFormTitle').textContent = 'Novo Lançamento';
    $('mob-desc').value = ''; $('mob-valor').value = '';
    $('mob-fixo').checked = false;
    $('mob-parcelas').value = '1'; $('mob-parcelasModo').value = 'total'; $('mob-juros').value = '';
    $('mobMaisField').open = false; formParcInfo(FORM_MOBILE);
    $('mob-data').value = todayLocalISO();
    mobOnTipoChange();
    $('mobFormSheet').classList.add('open');
    setTimeout(() => $('mob-desc').focus(), 300);
}

function closeMobForm() { $('mobFormSheet').classList.remove('open'); }

function mobAdicionar() {
    submitTx(readTxForm(FORM_MOBILE), null, closeMobForm);
}

function openMobEdit(id) {
    const t = tx.find(x => x.id === id);
    if (!t) return;
    $('mob-edit-id').value = id;
    $('mob-edit-desc').value = t.desc;
    $('mob-edit-valor').value = fmtValorInput(t.valor);
    $('mob-edit-data').value = t.data;
    $('mob-edit-tipo').value = t.tipo;
    $('mob-edit-fixo').checked = t.fixo;
    $('mob-edit-pag').value = t.pagamento || 'debito';
    $('mob-edit-juros').value = t.juros ? fmtValorInput(t.juros) : '';
    $('mob-edit-prox').checked = false;
    $('mobEditProxRow').style.display = t.parcela && t.parcela.k < t.parcela.n ? 'flex' : 'none';
    $('mobEditProxTxt').textContent = t.parcela ? `Aplicar às parcelas seguintes (${t.parcela.k + 1}–${t.parcela.n})` : '';
    mobEditTipoChange(t.cat);
    // Cartão DESTE lançamento (formPagChange sugeriu o padrão). Só saídas mostram cartão:
    // antes um estorno (entrada no crédito) exibia um seletor de cartão que era ignorado.
    if (t.tipo === 'saida' && t.pagamento === 'credito') {
        _populateCardSelect('mob-edit-cartao', t.cartaoId);
        formFaturaInfo(FORM_MOB_EDIT);
    }
    $('mobEditSheet').classList.add('open');
}

function closeMobEdit() { $('mobEditSheet').classList.remove('open'); }

function mobEditSave() {
    submitTx(readTxForm(FORM_MOB_EDIT), toId($('mob-edit-id').value), closeMobEdit);
}

function mobEditDelete() {
    remover(toId($('mob-edit-id').value), () => closeMobEdit());
}

function renderMobList() {
    const { m, a } = filtro();
    const lista = txFiltrados(m, a);
    const container = $('mobTxList');
    if (!container) return;

    // Build fatura cards for mobile
    let faturaHtml = '';
    if (activeTab === 'all' || activeTab === 'saida') {
        // Com busca ativa, a fatura mostra só os itens que batem (e some se nenhum bater)
        const match = buscaPredicate(), buscando = !!$('busca').value.trim();
        const faturas = getFaturasForMonth(m, a)
            .map(f => buscando ? { ...f, items: f.items.filter(match) } : f)
            .filter(f => f.items.length);
        faturaHtml = faturas.map((f, idx) => {
            const [vy, vm, vd] = f.faturaDate.split('-');
            const key = faturaKey(f);
            return `<div class="mob-fatura-card ${_faturaOpen.has(key) || buscando ? 'open' : ''}" id="mobFaturaCard-${idx}">
                <div class="mob-fatura-header" data-onclick="toggleFaturaOpen(this.parentElement, ${jsStr(key)})">
                    <div class="mob-tx-dot" style="background:${f.card.cor}22;border-radius:10px"><span style="font-size:16px">💳</span></div>
                    <div class="mob-tx-info">
                        <div class="mob-tx-desc" style="color:var(--accent)">${escHtml(f.card.nome)}</div>
                        <div class="mob-tx-meta">Fatura · vence ${vd}/${vm} · ${f.items.length} itens</div>
                    </div>
                    <div class="mob-tx-right">
                        <div class="mob-tx-val" style="color:var(--danger)">− ${fmt(f.total)}</div>
                        <div class="mob-tx-date">▼</div>
                    </div>
                </div>
                <div class="mob-fatura-body">
                    ${f.items.map(t => {
                        const [y2, m2, d2] = t.data.split('-');
                        return `<div class="mob-tx-card" data-onclick="openMobEdit(${t.id})" style="background:transparent">
                            <div class="mob-tx-info" style="padding-left:14px">
                                <div class="mob-tx-desc" style="font-size:12px">${escHtml(t.desc)}</div>
                                <div class="mob-tx-meta">${d2}/${m2} · ${escHtml(catLabel(t))}</div>
                            </div>
                            <div class="mob-tx-right">
                                <div class="mob-tx-val" style="color:var(--danger);font-size:12px">− ${fmt(t.valor)}</div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('');
    }

    if (!lista.length && !faturaHtml) {
        container.innerHTML = '<div class="empty-state" style="padding:30px;text-align:center;color:var(--text-3);font-size:13px">Nenhum lançamento encontrado.</div>';
        return;
    }
    container.innerHTML = faturaHtml + lista.map(t => {
        const [y, mo, d] = t.data.split('-');
        const cor = txCor(t);
        const pre = txPre(t);
        const dotClass = t.tipo === 'investimento' ? 'invest' : t.tipo;
        const icon = MOB_TYPE_ICON[t.tipo] || '💰';
        const payBadge = txPayBadge(t);
        const fixoBadge = t.fixo ? '<span class="tag-fixo">FIXO</span>' : '';
        const cardBadge = t.cartaoId ? (()=>{ const c = cards.find(x=>x.id==t.cartaoId); return c ? `<span class="tag-card" style="background:${c.cor}22;color:${c.cor}">${escHtml(c.nome)}</span>` : ''; })() : '';
        return `<div class="mob-tx-card" data-onclick="openMobEdit(${t.id})">
            <div class="mob-tx-dot ${dotClass}">${icon}</div>
            <div class="mob-tx-info">
                <div class="mob-tx-desc">${escHtml(t.desc)}</div>
                <div class="mob-tx-meta">${escHtml(catLabel(t))}${payBadge}${fixoBadge}${cardBadge}</div>
            </div>
            <div class="mob-tx-right">
                <div class="mob-tx-val" style="color:${cor}">${pre} ${fmt(t.valor)}</div>
                <div class="mob-tx-date">${d}/${mo}</div>
            </div>
        </div>`;
    }).join('');
}


const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const GOAL_COLORS = ['#16a34a','#0284c7','#6d28d9','#dc2626','#f59e0b','#ec4899','#0f766e','#b45309','#0e7490'];
const CAT_COLORS  = ['#ef4444','#f59e0b','#0b62f0','#10b981','#ec4899','#8b5cf6','#06b6d4','#84cc16','#f97316','#14b8a6'];
// Cor ESTÁVEL por categoria (posição na lista de gastos+investimentos), igual em todos os
// meses e gráficos — antes vinha da posição no ranking do mês e "Alimentação" era vermelha
// num mês e azul no outro. Dentro de um gráfico, colisão (> 10 categorias) pega a próxima livre.
const COR_SEM_CATEGORIA = '#a1a1aa';
function coresCategorias(nomes) {
    const lista = [...(cats.saida || []), ...(cats.investimento || [])], usadas = new Set(), n = CAT_COLORS.length;
    return nomes.map(nome => {
        const idx = lista.indexOf(nome);
        if (idx < 0 && (!nome || nome === '(sem categoria)')) return COR_SEM_CATEGORIA;
        let i = idx >= 0 ? idx : [...nome].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 0);
        for (let k = 0; k < n && usadas.has(CAT_COLORS[i % n]); k++) i++;
        const cor = CAT_COLORS[i % n]; usadas.add(cor); return cor;
    });
}

const CHART_COMMON_OPTS = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, font: { size: 10, family: 'Inter' }, padding: 8 } } }
};
// Rótulo do eixo Y em pt-BR compacto ("3,2 mil", "1,5 mi"). Aumenta as casas até os rótulos do
// eixo ficarem distintos: com 1 casa fixa, uma faixa curta (R$ 3.000–3.150) mostrava
// "R$3.1k, R$3.1k, R$3.0k, R$3.0k"; negativos ficavam sem formato ("-1500") e valores
// pequenos saíam com ponto decimal ("R$-0.0094").
function fmtEixo(v, _i, ticks) {
    const vals = (ticks || []).map(t => t.value).filter(Number.isFinite);
    const mk = d => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: d });
    let f = mk(0);
    for (let d = 0; d <= 3; d++) { f = mk(d); if (new Set(vals.map(x => f.format(x))).size === vals.length) break; }
    return 'R$ ' + f.format(v);
}
const AXIS_OPTS = {
    x: { grid: { display: false }, ticks: { font: { size: 10, family: 'Inter' } } },
    y: { ticks: { font: { size: 9 }, callback: fmtEixo } }
};

// Dados de exemplo — carregados apenas no modo preview (conta real começa vazia)
const SEED = [
    {id:1, desc:"Aluguel",       valor:1800, data:"2026-02-01", tipo:"saida",       cat:"🏠 Moradia",      fixo:true,  pagamento:"debito"},
    {id:2, desc:"Netflix",        valor:44.9, data:"2026-02-01", tipo:"saida",       cat:"📱 Assinaturas",  fixo:true,  pagamento:"credito"},
    {id:3, desc:"Salário",        valor:5500, data:"2026-02-05", tipo:"entrada",     cat:"💰 Salário",      fixo:false, pagamento:null},
    {id:4, desc:"Supermercado",   valor:380,  data:"2026-02-08", tipo:"saida",       cat:"🍔 Alimentação",  fixo:false, pagamento:"debito"},
    {id:5, desc:"Tesouro Direto", valor:600,  data:"2026-02-10", tipo:"investimento",cat:"🛡️ Renda Fixa",  fixo:false, pagamento:null},
    {id:6, desc:"Restaurante",    valor:95,   data:"2026-02-12", tipo:"saida",       cat:"🍽️ Restaurantes",fixo:false, pagamento:"credito"},
    {id:7, desc:"Uber",           valor:38,   data:"2026-02-14", tipo:"saida",       cat:"🚗 Transporte",   fixo:false, pagamento:"credito"},
    {id:8, desc:"Farmácia",       valor:62,   data:"2026-02-15", tipo:"saida",       cat:"💊 Saúde",        fixo:false, pagamento:"debito"}
];

const TIPOS = ['saida', 'entrada', 'investimento'];
const DEFAULT_CATS = {
    saida:        ["🏠 Moradia","🍔 Alimentação","🚗 Transporte","🎉 Lazer","💊 Saúde","🛒 Compras","💳 Fatura Cartão","👨‍👩‍👧 Família","📡 Internet/Telefone","📱 Assinaturas","🍽️ Restaurantes","🎮 Jogos","👗 Roupas"],
    entrada:      ["💰 Salário","💸 Dividendos","👨‍👩‍👧 Família","🔄 Transferência","⚙️ Outros"],
    investimento: ["🛡️ Renda Fixa","📈 Ações","₿ Cripto","🏦 Fundo"]
};
// v3: fatura de cartões com vencimento ≤ fechamento corrigida; fixos ganham `serie`
// v4: sem migração de dados; o número sobe junto com campos novos (`l`, `parcela`, `allocsDe`...) para que um
// app ANTIGO (que descartaria o que não conhece) se recuse a gravar por cima — ver _remotoMaisNovo()
const SCHEMA_VERSION = 4;
const APP_BUILD = 20261007;   // só diagnóstico (gravado em `appV`); a trava usa SCHEMA_VERSION

// ── SANITIZAÇÃO ───────────────────────────────────────────────────────────────
// TODO dado externo (localStorage, Firebase, backup) passa por aqui antes de virar
// estado. O Firebase, por exemplo, apaga objetos/arrays vazios e transforma arrays
// esparsos em objetos — sem normalização isso derrubava a tela (budget.monthTotals
// undefined). Aqui também moram as migrações de esquema.
const _asList = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
function _normDate(v) {
    if (typeof v !== 'string') return null;
    const s = v.slice(0, 10);
    return isValidISODate(s) ? s : null;
}
function _sanCards(list) {
    const seen = new Set();
    // 1–31: cartões que fecham/vencem dia 29–31 existem (ex.: vence dia 7, fecha 7 dias antes);
    // _calcFatura limita ao último dia de meses curtos. Antes era 1–28 e a compra do dia
    // 29–31 caía na fatura seguinte.
    const day = v => Math.min(31, Math.max(1, parseInt(v, 10) || 1));
    return _asList(list).filter(c => c && typeof c === 'object').map(c => {
        let id = toId(c.id);
        if (!id || seen.has(id)) id = newId();
        seen.add(id);
        return { id, nome: String(c.nome ?? '').trim().slice(0, CARD_MAX) || 'Cartão', fechamento: day(c.fechamento), vencimento: day(c.vencimento), cor: safeColor(c.cor) };
    });
}
function _sanCats(c) {
    if (!c || typeof c !== 'object') return _clone(DEFAULT_CATS);
    const out = {};
    TIPOS.forEach(tp => {
        out[tp] = [...new Set(_asList(c[tp]).filter(x => typeof x === 'string').map(x => x.trim().slice(0, CAT_MAX)).filter(Boolean))];
    });
    return out;
}
// Limites plausíveis: acima de ~R$ 90 trilhões o double perde os centavos e as somas ficam
// erradas; um "0" a mais digitado sem querer ou um extrato corrompido não pode entrar mudo.
const VALOR_MAX = 1e11, DESC_MAX = 200, CAT_MAX = 60, CARD_MAX = 40;
const PARCELAS_MAX = 120, LOAN_N_MAX = 600;   // parcelas numa compra / num empréstimo
const _valorOk = v => Number.isFinite(v) && Math.abs(v) <= VALOR_MAX;
function _sanTx(list, cardList, fromVersion, report) {
    const seen = new Set();
    const cardById = new Map(cardList.map(c => [c.id, c]));
    const out = [];
    _asList(list).forEach(t => {
        if (!t || typeof t !== 'object') return;
        const data  = _normDate(t.data);
        const valor = parseValor(t.valor);
        if (!data || !_valorOk(valor)) { report.dropped.push(t); return; }
        const tipo = TIPOS.includes(t.tipo) ? t.tipo : 'saida';
        // Crédito vale para saídas e para estornos (entrada no cartão)
        const pagamento = t.pagamento === 'credito' ? 'credito' : (tipo === 'saida' ? 'debito' : null);
        const cartaoId  = pagamento === 'credito' ? toId(t.cartaoId) : null;
        let faturaData  = cartaoId ? _normDate(t.faturaData) : null;
        const card = cartaoId ? cardById.get(cartaoId) : null;
        if (card) {
            // Migração v3: a fórmula antiga punha a fatura um mês antes quando vencimento ≤ fechamento
            if (fromVersion < 3 && faturaData && card.vencimento <= card.fechamento && faturaData === _calcFaturaLegacy(card, data)) faturaData = null;
            // Invariante: fatura nunca vence antes da compra
            if (!faturaData || faturaData < data) faturaData = _calcFatura(card, data);
        }
        let id = toId(t.id);
        if (!id || seen.has(id)) id = newId();
        seen.add(id);
        const o = { id, desc: String(t.desc ?? '').trim().slice(0, DESC_MAX), valor: roundMoney(Math.abs(valor)), data, tipo,
                    cat: typeof t.cat === 'string' ? t.cat.trim().slice(0, CAT_MAX) : '', fixo: !!t.fixo, pagamento, cartaoId, faturaData };
        // Série de fixos: identidade estável da recorrência (antes era só a descrição)
        if (o.fixo) o.serie = (typeof t.serie === 'string' && t.serie) ? t.serie : `L:${tipo}:${o.desc}`;
        if (typeof t.extId === 'string' && t.extId) o.extId = t.extId;   // id do banco (dedup de importação)
        // Compra parcelada / parcela de empréstimo: { serie, k, n } liga as parcelas entre si (só saídas)
        const pr = t.parcela;
        if (tipo === 'saida' && pr && typeof pr === 'object' && typeof pr.serie === 'string' && pr.serie) {
            const n = Math.round(+pr.n), k = Math.round(+pr.k);
            if (n >= 2 && n <= LOAN_N_MAX && k >= 1 && k <= n) o.parcela = { serie: pr.serie, k, n };
        }
        // Juros/multa EMBUTIDOS no valor (boleto pago com atraso, parcela de empréstimo): parte do
        // valor que é juros — o lançamento continua um só, na categoria do boleto
        if (tipo === 'saida') { const j = roundMoney(parseValor(t.juros)); if (j > 0 && _valorOk(j)) o.juros = Math.min(j, o.valor); }
        out.push(o);
    });
    return out;
}
// Empréstimos: contrato (valor, taxa, parcelas) + a série de lançamentos que ele gera (loan.serie)
function _sanLoans(list) {
    const seen = new Set();
    const money = v => { const n = parseValor(v); return _valorOk(n) && n > 0 ? roundMoney(n) : 0; };
    return _asList(list).filter(l => l && typeof l === 'object').map(l => {
        let id = toId(l.id);
        if (!id || seen.has(id)) id = newId();
        seen.add(id);
        const n = Math.round(+l.n), taxa = +l.taxa;
        return { id, nome: String(l.nome ?? '').trim().slice(0, DESC_MAX) || 'Empréstimo',
                 valor: money(l.valor), taxa: Number.isFinite(taxa) && taxa > 0 ? Math.min(100, +taxa.toFixed(4)) : 0,
                 n: n >= 1 && n <= LOAN_N_MAX ? n : 1, parcela: money(l.parcela), primeira: _normDate(l.primeira) || '',
                 serie: typeof l.serie === 'string' && l.serie ? l.serie : 'E' + id, nota: String(l.nota ?? '').slice(0, CONFIG.NOTA_MAX) };
    });
}
function _sanGoals(list, report) {
    const seen = new Set();
    return _asList(list).filter(g => g && typeof g === 'object').map(g => {
        let id = toId(g.id);
        if (!id || seen.has(id)) id = newId();
        seen.add(id);
        const meta = parseValor(g.meta);
        const aportes = [];
        _asList(g.aportes).forEach(a => {
            const v = parseValor(a && a.valor), d = _normDate(a && a.data);
            if (_valorOk(v) && v > 0 && d) aportes.push({ valor: roundMoney(v), data: d, nota: String(a.nota ?? '') });
            else report.dropped.push({ aporteDe: g.nome, ...a });
        });
        return { id, nome: String(g.nome ?? '').trim().slice(0, DESC_MAX) || 'Meta', meta: _valorOk(meta) && meta > 0 ? roundMoney(meta) : 0,
                 prazo: _normDate(g.prazo) || '', descricao: String(g.descricao ?? ''), cor: safeColor(g.cor, GOAL_COLORS[0]), aportes };
    });
}
function _sanBudget(b) {
    b = b && typeof b === 'object' ? b : {};
    const nonNeg = v => { const n = parseValor(v); return Number.isFinite(n) && n >= 0 ? n : null; };
    const out = { total: nonNeg(b.total) || 0, allocs: {}, monthTotals: {}, needsWants: {}, locks: {}, off: {} };
    _asList(b.categorias).forEach(c => { if (c && c.nome && c.pct) out.allocs[c.nome] = c.pct; });  // formato antigo
    Object.entries(b.allocs || {}).forEach(([k, v]) => { const p = nonNeg(v); if (p) out.allocs[k] = Math.min(100, p); });
    Object.entries(b.monthTotals || {}).forEach(([k, v]) => { const n = nonNeg(v); if (/^\d{4}-\d{2}$/.test(k) && n !== null) out.monthTotals[k] = n; });
    Object.entries(b.needsWants || {}).forEach(([k, v]) => { if (v === 'needs' || v === 'wants') out.needsWants[k] = v; });
    Object.entries(b.locks || {}).forEach(([k, v]) => { if (v === true) out.locks[k] = true; });   // "valor fixo" na roda
    // Categoria fora do orçamento em certos meses: faixas { de: 'AAAA-MM', ate?: 'AAAA-MM' } (sem `ate` = daí em diante)
    const ym = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
    Object.entries(b.off || {}).forEach(([k, v]) => {
        const faixas = _asList(v).filter(r => r && ym(r.de) && (!r.ate || (ym(r.ate) && r.ate >= r.de)))
            .map(r => (r.ate ? { de: r.de, ate: r.ate } : { de: r.de }))
            .sort((x, y) => x.de.localeCompare(y.de) || String(x.ate || '').localeCompare(String(y.ate || '')));
        if (faixas.length) out.off[k] = faixas;
    });
    // Planejamentos por período: allocsDe['AAAA-MM'] = { cat: % } vale daquele mês em diante (até o
    // próximo); os meses antes do primeiro usam `allocs`
    out.allocsDe = {};
    Object.entries(b.allocsDe || {}).forEach(([k, v]) => {
        if (!ym(k) || !v || typeof v !== 'object') return;
        const m = {};
        Object.entries(v).forEach(([c, pv]) => { const n = nonNeg(pv); if (n) m[c] = Math.min(100, n); });
        out.allocsDe[k] = m;
    });
    return out;
}
// raw usa as chaves curtas do payload/backup: t=tx, c=cats, g=goals, k=cards, b=budget, l=loans
function sanitizeState(raw, fromVersion = SCHEMA_VERSION) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const report = { dropped: [] };
    // Novos ids precisam ficar acima de todos os existentes (inclusive de outro dispositivo)
    [raw.t, raw.g, raw.k, raw.l].forEach(l => _asList(l).forEach(x => { const id = toId(x && x.id); if (id) _bumpLastId(id); }));
    const cardsN = _sanCards(raw.k);
    const catsN  = _sanCats(raw.c);
    const txN    = _sanTx(raw.t, cardsN, fromVersion, report);
    // Invariante: toda categoria usada existe na lista do seu tipo (renomear/remover a alcançam)
    txN.forEach(t => { if (t.cat && !catsN[t.tipo].includes(t.cat)) catsN[t.tipo].push(t.cat); });
    _ligarParcelasSoltas(txN);
    return { tx: txN, cats: catsN, goals: _sanGoals(raw.g, report), cards: cardsN, budget: _sanBudget(raw.b), loans: _sanLoans(raw.l), report };
}
// Lançamentos "Nome - Parcela k/N" feitos à mão ou importados entram na mesma série das parcelas
// automáticas (remover/editar em grupo, caixa "Parcelas do mês"). Série = nome + n + cartão; só liga
// quando cada k aparece uma vez — compras diferentes com o mesmo nome ficam soltas. Idempotente.
function _ligarParcelasSoltas(lista) {
    const re = /^(.*?)\s*[-–]\s*parcela\s*(\d+)\s*\/\s*(\d+)\s*$/i, grupos = new Map();
    lista.forEach(t => {
        if (t.tipo !== 'saida') return;
        let chave, k;
        if (t.parcela) { if (!t.parcela.serie.startsWith('D:')) return; chave = t.parcela.serie; k = t.parcela.k; }
        else {
            const m = re.exec(t.desc); if (!m) return;
            const n = +m[3]; k = +m[2];
            if (!(n >= 2 && n <= LOAN_N_MAX && k >= 1 && k <= n)) return;
            chave = `D:${m[1].trim().toLowerCase()}|${n}|${t.cartaoId || ''}`;
        }
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push({ t, k });
    });
    grupos.forEach((itens, chave) => {
        if (new Set(itens.map(x => x.k)).size !== itens.length) return;
        const n = +chave.split('|')[1];
        itens.forEach(({ t, k }) => { if (!t.parcela) t.parcela = { serie: chave, k, n }; });
    });
}
// Registros irrecuperáveis (sem data/valor) não somem: vão para fin5_quarantine
function _quarantine(report) {
    if (!report || !report.dropped.length) return;
    // Deduplicado: o mesmo registro ruim vindo em várias sincronizações entra uma vez só
    const cur = loadJSON('fin5_quarantine', []);
    const seen = new Set(cur.map(x => JSON.stringify(x)));
    const novos = report.dropped.filter(x => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!novos.length) return;
    console.warn(`${novos.length} registro(s) inválido(s) movidos para fin5_quarantine`, novos);
    storeJSON('fin5_quarantine', cur.concat(novos).slice(-CONFIG.QUARENTENA_MAX));
    // Antes só havia o console.warn: para o usuário o lançamento simplesmente sumia
    if (typeof toast === 'function' && $('toast')) toast(`⚠️ ${novos.length} registro(s) sem data/valor válido separado(s) — veja em Backup.`, '#b45309');
    if (typeof renderQuarentena === 'function') renderQuarentena();
}

// Quarentena visível (seção Backup): quantos registros foram separados, o que são
// (tooltip) e como baixar/descartar. Também vai junto no backup JSON.
const _descQuarentena = x => x && x.aporteDe ? `Aporte em "${x.aporteDe}"` : String((x && (x.desc || x.descricao || x.nome)) || '(sem descrição)');
function renderQuarentena() {
    const box = $('quarentenaBox');
    if (!box) return;
    const q = loadJSON('fin5_quarantine', []);
    if (!q.length) { box.innerHTML = ''; return; }
    const lista = q.slice(-15).map(x => '• ' + _descQuarentena(x)).join('\n') + (q.length > 15 ? `\n… e mais ${q.length - 15}` : '');
    box.innerHTML = `<div style="font-size:10px;line-height:1.5;color:var(--warn);margin-top:5px" title="${escHtml(lista)}">
        ⚠️ ${q.length} registro${q.length > 1 ? 's' : ''} sem data/valor válido separado${q.length > 1 ? 's' : ''} (não entra${q.length > 1 ? 'm' : ''} nos totais).
        <button class="link-btn" data-onclick="baixarQuarentena()">baixar</button> ·
        <button class="link-btn" data-onclick="descartarQuarentena()">descartar</button></div>`;
}
function baixarQuarentena() {
    downloadBlob(new Blob([JSON.stringify(loadJSON('fin5_quarantine', []), null, 2)], { type: 'application/json' }), `quarentena_finances_${todayLocalISO()}.json`);
}
function descartarQuarentena() {
    const n = loadJSON('fin5_quarantine', []).length;
    if (!n) return;
    confirmar(`Descartar ${n} registro(s) inválido(s)? Baixe antes se quiser conferir — não dá para desfazer.`, { ok: 'Descartar', perigo: true }, () => _descartarQuarentena());
}
function _descartarQuarentena() {
    lsDel('fin5_quarantine');
    renderQuarentena();
    toast('Quarentena descartada.', '#52525b');
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let tx, cats, goals, cards, budget, loans;
function restoreState(s) { ({ tx, cats, goals, cards, budget, loans } = s); _invalidateTxCache(); }
function snapshotState() { return _clone({ tx, cats, goals, cards, budget, loans }); }
function loadLocalState() {
    let hasData = false;
    hasData = lsGet('fin5_data') != null;
    const fromVersion = loadJSON('fin5_schema', 2);
    const s = sanitizeState({
        t: loadJSON('fin5_data', (!hasData && PREVIEW_MODE) ? SEED : []),   // dados de exemplo só no modo preview
        c: loadJSON('fin5_cats', null),
        g: loadJSON('fin5_goals', []),
        k: loadJSON('fin5_cards', []),
        b: loadJSON('fin5_budget', null),
        l: loadJSON('fin5_loans', []),
    }, fromVersion);
    _quarantine(s.report);
    restoreState(s);
    return fromVersion < SCHEMA_VERSION;
}

let undoStack = [], redoStack = [];
// Ordem da tabela de lançamentos e modo "agrupar por categoria": lembrados neste aparelho
const _SORT_COLS = ['data', 'desc', 'cat', 'valor'];
let sortCol   = _SORT_COLS.includes(lsGet('fin5_sortCol')) ? lsGet('fin5_sortCol') : 'data';
let sortDir   = lsGet('fin5_sortDir') === 'asc' ? 'asc' : 'desc';
let activeTab = 'all';
let charts    = {};
let currentView = 'dashboard';
let selectedGoalColor = GOAL_COLORS[0];
let _pendingFixo = null;
let _openInlineId = null;
let groupMode = lsGet('fin5_groupMode') === 'cat' ? 'cat' : 'none'; // 'none' | 'cat'
let _dashDirty = false; // tracks if dashboard needs re-render after returning from another view

// ── HELPERS ───────────────────────────────────────────────────────────────────
const _fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt     = v => _fmtBRL.format(roundMoney(+v || 0));
// Período filtrado — NUNCA NaN: antes de init() montar os selects (ou com valor inválido)
// vale o mês atual. Com NaN, o hero quebrava e renderPatrimonio entrava em laço infinito
// ("2026-02" <= "NaN-NaN" é sempre verdadeiro) e o app travava ao abrir.
function filtro() {
    const now = new Date(), m = parseInt($('filtroMes').value, 10), a = parseInt($('filtroAno').value, 10);
    return { m: m >= 0 && m <= 11 ? m : now.getMonth(), a: a >= 1900 && a <= 9999 ? a : now.getFullYear() };
}

// Índice mês → lançamentos, construído numa única passada e reaproveitado por todas
// as telas (a visão anual fazia 12 filtros completos sobre tx). Autovalidável:
// reconstrói se tx foi reatribuído ou mudou de tamanho, mesmo sem invalidação manual.
let _txVer = 0, _txIdx = null;
const _EMPTY = Object.freeze([]);
function _invalidateTxCache() { _txVer++; }
function _txIndex() {
    if (_txIdx && _txIdx.ver === _txVer && _txIdx.src === tx && _txIdx.len === tx.length) return _txIdx;
    const byYm = new Map(), byFat = new Map();
    const add = (map, k, t) => { let arr = map.get(k); if (!arr) map.set(k, arr = []); arr.push(t); };
    tx.forEach(t => {
        add(byYm, t.data.slice(0, 7), t);
        if (t.pagamento === 'credito' && t.cartaoId && t.faturaData) add(byFat, t.faturaData.slice(0, 7), t);
    });
    return _txIdx = { ver: _txVer, src: tx, len: tx.length, byYm, byFat };
}
const txMes       = (m, a) => _txIndex().byYm.get(ymKey(m, a))  || _EMPTY;   // por data da compra
const txFaturaMes = (m, a) => _txIndex().byFat.get(ymKey(m, a)) || _EMPTY;   // por vencimento da fatura

// Toda gravação local deixa o dashboard pendente de re-render (quem está nele re-renderiza
// e limpa a marca). Antes, mudar orçamento na aba Orçamento e voltar mostrava hero e
// painel "restante" calculados com o orçamento antigo.
const _persist = (key, val) => { storeJSON(key, val); _dashDirty = true; };
function save()       { _ligarParcelasSoltas(tx); _invalidateTxCache(); _persist('fin5_data', tx); }
function saveGoals()  { _persist('fin5_goals', goals); }
function saveLoans()  { _persist('fin5_loans', loans); }
function saveCats()   { _persist('fin5_cats', cats); }
function saveCards()  { _persist('fin5_cards', cards); }
function saveBudget() { _persist('fin5_budget', budget); schedulePush(); }
function persistAll() {
    save(); saveCats(); saveGoals(); saveCards(); saveLoans(); storeJSON('fin5_budget', budget);
    storeJSON('fin5_schema', SCHEMA_VERSION);
}

// Um widget com erro não pode derrubar o resto da tela
function safeRender(fn, ...args) {
    try { return fn(...args); }
    catch (e) { console.error(`Erro ao renderizar ${fn.name || 'widget'}:`, e); }
}
function renderCurrentView() {
    if (currentView === 'anual')  safeRender(renderAnual);
    if (currentView === 'mensal') safeRender(renderMensal);
    if (currentView === 'metas')  { safeRender(renderBudget); safeRender(renderGoals); }   // renderBudget também desenha parcelas e empréstimos
}
// Re-renderiza tudo que depende do estado: KPIs/sidebar/dashboard + a view aberta.
// Antes, salvar um lançamento estando na visão Mensal/Anual deixava a tela desatualizada.
function renderAll() {
    safeRender(onTipoChange);
    safeRender(atualizar);
    renderCurrentView();
    safeRender(refreshAllCatCombos);
    safeRender(renderBackupAge);
    safeRender(renderQuarentena);
}

const commit      = () => { save(); renderAll(); schedulePush(); };
const commitGoals = () => { saveGoals(); renderGoals(); schedulePush(); };
const commitCats  = () => { saveCats(); onTipoChange(); schedulePush(); if (currentView === 'metas') renderBudget(); refreshAllCatCombos(); };
// Para operações que mexem em várias partes do estado (categorias, backup, undo, sync)
const commitAll   = () => { persistAll(); renderAll(); schedulePush(); };

if (loadLocalState()) persistAll();

// Payment badge HTML — shared across table, fixos, mobile list
const txPayBadge = t => t.tipo !== 'saida' ? '' :
    (t.pagamento === 'credito' ? '<span class="tag-cred">CRÉD</span>' : '<span class="tag-deb">DÉB</span>') + txExtraBadges(t);
// Parcela k/n e juros embutidos: aparecem em todas as listas junto do selo de pagamento
const txExtraBadges = t => (t.parcela ? `<span class="tag-parc" title="Parcela ${t.parcela.k} de ${t.parcela.n}">${t.parcela.k}/${t.parcela.n}</span>` : '')
    + (t.juros ? `<span class="tag-juros" title="Inclui ${escHtml(fmt(t.juros))} de juros/multa">juros ${escHtml(fmt(t.juros))}</span>` : '');
// Type colour + sign — shared across renders
const txCor  = t => t.tipo === 'entrada' ? 'var(--success)' : t.tipo === 'investimento' ? 'var(--invest)' : 'var(--danger)';
const catLabel = t => t.cat && t.cat.trim() ? t.cat : '(sem categoria)';
const txPre  = t => t.tipo === 'entrada' ? '+' : '−';

function toast(msg, bg = '#18181b') {
    const el = $('toast');
    el.textContent = msg; el.style.background = corLegivel(bg);   // texto branco legível em qualquer cor
    el.style.opacity = 1; el.style.transform = 'translateY(0)';
    clearTimeout(el._tid);
    el._tid = setTimeout(() => { el.style.opacity = 0; el.style.transform = 'translateY(6px)'; }, 2400);
}

// ── INIT ──────────────────────────────────────────────────────────────────────
// Configuração única do DOM/listeners. Pode ser chamada de novo (ex.: sair e entrar
// com outra conta) sem duplicar opções nem listeners — só re-renderiza.
let _initDone = false;
function init() {
    if (!_initDone) {
        _initDone = true;
        const now = new Date();
        ['filtroMes', 'mobFiltroMes'].forEach(id => {
            const sel = $(id);
            if (!sel) return;
            MESES.forEach((m, i) => sel.add(new Option(m, i, false, i === now.getMonth())));
        });
        ['filtroAno', 'mobFiltroAno'].forEach(id => {
            const sel = $(id);
            if (!sel) return;
            for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 2; y++) sel.add(new Option(y, y, false, y === now.getFullYear()));
        });
        $('data').value = todayLocalISO();
        $('aporteData').value = todayLocalISO();

        $('busca').addEventListener('input', debounce(renderTabela, 150));
        // A data decide a fatura: o aviso acompanha a data nos 3 formulários (ligado pelo
        // descritor — antes era atributo por <input> e o de edição no celular ficou sem)
        [FORM_DESKTOP, FORM_MOBILE, FORM_MOB_EDIT].forEach(F => $(F.data)?.addEventListener('input', () => formFaturaInfo(F)));
        document.addEventListener('keydown', e => {
            const k = e.key.toLowerCase(), refaz = k === 'y' || (k === 'z' && e.shiftKey);
            if (!(e.ctrlKey || e.metaKey) || (k !== 'z' && k !== 'y')) return;
            // Dentro de campos de texto o Ctrl+Z é do navegador (desfazer digitação)
            const el = e.target;
            if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
            e.preventDefault(); if (refaz) redo(); else undo();
        });
        document.addEventListener('keydown', _onGlobalKey);
        _setupModalFocus();
        safeRender(_ligarParcelas);
        safeRender(_setupA11y);   // acessibilidade nunca pode impedir o app de abrir
        // Outra aba do app salvou → recarrega o estado em vez de sobrescrever depois
        window.addEventListener('storage', e => {
            if (!e.key || !e.key.startsWith(LS_PREFIX) || !/^fin5_(data|cats|goals|cards|budget|loans)$/.test(e.key.slice(LS_PREFIX.length))) return;
            loadLocalState();
            undoStack = []; redoStack = []; _updateUndoBtn();   // snapshots antigos desfariam a mudança da outra aba
            renderAll();
        });
        if (IS_MOBILE) mobOnTipoChange();
        // Virada de dia com o app aberto: verifica a cada minuto e ao voltar para a aba
        setInterval(_checkDayChange, CONFIG.VIRADA_DIA_MS);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _checkDayChange(); });
    }
    safeRender(_marcarSort);
    renderAll();
    renderGoals();
    renderCartoesMini();
}

// ── TECLADO: Esc fecha, Enter confirma ───────────────────────────────────────
// Registro único dos modais: cada um declara como fecha (respeitando efeitos: fechar o
// "replicar fixo?" equivale a "só este mês", como o clique fora) e como confirma.
// O de conflito de sync não tem close — exige uma decisão explícita.
// ── CONFIRMAÇÃO PRÓPRIA (no lugar de confirm()) ───────────────────────────────
// perguntar(msg, opcoes, cb): mostra o modal; cb(valor) uma vez — null se cancelou (Esc, voltar, fora do
// quadro, Cancelar). opcoes = [{ label, valor, perigo? }] (a 1ª é a ação principal). O foco inicial fica em
// Cancelar (Enter sem querer não destrói nada); Enter num botão ativa o botão focado.
// A mensagem entra por textContent (nomes de lançamentos são texto do usuário).
// Quando um teste troca window.confirm (fuzz), responde na hora e de forma síncrona: true → 1ª opção,
// false → 2ª opção (ou null se só houver uma) — a mesma semântica dos confirm() antigos.
const _confirmNativo = window.confirm;
let _confCb = null, _confOpcoes = [];
function perguntar(msg, opcoes, cb, { titulo = 'Confirmar' } = {}) {
    if (window.confirm !== _confirmNativo) { cb(window.confirm(msg) ? opcoes[0].valor : (opcoes[1] ? opcoes[1].valor : null)); return; }
    if (_confCb) _confirmarFechar(null);        // pergunta anterior ainda aberta: conta como cancelada
    _confCb = cb; _confOpcoes = opcoes;
    $('confTitulo').textContent = titulo;
    $('confMsg').textContent = msg;
    const box = $('confBotoes'); box.textContent = '';
    const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = fn; box.appendChild(b); return b; };
    mk('Cancelar', 'btn-mcancel', () => _confirmarFechar(null));
    opcoes.forEach((o, i) => { const b = mk(o.label, 'btn-confirm', () => _confirmarFechar(o.valor)); if (o.perigo) b.style.background = 'var(--danger)'; });
    $('ovConfirmar').classList.add('open');
}
function _confirmarFechar(valor) {
    const cb = _confCb; _confCb = null;
    $('ovConfirmar').classList.remove('open');
    if (cb) cb(valor);
}
const _confirmarPrimaria = () => _confOpcoes.length && _confirmarFechar(_confOpcoes[0].valor);
// Atalhos: confirmar (sim/não), com callback ou em Promise
function confirmar(msg, { ok = 'OK', perigo = false, titulo } = {}, cb) { perguntar(msg, [{ label: ok, valor: true, perigo }], v => { if (v) cb(); }, { titulo }); }
const confirmarP = (msg, opts) => new Promise(res => perguntar(msg, [{ label: (opts && opts.ok) || 'OK', valor: true, perigo: !!(opts && opts.perigo) }], v => res(!!v), { titulo: opts && opts.titulo }));

const MODALS = {
    ovFixos:        { close: () => closeFixos() },
    ovAplicarMeses: { close: () => $('ovAplicarMeses').classList.remove('open'), submit: () => confirmarAplicarMeses() },
    ovRecalcFatura: { close: () => closeRecalcFatura() },
    ovCatDelete:    { close: () => closeCatDelete(), submit: () => confirmCatDelete() },
    ovParcRemover:  { close: () => closeParcRemover(), submit: () => confirmarRemoverParcela() },
    ovLoan:         { close: () => closeLoan(), submit: () => salvarLoan() },
    ovEditFixo:     { close: () => closeEditFixo(), submit: () => confirmarEdicaoFixo() },
    ovNovaGoal:     { close: () => closeNovaGoal(), submit: () => salvarGoal() },
    ovAporte:       { close: () => closeAporte(), submit: () => confirmarAporte() },
    ovFixoRep:      { close: () => closeFixoRep('nao') },
    ovConflict:     {},
    ovBackups:      { close: () => closeBackups() },
    ovConfirmar:    { close: () => _confirmarFechar(null), submit: () => _confirmarPrimaria() },
    ovCartoes:      { close: () => closeCartoes(), submit: () => salvarCartao() },
    ovExtrato:      { close: () => closeExtrato() },
    mobFormSheet:   { close: () => closeMobForm(), submit: () => mobAdicionar() },
    mobEditSheet:   { close: () => closeMobEdit(), submit: () => mobEditSave() },
};
// Modal aberto mais ao topo (o último no DOM é desenhado por cima)
function _topModal() {
    const open = Object.keys(MODALS).map(id => $(id)).filter(el => el && el.classList.contains('open'));
    return open.length ? open.sort((x, y) => x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1).pop() : null;
}
function _onGlobalKey(e) {
    if (e.defaultPrevented || e.isComposing) return;   // combobox etc. já trataram a tecla
    const el = e.target;
    const inField = el && el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file)$/.test(el.type);
    const modal = _topModal();
    if (e.key === 'Escape') {
        if (_closeIconPicker(true)) { e.preventDefault(); return; }   // seletor aberto fecha primeiro
        if (modal) { const m = MODALS[modal.id]; if (m.close) { e.preventDefault(); m.close(); } return; }
        if (_openInlineId) { e.preventDefault(); closeInlineEdit(); }
        return;
    }
    if (e.key !== 'Enter' || !inField) return;
    if (modal) {
        if (modal.contains(el) && MODALS[modal.id].submit) { e.preventDefault(); MODALS[modal.id].submit(); }
        return;
    }
    const ie = el.id.match(/^ie-(?:desc|valor|data)-(\d+)$/);
    if (ie) { e.preventDefault(); saveInlineEdit(+ie[1]); return; }
    if (['desc', 'valor', 'data'].includes(el.id)) { e.preventDefault(); adicionar(); }
}

// ── ACESSIBILIDADE ──────────────────────────────────────────────────────────────
// Uma rotina para o DOM inicial e para tudo que é renderizado depois (MutationObserver).
// Auditoria antes: 47 de 53 campos sem nome acessível (<label> sem "for"), 17 botões só
// com ícone sem nome e 23 clicáveis fora do alcance do teclado (ex.: "Exportar" backup,
// cabeçalhos ordenáveis, "Nova Meta", importar arquivo).
const _A11Y_NATIVO = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|OPTION|TR|TD)$/;
const _A11Y_GLIFOS = { '✕': 'Fechar', '×': 'Fechar', '◀': 'Anterior', '▶': 'Próximo', '‹': 'Anterior', '›': 'Próximo',
                       '🗑': 'Excluir', '✏': 'Editar', '＋': 'Adicionar', '+': 'Adicionar', '✓': 'Confirmar', '↩': 'Desfazer' };
const _textoVisivel = el =>(el.textContent || '').replace(/[\p{Extended_Pictographic}️‍\s✓✕▼›⌄«»＋+↑↓⇪↩←→·•×↕]/gu, '');
function _a11y(root) {
    if (!root || !root.querySelectorAll) return;
    const todos = sel => [...(root.matches && root.matches(sel) ? [root] : []), ...root.querySelectorAll(sel)];
    // 1) rótulo do bloco → campo
    todos('.field, .ie-field').forEach(f => {
        const l = f.querySelector(':scope > label'), c = f.querySelector('input:not([type=hidden]), select, textarea');
        if (!l || !c || l.htmlFor || l.contains(c)) return;
        if (c.id) l.htmlFor = c.id; else if (!c.hasAttribute('aria-label')) c.setAttribute('aria-label', l.textContent.trim());
    });
    // 2) campo ainda sem nome: title/placeholder
    todos('input:not([type=hidden]), select, textarea').forEach(c => {
        if ((c.labels && c.labels.length) || c.hasAttribute('aria-label') || c.hasAttribute('aria-labelledby')) return;
        const n = c.getAttribute('title') || c.getAttribute('placeholder');
        if (n) c.setAttribute('aria-label', n);
    });
    // 3) botão só com ícone: title vira nome; sem title, o significado do glifo
    todos('button').forEach(b => {
        if (b.hasAttribute('aria-label') || _textoVisivel(b)) return;
        const n = b.title || _A11Y_GLIFOS[(b.textContent || '').replace(/[\s️]/g, '')];
        if (n) b.setAttribute('aria-label', n);
    });
    // 4) clicáveis que não são controles: Tab + Enter/Espaço (fundos de modal ficam de fora — Esc fecha)
    // (sem :has() — navegadores mais antigos lançariam SyntaxError e derrubariam o init)
    todos('[data-onclick], label').forEach(el => {
        if (el.tagName === 'LABEL' && !el.querySelector(':scope > input[type=file][hidden]')) return;
        if (_A11Y_NATIVO.test(el.tagName) || /(^|\s)(overlay|[\w-]*backdrop)(\s|$)/.test(el.className)) return;
        // fundo de modal (fecha ao clicar fora) e containers que só barram o clique (painel de
        // detalhe do orçamento: event.stopPropagation()) não são botões
        const oc = el.getAttribute('data-onclick') || '';
        if (/event\.target\s*===\s*this/.test(oc) || /^\s*event\.stopPropagation\(\)\s*;?\s*$/.test(oc)) return;
        el.dataset.a11yAtivar = '1';
        if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
        if (el.tagName !== 'TH' && !el.hasAttribute('role')) el.setAttribute('role', 'button');
        if (!el.hasAttribute('aria-label') && !_textoVisivel(el) && el.title) el.setAttribute('aria-label', el.title);
    });
}
function _setupA11y() {
    _a11y(document.body);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) _a11y(n); })))
        .observe(document.body, { childList: true, subtree: true });
    // Enter/Espaço ativam os clicáveis marcados (como um <button> faria)
    document.addEventListener('keydown', e => {
        const el = e.target;
        if ((e.key === 'Enter' || e.key === ' ') && el && el.dataset && el.dataset.a11yAtivar && !e.repeat) { e.preventDefault(); el.click(); }
    });
}

// Foco dos modais sem tocar em cada função de abrir: observa a classe "open" dos modais
// do registro. Ao abrir, foca o 1º campo (Enter/Esc funcionam sem precisar clicar);
// ao fechar, devolve o foco a quem abriu. No celular não foca campo (abriria o teclado
// só para visualizar). Overlays viram role="dialog" para leitores de tela.
//
// Botão "voltar" (celular/navegador): cada modal aberto empilha uma entrada no histórico;
// voltar fecha o modal do topo em vez de sair do app (e perder o que estava digitado).
// Fechar pela interface consome a entrada. O conflito de sync (sem close) não fecha.
const _modalReturnFocus = new Map();
let _ignorePop = 0;
function _setupModalFocus() {
    if (history.state && history.state.finModal) history.replaceState(null, '');   // sobra de um reload com modal aberto
    window.addEventListener('popstate', () => {
        if (_ignorePop > 0) { _ignorePop--; return; }
        const top = _topModal();
        if (!top) {      // voltar/avançar entre telas
            const v = (history.state && history.state.finView) || _viewDoHash();
            if (v && v !== currentView && $('view-' + v)) navTo(v, null, { hist: 'none' });
            return;
        }
        const m = MODALS[top.id];
        if (m.close) m.close();
        else history.pushState({ finModal: top.id }, '');   // exige decisão: mantém aberto
    });
    Object.keys(MODALS).forEach(id => {
        const el = $(id);
        if (!el) return;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        new MutationObserver(() => {
            const open = el.classList.contains('open');
            if (open && !_modalReturnFocus.has(id)) {
                history.pushState({ finModal: id }, '');
                _modalReturnFocus.set(id, document.activeElement);
                if (IS_MOBILE) return;
                setTimeout(() => {   // após a função de abrir terminar (e não rAF: pausa em aba oculta)
                    if (el.contains(document.activeElement)) return;   // a própria função já focou algo
                    const f = el.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=file]):not([disabled]), select:not([disabled]), textarea')
                           || el.querySelector('button:not([disabled])');
                    if (f && f.offsetParent !== null) f.focus({ preventScroll: true });
                });
            } else if (!open && _modalReturnFocus.has(id)) {
                // Fechado pela interface: remove a entrada que ele empilhou
                if (history.state && history.state.finModal === id) { _ignorePop++; history.back(); }
                const prev = _modalReturnFocus.get(id);
                _modalReturnFocus.delete(id);
                if (prev && prev.isConnected && prev !== document.body && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
            }
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
}

// ── VIRADA DE DIA ─────────────────────────────────────────────────────────────
// Tudo que depende de "hoje" (hero/ritmo, vencimentos, data sugerida nos formulários)
// ficava congelado se o app passasse a meia-noite aberto.
let _today = todayLocalISO();
function _checkDayChange() {
    const now = todayLocalISO();
    if (now === _today) return;
    const prev = _today;
    _today = now;
    // Só troca a data sugerida se o usuário não escolheu outra
    ['data', 'mob-data', 'aporteData'].forEach(id => { const el = $(id); if (el && (!el.value || el.value === prev)) el.value = now; });
    renderAll();
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
// ── NAVEGAÇÃO ENTRE TELAS (com URL: #dashboard #anual #mensal #metas) ──────────
// Recarregar mantém a tela; o botão voltar do celular/navegador volta para a tela anterior. Os modais
// continuam empilhando a própria entrada (sem mudar a URL) e voltar ainda fecha o modal primeiro.
const VIEWS = ['dashboard', 'anual', 'mensal', 'metas'];
const _viewDoHash = () => { const v = (location.hash || '').slice(1); return VIEWS.includes(v) ? v : null; };
function _marcarAbaAtiva(view) {
    document.querySelectorAll('.nav-pill').forEach(el => el.classList.toggle('active', (el.getAttribute('data-onclick') || '').includes(`'${view}'`)));
    document.querySelectorAll('.mob-nav-tab:not(.mob-add-tab)').forEach(t => t.classList.toggle('active', t.id === 'mob-tab-' + view));
    const label = $('mobViewLabel'); if (label) label.textContent = MOB_VIEW_LABELS[view] || '';
    const bar = $('mobMonthBar'); if (bar) bar.style.display = (view === 'anual' || view === 'metas') ? 'none' : 'flex';
}
// hist: 'push' (padrão: nova entrada no histórico), 'replace' (boot), 'none' (veio do botão voltar)
function _historicoDaView(view, hist) {
    if (hist === 'none') return;
    const st = { ...(history.state || {}), finView: view };
    const modalAberto = typeof _topModal === 'function' && _topModal();
    try {
        if (hist === 'replace' || modalAberto || _viewDoHash() === view) history.replaceState(st, '', '#' + view);
        else history.pushState(st, '', '#' + view);
    } catch (e) {}
}
function navTo(view, btn, { hist = 'push' } = {}) {
    if (!VIEWS.includes(view)) view = 'dashboard';
    currentView = view;
    _marcarAbaAtiva(view);
    _historicoDaView(view, hist);

    const isDash = view === 'dashboard';
    $('view-dashboard').style.display = isDash ? (IS_MOBILE ? 'flex' : 'grid') : 'none';
    ['anual','mensal','metas'].forEach(v => $('view-' + v).classList.toggle('active', v === view));

    const hideMes = view === 'anual' || view === 'metas';
    const navBar = $('monthNavBar');
    if (navBar) navBar.style.display = hideMes ? 'none' : '';
    const yearNav = $('yearNavBar');
    if (yearNav) yearNav.style.display = hideMes ? 'none' : '';

    if (view === 'dashboard' && _dashDirty) { _dashDirty = false; safeRender(atualizar); }
    renderCurrentView();
}

// ── FILTRO MÊS/ANO ────────────────────────────────────────────────────────────
// Único ponto que altera o período: mantém selects desktop e mobile em sincronia,
// cria a opção de ano quando falta (antes o select mobile ficava em branco ao
// navegar para um ano fora da lista) e re-renderiza uma única vez.
function _ensureYearOption(sel, a) {
    if (!sel || [...sel.options].some(o => +o.value === a)) return;
    const next = [...sel.options].find(o => +o.value > a);
    sel.add(new Option(a, a), next || null);
}
function setFiltro(m, a, { render = true } = {}) {
    m = parseInt(m, 10); a = parseInt(a, 10);
    if (!Number.isFinite(m) || !Number.isFinite(a)) return;
    a += Math.floor(m / 12); m = ((m % 12) + 12) % 12;       // aceita m = -1 / 12
    [['filtroMes', 'filtroAno'], ['mobFiltroMes', 'mobFiltroAno']].forEach(([ms, as]) => {
        const selM = $(ms), selA = $(as);
        if (!selM || !selA) return;
        _ensureYearOption(selA, a);
        selM.value = m; selA.value = a;
    });
    if (render) { safeRender(atualizar); renderCurrentView(); }
}
function onFiltroChange() { setFiltro($('filtroMes').value, $('filtroAno').value); }

function goToMensal(m, a) {
    // Selects mudados via JS não disparam onchange — setFiltro atualiza KPIs, label
    // do topo e marca o dashboard como sujo (senão ele volta mostrando o mês antigo)
    setFiltro(m, a, { render: false });
    safeRender(atualizar);
    navTo('mensal');      // marca as abas (desktop e celular) e o histórico
}

// ── UNDO ──────────────────────────────────────────────────────────────────────
// Snapshot do estado inteiro (lançamentos, categorias, metas, cartões, orçamento):
// antes só `tx` era salvo, então desfazer uma remoção de categoria/meta/cartão
// ou uma importação de backup não restaurava nada além dos lançamentos.
// grupo: edições seguidas do MESMO campo (cada tecla do total do orçamento, ajustes de uma
// alocação) viram UM passo, com o estado de antes da primeira — sem isso, um passo por
// tecla esgotaria as 30 posições da pilha. Janela de 10 s renovada a cada edição.
const UNDO_GRUPO_MS = CONFIG.UNDO_GRUPO_MS;
function pushUndo(label, grupo = null) {
    const top = undoStack[undoStack.length - 1], agora = Date.now();
    if (grupo && top && top.grupo === grupo && agora - top.at < UNDO_GRUPO_MS) { top.at = agora; return; }
    redoStack = [];   // uma ação nova encerra o "refazer"
    undoStack.push({ snap: snapshotState(), label, grupo, at: agora });
    if (undoStack.length > CONFIG.UNDO_MAX) undoStack.shift();
    _updateUndoBtn();
}
function _updateUndoBtn() {
    const b = $('btnUndo');
    if (!b) return;
    b.disabled = !undoStack.length;
    b.title = undoStack.length ? `Desfazer: ${undoStack[undoStack.length - 1].label}` : 'Nada para desfazer';
    const r = $('btnRedo');
    if (r) { r.disabled = !redoStack.length; r.title = redoStack.length ? `Refazer: ${redoStack[redoStack.length - 1].label}` : 'Nada para refazer'; }
}
function undo() {
    if (!undoStack.length) return;
    const { snap, label } = undoStack.pop();
    redoStack.push({ snap: snapshotState(), label });   // estado de agora, para poder refazer
    restoreState(snap);
    commitAll();
    renderGoals(); renderCartoesMini();
    toast(`↩ Desfeito: ${label}`, '#6d28d9');
    _updateUndoBtn();
}
function redo() {
    if (!redoStack.length) return;
    const { snap, label } = redoStack.pop();
    undoStack.push({ snap: snapshotState(), label, grupo: null, at: 0 });
    restoreState(snap);
    commitAll();
    renderGoals(); renderCartoesMini();
    toast(`↪ Refeito: ${label}`, '#6d28d9');
    _updateUndoBtn();
}

// ── SORTING ───────────────────────────────────────────────────────────────────
function sortBy(col) {
    sortDir = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : (col === 'valor' ? 'desc' : 'asc');
    sortCol = col;
    lsSet('fin5_sortCol', sortCol); lsSet('fin5_sortDir', sortDir);
    _marcarSort();
    renderTabela();
}
// Setas dos cabeçalhos, botão e seletor do agrupamento conforme a escolha guardada
function _marcarSort() {
    _SORT_COLS.forEach(c => {
        const th = $('si-' + c).closest('th');
        $('si-' + c).textContent = '↕';
        th.classList.remove('sort-asc', 'sort-desc');
    });
    _SORT_COLS.forEach(c => $('si-' + c).closest('th').setAttribute('aria-sort', c === sortCol ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'));
    const si = $('si-' + sortCol);
    si.textContent = sortDir === 'asc' ? '↑' : '↓';
    si.closest('th').classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    const btn = $('btnGroupCat'), ord = $('groupSort');
    if (btn) btn.classList.toggle('active', groupMode === 'cat');
    if (ord) { ord.value = _groupSort; ord.style.display = groupMode === 'cat' ? '' : 'none'; }
}

function sorted(list) {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
        let va, vb;
        if (sortCol === 'data')  { va = a.data;            vb = b.data; }
        // Texto: collator pt-BR (acentos/maiúsculas não bagunçam a ordem)
        if (sortCol === 'desc')  return dir * cmpText(a.desc, b.desc);
        if (sortCol === 'cat')   return dir * cmpText(catLabel(a), catLabel(b));
        if (sortCol === 'valor') { va = a.valor;           vb = b.valor; }
        return va < vb ? -dir : va > vb ? dir : 0;
    });
}

// Lista da tabela (desktop) e do mobile: aba + busca, já ordenada — antes eram duas
// cópias. A busca ignora acentos/maiúsculas ("farmacia" acha "Farmácia") e procura
// em descrição, categoria, nome do cartão e valor ("44,90").
function txFiltrados(m, a) {
    const match = buscaPredicate();
    return sorted(txMes(m, a).filter(t => (activeTab === 'all' || t.tipo === activeTab) && match(t)));
}
// Critério da busca atual — reaproveitado pela lista e pelos cards de fatura (mobile)
function buscaPredicate() {
    const q = fold($('busca').value.trim());
    if (!q) return () => true;
    const cardName = new Map(cards.map(c => [c.id, fold(c.nome)]));
    return t => fold(t.desc).includes(q) || fold(catLabel(t)).includes(q)
        || (t.cartaoId && (cardName.get(t.cartaoId) || '').includes(q))
        || fmtValorInput(t.valor).includes(q);
}

// ── TABS ──────────────────────────────────────────────────────────────────────
function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    const map = { all: 'tab-all', entrada: 'tab-entrada', saida: 'tab-saida', investimento: 'tab-invest' };
    $(map[tab]).classList.add('active');
    renderTabela();
}

// ── TIPO / PAGAMENTO ──────────────────────────────────────────────────────────
// ── LANÇAMENTOS: fluxo único de salvar ───────────────────────────────────────
// Todos os formulários (sidebar, mobile, edição mobile, edição inline) passam por
// readTxForm → submitTx → makeTx. Antes eram 4 cópias com regras divergentes
// (cartaoId salvo como string, validação diferente, fatura recalculada ou não).
// pagField/cartaoField/faturaInfo: blocos que formTipoChange/formPagChange mostram e ocultam
const FORM_DESKTOP  = { desc: 'desc', valor: 'valor', data: 'data', tipo: 'tipo', cat: 'categoria', fixo: 'fixo', pag: 'pagamento', cartao: 'cartao',
                        pagField: 'pagamentoField', cartaoField: 'cartaoField', faturaInfo: 'faturaInfo',
                        parc: 'parcelas', parcModo: 'parcelasModo', parcInfo: 'parcelasInfo', juros: 'juros', maisField: 'maisField' };
const FORM_MOBILE   = { desc: 'mob-desc', valor: 'mob-valor', data: 'mob-data', tipo: 'mob-tipo', cat: 'mob-categoria', fixo: 'mob-fixo', pag: 'mob-pagamento', cartao: 'mob-cartao',
                        pagField: 'mobPagamentoField', cartaoField: 'mobCartaoField', faturaInfo: 'mobFaturaInfo',
                        parc: 'mob-parcelas', parcModo: 'mob-parcelasModo', parcInfo: 'mob-parcelasInfo', juros: 'mob-juros', maisField: 'mobMaisField' };
const FORM_MOB_EDIT = { desc: 'mob-edit-desc', valor: 'mob-edit-valor', data: 'mob-edit-data', tipo: 'mob-edit-tipo', cat: 'mob-edit-cat', fixo: 'mob-edit-fixo', pag: 'mob-edit-pag', cartao: 'mob-edit-cartao',
                        pagField: 'mobEditPagField', cartaoField: 'mobEditCartaoField', faturaInfo: 'mobEditFaturaInfo',
                        juros: 'mob-edit-juros', prox: 'mob-edit-prox', maisField: 'mobEditMaisField' };
const formInline = id => ({ desc: 'ie-desc-' + id, valor: 'ie-valor-' + id, data: 'ie-data-' + id, tipo: 'ie-tipo-' + id, cat: 'ie-cat-' + id, fixo: 'ie-fixo-' + id, pag: 'ie-pag-' + id, cartao: 'ie-cartao-' + id,
                            pagField: 'ie-pag-wrap-' + id, cartaoField: 'ie-cartao-wrap-' + id,
                            juros: 'ie-juros-' + id, prox: 'ie-prox-' + id, maisField: 'ie-mais-' + id });   // sem aviso de fatura

const fmtValorInput = v => v.toFixed(2).replace('.', ',');

function readTxForm(f) {
    const tipo = $(f.tipo).value;
    // Formulários só mostram pagamento para saídas: para outros tipos fica `undefined`
    // ("não informado") e makeTx herda o da versão anterior — editar um estorno de
    // cartão (entrada no crédito) não pode desvinculá-lo da fatura.
    const pagamento = tipo === 'saida' ? (($(f.pag) && $(f.pag).value) || 'debito') : undefined;
    return {
        desc: $(f.desc).value.trim(),
        valor: parseValor($(f.valor).value),
        data: $(f.data).value,
        tipo,
        cat: ($(f.cat) ? $(f.cat).value : '').trim(),
        fixo: !!($(f.fixo) && $(f.fixo).checked),
        pagamento,
        cartaoId: pagamento === 'credito' ? toId($(f.cartao) && $(f.cartao).value) : null,
        // Juros/multa embutidos (parte do valor); `undefined` = formulário sem o campo (mantém o que já havia)
        juros: tipo === 'saida' && f.juros && $(f.juros) ? (($(f.juros).value || '').trim() ? parseValor($(f.juros).value) : 0) : undefined,
        // Parcelas só existem em lançamento novo (formulários com o campo); modo: o valor é o total ou o de cada parcela
        parcelas: f.parc && $(f.parc) && tipo === 'saida' ? (Math.round(+$(f.parc).value) || 1) : 1,
        parcModo: f.parcModo && $(f.parcModo) ? $(f.parcModo).value : 'total',
        prox: !!(f.prox && $(f.prox) && $(f.prox).checked),   // edição: aplicar também às parcelas seguintes
    };
}

function validateTx(f) {
    const warn = msg => { toast('⚠️ ' + msg, '#b45309'); return false; };
    if (!f.desc)                                   return warn('Digite uma descrição.');
    if (!Number.isFinite(f.valor) || f.valor <= 0) return warn('Valor inválido.');
    if (!_valorOk(f.valor))                        return warn('Valor acima do limite (R$ 100 bilhões).');
    if (f.desc.length > DESC_MAX)                  return warn(`Descrição longa demais (máx. ${DESC_MAX} caracteres).`);
    if ((f.cat || '').length > CAT_MAX)            return warn(`Nome de categoria longo demais (máx. ${CAT_MAX} caracteres).`);
    if (!isValidISODate(f.data))                   return warn('Selecione uma data válida.');
    if (!TIPOS.includes(f.tipo))                   return warn('Tipo inválido.');
    if (f.juros !== undefined && (!Number.isFinite(f.juros) || f.juros < 0)) return warn('Juros inválidos.');
    if (f.juros > f.valor)                         return warn('Os juros não podem passar do valor total.');
    if (f.parcelas > 1) {
        if (f.tipo !== 'saida')                    return warn('Parcelas só valem para gastos.');
        if (f.fixo)                                return warn('Gasto fixo e parcelado não combinam: desmarque um dos dois.');
        if (f.parcelas > PARCELAS_MAX)             return warn(`No máximo ${PARCELAS_MAX} parcelas.`);
    }
    return true;
}

// Monta o objeto normalizado. `base` = versão anterior (edição): preserva id/série e
// a fatura já calculada quando data e cartão não mudaram (ex.: fatura passada mantida
// de propósito após mudar o fechamento do cartão).
function makeTx(f, base = null) {
    let { pagamento, cartaoId } = f;
    if (pagamento === undefined) {
        const herda = base && base.tipo === f.tipo && base.pagamento === 'credito';
        pagamento = herda ? 'credito' : null;
        cartaoId  = herda ? base.cartaoId : null;
    }
    const t = {
        ...(base || {}),
        id: base ? base.id : newId(),
        desc: f.desc, valor: roundMoney(f.valor), data: f.data, tipo: f.tipo, cat: f.cat || '',
        fixo: !!f.fixo, pagamento, cartaoId: cartaoId || null,
    };
    // Juros embutidos: informado no formulário → vale; sem campo (undefined) → herda o da versão anterior
    if (f.juros !== undefined) { if (f.juros > 0 && f.tipo === 'saida') t.juros = roundMoney(f.juros); else delete t.juros; }
    const keepFatura = base && base.faturaData && base.data === t.data && base.cartaoId === t.cartaoId;
    t.faturaData = (t.pagamento === 'credito' && t.cartaoId)
        ? (keepFatura ? base.faturaData : calcFaturaData(t.cartaoId, t.data))
        : null;
    if (!t.fixo) delete t.serie;
    else if (!t.serie) t.serie = 'S' + newId();
    // Fonte única de verdade: o objeto criado pela UI passa pela MESMA normalização dos
    // dados externos (_sanTx). Antes eram duas regras paralelas que divergiam — ex.:
    // investimento importado de fatura ficava com cartaoId sem pagamento no crédito.
    const norm = _sanTx([t], cards, SCHEMA_VERSION, { dropped: [] })[0];
    if (!norm) throw new Error('Lançamento inválido após normalização: ' + JSON.stringify(t));
    if (t.extId) norm.extId = t.extId;
    return norm;
}

// Garante que a categoria existe na lista do tipo (texto livre da combobox vira categoria real)
function ensureCat(tipo, cat) {
    if (!cat || !TIPOS.includes(tipo)) return false;
    if (!cats[tipo]) cats[tipo] = [];
    if (cats[tipo].includes(cat)) return false;
    cats[tipo].push(cat);
    return true;
}

// editId = null para novo. onDone roda quando os dados foram aceitos (fecha/limpa o form).
function submitTx(f, editId = null, onDone = null) {
    if (!validateTx(f)) return false;
    const old = editId != null ? tx.find(t => t.id === editId) : null;
    if (editId != null && !old) { toast('⚠️ Lançamento não encontrado (removido em outro dispositivo?).', '#b45309'); return false; }
    if (!old && f.parcelas > 1) return _submitParcelado(f, onDone);
    pushUndo(old ? `Edição de "${f.desc}"` : `Adição de "${f.desc}"`);
    if (ensureCat(f.tipo, f.cat)) saveCats();
    if (f.pagamento === 'credito' && f.cartaoId) lsSet('fin5_lastCard', String(f.cartaoId));   // inclui fixos (desviam p/ o modal)
    if (onDone) onDone();
    if (f.fixo && !(old && old.fixo)) {
        // Virou fixo agora → pergunta se replica; a gravação acontece em closeFixoRep
        _pendingFixo = { f, editId: old ? old.id : null };
        $('fixoRepMsg').textContent = old
            ? `"${f.desc}" foi marcado como fixo. Replicar para os próximos 12 meses?`
            : `Replicar "${f.desc}" como gasto fixo para os próximos 12 meses?`;
        $('ovFixoRep').classList.add('open');
        return true;
    }
    const t = makeTx(f, old);
    tx = old ? tx.map(x => x.id === old.id ? t : x) : tx.concat(t);
    const prox = old && old.parcela && f.prox;
    if (prox) tx = _propagarParcelas(tx, old, t);
    commit();
    toast(prox ? '✓ Atualizado, inclusive as parcelas seguintes!' : old ? '✓ Atualizado!' : '✓ Salvo!');
    return true;
}

// ── PARCELAS: a compra parcelada é gerada automaticamente ─────────────────────
// Um lançamento por parcela ("Nome - Parcela k/N", mesmo padrão dos extratos), no mesmo dia dos
// meses seguintes e com a fatura certa de cada uma. `parcela: { serie, k, n }` liga as parcelas:
// remover/editar vale para a série. Divisão em centavos exatos (o resto vai para as primeiras).
function parcelasDividir(total, n) {
    const c = Math.round(total * 100), base = Math.floor(c / n), resto = c - base * n;
    return Array.from({ length: n }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
}
const _sufixoParcela = (k, n) => ` - Parcela ${k}/${n}`;
const _descSemParcela = d => String(d || '').replace(/\s*[-–]?\s*parcela\s*\d+\s*\/\s*\d+\s*$/i, '').trim();
// Lista de lançamentos (já normalizados, ainda não gravados) de uma compra em n parcelas
function gerarParcelas(f, n, modo = 'total', prefixoSerie = 'P') {
    const porParcela = modo === 'parcela';
    const valores = porParcela ? Array(n).fill(roundMoney(f.valor)) : parcelasDividir(f.valor, n);
    const jur = f.juros > 0 ? (porParcela ? Array(n).fill(roundMoney(f.juros)) : parcelasDividir(f.juros, n)) : Array(n).fill(0);
    const serie = prefixoSerie + newId(), base = _descSemParcela(f.desc) || f.desc;
    return valores.map((valor, i) => {
        const suf = _sufixoParcela(i + 1, n);
        const t = makeTx({ ...f, fixo: false, desc: base.slice(0, DESC_MAX - suf.length) + suf, valor, juros: Math.min(jur[i], valor), data: addMonthsISO(f.data, i) });
        t.parcela = { serie, k: i + 1, n };
        return t;
    });
}
function _submitParcelado(f, onDone) {
    const n = f.parcelas, lista = gerarParcelas(f, n, f.parcModo);
    pushUndo(`Adição de "${f.desc}" em ${n} parcelas`);
    if (ensureCat(f.tipo, f.cat)) saveCats();
    if (f.pagamento === 'credito' && f.cartaoId) lsSet('fin5_lastCard', String(f.cartaoId));
    if (onDone) onDone();
    tx = tx.concat(lista);
    commit();
    const mes = t => `${MES_ABREV[+t.data.slice(5, 7) - 1]}/${t.data.slice(2, 4)}`, v0 = lista[0].valor;
    toast(`✓ ${n} parcelas lançadas${lista.every(t => t.valor === v0) ? ` (${n}× de ${fmt(v0)})` : ''} · ${mes(lista[0])} → ${mes(lista[n - 1])}`);
    return true;
}
// Edição de uma parcela aplicada às seguintes da mesma série: valor, categoria, pagamento/cartão e nome
function _propagarParcelas(lista, antes, depois) {
    const base = _descSemParcela(depois.desc) || depois.desc;
    return lista.map(x => {
        if (!x.parcela || x.parcela.serie !== antes.parcela.serie || x.parcela.k <= antes.parcela.k) return x;
        const suf = _sufixoParcela(x.parcela.k, x.parcela.n);
        return makeTx({ desc: base.slice(0, DESC_MAX - suf.length) + suf, valor: depois.valor, data: x.data, tipo: depois.tipo, cat: depois.cat, fixo: false,
                        pagamento: depois.pagamento, cartaoId: depois.cartaoId, juros: depois.juros || 0 }, x);
    });
}
// Parcelas da mesma série, em ordem
const parcelasDaSerie = serie => tx.filter(t => t.parcela && t.parcela.serie === serie).sort((x, y) => x.parcela.k - y.parcela.k);

// Remover uma parcela pergunta o escopo: só esta, esta e as seguintes, ou a série toda
let _parcRemPend = null;   // { id, serie }
function _abrirRemoverParcela(t) {
    const serie = parcelasDaSerie(t.parcela.serie), { k, n } = t.parcela;
    const apos = serie.filter(x => x.parcela.k >= k), soma = l => fmt(l.reduce((s, x) => s + x.valor, 0));
    _parcRemPend = { id: t.id, serie: t.parcela.serie };
    $('parcRemSub').textContent = `"${_descSemParcela(t.desc) || t.desc}" — parcela ${k} de ${n}`;
    $('parcRemLblEsta').textContent = `Só a parcela ${k}/${n}`;
    $('parcRemRowProx').style.display = apos.length > 1 ? '' : 'none';
    $('parcRemLblProx').textContent = `Esta e as seguintes (${k} a ${apos[apos.length - 1].parcela.k})`;
    $('parcRemNotaProx').textContent = `${apos.length} parcelas, ${soma(apos)}.`;
    $('parcRemLblTodas').textContent = `Todas as ${serie.length} parcelas`;
    $('parcRemNotaTodas').textContent = `${soma(serie)}${serie.length > apos.length ? ', inclusive as anteriores' : ''}.`;
    document.querySelector('input[name="parcRemEscopo"][value="esta"]').checked = true;
    $('ovParcRemover').classList.add('open');
}
function closeParcRemover() { $('ovParcRemover').classList.remove('open'); _parcRemPend = null; }
function confirmarRemoverParcela() {
    const p = _parcRemPend, t = p && tx.find(x => x.id === p.id);
    if (!t) { closeParcRemover(); return; }
    const esc = (document.querySelector('input[name="parcRemEscopo"]:checked') || {}).value || 'esta', k = t.parcela.k;
    const sai = x => x.parcela && x.parcela.serie === p.serie && (esc === 'todas' || (esc === 'proximas' ? x.parcela.k >= k : x.id === p.id));
    const n = tx.filter(sai).length;
    pushUndo(`Remoção de ${n} parcela${n !== 1 ? 's' : ''} de "${_descSemParcela(t.desc) || t.desc}"`);
    tx = tx.filter(x => !sai(x));
    if (_openInlineId != null && !tx.some(x => x.id === _openInlineId)) _openInlineId = null;
    closeParcRemover(); closeMobEdit();
    commit();
    toast(`${n} parcela${n !== 1 ? 's' : ''} removida${n !== 1 ? 's' : ''}.`, '#52525b');
}

// Prévia no formulário de lançamento novo: "6× de R$ 100,00 · de 15/10/2026 a 15/03/2027"
function formParcInfo(F) {
    const el = F.parcInfo && $(F.parcInfo); if (!el) return;
    const n = Math.round(+$(F.parc).value) || 1, v = parseValor($(F.valor).value), data = $(F.data).value;
    if (!(n > 1) || $(F.tipo).value !== 'saida' || !(v > 0) || !isValidISODate(data)) { el.style.display = 'none'; return; }
    const porParcela = $(F.parcModo).value === 'parcela';
    const total = porParcela ? roundMoney(v * n) : roundMoney(v), p = porParcela ? roundMoney(v) : parcelasDividir(total, n)[0];
    const br = iso => iso.split('-').reverse().join('/');
    el.innerHTML = `<b>${n}× de ${escHtml(fmt(p))}</b> · total ${escHtml(fmt(total))}<br>${br(data)} → ${br(addMonthsISO(data, n - 1))}, uma por mês`;
    el.style.display = '';
}
function _ligarParcelas() {
    [FORM_DESKTOP, FORM_MOBILE].forEach(F => [F.valor, F.data, F.parc, F.parcModo, F.tipo].forEach(id => {
        const el = $(id); if (!el) return;
        ['input', 'change'].forEach(ev => el.addEventListener(ev, () => formParcInfo(F)));
    }));
    ['loanValor', 'loanTaxa', 'loanN', 'loanParcela'].forEach(id => { const el = $(id); if (el) el.addEventListener('input', loanPreview); });
}

function adicionar() {
    submitTx(readTxForm(FORM_DESKTOP), null, cancelarEdicao);
}

// Quantos meses um fixo novo é replicado (inclui o mês do lançamento). Antes ia só
// "até dezembro" — criado em dezembro, não replicava nada.
const FIXO_REPLICAR_MESES = CONFIG.FIXO_REPLICAR_MESES;

function closeFixoRep(opcao) {
    $('ovFixoRep').classList.remove('open');
    if (!_pendingFixo) return;
    const { f, editId } = _pendingFixo;
    _pendingFixo = null;
    const old = editId != null ? tx.find(t => t.id === editId) : null;
    const serie = 'S' + newId();

    if (opcao === 'sim') {
        // Dia limitado ao fim do mês: fixo do dia 31 vira 28/fev, 30/abr...
        const novos = [];
        for (let i = 0; i < FIXO_REPLICAR_MESES; i++) {
            const t = makeTx({ ...f, fixo: true, data: addMonthsISO(f.data, i) }, i === 0 ? old : null);
            t.serie = serie;
            novos.push(t);
        }
        tx = tx.filter(t => !old || t.id !== old.id).concat(novos);
        toast(`📌 Fixo replicado pelos próximos ${FIXO_REPLICAR_MESES} meses!`);
    } else {
        const t = makeTx({ ...f, fixo: true }, old);
        t.serie = serie;
        tx = old ? tx.map(x => x.id === old.id ? t : x) : tx.concat(t);
        toast('✓ Salvo como fixo (só este mês).');
    }
    commit();
}

function cancelarEdicao() {
    $('editId').value = '';
    $('formLabel').textContent = 'Novo Lançamento';
    $('btnCancelar').style.display = 'none';
    $('desc').value  = '';
    $('valor').value = '';
    $('parcelas').value = '1'; $('parcelasModo').value = 'total'; $('juros').value = '';
    $('maisField').open = false; formParcInfo(FORM_DESKTOP);
}

function remover(id, depois) {
    const t = tx.find(x => x.id === id);
    if (!t) { toast('⚠️ Lançamento não encontrado.', '#b45309'); return false; }
    if (t.parcela && parcelasDaSerie(t.parcela.serie).length > 1) { _abrirRemoverParcela(t); return false; }   // pergunta o escopo
    // `depois` roda só se a remoção aconteceu (a pergunta pode ser respondida mais tarde)
    confirmar(`Remover "${t.desc}"?`, { ok: 'Remover', perigo: true }, () => {
        if (!tx.some(x => x.id === id)) return;      // sumiu enquanto o modal estava aberto (sync de outro aparelho)
        pushUndo(`Remoção de "${t.desc}"`);
        tx = tx.filter(x => x.id !== id);
        if (_openInlineId === id) _openInlineId = null;
        commit();
        toast('Removido.', '#52525b');
        if (depois) depois();
    });
    return false;
}

// ── FIXOS ─────────────────────────────────────────────────────────────────────
// Cada recorrência tem uma `serie` estável. Antes a série era identificada só pela
// descrição: renomear um mês "soltava" ele da série e dois fixos com o mesmo nome
// (ex.: "Plano" de saúde e de celular) eram editados/removidos juntos.
function fixoSeriesDoMes(m, a) {
    const map = new Map();
    txMes(m, a).forEach(t => {
        if (!t.fixo) return;
        let s = map.get(t.serie);
        if (!s) map.set(t.serie, s = { serie: t.serie, tipo: t.tipo, desc: t.desc, cat: t.cat, total: 0 });
        s.total += t.valor;
    });
    return [...map.values()].sort((x, y) => y.total - x.total);
}
// "Total de fixos" = compromissos de saída (gastos + investimentos). Entradas fixas
// (salário) aparecem nas listas, mas não somam no total — antes somavam e o "Gastos
// Fixos do Mês" inflava com o salário.
const fixoSaidaTotal = items => roundMoney(items.reduce((s, x) => s + (x.tipo === 'entrada' ? 0 : (x.total ?? x.valor)), 0));

// Lançamentos da série no mês filtrado (ou dele em diante, em qualquer ano)
function _fixoNoEscopo(t, serie, ym, futuro) {
    if (!t.fixo || t.serie !== serie) return false;
    const tym = t.data.slice(0, 7);
    return futuro ? tym >= ym : tym === ym;
}

let _fixosPopup = [], _editingFixo = null;
function abrirPopupFixos() { renderPopupFixos(); $('ovFixos').classList.add('open'); }
function closeFixos(e) { closeOverlay('ovFixos', e); }

function renderPopupFixos() {
    const { m, a } = filtro();
    _fixosPopup = fixoSeriesDoMes(m, a);
    const total = fixoSaidaTotal(_fixosPopup);
    $('fixosPopupMes').textContent   = MESES[m] + ' / ' + a;
    $('fixosPopupTotal').textContent = fmt(total);
    const body = $('fixosPopupBody');
    if (!_fixosPopup.length) { body.innerHTML = '<div class="empty-state">Nenhum fixo neste mês.</div>'; return; }
    body.innerHTML = _fixosPopup.map((s, i) => {
        const info = fixoSerieInfo(s.serie);
        const mesFim = info ? `${MESES[+info.lastYm.slice(5) - 1].slice(0, 3)}/${info.lastYm.slice(2, 4)}` : '';
        const fim = info ? (info.endingSoon ? `em ${mesFim}` : `até ${mesFim}`) : '';
        return `
        <div class="fixos-popup-item">
            <div><div class="fp-name">${escHtml(s.desc)}</div>
                <div class="fp-cat">${escHtml(s.cat || '')}${fim ? ` · <span style="${info.endingSoon ? 'color:var(--warn);font-weight:600' : ''}">${info.endingSoon ? '⚠️ termina ' : ''}${fim}</span>` : ''}</div></div>
            <div class="fp-val" style="color:${txCor(s)}">${txPre(s)} ${fmt(s.total)}</div>
            <div class="fp-acts">
                ${info && info.endingSoon ? `<button class="icon-btn" data-onclick="renovarFixo(${i})" title="Renovar por mais ${FIXO_REPLICAR_MESES} meses">🔁</button>` : ''}
                <button class="icon-btn" data-onclick="abrirEditFixo(${i})">✏️</button>
                <button class="icon-btn" data-onclick="removerFixo(${i})">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

// Até quando uma série de fixos vai. Os fixos são gravados como lançamentos concretos
// (12 meses) — quando acabavam, simplesmente sumiam sem aviso. "Terminando" = a última
// ocorrência cai no mês atual ou no próximo.
function fixoSerieInfo(serie) {
    const items = tx.filter(t => t.fixo && t.serie === serie);
    if (!items.length) return null;
    const last = items.reduce((x, y) => (y.data > x.data ? y : x));
    const limite = addMonthsISO(todayLocalISO(), 1).slice(0, 7);   // mês que vem
    return {
        last, lastYm: last.data.slice(0, 7), endingSoon: last.data.slice(0, 7) <= limite,
        // Dia pretendido: o maior da série (fixo do dia 31 vira 28/fev, mas a intenção é 31)
        day: Math.max(...items.map(t => +t.data.slice(8, 10))),
    };
}

// Continua a série a partir da última ocorrência, com os dados mais recentes dela
function renovarFixo(i) {
    const s = _fixosPopup[i];
    const info = s && fixoSerieInfo(s.serie);
    if (!info) return;
    const b = info.last, start = `${info.lastYm}-${pad2(info.day)}`;
    pushUndo(`Renovar fixo "${b.desc}"`);
    const novos = [];
    for (let k = 1; k <= FIXO_REPLICAR_MESES; k++) {
        const t = makeTx({ desc: b.desc, valor: b.valor, data: addMonthsISO(start, k), tipo: b.tipo, cat: b.cat, fixo: true,
                           pagamento: b.pagamento, cartaoId: b.cartaoId });
        t.serie = s.serie;
        novos.push(t);
    }
    tx = tx.concat(novos);
    commit(); renderPopupFixos();
    toast(`🔁 "${b.desc}" renovado até ${MESES[+novos[novos.length - 1].data.slice(5, 7) - 1].slice(0, 3)}/${novos[novos.length - 1].data.slice(2, 4)}`);
}

function abrirEditFixo(i) {
    const s = _fixosPopup[i];
    if (!s) return;
    _editingFixo = s;
    $('editFixoNome').textContent = s.desc;
    $('editFixoVal').value = '';
    $('editFixoVal').placeholder = fmtValorInput(s.total);
    $('editFixoFuturo').checked = false;
    populateCatSelect($('editFixoCat'), s.tipo, s.cat);   // categorias do tipo do fixo (entrada/saída)
    $('ovEditFixo').classList.add('open');
}
function closeEditFixo(e) { closeOverlay('ovEditFixo', e); }

function confirmarEdicaoFixo() {
    const s = _editingFixo;
    if (!s) return closeEditFixo();
    const rawVal  = $('editFixoVal').value.trim();
    const novoV   = rawVal ? parseValor(rawVal) : null;
    const novaCat = $('editFixoCat').value;
    const futuro  = $('editFixoFuturo').checked;
    if (rawVal && !(novoV > 0)) return toast('⚠️ Valor inválido', '#b45309');
    const { m, a } = filtro(), ym = ymKey(m, a);
    pushUndo(`Edição do fixo "${s.desc}"`);
    tx = tx.map(t => _fixoNoEscopo(t, s.serie, ym, futuro)
        ? { ...t, valor: novoV ? roundMoney(novoV) : t.valor, cat: novaCat }
        : t);
    commit(); renderPopupFixos(); closeEditFixo();
    toast('✓ Fixo atualizado!');
}

function removerFixo(i) {
    const s = _fixosPopup[i];
    if (!s) return;
    // Antes: "Cancelar" no confirm significava "remover só este mês" — quem queria
    // desistir perdia o lançamento. Agora a 1ª pergunta pode abortar.
    perguntar(`Remover o fixo "${s.desc}"?`, [{ label: 'Este e os próximos meses', valor: 'futuro', perigo: true }, { label: 'Só este mês', valor: 'este', perigo: true }], escopo => {
        if (!escopo) return;
        const futuro = escopo === 'futuro', { m, a } = filtro(), ym = ymKey(m, a);
        pushUndo(`Remoção do fixo "${s.desc}"`);
        tx = tx.filter(t => !_fixoNoEscopo(t, s.serie, ym, futuro));
        commit(); renderPopupFixos();
        toast('Fixo removido.', '#52525b');
    });
}

// ── CATEGORIAS: identidade = (tipo, nome) ────────────────────────────────────
// "👨‍👩‍👧 Família" existe em saída E em entrada. Antes, remover/renomear numa lista
// afetava a outra e movia lançamentos de entrada para categorias de saída.
// Chaves do orçamento (allocs/needsWants/locks) são por nome: só migram quando o nome
// antigo não existe mais entre as categorias orçáveis (gasto/investimento). Antes valia
// qualquer lista: renomear o gasto "🌟 Ela" com uma entrada "🌟 Ela" deixava o valor
// planejado no nome antigo e a categoria renomeada aparecia com R$ 0.
function _moveBudgetKeys(oldName, newName) {
    if (_allBudgetCats().includes(oldName)) return;
    ['allocs', 'needsWants', 'locks', 'off'].map(k => budget[k]).concat(Object.values(budget.allocsDe || {})).forEach(o => {
        if (!o || o[oldName] === undefined) return;
        if (newName && o[newName] === undefined) o[newName] = o[oldName];
        delete o[oldName];
    });
    if (_orcSel && _orcSel.type === 'cat' && _orcSel.id === oldName) _orcSel = newName ? { type: 'cat', id: newName } : null;
}

function renameCategory(tipo, oldName, newName) {
    newName = String(newName || '').trim();
    const list = cats[tipo] || [];
    const idx = list.indexOf(oldName);
    if (idx < 0) { toast('⚠️ Categoria não encontrada.', '#b45309'); return false; }
    if (!newName) { toast('⚠️ Nome não pode ser vazio.', '#b45309'); return false; }
    if (newName === oldName) return true;
    if (list.some((c, i) => i !== idx && c.toLowerCase() === newName.toLowerCase())) {
        toast('⚠️ Categoria já existe.', '#b45309'); return false;
    }
    pushUndo(`Renomear categoria "${oldName}"`);
    list[idx] = newName;
    tx = tx.map(t => t.tipo === tipo && t.cat === oldName ? { ...t, cat: newName } : t);
    _moveBudgetKeys(oldName, newName);
    commitAll();
    return true;
}

// Remover uma categoria de gasto/investimento pergunta ONDE: só no mês do orçamento, dali em
// diante (os meses anteriores continuam com ela) ou de vez. As duas primeiras só tiram a
// categoria do orçamento (budget.off); a categoria e os outros meses ficam intactos.
// Entradas não têm orçamento mensal: só "excluir tudo".
let _catDeletePending = null;   // { tipo, name }
const _catEscopo = () => { const r = document.querySelector('input[name="catDeleteEscopo"]:checked'); return r ? r.value : 'tudo'; };
// Lançamentos da categoria dentro do escopo (ym = mês do orçamento)
function _catLancamentosNoEscopo(tipo, nome, escopo, ym) {
    return tx.filter(t => t.tipo === tipo && t.cat === nome
        && (escopo === 'tudo' || (escopo === 'mes' ? t.data.slice(0, 7) === ym : t.data.slice(0, 7) >= ym)));
}
function deleteCategoryFlow(tipo, catName) {
    if (!catName || !(cats[tipo] || []).includes(catName)) return;
    const comEscopo = tipo !== 'entrada';
    if (!comEscopo && !tx.some(t => t.tipo === tipo && t.cat === catName)) {
        confirmar(`Remover a categoria "${catName}"?`, { ok: 'Remover', perigo: true }, () => _performCatDelete(tipo, catName, null));
        return;
    }
    _catDeletePending = { tipo, name: catName };
    const mesTxt = `${MESES[_budgetMonth]} de ${_budgetYear}`;
    $('catDeleteScopes').style.display = comEscopo ? '' : 'none';
    $('catDeleteLblMes').textContent = `Só em ${mesTxt}`;
    $('catDeleteNotaMes').textContent = 'Sai do orçamento deste mês; continua nos outros meses.';
    $('catDeleteLblDesde').textContent = `De ${mesTxt} em diante`;
    $('catDeleteNotaDesde').textContent = 'Os meses anteriores continuam com ela.';
    const radio = document.querySelector(`input[name="catDeleteEscopo"][value="${comEscopo ? 'mes' : 'tudo'}"]`);
    if (radio) radio.checked = true;
    catDeleteRefresh();
    const ov = $('ovCatDelete');
    if (ov) ov.classList.add('open');
}
// Texto, contagem de lançamentos e destinos possíveis conforme o escopo escolhido
function catDeleteRefresh() {
    const p = _catDeletePending; if (!p) return;
    const escopo = _catEscopo(), ym = ymKey(_budgetMonth, _budgetYear);
    const count = _catLancamentosNoEscopo(p.tipo, p.name, escopo, ym).length;
    const onde = escopo === 'mes' ? ` em ${MESES[_budgetMonth]} de ${_budgetYear}` : escopo === 'desde' ? ` de ${MESES[_budgetMonth]} de ${_budgetYear} em diante` : '';
    $('catDeleteSub').innerHTML = count
        ? `<strong>${count}</strong> lançamento(s)${onde} usam "${escHtml(p.name)}". Para onde movê-los antes de remover?`
        : `"${escHtml(p.name)}" não tem lançamentos${onde}.`;
    $('catDeleteMoveBox').style.display = count ? '' : 'none';
    const sel = $('catDeleteTarget'), antes = sel.value;
    // Destino não pode ser outra categoria que também esteja fora do orçamento naquele mês
    const alvos = cats[p.tipo].filter(c => c !== p.name && (escopo === 'tudo' || !_catOff(c, ym)));
    sel.innerHTML = alvos.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('') + '<option value="__none__">— Deixar sem categoria —</option>';
    if ([...sel.options].some(o => o.value === antes)) sel.value = antes;
}
function closeCatDelete() {
    const ov = $('ovCatDelete'); if (ov) ov.classList.remove('open');
    _catDeletePending = null;
}
function confirmCatDelete() {
    const p = _catDeletePending;
    if (!p) { closeCatDelete(); return; }
    const escopo = p.tipo === 'entrada' ? 'tudo' : _catEscopo();
    const box = $('catDeleteMoveBox'), v = box && box.style.display !== 'none' && $('catDeleteTarget') ? $('catDeleteTarget').value : '__none__';
    const alvo = v === '__none__' ? null : v;
    if (escopo === 'tudo') _performCatDelete(p.tipo, p.name, alvo); else _performCatHide(p.tipo, p.name, escopo, alvo);
    closeCatDelete();
}
function _performCatDelete(tipo, catName, target) {
    pushUndo(`Remoção da categoria "${catName}"`);
    // Reatribui (ou limpa) só os lançamentos DESTE tipo
    tx = tx.map(t => t.tipo === tipo && t.cat === catName ? { ...t, cat: target || '' } : t);
    cats[tipo] = (cats[tipo] || []).filter(c => c !== catName);
    _moveBudgetKeys(catName, null);
    commitAll();
    toast(target ? `Categoria removida. Lançamentos movidos para "${target}".` : 'Categoria removida.', '#52525b');
}
// "Só neste mês" / "daqui pra frente": a categoria sai do orçamento a partir do mês aberto
function _performCatHide(tipo, catName, escopo, target) {
    const ym = ymKey(_budgetMonth, _budgetYear), onde = escopo === 'mes' ? `${MESES[_budgetMonth]}/${_budgetYear}` : `${MESES[_budgetMonth]}/${_budgetYear} em diante`;
    pushUndo(`Tirar "${catName}" do orçamento (${onde})`);
    const movidos = _catLancamentosNoEscopo(tipo, catName, escopo, ym);
    const ids = new Set(movidos.map(t => t.id));
    tx = tx.map(t => ids.has(t.id) ? { ...t, cat: target || '' } : t);
    ocultarCategoriaNoOrcamento(catName, ym, escopo === 'mes' ? ym : null);
    commitAll();
    toast(`"${catName}" saiu do orçamento ${escopo === 'mes' ? 'de ' + MESES[_budgetMonth] : 'daqui pra frente'}.${movidos.length ? (target ? ` Lançamentos movidos para "${target}".` : ' Lançamentos ficaram sem categoria.') : ''} Desfazer volta tudo.`, '#52525b');
}

// ── NOVA CATEGORIA (linha "adicionar" do Orçamento) ──────────────────────────
// Renomear/remover acontece nos tiles do orçamento (renameCategory/deleteCategoryFlow).
// A antiga lista "hub de categorias" não existe mais no HTML — o código dela foi removido.
let _catHubNewIcon = '📦'; // ícone escolhido para a nova categoria

function addCatHub(tipo) {
    const inp  = $('catHubInput');
    const nome = inp ? inp.value.trim() : '';
    if (!nome) return toast('⚠️ Digite um nome para a categoria.', '#b45309');
    if (!TIPOS.includes(tipo)) tipo = 'saida';
    const fullName = (_catHubNewIcon || '📦') + ' ' + nome;
    if (fullName.length > CAT_MAX) return toast(`⚠️ Nome da categoria longo demais (máx. ${CAT_MAX} caracteres).`, '#b45309');
    if ((cats[tipo] || []).some(c => c.toLowerCase() === fullName.toLowerCase()))
        return toast('⚠️ Categoria já existe.', '#b45309');
    ensureCat(tipo, fullName);
    commitCats();
    if (inp) inp.value = '';
    _catHubNewIcon = '📦';
    const btn = $('catHubIconBtn');
    if (btn) btn.textContent = '📦';
    toast('✓ Categoria adicionada!');
}

// ── ICON PICKER ─────────────────────────────────────────────────────────────
// (fechamento por clique fora: listener global junto da combobox de categorias)
let _openPickerId = null, _pickerTrigger = null;

// Fechar sempre por aqui. devolverFoco: ao escolher/fechar pelo teclado (e no Esc) o foco
// volta a quem abriu — antes o botão focado sumia com o seletor e o foco caía no <body>
function _closeIconPicker(devolverFoco = false) {
    if (!_openPickerId) return false;
    const el = $(_openPickerId);
    if (el) el.classList.remove('open');
    _openPickerId = null;
    if (devolverFoco && _pickerTrigger && _pickerTrigger.isConnected) _pickerTrigger.focus();
    _pickerTrigger = null;
    return true;
}

function toggleIconPicker(pickerId) {
    if (_openPickerId === pickerId) { _closeIconPicker(true); return; }
    _closeIconPicker();
    const el = $(pickerId);
    if (!el) return;
    const currentIcon = _catHubNewIcon || '📦';
    el.innerHTML = `
        <div class="icon-picker-title">Escolher Ícone</div>
        <div class="icon-picker-grid">
            ${ICON_LIB.map(ic => `<button class="icon-pick ${ic === currentIcon ? 'sel' : ''}" aria-pressed="${ic === currentIcon}"
                data-onclick="pickIcon(${jsStr(pickerId)},${jsStr(ic)})">${ic}</button>`).join('')}
        </div>`;
    el.classList.add('open');
    _openPickerId = pickerId;
    _pickerTrigger = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    // Aberto pelo teclado (clique sintético: detail 0) → foco no ícone atual
    if (window.event && window.event.detail === 0) (el.querySelector('.icon-pick.sel') || el.querySelector('.icon-pick'))?.focus();
}

function pickIcon(pickerId, icon) {
    _catHubNewIcon = icon;
    const btn = $('catHubIconBtn');
    if (btn) btn.textContent = icon;
    _closeIconPicker(true);
}

// ── BACKUP ────────────────────────────────────────────────────────────────────
function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportar() {
    const data = { t: tx, c: cats, g: goals, k: cards, b: budget, l: loans, v: SCHEMA_VERSION, exportedAt: new Date().toISOString() };
    const q = loadJSON('fin5_quarantine', []);
    if (q.length) data.q = q;   // registros separados também vão para a cópia (e voltam na importação)
    downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `backup_finances_${todayLocalISO()}.json`);
    lsSet('fin5_lastExport', todayLocalISO());
    renderBackupAge();
    toast('Exportado!');
}

// Nuvem + navegador não bastam como única cópia (conta comprometida, regra errada,
// exclusão acidental sincronizada). Lembra de exportar um arquivo a cada 30 dias.
const BACKUP_LEMBRETE_DIAS = CONFIG.BACKUP_LEMBRETE_DIAS;
function renderBackupAge() {
    const el = $('backupAge');
    if (!el) return;
    if (!tx.length) { el.textContent = ''; return; }
    const last = lsGet('fin5_lastExport');
    const dias = last && isValidISODate(last)
        ? Math.round((new Date(todayLocalISO() + 'T00:00:00') - new Date(last + 'T00:00:00')) / 86400000) : null;
    const atrasado = dias === null || dias > BACKUP_LEMBRETE_DIAS;
    el.textContent = dias === null ? '⚠️ Nenhum backup em arquivo neste navegador — exporte uma cópia.'
        : dias === 0 ? '✓ Backup feito hoje.'
        : `${atrasado ? '⚠️ ' : ''}Último backup há ${dias} dia${dias === 1 ? '' : 's'}${atrasado ? ' — exporte uma cópia.' : '.'}`;
    el.style.color = atrasado ? 'var(--warn)' : 'var(--text-3)';
    el.style.fontWeight = atrasado ? '600' : '';
    // Tamanho da base que cada sincronização envia/baixa por inteiro (a sync não é por item): avisa antes de pesar
    try {
        const kb = Math.round(JSON.stringify({ t: tx, c: cats, g: goals, k: cards, b: budget, l: loans }).length / 1024);
        el.textContent += ` Dados: ${tx.length} lançamentos, ~${kb} KB` + (kb > CONFIG.PAYLOAD_AVISO_KB ? ' — base grande: cada sincronização sobe tudo; considere arquivar anos antigos.' : '.');
    } catch (e) {}
}

// Excel/Sheets executam como FÓRMULA células que começam com = + - @ (CSV injection) — e
// descrições vêm de extratos, texto de terceiros. O export prefixa "'"; a importação de
// extrato remove esse prefixo, então o CSV do próprio app volta com o texto original.
const _csvSeguro = s => /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
const _csvDesfaz = s => s.replace(/^'(?=[=+\-@\t\r])/, '');

// Lançamentos do mês filtrado ou do ano inteiro (por data da compra), em ordem de data
function _listaCSV(escopo, m, a) {
    const meses = escopo === 'ano' ? Array.from({ length: 12 }, (_, i) => i) : [m];
    return meses.flatMap(k => txMes(k, a)).sort((x, y) => x.data.localeCompare(y.data));
}
function _csvDe(lista) {
    const q = s => '"' + _csvSeguro(String(s == null ? '' : s)).replace(/"/g, '""') + '"';
    const cardName = id => { const c = cards.find(c => c.id === id); return c ? c.nome : ''; };
    const head = 'data;tipo;descricao;categoria;pagamento;cartao;fixo;valor';
    const rows = lista.map(t => [
        t.data, t.tipo, q(t.desc), q(t.cat || ''), t.pagamento || '', q(cardName(t.cartaoId)),
        t.fixo ? 'sim' : '', fmtValorInput(t.valor)
    ].join(';'));
    return [head, ...rows].join('\r\n');
}

// Exporta o mês filtrado (ou o ano inteiro) como CSV (BOM + ';' = abre direto no Excel/Sheets pt-BR)
function exportarCSV(escopo = 'mes') {
    const { m, a } = filtro();
    const ano = escopo === 'ano';
    const lista = _listaCSV(escopo, m, a);
    if (!lista.length) { toast(ano ? `Nada para exportar em ${a}.` : 'Nada para exportar neste mês.', '#52525b'); return; }
    const BOM = String.fromCharCode(0xFEFF);
    downloadBlob(new Blob([BOM + _csvDe(lista)], { type: 'text/csv;charset=utf-8' }), ano ? `financas-${a}.csv` : `financas-${ymKey(m, a)}.csv`);
    toast(ano ? `CSV de ${a} exportado!` : `CSV de ${MESES[m]} exportado!`);
}

// Partes ausentes no arquivo mantêm o estado atual; tudo passa pela sanitização
function _aplicarBackup(d) {
    const s = sanitizeState({
        t: d.t || tx, c: d.c || cats, g: d.g || goals, k: d.k || cards, b: d.b || budget, l: d.l || loans,
    }, Number(d.v) || 2);
    pushUndo('Importação de backup');
    _quarantine(s.report);
    if (Array.isArray(d.q) && d.q.length) _quarantine({ dropped: d.q });
    restoreState(s);
    commitAll();
    renderGoals(); renderCartoesMini();
    toast(s.report.dropped.length ? `Importado (${s.report.dropped.length} registro(s) inválido(s) ignorado(s)).` : 'Importado!');
}
function importar(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
        try {
            const d = JSON.parse(r.result);
            if (!d || typeof d !== 'object' || (!d.t && !d.c && !d.g && !d.k && !d.b && !d.l)) {
                toast('⚠️ Arquivo não parece ser um backup válido.', '#b45309');
                return;
            }
            const n = _asList(d.t).length;
            confirmar(`Substituir os dados atuais pelo backup${d.t ? ` (${n} lançamentos)` : ''}?\nDá para desfazer com Ctrl+Z.`, { ok: 'Substituir', perigo: true }, () => {
                try { _aplicarBackup(d); } catch (e) { toast('❌ Erro ao importar o backup: ' + e.message, '#dc2626'); }
            });
        } catch (e) {
            toast('❌ Erro ao ler o backup: ' + e.message, '#dc2626');
        } finally {
            input.value = ''; // permite reimportar o mesmo arquivo
        }
    };
    r.readAsText(file);
}

// ── CAIXA DE ENTRADA DO CLAUDE (repositório privado no GitHub) ───────────────
// O dono manda os gastos para o Claude no chat; o Claude grava operações no arquivo
// inbox.json de um repositório PRIVADO do GitHub, e o app — no navegador do dono, já logado
// no Firebase — lê o arquivo com um token fine-grained (só esse repositório), aplica pelo
// fluxo normal (sanitização → estado → sync de 3 vias) e marca como processadas. O
// repositório do site é público, por isso a caixa fica em outro. Antes, cada rodada exigia
// exportar/importar um backup inteiro (a importação substitui tudo o que está no app).
// Formato: { versao: 1, ops: [ {id, op:'add', tx} | {id, op:'update', txId, espera, muda}
//            | {id, op:'delete', txId, espera} ], processados: [ {id, resultado, em} ] }
// Idempotente: "add" com id já existente é ignorado; "update"/"delete" só valem se os campos
// de `espera` ainda baterem (uma edição do dono feita depois vence). Reprocessar o arquivo
// (falha ao marcar, dois aparelhos ao mesmo tempo) nunca duplica nem sobrescreve.
// Detalhes para quem grava as operações: CAIXA-DE-ENTRADA.md.
const INBOX_ARQ = 'inbox.json', ESTADO_ARQ = 'estado.json';
// `parcela` ({ serie, k, n }) liga lançamentos soltos numa série; `serie` é a recorrência de um fixo
const INBOX_CAMPOS = ['desc', 'valor', 'data', 'tipo', 'cat', 'pagamento', 'cartaoId', 'faturaData', 'fixo', 'juros', 'parcela', 'serie'];
const INBOX_MIN_MS  = CONFIG.INBOX_MIN_MS;     // checagens automáticas no máximo a cada 2 min
const ESTADO_MIN_MS = CONFIG.ESTADO_MIN_MS;    // cópia dos dados no máximo a cada 10 min
// Por conta: outra conta entrando no mesmo navegador não herda o token nem a caixa
const _inboxKey = uid => 'fin5_inbox_' + uid;
function inboxCfg() { return _currentUser ? loadJSON(_inboxKey(_currentUser.uid), null) : null; }

// Base64 ↔ UTF-8 (a API de conteúdo do GitHub usa base64; atob/btoa puros quebram emoji/acentos)
function _b64Utf8(s) {
    const b = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(bin);
}
function _utf8B64(b64) {
    const bin = atob(String(b64 || '').replace(/\s/g, ''));
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(b);
}

// Orçamento pela caixa de entrada (mexe numa cópia de budget). Ordem: total, meses, planejamento, grupos, fixos.
// total.de = novo total padrão a partir do mês: os meses anteriores (desde o 1º lançamento) ficam com o
// total que tinham e os totais próprios de meses ≥ de saem. planejamento.de = planejamento que vale
// daquele mês em diante (substitui; categorias fora da lista ficam com 0), em "reais" ou "pct".
function _inboxOrcamento(b, o, txs) {
    const ymOk = v => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
    const num = v => { const n = parseValor(v); return Number.isFinite(n) && n >= 0 && _valorOk(n) ? roundMoney(n) : null; };
    const totalDo = ym => b.monthTotals[ym] != null ? b.monthTotals[ym] : b.total;
    let mexeu = false;
    if (o.total && typeof o.total === 'object') {
        const v = num(o.total.valor), de = o.total.de;
        if (v == null || (de != null && !ymOk(de))) return 'ignorado: total inválido';
        if (de) {
            const primeiro = txs.reduce((m, t) => (!m || t.data < m ? t.data : m), '').slice(0, 7);
            for (let ym = primeiro; ym && ym < de; ym = _ymMais(ym, 1)) if (b.monthTotals[ym] == null && b.total > 0) b.monthTotals[ym] = b.total;
            Object.keys(b.monthTotals).forEach(ym => { if (ym >= de) delete b.monthTotals[ym]; });
        }
        b.total = v; mexeu = true;
    }
    if (o.meses && typeof o.meses === 'object') {
        for (const [ym, v] of Object.entries(o.meses)) {
            if (!ymOk(ym)) return 'ignorado: mês inválido';
            if (v === null) delete b.monthTotals[ym];
            else { const n = num(v); if (n == null) return 'ignorado: total do mês inválido'; b.monthTotals[ym] = n; }
            mexeu = true;
        }
    }
    if (o.planejamento && typeof o.planejamento === 'object') {
        const pl = o.planejamento, de = pl.de, emReais = pl.reais && typeof pl.reais === 'object';
        const vals = emReais ? pl.reais : pl.pct;
        if (!vals || typeof vals !== 'object' || (de != null && !ymOk(de))) return 'ignorado: planejamento inválido';
        const T = de ? totalDo(de) : b.total;
        if (emReais && !(T > 0)) return 'ignorado: total do mês é zero';
        const mapa = {};
        for (const [cat, v] of Object.entries(vals)) {
            const n = num(v);
            if (n == null) return 'ignorado: valor do planejamento inválido';
            const pct = emReais ? +(n / T * 100).toFixed(6) : n;
            if (pct > 0) mapa[String(cat)] = Math.min(100, pct);
        }
        if (de) b.allocsDe[de] = mapa; else b.allocs = mapa;
        mexeu = true;
    }
    if (o.grupos && typeof o.grupos === 'object') Object.entries(o.grupos).forEach(([c, g]) => { if (g === 'needs' || g === 'wants') { b.needsWants[c] = g; mexeu = true; } });
    // fora = { cat: 'AAAA-MM' }: categoria sai do orçamento daquele mês em diante (lançamentos antigos ficam)
    if (o.fora && typeof o.fora === 'object') Object.entries(o.fora).forEach(([c, de]) => { if (ymOk(de)) { b.off[c] = [{ de }]; mexeu = true; } });
    if (o.fixos && typeof o.fixos === 'object') Object.entries(o.fixos).forEach(([c, v]) => { if (v) b.locks[c] = true; else delete b.locks[c]; mexeu = true; });
    return mexeu ? 'aplicado' : 'ignorado: nada a mudar';
}

// Aplica as operações sobre um estado (sem mutar o original). Devolve o estado novo
// (sanitizado) e o resultado de cada operação: 'aplicado' ou 'ignorado: motivo'.
// Operações: add/update/delete (lançamentos), orcamento, emprestimo (acao add/update/delete).
const INBOX_MAX_DEL = CONFIG.INBOX_MAX_DEL;   // exclusões por rodada; acima disso nenhuma exclusão é feita (tudo-ou-nada)
function inboxAplicar(state, ops, { maxDel = INBOX_MAX_DEL } = {}) {
    // Exclusão em massa quase sempre é erro (id errado, lista errada): não apaga nada, o dono confirma e reenvia
    const nDel = _asList(ops).filter(o => o && o.id && ((o.op === 'delete') || (o.op === 'emprestimo' && o.acao === 'delete'))).length;
    const delBloqueado = nDel > maxDel;
    const lista = state.tx.map(t => ({ ...t }));
    const porId = new Map(lista.map(t => [t.id, t]));
    const confere = (t, espera) => Object.entries(espera && typeof espera === 'object' ? espera : {}).every(([k, v]) =>
        k === 'valor' ? Math.abs(roundMoney(+t.valor) - roundMoney(+v)) < 0.005 : JSON.stringify(t[k] ?? null) === JSON.stringify(v ?? null));
    const budgetN = _sanBudget(JSON.parse(JSON.stringify(state.budget || {})));
    let loansN = _asList(state.loans).map(l => ({ ...l }));
    const resultados = [], adicionados = new Map(), removidos = new Set();
    _asList(ops).forEach(o => {
        const id = String((o && o.id) || '');
        if (!id) return;                       // sem id não dá para marcar como processada
        const res = r => resultados.push({ id, resultado: r });
        if (o.op === 'add') {
            const t = o.tx && typeof o.tx === 'object' ? o.tx : null;
            const tid = t && toId(t.id);
            if (!tid) return res('ignorado: lançamento sem id');
            if (porId.has(tid)) return res('ignorado: já existe');
            const novo = { ...t, id: tid, extId: 'claude:' + id };
            lista.push(novo); porId.set(tid, novo);
            adicionados.set(tid, resultados.length);
            return res('aplicado');
        }
        if (o.op === 'update' || o.op === 'delete') {
            const t = porId.get(toId(o.txId));
            if (!t) return res(o.op === 'delete' ? 'ignorado: já não existe' : 'ignorado: não existe');
            // `espera` é a trava contra id errado/edição do dono: sem ela a operação não vale
            const esp = o.espera && typeof o.espera === 'object' && !Array.isArray(o.espera) ? o.espera : null;
            if (esp && Object.keys(esp).some(k => !INBOX_CAMPOS.includes(k))) return res('ignorado: espera inválida');
            if (o.op === 'delete') {
                if (!esp || typeof esp.desc !== 'string' || !Number.isFinite(+esp.valor) || esp.valor === null || esp.valor === '') return res('ignorado: delete exige espera com desc e valor');
                if (delBloqueado) return res(`ignorado: ${nDel} exclusões numa rodada (máx ${maxDel}) — confirme com o dono e reenvie`);
            } else if (!esp || !Object.keys(esp).length) return res('ignorado: update exige espera');
            if (!confere(t, o.espera)) return res('ignorado: mudou desde então');
            if (o.op === 'delete') { porId.delete(t.id); removidos.add(t); return res('aplicado'); }
            const muda = o.muda && typeof o.muda === 'object' ? o.muda : {};
            const chaves = Object.keys(muda).filter(k => INBOX_CAMPOS.includes(k));
            if (!chaves.length) return res('ignorado: nada a mudar');
            chaves.forEach(k => { if (muda[k] === null && (k === 'parcela' || k === 'juros')) delete t[k]; else t[k] = muda[k]; });
            // mudou data/cartão sem informar a fatura: a sanitização recalcula
            if ((chaves.includes('data') || chaves.includes('cartaoId')) && !chaves.includes('faturaData')) t.faturaData = null;
            return res('aplicado');
        }
        if (o.op === 'orcamento') return res(_inboxOrcamento(budgetN, o, lista.filter(t => !removidos.has(t))));
        if (o.op === 'emprestimo') {
            if (o.acao === 'add') {
                const l = o.loan && typeof o.loan === 'object' ? o.loan : null, lid = l && toId(l.id);
                if (!lid) return res('ignorado: empréstimo sem id');
                if (loansN.some(x => x.id === lid)) return res('ignorado: já existe');
                const n0 = _sanLoans([{ ...l, id: lid }])[0];
                if (!(n0.valor > 0) || !(n0.n >= 2) || !(n0.parcela > 0) || !n0.primeira) return res('ignorado: contrato inválido');
                loansN = loansN.concat(n0);
                const modo = o.lancar === 'parcela' ? 'parcela' : o.lancar === 'nada' ? null : 'juros';
                if (modo) loanTx(n0, modo).forEach(t => { const nt = { ...t, id: lid * 1000 + t.parcela.k, extId: 'claude:' + id };   // id derivado: dois aparelhos processando juntos não duplicam parcelas
                    if (porId.has(nt.id)) return; lista.push(nt); porId.set(nt.id, nt); });
                return res('aplicado');
            }
            const l = loansN.find(x => x.id === toId(o.loanId));
            if (!l) return res(o.acao === 'delete' ? 'ignorado: já não existe' : 'ignorado: não existe');
            if (o.acao === 'delete') {
                if (delBloqueado) return res(`ignorado: ${nDel} exclusões numa rodada (máx ${maxDel}) — confirme com o dono e reenvie`);
                loansN = loansN.filter(x => x !== l); return res('aplicado');
            }
            if (o.acao === 'update') {
                const muda = o.muda && typeof o.muda === 'object' ? o.muda : {};
                const ok = ['nome', 'nota'].filter(k => typeof muda[k] === 'string');
                if (!ok.length) return res('ignorado: nada a mudar');
                ok.forEach(k => { l[k] = muda[k]; });
                return res('aplicado');
            }
            return res('ignorado: ação desconhecida');
        }
        res('ignorado: operação desconhecida');
    });
    const s = sanitizeState({ t: lista.filter(t => !removidos.has(t)), c: state.cats, g: state.goals, k: state.cards, b: budgetN, l: loansN });
    // Lançamento recusado pela sanitização (sem data/valor) vai para a quarentena, não conta como aplicado
    const ids = new Set(s.tx.map(t => t.id));
    adicionados.forEach((i, tid) => { if (!ids.has(tid)) resultados[i].resultado = 'ignorado: inválido (quarentena)'; });
    return { state: s, resultados };
}

let _inboxFetch = (...a) => fetch(...a);   // trocado pelo teste (GitHub simulado)
function _ghErro(status) {
    return new Error(status === 401 ? 'token inválido ou expirado'
        : status === 403 ? 'token sem permissão (precisa de Contents: leitura e escrita neste repositório)'
        : status === 404 ? 'repositório não encontrado (confira dono/nome e o acesso do token)'
        : 'GitHub respondeu ' + status);
}
const _ghHeaders = cfg => ({ Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
async function _ghReq(cfg, method, arq, body) {
    const headers = _ghHeaders(cfg);
    if (body) headers['Content-Type'] = 'application/json';
    const r = await _comPrazo(_inboxFetch(`https://api.github.com/repos/${cfg.repo}/contents/${arq}`,
        { method, headers, cache: 'no-store', body: body ? JSON.stringify(body) : undefined }), SYNC_PRAZO_MS, 'GitHub sem resposta');
    _ghLerExpiracao(r);
    return r;
}
// O GitHub informa quando o token vence (cabeçalho, se o navegador o expõe): o app avisa antes de a caixa parar
let _ghTokenExpira = null;
function _ghLerExpiracao(r) {
    try { const e = r && r.headers && r.headers.get && r.headers.get('github-authentication-token-expiration'); if (e) _ghTokenExpira = Date.parse(e) || null; } catch (e) {}
}
const _ghDiasParaExpirar = () => _ghTokenExpira ? Math.ceil((_ghTokenExpira - Date.now()) / 86400000) : null;
// A caixa e a cópia dos dados só podem usar repositório PRIVADO: este app e o `finances` são públicos
// e um erro de digitação no dono/nome publicaria todos os lançamentos. Campo ausente conta como público.
async function _ghRepoPrivado(cfg) {
    const r = await _comPrazo(_inboxFetch(`https://api.github.com/repos/${cfg.repo}`,
        { headers: _ghHeaders(cfg), cache: 'no-store' }), SYNC_PRAZO_MS, 'GitHub sem resposta');
    if (!r.ok) throw _ghErro(r.status);
    const j = await r.json().catch(() => null);
    if (!j || j.private !== true)
        throw new Error(`o repositório ${cfg.repo} é PÚBLICO (ou não deu para confirmar que é privado). A caixa de entrada só funciona com repositório privado — nada foi gravado`);
}
// Arquivo inexistente → { sha: null, dados: null }
async function _ghLer(cfg, arq) {
    const r = await _ghReq(cfg, 'GET', arq);
    if (r.status === 404) {
        // 404 vale para arquivo E repositório: confere o repositório para dar a mensagem certa
        const rr = await _comPrazo(_inboxFetch(`https://api.github.com/repos/${cfg.repo}`,
            { headers: _ghHeaders(cfg), cache: 'no-store' }), SYNC_PRAZO_MS, 'GitHub sem resposta');
        if (!rr.ok) throw _ghErro(rr.status);
        return { sha: null, dados: null };
    }
    if (!r.ok) throw _ghErro(r.status);
    const j = await r.json();
    return { sha: j.sha, dados: JSON.parse(_utf8B64(j.content)) };
}
// Grava; devolve o sha novo, ou null se o arquivo mudou no meio (sha antigo) — quem chamou relê
async function _ghGravar(cfg, arq, dados, sha, msg) {
    const r = await _ghReq(cfg, 'PUT', arq, { message: msg, content: _b64Utf8(JSON.stringify(dados, null, 1)), ...(sha ? { sha } : {}) });
    if (r.status === 409 || r.status === 422) return null;
    if (!r.ok) throw _ghErro(r.status);
    const j = await r.json();
    return (j && j.content && j.content.sha) || '?';
}

async function _inboxProcessar(cfg) {
    await _ghRepoPrivado(cfg);      // a cada rodada: cobre config antiga e repositório que virou público
    let { sha, dados } = await _ghLer(cfg, INBOX_ARQ);
    let ops = dados && Array.isArray(dados.ops) ? dados.ops : [];
    let resultados = [];
    if (ops.length) {
        pushUndo('Lançamentos do Claude');     // Ctrl+Z desfaz a rodada inteira
        const r = inboxAplicar(snapshotState(), ops);
        _quarantine(r.state.report);
        restoreState(r.state);
        commitAll(); renderGoals(); renderCartoesMini();
        const em = new Date().toISOString();
        resultados = r.resultados.map(x => ({ ...x, em }));
        // Marca como processadas. Se o Claude gravou no meio (sha mudou), relê e tira só as
        // que esta rodada tratou — as novas ficam para a próxima.
        const feitos = new Set(resultados.map(x => x.id));
        for (let tent = 0; ; tent++) {
            const novo = { versao: 1, ops: ops.filter(o => !feitos.has(String((o && o.id) || ''))),
                           processados: [..._asList(dados && dados.processados), ...resultados].slice(-CONFIG.INBOX_PROCESSADOS_MAX) };
            if (await _ghGravar(cfg, INBOX_ARQ, novo, sha, `App: ${resultados.length} operação(ões) processada(s)`)) break;
            if (tent >= 3) throw new Error('não consegui marcar como processadas (as alterações já estão no app; tento de novo depois)');
            ({ sha, dados } = await _ghLer(cfg, INBOX_ARQ));
            ops = dados && Array.isArray(dados.ops) ? dados.ops : [];
        }
    }
    const aplicadas = resultados.filter(x => x.resultado === 'aplicado').length;
    if (resultados.length)
        toast(`📥 Claude: ${aplicadas} alteração(ões) aplicada(s)` + (resultados.length > aplicadas ? `, ${resultados.length - aplicadas} ignorada(s)` : '') + '.', '#0b62f0');
    let copia = false;
    if (cfg.copia) copia = await _inboxCopiaEstado(cfg);
    return { processadas: resultados.length, aplicadas, resultados, copia };
}

// Cópia dos dados (mesmo formato do backup) para o Claude conferir duplicados sem pedir
// arquivo. Só grava se o estado mudou desde a última cópia, no máximo a cada 10 min.
async function _inboxCopiaEstado(cfg) {
    const key = _inboxKey(_currentUser.uid) + '_copia';
    const h = _stateHash(), ult = loadJSON(key, null);
    if (ult && (ult.hash === h || Date.now() - ult.em < ESTADO_MIN_MS)) return false;
    await _ghRepoPrivado(cfg);      // defesa própria: este arquivo contém TODOS os dados financeiros
    const dados = { t: tx, c: cats, g: goals, k: cards, b: budget, l: loans, v: SCHEMA_VERSION, exportedAt: new Date().toISOString() };
    let sha = ult && ult.sha;
    for (let tent = 0; tent < 3; tent++) {
        const novo = await _ghGravar(cfg, ESTADO_ARQ, dados, sha, 'App: cópia dos dados');
        if (novo) { storeJSON(key, { hash: h, em: Date.now(), sha: novo }); return true; }
        ({ sha } = await _ghLer(cfg, ESTADO_ARQ));     // sha desconhecido/antigo: relê e tenta de novo
    }
    throw new Error('não consegui gravar a cópia dos dados');
}

let _inboxRodando = null, _inboxUltima = 0, _inboxMsg = '';
function _inboxStatus(msg) { _inboxMsg = msg; const el = $('inboxStatus'); if (el) el.textContent = msg; }
async function checkInbox({ manual = false } = {}) {
    const cfg = inboxCfg();
    if (!cfg || !cfg.repo || !cfg.token || !SYNC_ENABLED || !_currentUser || _conflictOpen || _offline()) return null;
    if (_appDesatualizado) return null;   // não marca operações como processadas num app que não consegue sincronizar
    if (!manual && Date.now() - _inboxUltima < INBOX_MIN_MS) return null;
    if (_inboxRodando) return _inboxRodando;
    _inboxRodando = (async () => {
        _inboxUltima = Date.now();
        try {
            if (_syncing) await _syncing;      // aplica sobre o estado já sincronizado
            if (_conflictOpen || _appDesatualizado) return null;   // a sync acima pode ter acabado de marcar 'stale'
            const r = await _inboxProcessar(cfg);
            const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const dExp = _ghDiasParaExpirar();
            _inboxStatus(`✓ Verificado às ${hora}` + (r.processadas ? ` — ${r.aplicadas} aplicada(s)` : ' — nada novo') + (r.copia ? ' · cópia dos dados atualizada' : '')
                + (dExp !== null && dExp <= CONFIG.TOKEN_AVISO_DIAS ? ` · ⚠️ o token do GitHub ${dExp <= 0 ? 'venceu' : 'vence em ' + dExp + ' dia(s)'} — gere outro` : ''));
            if (manual && !r.processadas) toast('✓ Caixa de entrada: nada novo.');
            return r;
        } catch (e) {
            _inboxStatus('❌ ' + e.message);
            console.warn('Caixa de entrada do Claude:', e);
            if (manual) toast('❌ Caixa de entrada: ' + e.message, '#dc2626');
            return { erro: e.message };
        } finally { _inboxRodando = null; }
    })();
    return _inboxRodando;
}

function abrirInbox() {
    const cfg = inboxCfg() || {};
    $('inboxRepo').value = cfg.repo || '';
    $('inboxToken').value = '';
    $('inboxToken').placeholder = cfg.token ? 'token salvo neste aparelho (vazio = manter)' : 'github_pat_…';
    $('inboxCopia').checked = !!cfg.copia;
    _inboxStatus(_inboxMsg || (cfg.token ? 'Ligada neste aparelho.' : 'Desligada neste aparelho.'));
    $('ovInbox').classList.add('open');
}
async function salvarInbox() {
    if (!_currentUser) return;
    const repo = $('inboxRepo').value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { _inboxStatus('⚠️ Informe o repositório no formato dono/nome.'); return; }
    const antes = inboxCfg() || {};
    const token = $('inboxToken').value.trim() || antes.token || '';
    if (!token) { _inboxStatus('⚠️ Cole o token do GitHub.'); return; }
    if (SYNC_ENABLED) {   // não guarda token de um repositório público/inexistente
        _inboxStatus('Verificando o repositório…');
        try { await _ghRepoPrivado({ repo, token }); }
        catch (e) { _inboxStatus('❌ ' + e.message); return; }
    }
    storeJSON(_inboxKey(_currentUser.uid), { repo, token, copia: $('inboxCopia').checked });
    $('inboxToken').value = '';
    $('inboxToken').placeholder = 'token salvo neste aparelho (vazio = manter)';
    if (!SYNC_ENABLED) { _inboxStatus('Salvo. (No modo de teste a caixa de entrada não é consultada.)'); return; }
    _inboxStatus('Verificando…');
    await checkInbox({ manual: true });
}
function desligarInbox() {
    if (!_currentUser || !inboxCfg()) { _inboxStatus('Já está desligada neste aparelho.'); return; }
    confirmar('Desligar a caixa de entrada neste aparelho? O token é apagado daqui.', { ok: 'Desligar', perigo: true }, () => {
        lsDel(_inboxKey(_currentUser.uid)); lsDel(_inboxKey(_currentUser.uid) + '_copia');
        $('inboxRepo').value = ''; $('inboxCopia').checked = false; $('inboxToken').placeholder = 'github_pat_…';
        _inboxStatus('Desligada neste aparelho.');
    });
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
// Conteúdo (<td>) do editor inline de um lançamento
function _inlineEditorHtml(t) {
    const tipoOpts = [['saida', 'Gasto'], ['entrada', 'Ganho'], ['investimento', 'Investimento']]
        .map(([v, l]) => `<option value="${v}" ${t.tipo === v ? 'selected' : ''}>${l}</option>`).join('');
    const pagOpts  = [['debito', 'Débito'], ['credito', 'Crédito']]
        .map(([v, l]) => `<option value="${v}" ${(t.pagamento || 'debito') === v ? 'selected' : ''}>${l}</option>`).join('');
    const cardOpts = cards.map(c => `<option value="${c.id}" ${t.cartaoId === c.id ? 'selected' : ''}>${escHtml(c.nome)}</option>`).join('');
    const selStyle = 'padding:2px 6px;border:1px solid var(--border);border-radius:5px;font-size:11px;font-family:inherit';
    return `<td colspan="5">
        <div class="ie-inner">
            <div class="ie-field"><label>Descrição</label><input autocomplete="off" id="ie-desc-${t.id}" value="${escHtml(t.desc)}" type="text" maxlength="200"></div>
            <div class="ie-field"><label>Valor (R$)</label><input autocomplete="off" id="ie-valor-${t.id}" value="${fmtValorInput(t.valor)}" type="text" inputmode="decimal"></div>
            <div class="ie-field"><label>Data</label><input id="ie-data-${t.id}" value="${t.data}" type="date"></div>
            <div class="ie-field"><label>Tipo</label><select id="ie-tipo-${t.id}" data-onchange="ieUpdateCats(${t.id})">${tipoOpts}</select></div>
            <div class="ie-field"><label>Categoria</label><div class="cat-combo" id="ie-cat-wrap-${t.id}">${buildCatCombo('ie-cat-' + t.id, t.tipo, t.cat)}</div></div>
            <div class="ie-actions">
                <button class="ie-save" data-onclick="saveInlineEdit(${t.id})">✓ Salvar</button>
                <button class="ie-cancel" data-onclick="closeInlineEdit()">✕</button>
            </div>
        </div>
        <div style="display:flex;gap:16px;margin-top:8px;align-items:center;flex-wrap:wrap">
            <label class="ie-check"><input type="checkbox" id="ie-fixo-${t.id}" ${t.fixo ? 'checked' : ''}> Gasto fixo mensal</label>
            <div id="ie-mais-${t.id}" style="${t.tipo !== 'saida' ? 'display:none' : ''}">
                <label class="ie-check">Juros incluídos:&nbsp;<input autocomplete="off" id="ie-juros-${t.id}" type="text" inputmode="decimal" value="${t.juros ? fmtValorInput(t.juros) : ''}" placeholder="0,00" style="${selStyle};width:84px"></label>
            </div>
            ${t.parcela && t.parcela.k < t.parcela.n ? `<label class="ie-check"><input type="checkbox" id="ie-prox-${t.id}"> Aplicar às parcelas seguintes (${t.parcela.k + 1}–${t.parcela.n})</label>` : ''}
            <div id="ie-pag-wrap-${t.id}" style="${t.tipo !== 'saida' ? 'display:none' : ''}">
                <label class="ie-check">Pagamento:&nbsp;
                    <select id="ie-pag-${t.id}" data-onchange="ieUpdateCartao(${t.id})" style="${selStyle}">${pagOpts}</select>
                </label>
            </div>
            <div id="ie-cartao-wrap-${t.id}" style="${(t.pagamento !== 'credito' || !cards.length) ? 'display:none' : ''}">
                <label class="ie-check">Cartão:&nbsp;
                    <select id="ie-cartao-${t.id}" style="${selStyle}"><option value="">— sem cartão —</option>${cardOpts}</select>
                </label>
            </div>
        </div>
    </td>`;
}

function renderTabela() {
    const { m, a } = filtro();
    const lista = txFiltrados(m, a);
    const tbody = $('tbody'), empty = $('emptyState'), caixas = $('txBoxes'), tabela = $('txTable');
    // Agrupado por categoria (só no computador): a tabela única dá lugar às caixinhas
    const agrupado = groupMode === 'cat' && !IS_MOBILE && lista.length > 0;
    tabela.style.display = agrupado ? 'none' : '';
    caixas.style.display = agrupado ? '' : 'none';
    if (!agrupado) caixas.innerHTML = '';
    if (!lista.length) { tbody.innerHTML = ''; _openInlineId = null; if (IS_MOBILE) { empty.style.display = 'none'; renderMobList(); } else { empty.style.display = 'block'; } return; }
    empty.style.display = 'none';
    if (IS_MOBILE) { renderMobList(); return; }

    function _rowHtml(t) {
        const [y, mo, d] = t.data.split('-');
        const cor = txCor(t);
        const pre    = txPre(t);
        const payTag = txPayBadge(t);
        const card    = t.cartaoId ? cards.find(c => c.id === t.cartaoId) : null;
        const cardTag = card ? `<span class="tag-card" style="background:${card.cor}22;color:${card.cor}">${escHtml(card.nome)}</span>` : '';
        const isEditing = _openInlineId === t.id;
        // O editor inline só é montado para a linha aberta (openInlineEdit) — antes cada
        // linha carregava um editor escondido completo com combobox de categorias
        return `<tr id="tr-${t.id}" class="${isEditing ? 'editing' : ''}">
            <td style="color:var(--text-3);font-size:12px;white-space:nowrap">${d}/${mo}</td>
            <td><span style="font-weight:500">${escHtml(t.desc)}</span>${payTag}${t.fixo ? '<span class="tag-fixo">FIXO</span>' : ''}${cardTag}</td>
            <td style="font-size:12px;color:var(--text-3)">${groupMode === 'cat' ? '' : escHtml(catLabel(t))}</td>
            <td style="font-weight:600;color:${cor};white-space:nowrap">${pre} ${fmt(t.valor)}</td>
            <td><div class="btn-row">
                <button class="icon-btn" title="Editar" data-onclick="openInlineEdit(${t.id})">&#9999;&#65039;</button>
                <button class="icon-btn" title="Remover" data-onclick="remover(${t.id})">&#128465;&#65039;</button>
            </div></td>
        </tr>
        <tr id="ie-${t.id}" class="ie-row ${isEditing ? 'open' : ''}">${isEditing ? _inlineEditorHtml(t) : ''}</tr>`;
    }

    if (agrupado) {
        tbody.innerHTML = '';
        caixas.innerHTML = _caixinhasHtml(lista, _rowHtml);
    } else {
        tbody.innerHTML = lista.map(_rowHtml).join('');
    }
}

// ── AGRUPAR POR CATEGORIA: caixinhas ─────────────────────────────────────────
// Cada categoria vira uma caixinha (cor estável da categoria, total, % do tipo e os lançamentos),
// separadas por Entradas / Saídas / Investimentos. A ordem das caixinhas fica guardada neste aparelho.
const GROUP_ORDENS = ['valor_desc', 'valor_asc', 'itens', 'recente', 'nome', 'grupo_valor'];
let _groupSort = GROUP_ORDENS.includes(lsGet('fin5_groupSort')) ? lsGet('fin5_groupSort') : 'valor_desc';
function setGroupSort(v) {
    if (!GROUP_ORDENS.includes(v)) return;
    _groupSort = v; lsSet('fin5_groupSort', v);
    renderTabela();
}
const _GRUPO_TIPOS = [
    { tipo: 'entrada', label: '📈 Entradas', cls: 'green', pre: '+', de: 'das entradas' },
    { tipo: 'saida', label: '📉 Saídas', cls: 'red', pre: '−', de: 'das saídas' },
    { tipo: 'investimento', label: '💼 Investimentos', cls: 'purple', pre: '−', de: 'dos investimentos' },
];
function _caixinhasHtml(lista, rowHtml) {
    const soma = items => roundMoney(items.reduce((s, t) => s + t.valor, 0));
    const ordem = {
        grupo_valor: (x, y) => y.total - x.total,   // dentro de cada grupo (saídas); entradas e investimentos: por valor
        valor_desc: (x, y) => y.total - x.total, valor_asc: (x, y) => x.total - y.total,
        itens: (x, y) => y.items.length - x.items.length,
        recente: (x, y) => (y.ult > x.ult) - (y.ult < x.ult),
        nome: (x, y) => cmpText(x.nome, y.nome),
    }[_groupSort];
    return _GRUPO_TIPOS.map(({ tipo, label, cls, pre, de }) => {
        const doTipo = lista.filter(t => t.tipo === tipo);
        if (!doTipo.length) return '';
        const porCat = new Map();
        doTipo.forEach(t => { const k = catLabel(t); if (!porCat.has(k)) porCat.set(k, []); porCat.get(k).push(t); });
        // dentro da caixinha: maior valor em cima (empate: mais recente primeiro)
        const caixas = [...porCat].map(([cat, itens]) => { const items = [...itens].sort((x, y) => y.valor - x.valor || y.data.localeCompare(x.data)); return ({ cat, nome: splitCatName(cat).label || cat, items, total: soma(items),
            ult: items.reduce((u, t) => (t.data > u ? t.data : u), '') }); });
        caixas.sort((x, y) => ordem(x, y) || y.total - x.total || cmpText(x.nome, y.nome));
        const totalTipo = soma(doTipo), cores = coresCategorias(caixas.map(c => c.cat));
        const caixaHtml = c => {
            const pct = totalTipo > 0 ? c.total / totalTipo * 100 : 0;
            return `<section class="tx-box${c.items.some(t => t.id === _openInlineId) ? ' wide' : ''}" style="--cor:${cores[caixas.indexOf(c)]}">
                <div class="tx-box-h"><span class="tx-box-ico" aria-hidden="true">${escHtml(splitCatName(c.cat).icon || '📦')}</span><span class="tx-box-name">${escHtml(c.nome)}</span><span class="tx-box-total ${cls}">${pre} ${fmt(c.total)}</span></div>
                <div class="tx-box-meta">${c.items.length} ${c.items.length === 1 ? 'lançamento' : 'lançamentos'} · ${escHtml(fmtPct(pct))} ${de}</div>
                <div class="tx-box-bar" aria-hidden="true"><i style="width:${Math.min(100, pct).toFixed(1)}%"></i></div>
                <table class="tx-box-table"><tbody>${c.items.map(rowHtml).join('')}</tbody></table>
            </section>`;
        };
        const cab = `<div class="tx-sec-h"><div class="gh-label"><span>${label}</span><span class="gh-count">${doTipo.length} ${doTipo.length === 1 ? 'item' : 'itens'} · ${caixas.length} categoria${caixas.length === 1 ? '' : 's'}</span><span class="gh-total ${cls}" style="font-size:13px">${pre} ${fmt(totalTipo)}</span></div></div>`;
        // "Grupo + valor" (só saídas): Necessidades / Desejos / Sem categoria, cada um com subtotal
        if (_groupSort === 'grupo_valor' && tipo === 'saida') {
            const GR = [['needs', 'Necessidades', '#2a78d6'], ['wants', 'Desejos', '#eb6834'], ['sem', 'Sem categoria', '#9aa0ab']];
            return cab + GR.map(([k, nome, cor]) => {
                const grupo = caixas.filter(c => (c.cat === '(sem categoria)' ? 'sem' : _budgetGroup(c.cat)) === k);
                if (!grupo.length) return '';
                return `<div class="tx-sub-h"><span class="orc-dot" style="background:${cor}"></span><b>${nome}</b><span class="gh-count">${grupo.length} categoria${grupo.length === 1 ? '' : 's'}</span><span class="gh-total ${cls}">${pre} ${fmt(soma(grupo.flatMap(c => c.items)))}</span></div><div class="tx-grid">${grupo.map(caixaHtml).join('')}</div>`;
            }).join('');
        }
        return cab + `<div class="tx-grid">${caixas.map(caixaHtml).join('')}</div>`;
    }).join('');
}

function toggleGroupMode() {
    groupMode = groupMode === 'cat' ? 'none' : 'cat';
    lsSet('fin5_groupMode', groupMode);
    _marcarSort();
    renderTabela();
}

function openInlineEdit(id) {
    if (_openInlineId === id) { closeInlineEdit(); return; }
    closeInlineEdit();
    // A linha pode não estar na tabela (aba/busca filtrando, ex.: clique vindo da
    // seção Débito) — limpa os filtros e re-renderiza antes de abrir.
    if (!$('ie-' + id)) {
        if (!tx.some(t => t.id === id)) return;
        $('busca').value = '';
        setTab('all');
    }
    const row = $('ie-' + id), t = tx.find(x => x.id === id);
    if (!row || !t) return;
    _openInlineId = id;
    row.innerHTML = _inlineEditorHtml(t);
    row.classList.add('open');
    row.closest('.tx-box')?.classList.add('wide');   // caixinha com o editor aberto ocupa a linha toda
    $('tr-' + id).classList.add('editing');
    $('tr-' + id).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('ie-desc-' + id).focus({ preventScroll: true });
}

function closeInlineEdit() {
    if (!_openInlineId) return;
    const row = $('ie-' + _openInlineId);
    if (row) { row.classList.remove('open'); row.innerHTML = ''; }   // libera o editor do DOM
    $('tr-'  + _openInlineId)?.classList.remove('editing');
    document.querySelectorAll('.tx-box.wide').forEach(b => b.classList.remove('wide'));
    _openInlineId = null;
}

// Mudou o pagamento no editor inline: mesmo fluxo dos formulários (mostra o cartão e, se
// vazio, sugere o padrão — _populateCardSelect preserva o cartão já escolhido)
function ieUpdateCartao(id) { formPagChange(formInline(id)); }

function saveInlineEdit(id) {
    submitTx(readTxForm(formInline(id)), id, closeInlineEdit);
}

// ── CHART HELPERS ─────────────────────────────────────────────────────────────
function destroyChart(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

// Único ponto de criação/atualização de gráficos. Reaproveita a instância quando o
// canvas é o mesmo e o tipo/nº de séries batem (atualiza sem animação: nada pisca a
// cada salvamento); recria quando o canvas foi trocado no DOM ou a forma mudou —
// destruindo o anterior (sem vazar instâncias presas a canvas órfãos).
// Sem Chart.js (CDN fora do ar) o resto da tela continua funcionando.
// Alternativa em texto para leitor de tela: o canvas vira role="img" com resumo e uma tabela oculta
// (rótulos × séries) ligada por aria-describedby. Tudo por textContent (rótulos podem ser texto do usuário).
function _chartAlt(canvas, config) {
    try {
        const labels = _asList(config.data.labels).map(l => Array.isArray(l) ? l.join(' ') : String(l)), ds = config.data.datasets || [];
        const nome = d => d.label || '';
        const num = v => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '';
        const id = canvas.id + '-alt';
        let tab = document.getElementById(id);
        if (!tab) { tab = document.createElement('table'); tab.id = id; tab.className = 'sr-only'; canvas.insertAdjacentElement('afterend', tab); }
        tab.textContent = '';
        const cap = tab.createCaption(); cap.textContent = 'Dados do gráfico' + (ds.length === 1 && nome(ds[0]) ? ': ' + nome(ds[0]) : '');
        const head = tab.insertRow(); ['Item', ...(ds.length === 1 ? ['Valor'] : ds.map(nome))].forEach(t => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = t; head.appendChild(th); });
        labels.slice(0, 80).forEach((l, i) => { const r = tab.insertRow(); const th = document.createElement('th'); th.scope = 'row'; th.textContent = l; r.appendChild(th);
            ds.forEach(d => { r.insertCell().textContent = num(Array.isArray(d.data) ? d.data[i] : undefined); }); });
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Gráfico de ${config.type === 'doughnut' ? 'rosca' : config.type === 'line' ? 'linhas' : 'barras'} com ${labels.length} item(ns). Os dados estão na tabela a seguir.`);
        canvas.setAttribute('aria-describedby', id);
    } catch (e) {}
}
function upsertChart(key, canvas, config) {
    if (!canvas || typeof Chart === 'undefined') { destroyChart(key); return null; }
    _chartAlt(canvas, config);
    const cur = charts[key];
    if (cur && cur.canvas === canvas && cur.config.type === config.type
        && cur.data.datasets.length === config.data.datasets.length) {
        cur.data.labels = config.data.labels;
        config.data.datasets.forEach((ds, i) => Object.assign(cur.data.datasets[i], ds));
        cur.options = config.options;
        cur.update('none');
        return cur;
    }
    destroyChart(key);
    return charts[key] = new Chart(canvas.getContext('2d'), config);
}
// Canvas dentro de um wrapper que alterna entre gráfico e "sem dados": reaproveita o
// canvas existente em vez de reescrever o HTML (que forçava recriar o gráfico)
function ensureCanvas(wrap, id, height) {
    const existing = wrap.querySelector('canvas#' + id);
    if (existing) return existing;
    wrap.innerHTML = `<div style="height:${height}px;position:relative"><canvas id="${id}"></canvas></div>`;
    return $(id);
}

function renderDonut(dados, cid, wid, emptyIcon, colors, emptyH = 160) {
    const wrap = $(wid), keys = Object.keys(dados);
    if (!keys.length) {
        wrap.innerHTML = `<div class="chart-empty" style="height:${emptyH}px"><span style="font-size:24px;opacity:.3">${emptyIcon}</span>Sem dados</div>`;
        destroyChart(cid); return;
    }
    upsertChart(cid, ensureCanvas(wrap, cid, emptyH), {
        type: 'doughnut',
        data: { labels: keys, datasets: [{ data: Object.values(dados), backgroundColor: keys.map((_, i) => colors[i % colors.length]), borderWidth: 2, borderColor: _cssVar('--surface', '#fff') }] },
        options: { ...CHART_COMMON_OPTS, cutout: '65%' }
    });
}

// ── FATURA HELPERS ────────────────────────────────────────────────────────────
// Returns array of { card, items, total, faturaDate } for faturas due in month m/year a
function getFaturasForMonth(m, a) {
    if (!cards.length) return [];
    const doMes = txFaturaMes(m, a);
    const result = [];
    cards.forEach(card => {
        const items = doMes.filter(t => t.cartaoId === card.id);
        if (!items.length) return;
        // Estornos/créditos (tipo entrada) abatem da fatura em vez de somar
        const total = roundMoney(items.reduce((s, t) => s + (t.tipo === 'entrada' ? -t.valor : t.valor), 0));
        // Data exibida: dia de vencimento deste mês
        const faturaDate = `${ymKey(m, a)}-${pad2(Math.min(card.vencimento, new Date(a, m + 1, 0).getDate()))}`;
        result.push({ card, items: [...items].sort((x, y) => x.data.localeCompare(y.data)), total, faturaDate });
    });
    return result;
}

// ── PRÓXIMOS VENCIMENTOS (30 dias) ───────────────────────────────────────────
// Junta fixos (saídas) e faturas de cartão que vencem nos próximos 30 dias,
// independente do mês filtrado — visão de fluxo de caixa real.
function renderVencimentos() {
    const box = $('vencBox');
    if (!box) return;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const _iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const limite = new Date(hoje); limite.setDate(limite.getDate() + 30);
    const hojeStr = _iso(hoje), limStr = _iso(limite);

    const items = [];
    // Meses tocados pela janela (30 dias podem cruzar 2 viradas de mês, ex.: 31/jan → 02/mar)
    const meses = [];
    for (let d = new Date(hoje.getFullYear(), hoje.getMonth(), 1); d <= limite; d.setMonth(d.getMonth() + 1))
        meses.push([d.getMonth(), d.getFullYear()]);
    // Fixos (saídas) na janela — via índice mensal, sem varrer todos os lançamentos
    meses.forEach(([m, a]) => txMes(m, a).forEach(t => {
        if (!t.fixo || t.tipo !== 'saida') return;
        if (t.pagamento === 'credito' && t.cartaoId) return; // já entra via fatura
        if (t.data >= hojeStr && t.data <= limStr) items.push({ data: t.data, desc: t.desc, valor: t.valor, badge: 'FIXO', cor: 'var(--debit)' });
    }));
    // Faturas de cartão que vencem na janela (antes: só mês atual e próximo)
    for (const [m, a] of meses) {
        getFaturasForMonth(m, a).forEach(f => {
            // Fatura zerada/negativa (só estornos) não é conta a pagar
            if (f.total > 0 && f.faturaDate >= hojeStr && f.faturaDate <= limStr)
                items.push({ data: f.faturaDate, desc: 'Fatura ' + f.card.nome, valor: f.total, badge: 'FATURA', cor: f.card.cor || 'var(--credit)' });
        });
    }
    items.sort((x, y) => x.data.localeCompare(y.data));

    if (!items.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    const total = items.reduce((s, i) => s + i.valor, 0);
    $('vencTotal').textContent = fmt(total) + ' no período';

    const rowHtml = i => {
        const dt = new Date(i.data + 'T00:00:00');
        const dias = Math.round((dt - hoje) / 86400000);
        const [chipTxt, chipColor, chipBg] =
            dias === 0 ? ['hoje', 'var(--danger)', 'var(--t-red-bg2)'] :
            dias === 1 ? ['amanhã', 'var(--warn)', 'var(--t-amber-bg2)'] :
            dias <= 7  ? ['em ' + dias + 'd', 'var(--warn)', 'var(--t-amber-bg2)'] :
                         ['em ' + dias + 'd', 'var(--text-3)', 'var(--bg)'];
        return `<div style="display:flex;align-items:center;gap:10px;padding:7px 2px;border-bottom:1px solid var(--border-light);font-size:12px">
            <span style="font-weight:600;color:var(--text-2);width:42px;flex-shrink:0">${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}</span>
            <span style="font-size:9px;font-weight:700;letter-spacing:.5px;padding:2px 6px;border-radius:4px;color:white;background:${corLegivel(i.cor)};flex-shrink:0">${i.badge}</span>
            <span style="flex:1;min-width:0;overflow-wrap:anywhere;font-weight:500">${escHtml(i.desc)}</span>
            <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;color:${chipColor};background:${chipBg};flex-shrink:0">${chipTxt}</span>
            <span style="font-weight:700;color:var(--danger);flex-shrink:0">${fmt(i.valor)}</span>
        </div>`;
    };
    const sectionHtml = (title, arr) => {
        if (!arr.length) return '';
        const sub = arr.reduce((s, i) => s + i.valor, 0);
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 2px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3)">
            <span>${title}</span><span>${fmt(sub)}</span>
        </div>` + arr.map(rowHtml).join('');
    };
    const fixos   = items.filter(i => i.badge === 'FIXO');
    const faturas = items.filter(i => i.badge === 'FATURA');
    $('vencList').innerHTML = sectionHtml('Fixos', fixos) + sectionHtml('Faturas', faturas)
        + `<div style="display:flex;justify-content:space-between;padding:8px 2px 0;font-size:11px;color:var(--text-3)">
        <span>${items.length} vencimento${items.length !== 1 ? 's' : ''} até ${String(limite.getDate()).padStart(2,'0')}/${String(limite.getMonth()+1).padStart(2,'0')}</span>
        <span>total <strong style="color:var(--danger)">${fmt(total)}</strong></span>
    </div>`;
}

function renderFaturas() {
    const { m, a } = filtro();
    const faturas = getFaturasForMonth(m, a);
    const section = $('faturaSection');
    const container = $('faturaAccordion');

    if (!faturas.length) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';
    container.innerHTML = faturas.map((f, idx) => {
        const [vy, vm, vd] = f.faturaDate.split('-');
        return `<div class="fatura-card ${_faturaOpen.has(faturaKey(f)) ? 'open' : ''}" id="faturaCard-${idx}">
            <div class="fatura-card-header" data-onclick="toggleFaturaCard(${idx})">
                <div class="fatura-card-dot" style="background:${f.card.cor}"></div>
                <div class="fatura-card-name">${escHtml(f.card.nome)}</div>
                <div class="fatura-card-due">vence ${vd}/${vm}</div>
                <div class="fatura-card-total">${fmt(f.total)}</div>
                <div class="fatura-card-arrow">▼</div>
            </div>
            <div class="fatura-card-body">
                ${f.items.map(t => {
                    const [y2, m2, d2] = t.data.split('-');
                    return `<div class="fatura-item">
                        <div>
                            <div class="fatura-item-desc">${escHtml(t.desc)}</div>
                            <div class="fatura-item-meta">${d2}/${m2} · ${escHtml(catLabel(t))}</div>
                        </div>
                        <div class="fatura-item-val" ${t.tipo === 'entrada' ? 'style="color:var(--success)"' : ''}>${t.tipo === 'entrada' ? '+' : '−'} ${fmt(t.valor)}</div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }).join('');
}

// Cards de fatura abertos (desktop e mobile) sobrevivem aos re-renders
const _faturaOpen = new Set();
const faturaKey = f => f.card.id + '|' + f.faturaDate;
function toggleFaturaOpen(el, key) {
    if (!el) return;
    el.classList.toggle('open');
    if (el.classList.contains('open')) _faturaOpen.add(key); else _faturaOpen.delete(key);
}
function toggleFaturaCard(idx) {
    const f = getFaturasForMonth(filtro().m, filtro().a)[idx];
    if (f) return toggleFaturaOpen($('faturaCard-' + idx), faturaKey(f));
    const el = $('faturaCard-' + idx);
    if (el) el.classList.toggle('open');
}

// ── DÉBITO TABLE ──────────────────────────────────────────────────────────────
function renderDebito() {
    const { m, a } = filtro();
    const debitos = txMes(m, a).filter(t => t.tipo === 'saida' && (t.pagamento || 'debito') === 'debito');
    const section = $('debitoSection');
    const div = $('txSectionDivider');

    if (!debitos.length) {
        section.style.display = 'none';
        if (div) div.style.display = 'none';
        return;
    }
    section.style.display = '';
    if (div) div.style.display = '';

    const total = debitos.reduce((s, t) => s + t.valor, 0);
    $('debitoCountBadge').textContent = debitos.length;
    $('debitoTotal').textContent = fmt(total);

    const body = $('debitoBody');
    const sorted2 = [...debitos].sort((a, b) => b.valor - a.valor);

    if (IS_MOBILE) {
        body.innerHTML = sorted2.map(t => {
            const [y, mo, d] = t.data.split('-');
            return `<div class="mob-fixo-item" data-onclick="openMobEdit(${t.id})" style="cursor:pointer">
                <div style="flex:1;min-width:0">
                    <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(t.desc)}${t.fixo ? '<span class="tag-fixo">FIXO</span>' : ''}</div>
                    <div style="font-size:11px;color:var(--text-3)">${d}/${mo} · ${escHtml(catLabel(t))}</div>
                </div>
                <div style="text-align:right">
                    <div style="font-weight:700;color:var(--danger);font-size:13px;white-space:nowrap">− ${fmt(t.valor)}</div>
                </div>
            </div>`;
        }).join('');
        return;
    }

    body.innerHTML = `<table class="fixos-table">${sorted2.map(t => {
        const [y, mo, d] = t.data.split('-');
        return `<tr data-onclick="openInlineEdit(${t.id})" style="cursor:pointer">
            <td style="color:var(--text-3);font-size:12px;white-space:nowrap;width:1%">${d}/${mo}</td>
            <td><span style="font-weight:500">${escHtml(t.desc)}</span>${t.fixo ? '<span class="tag-fixo">FIXO</span>' : ''}</td>
            <td style="font-size:12px;color:var(--text-3)">${escHtml(catLabel(t))}</td>
            <td style="font-weight:600;color:var(--danger);white-space:nowrap;text-align:right">− ${fmt(t.valor)}</td>
        </tr>`;
    }).join('')}</table>`;
}

// ── OVERLAP DETECTION: one-off spending that may duplicate a fixed item ──────
// Flags a non-fixo saída that has the SAME amount AND shares a meaningful word
// with a fixo saída in the same month (ignores noise words like "pix"/"plano").
const _OV_STOP = new Set(['pix','pra','the','com','ltda','para','plano','mensal','mensalidade']);
function _ovNorm(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function _ovTokens(s) {
    return new Set(_ovNorm(s).split(' ').filter(w => w.length >= 3 && !_OV_STOP.has(w)));
}
function findFixoOverlaps(m, a) {
    const lista  = txMes(m, a).filter(t => t.tipo === 'saida');
    const fixos  = lista.filter(t => t.fixo);
    const oneoff = lista.filter(t => !t.fixo);
    const pairs  = [];
    // Fixos agrupados por valor em centavos, com tokens calculados uma vez só
    const byVal = new Map();
    fixos.forEach(fx => {
        const k = Math.round(fx.valor * 100);
        if (!byVal.has(k)) byVal.set(k, []);
        byVal.get(k).push({ fx, tk: _ovTokens(fx.desc) });
    });
    oneoff.forEach(o => {
        const cands = byVal.get(Math.round(o.valor * 100));
        if (!cands) return;
        const ot = [..._ovTokens(o.desc)];
        cands.forEach(({ fx, tk }) => { if (ot.some(w => tk.has(w))) pairs.push({ one: o, fixo: fx }); });
    });
    return pairs;
}
// O que o usuário revisa é o PAR (avulso × fixo), guardado de forma persistente.
// Antes "Dispensar" valia só até recarregar e escondia o mês inteiro — inclusive
// sobreposições novas que aparecessem depois.
const _ovPairKey = p => p.one.id + ':' + p.fixo.id;
const _ovReviewed = () => new Set(loadJSON('fin5_overlap_ok', []));
function dismissOverlapBanner() {
    const { m, a } = filtro();
    const ok = _ovReviewed();
    findFixoOverlaps(m, a).forEach(p => ok.add(_ovPairKey(p)));
    storeJSON('fin5_overlap_ok', [...ok].slice(-1000));
    renderOverlapBanner(m, a);
}
function renderOverlapBanner(m, a) {
    const box = $('overlapBanner'); if (!box) return;
    const ok = _ovReviewed();
    const pairs = findFixoOverlaps(m, a).filter(p => !ok.has(_ovPairKey(p)));
    if (!pairs.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    const rows = pairs.map(p => `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;color:var(--text-2)">
        <span style="flex:1;min-width:0">
            <strong>${fmt(p.one.valor)}</strong> · "${escHtml(p.one.desc)}" pode estar duplicando o fixo "${escHtml(p.fixo.desc)}"
        </span></div>`).join('');
    box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <span style="font-weight:700;font-size:12px;color:var(--warn)">⚠️ ${pairs.length} possível(is) gasto(s) sobrepondo um fixo</span>
            <button data-onclick="dismissOverlapBanner()" style="background:none;border:none;color:var(--warn);font-size:11px;font-weight:600;cursor:pointer;padding:2px 4px">Dispensar ✕</button>
        </div>${rows}
        <div style="font-size:10px;color:var(--text-3);margin-top:3px">Mesmo valor e descrição parecida de um gasto fixo no mês. Revise e remova se for duplicado.</div>`;
}

// ── MAIN UPDATE ───────────────────────────────────────────────────────────────
function atualizar() {
    const { m, a } = filtro(), lista = txMes(m, a);
    let ent = 0, gas = 0, inv = 0;
    const catD = {}, catI = {};

    lista.forEach(t => {
        if (t.tipo === 'entrada') {
            ent += t.valor;
        } else if (t.tipo === 'investimento') {
            inv += t.valor; catI[catLabel(t)] = (catI[catLabel(t)] || 0) + t.valor;
        } else {
            gas += t.valor; catD[catLabel(t)] = (catD[catLabel(t)] || 0) + t.valor;
        }
    });

    const saldo = roundMoney(ent - gas - inv);
    $('kpiEnt').textContent = fmt(ent);
    $('kpiGas').textContent = fmt(gas);
    $('kpiInv').textContent = fmt(inv);
    const kpiSal = $('kpiSal');
    kpiSal.textContent = fmt(saldo); kpiSal.className = 'kpi-val ' + (saldo < 0 ? 'red' : '');

    // Δ vs mês anterior em cada KPI
    const pm = m === 0 ? 11 : m - 1, pa = m === 0 ? a - 1 : a;
    let pEnt = 0, pGas = 0, pInv = 0;
    txMes(pm, pa).forEach(t => {
        if (t.tipo === 'entrada') pEnt += t.valor;
        else if (t.tipo === 'investimento') pInv += t.valor;
        else pGas += t.valor;
    });
    const delta = (cur, old) => {
        if (!old || !cur) return '';
        const d = Math.round((cur - old) / old * 100);
        if (!isFinite(d) || d === 0) return '';
        return (d > 0 ? '▲ +' : '▼ ') + d + '% vs ' + MESES[pm].slice(0, 3).toLowerCase();
    };
    $('kpiEntSub').textContent = delta(ent, pEnt);
    const gasParts = [];
    if (ent > 0) gasParts.push(`${Math.round((gas / ent) * 100)}% da renda`);
    const dGas = delta(gas, pGas); if (dGas) gasParts.push(dGas);
    $('kpiGasSub').textContent = gasParts.join(' · ');
    const invSub = $('kpiInvSub'); if (invSub) invSub.textContent = delta(inv, pInv);

    const sw = $('savingsWrap');
    if (ent > 0) {
        const pct = Math.max(0, Math.round(((ent - gas) / ent) * 100));
        sw.style.display = 'block';
        $('savingsLabel').textContent = `${pct}% poupado`;
        $('savingsFill').style.width = Math.min(pct, 100) + '%';
    } else {
        sw.style.display = 'none';
    }

    updateMonthNavLabel();

    // Fixos do mês agrupados por série (não pela descrição)
    const series = fixoSeriesDoMes(m, a);
    const totalF = fixoSaidaTotal(series);
    if ($('fixosMiniTotal')) $('fixosMiniTotal').textContent = series.length ? fmt(totalF) : '';
    if ($('fixosMiniList')) $('fixosMiniList').innerHTML = series.length
        ? series.slice(0, 5).map(s =>
            `<div class="fixos-mini-item"><span class="n">${escHtml(s.desc)}</span><span class="v" style="color:${txCor(s)}">${txPre(s)} ${fmt(s.total)}</span></div>`).join('')
            + (series.length > 5 ? `<div style="text-align:center;margin-top:6px"><button class="link-btn" data-onclick="abrirPopupFixos()">ver todos (${series.length})</button></div>` : '')
        : '<span style="font-size:12px;color:var(--text-3)">Nenhum fixo.</span>';

    // Skip expensive dashboard rendering when not visible
    if (currentView === 'dashboard') {
        _dashDirty = false;
        safeRender(renderHero);
        safeRender(renderDistribution, catD);
        safeRender(renderDonut, catI, 'grafInv', 'wrapInvest', '💼', ['#6d28d9','#7c3aed','#a78bfa','#c4b5fd']);
        safeRender(renderBudgetRemaining);
        safeRender(renderOverlapBanner, m, a);
        safeRender(renderVencimentos);
        safeRender(renderFaturas);
        safeRender(renderDebito);
        safeRender(renderCartoesMini);
        safeRender(renderTabela);
    } else {
        _dashDirty = true;
    }
}

// Limite de gastos do mês = orçamento total menos a fatia alocada a investimentos
// (investir não é "gastar"). Compartilhado por dashboard, hero e orçamento.
// ym ('AAAA-MM'): investimentos fora do orçamento naquele mês não entram na conta
function investAllocPct(ym = null) {
    const al = allocsDoMes(ym);
    return (cats.investimento || []).filter(c => !ym || !_catOff(c, ym)).reduce((s, c) => s + (al[c] || 0), 0);
}
function spendBudgetOf(totalBudget, ym = null) {
    return totalBudget * (Math.max(0, 100 - investAllocPct(ym)) / 100);
}

// ── BUDGET REMAINING (dashboard panel) ───────────────────────────────────────
function renderBudgetRemaining() {
    const wrap = $('wrapBudgetRemaining');
    if (!wrap) return;
    const { m, a } = filtro();
    const totalBudget = getBudgetTotal(m, a);
    const saidas      = txMes(m, a).filter(t => t.tipo === 'saida');
    const investLista = txMes(m, a).filter(t => t.tipo === 'investimento');
    const totalSpent  = saidas.reduce((s, t) => s + t.valor, 0);

    if (!totalBudget) {
        wrap.innerHTML = `<div class="chart-empty"><span style="font-size:24px;opacity:.3">💰</span>Defina um orçamento<br><small style="font-size:10px;color:var(--text-3)">em Orçamento → Total</small></div>`;
        return;
    }

    // Carve out investment allocations — they're not money to spend
    const spendBudget    = spendBudgetOf(totalBudget, ymKey(m, a));

    const remaining  = roundMoney(spendBudget - totalSpent);
    const pctRaw     = spendBudget > 0 ? (totalSpent / spendBudget) * 100 : 0;
    const pctUsed    = Math.min(100, pctRaw);
    const overBudget = remaining < 0;
    const gaugeColor  = overBudget ? '#dc2626' : pctUsed > 80 ? '#f59e0b' : '#16a34a';
    const remainColor = overBudget ? 'var(--danger)' : 'var(--success)';   // texto: tokens com contraste AA

    // ── SVG arc gauge ────────────────────────────────────────────────────────
    // Semi-circle: center (100,108), radius 82, sweep=1 = clockwise = goes UP
    const cx = 100, cy = 108, r = 82, sw = 15;
    const pctSvg = Math.max(0.5, Math.min(99.9, pctUsed));
    const ang = Math.PI - (pctSvg / 100) * Math.PI;  // 180°→0° as pct goes 0→100
    const ex  = (cx + r * Math.cos(ang)).toFixed(2);
    const ey  = (cy - r * Math.sin(ang)).toFixed(2);
    const trackD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
    const fillD  = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex} ${ey}`;

    wrap.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;padding:4px 0 8px">

            <!-- Arc gauge -->
            <div style="position:relative;width:200px;height:112px;flex-shrink:0">
                <svg viewBox="0 0 200 118" width="200" height="112">
                    <path d="${trackD}" fill="none" stroke="var(--border)" stroke-width="${sw}" stroke-linecap="round"/>
                    <path d="${fillD}"  fill="none" stroke="${gaugeColor}"  stroke-width="${sw}" stroke-linecap="round"/>
                </svg>
                <div style="position:absolute;bottom:10px;left:0;right:0;text-align:center;line-height:1.15">
                    <div style="font-size:18px;font-weight:800;color:${remainColor};letter-spacing:-.5px">
                        ${overBudget ? '−' : ''}${fmt(Math.abs(remaining))}
                    </div>
                    <div style="font-size:10px;color:var(--text-3);margin-top:2px">
                        ${overBudget ? '⚠️ acima do limite' : 'restante'} · ${pctDoLimite(totalSpent, spendBudget)}% gasto
                    </div>
                </div>
            </div>

            <!-- Spent summary -->
            <div style="width:100%;display:flex;justify-content:space-between;font-size:10px;color:var(--text-3);padding:0 4px;margin-top:2px">
                <span>💸 ${fmt(totalSpent)} gasto</span>
                <span>de ${fmt(spendBudget)}</span>
            </div>
        </div>${_budgetMiniCats(m, a)}`;
}

// Resumo da página Orçamento dentro do painel da Visão Geral: as categorias que mais apertam
// primeiro (gastos antes dos investimentos), no máximo BUDGET_MINI_MAX; "Ver tudo" abre o Orçamento
const BUDGET_MINI_MAX = 6;
function _budgetMiniCats(m, a) {
    const mod = _orcModelo(m, a);
    const usado = c => c.vc ? c.spent / (c.vc / 100) : (c.spent ? Infinity : 0);
    const lista = mod.cats.filter(c => c.vc || c.spent)
        .sort((x, y) => (x.grupo === 'invest') - (y.grupo === 'invest') || usado(y) - usado(x) || y.vc - x.vc);
    if (!lista.length) return '';
    const linhas = lista.slice(0, BUDGET_MINI_MAX).map(c => {
        const st = _orcStatus(c), p = splitCatName(c.nome), r = c.vc ? Math.min(1, c.spent / (c.vc / 100)) : (c.spent ? 1 : 0);
        return `<div class="bm-row" title="${escHtml(st.lbl + (st.v === '—' ? '' : ' ' + st.v))}">
            <span class="bm-ico" aria-hidden="true">${escHtml(p.icon || '📦')}</span>
            <span class="bm-name">${escHtml(p.label || c.nome)}</span>
            <span class="bm-val orc-st-${st.cls}">${fmt(c.spent)} <small>de ${escHtml(_orcR0(c.vc))}</small></span>
            <span class="bm-bar"><i class="orc-fill-${st.cls === 'muted' ? 'good' : st.cls}" style="width:${(r * 100).toFixed(1)}%"></i></span>
        </div>`;
    }).join('');
    const mais = lista.length - BUDGET_MINI_MAX;
    return `<div class="bm-head"><span>Categorias</span><button class="link-btn" data-onclick="irParaOrcamento()">${mais > 0 ? `Ver todas (${lista.length})` : 'Abrir orçamento'} →</button></div>${linhas}`;
}
function irParaOrcamento() {
    const { m, a } = filtro();
    _budgetMonth = m; _budgetYear = a;
    const tabs = IS_MOBILE ? '.mob-nav-tab' : '.nav-pill', btn = [...document.querySelectorAll(tabs)].find(b => (b.getAttribute('data-onclick') || '').includes("'metas'")) || null;
    if (IS_MOBILE) mobNavTo('metas', btn); else navTo('metas', btn);
}

// ── ANNUAL VIEW ───────────────────────────────────────────────────────────────
function renderAnual() {
    const a = filtro().a;
    $('anualSubtitle').textContent = `Resumo completo de ${a}`;
    const yearLabel = $('anualYearLabel');
    if (yearLabel) yearLabel.textContent = a;
    let aEnt = 0, aGas = 0, aInv = 0, aCred = 0, aDeb = 0;
    const catAnual = {}, rows = [];

    const nowDate = new Date();
    const curMonth = nowDate.getMonth(), curYear = nowDate.getFullYear();
    // "Saldo até agora" = só o que já aconteceu (data ≤ hoje). Antes somava o mês atual
    // inteiro — fixos agendados para o fim do mês contavam como já pagos — e, num ano
    // futuro, mostrava o total do ano com o rótulo "Ainda não começou".
    const hoje = todayLocalISO();
    let sNowEnt = 0, sNowGas = 0, sNowInv = 0;

    // Single pass: aggregate per-month + "saldo até agora" in one loop
    for (let m = 0; m < 12; m++) {
        const lista = txMes(m, a);
        let ent = 0, gas = 0, inv = 0, cred = 0, deb = 0;
        lista.forEach(t => {
            const ateHoje = t.data <= hoje;
            if (t.tipo === 'entrada') { ent += t.valor; if (ateHoje) sNowEnt += t.valor; }
            else if (t.tipo === 'investimento') { inv += t.valor; if (ateHoje) sNowInv += t.valor; }
            else {
                gas += t.valor; if (ateHoje) sNowGas += t.valor;
                catAnual[catLabel(t)] = (catAnual[catLabel(t)] || 0) + t.valor;
                if (t.pagamento === 'credito') cred += t.valor; else deb += t.valor;
            }
        });
        aEnt += ent; aGas += gas; aInv += inv; aCred += cred; aDeb += deb;
        rows.push({ m, ent, gas, inv, cred, deb, saldo: roundMoney(ent - gas - inv) });
    }
    const aSaldo = roundMoney(aEnt - aGas - aInv);
    const saldoNow = roundMoney(sNowEnt - sNowGas - sNowInv);

    // Comparativo com o ano anterior no MESMO período (ano em andamento: jan até o mês atual; senão o ano todo)
    {
        const ate = a === curYear ? curMonth : 11;
        let cEnt = 0, cGas = 0, cInv = 0, pEnt = 0, pGas = 0, pInv = 0;
        for (let m = 0; m <= ate; m++) {
            txMes(m, a).forEach(t => { if (t.tipo === 'entrada') cEnt += t.valor; else if (t.tipo === 'investimento') cInv += t.valor; else cGas += t.valor; });
            txMes(m, a - 1).forEach(t => { if (t.tipo === 'entrada') pEnt += t.valor; else if (t.tipo === 'investimento') pInv += t.valor; else pGas += t.valor; });
        }
        const per = a === curYear ? ` (jan–${MESES[ate].slice(0, 3).toLowerCase()})` : '';
        const dlt = (cur, old) => {
            if (!(old > 0) || !(cur > 0)) return '';
            const d = Math.round((cur - old) / old * 100);
            return d === 0 ? `= ${a - 1}${per}` : `${d > 0 ? '▲ +' : '▼ '}${Math.abs(d)}% vs ${a - 1}${per}`;
        };
        [['aKpiEntSub', cEnt, pEnt], ['aKpiGasSub', cGas, pGas], ['aKpiInvSub', cInv, pInv]].forEach(([id, c, o]) => { const el = $(id); if (el) el.textContent = dlt(c, o); });
    }
    $('aKpiEnt').textContent = fmt(aEnt);
    $('aKpiGas').textContent = fmt(aGas);
    $('aKpiInv').textContent = fmt(aInv);
    const aKpiSaldo = $('aKpiSaldo');
    aKpiSaldo.textContent = fmt(aSaldo); aKpiSaldo.className = 'kpi-val ' + (aSaldo < 0 ? 'red' : '');

    const aKpiSaldoNow = $('aKpiSaldoNow');
    aKpiSaldoNow.textContent = fmt(saldoNow);
    aKpiSaldoNow.style.color = saldoNow < 0 ? 'var(--danger)' : 'var(--success)';
    $('aKpiSaldoNowSub').textContent = a === curYear
        ? `1º/jan → hoje (${hoje.slice(8, 10)}/${hoje.slice(5, 7)})`
        : (a < curYear ? 'Ano completo' : 'Ainda não começou');

    const anualLabels = MESES.map(m => m.slice(0, 3));
    const acc = _chartColors();
    const anualDs = [
        { label: 'Entradas', stack: 'in',  data: rows.map(r => r.ent),  backgroundColor: acc.entBg,  borderColor: acc.entBd,  borderWidth: 1.5, borderRadius: 3 },
        { label: 'Débito',   stack: 'out', data: rows.map(r => r.deb),  backgroundColor: acc.debBg,  borderColor: acc.debBd,  borderWidth: 1.5, borderRadius: 3 },
        { label: 'Crédito',  stack: 'out', data: rows.map(r => r.cred), backgroundColor: acc.credBg, borderColor: acc.credBd, borderWidth: 1.5, borderRadius: 3 },
        { label: 'Invest.',  stack: 'inv', data: rows.map(r => r.inv),  backgroundColor: acc.invBg,  borderColor: acc.invBd,  borderWidth: 1.5, borderRadius: 3 }
    ];
    // Débito + Crédito share stack 'out' → one "gastos" bar split into the two segments
    const anualScales = { x: { ...AXIS_OPTS.x, stacked: true }, y: { ...AXIS_OPTS.y, stacked: true } };
    upsertChart('anual', $('graficoAnual'), {
        type: 'bar', data: { labels: anualLabels, datasets: anualDs },
        options: { ...CHART_COMMON_OPTS, scales: anualScales }
    });

    renderDonut(catAnual, 'grafAnualCat', 'wrapAnualCat', '📉', CAT_COLORS, 240);
    renderHeroAnual();
    safeRender(renderPatrimonio);

    let accumulated = 0;
    $('anualTbody').innerHTML = rows.map(r => {
        const hasData = r.ent || r.gas || r.inv;
        const sc = r.saldo >= 0 ? 'green-val' : 'red-val';
        if (hasData) accumulated = roundMoney(accumulated + r.saldo);
        const ac = accumulated >= 0 ? 'green-val' : 'red-val';
        return `<tr class="${hasData ? 'clickable' : ''}" data-onclick="${hasData ? `goToMensal(${r.m},${a})` : ''}">
            <td>${MESES[r.m]}</td>
            <td class="green-val">${r.ent ? fmt(r.ent) : '—'}</td>
            <td class="red-val">${r.gas ? fmt(r.gas) : '—'}</td>
            <td class="purple-val">${r.inv ? fmt(r.inv) : '—'}</td>
            <td class="${hasData ? sc : ''}">${hasData ? fmt(r.saldo) : '—'}</td>
            <td class="${hasData ? ac : ''}">${hasData ? fmt(accumulated) : '—'}</td>
        </tr>`;
    }).join('');
}

// ── MONTHLY ANALYSIS VIEW ─────────────────────────────────────────────────────
// ── ANÁLISE MENSAL: REVISÃO DO MÊS ──────────────────────────────────────────
// A Visão Geral é o dia a dia (lançar, quanto ainda pode gastar, lançamentos, faturas).
// Aqui o mês é revisto: comparação com a média dos 3 meses anteriores, a cascata
// entrou → fixos → parcelas → juros → dia a dia → investido → sobrou, o calendário de
// gastos, maiores gastos, lugares recorrentes e o que mudou por categoria.
const MES_JUROS_RE = /\b(juros|encargos?|multas?|iof|atraso|mora|tarifas?|anuidade)\b/i;
const MES_PARCELA_RE = /\bparcela\s*\d+\s*\/\s*\d+/i;
const MES_RAMPA_CLARA = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'], MES_RAMPA_ESCURA = ['#1b2f55', '#234279', '#2c569e', '#3a6dc6', '#5588e6', '#7ba3f5'];
const _mesRampa = () => _temaEscuro() ? MES_RAMPA_ESCURA : MES_RAMPA_CLARA;   // sequencial azul (menos → mais)
const MES_CORES = { entrou: '#1baf7a', saiu: '#eb6834', invest: '#4a3aa7', sobrou: '#2a78d6', faltou: '#e34948' };
const MES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MES_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const _fmtCompacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
let _mesDia = null, _mesLigado = false;            // dia escolhido no calendário: { ym, dia }

const _mesRel = (m, a, k) => { const d = new Date(a, m + k, 1); return [d.getMonth(), d.getFullYear()]; };
// Tipo de gasto para a cascata (juros primeiro: "Juros - parcela 2/3" é juros)
function _mesTipoGasto(t) {
    const d = t.desc || '';
    if (MES_JUROS_RE.test(d)) return 'juros';
    if (t.fixo) return 'fixos';
    if (MES_PARCELA_RE.test(d)) return 'parcelas';
    return 'dia';
}
// ateDia: só lançamentos até esse dia (mês em andamento é comparado no mesmo ponto dos anteriores)
function _mesResumo(m, a, ateDia = 31) {
    const lista = txMes(m, a);
    let ent = 0, gas = 0, inv = 0;
    const cat = new Map();
    for (const t of lista) {
        if (+t.data.slice(8, 10) > ateDia) continue;
        if (t.tipo === 'entrada') ent += t.valor;
        else if (t.tipo === 'investimento') inv += t.valor;
        else { gas += t.valor; const k = catLabel(t); cat.set(k, (cat.get(k) || 0) + t.valor); }
    }
    return { m, a, lista, ent: roundMoney(ent), gas: roundMoney(gas), inv: roundMoney(inv), cat };
}
const _mesNomeCat = c => { const p = splitCatName(c); return p.label || c; };
const _mesIco = c => splitCatName(c).icon || '📦';
const _mesR0 = v => fmt(Math.round(v)).replace(/,00$/, '');
const _mesDelta = d => (d > 0 ? '▲ ' : '▼ ') + _mesR0(Math.abs(d));
const _mesCompacto = () => IS_MOBILE || matchMedia('(max-width: 700px)').matches;

function renderMensal() {
    const { m, a } = filtro();
    const r = _mesResumo(m, a), fase = periodoFase(a, m);
    // Base de comparação: até 3 meses anteriores com uso real (≥ 5 lançamentos). Mês em andamento:
    // compara só até hoje, com os anteriores no mesmo dia. Mês futuro só tem o que já foi lançado: sem média.
    const ateDia = fase === 'atual' ? new Date().getDate() : 31;
    const base = fase === 'futuro' ? [] : [1, 2, 3].map(k => _mesRel(m, a, -k)).filter(([mm, aa]) => txMes(mm, aa).length >= 5).map(([mm, aa]) => _mesResumo(mm, aa, ateDia));
    const rc = fase === 'atual' ? _mesResumo(m, a, ateDia) : r;     // o que se compara com a base
    const media = f => base.length ? base.reduce((s, x) => s + f(x), 0) / base.length : null;
    const mGas = media(x => x.gas), mEnt = media(x => x.ent);
    const ateTxt = fase === 'atual' ? ` até o dia ${ateDia}` : '';
    const saidas = r.lista.filter(t => t.tipo === 'saida');
    const cred = roundMoney(saidas.reduce((s, t) => s + (t.pagamento === 'credito' ? t.valor : 0), 0));
    const deb = roundMoney(r.gas - cred);
    const saldo = roundMoney(r.ent - r.gas - r.inv);
    const baseTxt = base.length === 1 ? 'do mês anterior' : `dos ${base.length} meses anteriores`;

    // ── Cartão azul ──
    $('mHeroLabel').textContent = `${fase === 'futuro' ? 'Saldo previsto' : 'Saldo'} de ${MESES[m]} ${a}`;
    $('mKpiSaldo').textContent = fmt(saldo);
    $('mKpiSaldo').classList.toggle('neg', saldo < 0);
    $('mHeroSub').textContent = `entrou ${fmt(r.ent)} − saiu ${fmt(r.gas)}${r.inv ? ` − investiu ${fmt(r.inv)}` : ''}`;
    $('mKpiGas').textContent = fmt(r.gas);
    $('mKpiGasSub').textContent = mGas != null && Math.abs(rc.gas - mGas) >= 1 ? `${_mesDelta(rc.gas - mGas)} ${rc.gas > mGas ? 'acima' : 'abaixo'} da média${ateTxt}` : fase === 'futuro' ? 'só o que já foi lançado' : (r.ent > 0 ? `${Math.round(r.gas / r.ent * 100)}% do que entrou` : '');
    $('mKpiEnt').textContent = fmt(r.ent);
    $('mKpiEntSub').textContent = mEnt != null && Math.abs(rc.ent - mEnt) >= 1 ? `${_mesDelta(rc.ent - mEnt)} ${rc.ent > mEnt ? 'acima' : 'abaixo'} da média${ateTxt}` : '';
    $('mKpiCred').textContent = fmt(cred);
    $('mKpiCredSub').textContent = r.gas > 0 ? `${Math.round(cred / r.gas * 100)}% dos gastos · débito ${fmt(deb)}` : '';
    if (fase === 'passado') {
        const pou = r.ent > 0 ? Math.round((r.ent - r.gas) / r.ent * 100) : null;
        $('mKpiProxLbl').textContent = 'Taxa de poupança';
        $('mKpiProx').textContent = pou == null ? '—' : `${pou}%`;
        $('mKpiProxSub').textContent = pou == null ? 'sem entradas' : pou >= 0 ? 'do que entrou ficou' : 'gastou mais do que entrou';
    } else {
        const [nm, na] = _mesRel(m, a, 1), prox = txMes(nm, na).filter(t => t.tipo === 'saida');
        const nPar = prox.filter(t => MES_PARCELA_RE.test(t.desc || '')).length, nFix = prox.filter(t => t.fixo).length;
        $('mKpiProxLbl').textContent = `Já lançado em ${MESES[nm].toLowerCase()}`;
        $('mKpiProx').textContent = fmt(prox.reduce((s, t) => s + t.valor, 0));
        $('mKpiProxSub').textContent = prox.length ? [nPar ? `${nPar} parcela${nPar !== 1 ? 's' : ''}` : '', nFix ? `${nFix} fixo${nFix !== 1 ? 's' : ''}` : '', prox.length - nPar - nFix > 0 ? `${prox.length - nPar - nFix} outro${prox.length - nPar - nFix !== 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') : 'nada lançado ainda';
    }
    // Por categoria: este mês x média (categorias sem gasto num mês contam como zero)
    const nomes = new Set([...rc.cat.keys(), ...base.flatMap(x => [...x.cat.keys()])]);
    const porCat = [...nomes].map(c => {
        const cur = rc.cat.get(c) || 0, med = base.length ? base.reduce((s, x) => s + (x.cat.get(c) || 0), 0) / base.length : null;
        return { c, cur, med, d: med == null ? null : cur - med };
    });
    const tip = $('mHeroTip');
    if (mGas != null && rc.gas > 0) {
        const d = rc.gas - mGas, altas = porCat.filter(x => x.d > 0).sort((x, y) => y.d - x.d), quedas = porCat.filter(x => x.d < 0).sort((x, y) => x.d - y.d);
        const nomesTop = arr => arr.slice(0, 2).map(x => `${_mesNomeCat(x.c)} (${x.d > 0 ? '+' : '−'}${_mesR0(Math.abs(x.d))})`).join(' e ');
        const quando = fase === 'atual' ? `Até hoje (dia ${ateDia}) você gastou ${_mesR0(rc.gas)}: ` : 'Você gastou ';
        const ref = `média ${baseTxt}${ateTxt} (${_mesR0(mGas)})`;
        $('mHeroTipText').textContent = Math.abs(d) < mGas * 0.03
            ? `${fase === 'atual' ? quando + 'em' : 'Gastos em'} linha com a ${ref}.`
            : d > 0 ? `${quando}${_mesR0(d)} a mais que a ${ref}${altas.length ? `, puxado por ${nomesTop(altas)}` : ''}.`
            : `${quando}${_mesR0(-d)} a menos que a ${ref}${quedas.length ? `. Maior economia: ${nomesTop(quedas.slice(0, 1))}` : ''}.`;
        tip.style.display = '';
    } else tip.style.display = 'none';

    _mesCascata(r, saidas, saldo);
    _mesDestaques(r, saidas, porCat, m, a, fase);
    _mesCalendario(r, m, a);
    _mesListas(saidas);
    _mesMudou(porCat, base, m, a, rc.gas, mGas, fase, ateTxt);
    _mesLigar();
}

function _mesCascata(r, saidas, saldo) {
    const grupos = { fixos: [], parcelas: [], juros: [], dia: [] };
    saidas.forEach(t => {
        const g = _mesTipoGasto(t), j = g === 'juros' ? 0 : (t.juros || 0);
        if (!(j > 0)) { grupos[g].push(t); return; }
        // Juros embutidos: a parte de juros vai para "Juros e tarifas", o resto fica no tipo do lançamento
        if (t.valor - j > 0) grupos[g].push({ ...t, valor: roundMoney(t.valor - j) });
        grupos.juros.push({ ...t, valor: j, desc: `${t.desc} (juros)` });
    });
    const soma = arr => roundMoney(arr.reduce((s, t) => s + t.valor, 0));
    const detalhe = arr => [...arr].sort((x, y) => y.valor - x.valor).slice(0, 3).map(t => `${t.desc}: ${fmt(t.valor)}`).join('\n');
    const passos = [{ nome: 'Entrou', v: r.ent, cor: MES_CORES.entrou, tipo: '+' }];
    [['fixos', 'Fixos'], ['parcelas', 'Parcelas'], ['juros', 'Juros e tarifas'], ['dia', 'Dia a dia']].forEach(([k, nome]) => {
        const v = soma(grupos[k]);
        if (v > 0) passos.push({ nome, v, cor: MES_CORES.saiu, tipo: '-', n: grupos[k].length, det: detalhe(grupos[k]) });
    });
    if (r.inv > 0) passos.push({ nome: 'Investido', v: r.inv, cor: MES_CORES.invest, tipo: '-' });
    passos.push({ nome: saldo >= 0 ? 'Sobrou' : 'Faltou', v: saldo, cor: saldo >= 0 ? MES_CORES.sobrou : MES_CORES.faltou, tipo: '=' });
    // Posição de cada barra (de lo a hi) na escala [min, max]
    let acc = 0;
    passos.forEach(p => {
        if (p.tipo === '+') { p.lo = 0; p.hi = p.v; acc = p.v; }
        else if (p.tipo === '-') { p.hi = acc; p.lo = acc - p.v; acc = p.lo; }
        else { p.lo = Math.min(0, p.v); p.hi = Math.max(0, p.v); }
    });
    const max = Math.max(0, ...passos.map(p => p.hi)), min = Math.min(0, ...passos.map(p => p.lo)), faixa = max - min || 1;
    const y = v => ((max - v) / faixa * 100).toFixed(2);
    const el = $('mCascata');
    if (!r.ent && !r.gas && !r.inv) { el.innerHTML = '<div class="mes-vazio">Nenhum lançamento neste mês.</div>'; $('mCascataNota').textContent = ''; return; }
    const curto = _mesCompacto(), val = v => curto ? _fmtCompacto.format(v) : _mesR0(v);
    el.setAttribute('aria-label', passos.map(p => `${p.nome} ${fmt(p.tipo === '-' ? -p.v : p.v)}`).join(', '));
    el.innerHTML = `<div class="mc-cols" style="--zero:${y(0)}%">${passos.map((p, i) => {
        const prox = passos[i + 1], ligar = prox && p.tipo !== '=' ? (p.tipo === '+' ? p.hi : p.lo) : null;
        const tit = `${p.nome}: ${fmt(p.tipo === '-' ? -p.v : p.v)}${p.n ? ` (${p.n} lançamento${p.n !== 1 ? 's' : ''})` : ''}${p.det ? '\n' + p.det : ''}`;
        return `<div class="mc-col" title="${escHtml(tit)}">
            <span class="mc-val">${p.tipo === '-' || p.v < 0 ? '−' : ''}${escHtml(val(Math.abs(p.v)))}</span>
            <div class="mc-plot"><div class="mc-bar" style="top:${y(p.hi)}%;height:max(2px, ${(+y(p.lo) - +y(p.hi)).toFixed(2)}%);background:${p.cor}"></div>${ligar != null ? `<i class="mc-link" style="top:${y(ligar)}%"></i>` : ''}</div>
            <span class="mc-nome">${escHtml(p.nome)}</span>
        </div>`;
    }).join('')}</div>`;
    const notas = [];
    if (grupos.parcelas.length) notas.push(`<b>Parcelas</b>: ${grupos.parcelas.length} compra${grupos.parcelas.length !== 1 ? 's' : ''} parcelada${grupos.parcelas.length !== 1 ? 's' : ''} que caíram neste mês`);
    if (grupos.juros.length) notas.push(`<b>Juros e tarifas</b>: juros, IOF, multas e encargos`);
    $('mCascataNota').innerHTML = notas.join(' · ');
}

// Juros/multas pagos no mês: lançamentos que SÃO juros (pela descrição) mais a parte de juros
// EMBUTIDA em outros (boleto pago com atraso, parcela de empréstimo)
function _mesJuros(saidas) {
    const ehJuros = t => MES_JUROS_RE.test(t.desc || ''), proprios = saidas.filter(ehJuros), embutidos = saidas.filter(t => t.juros && !ehJuros(t));
    return { v: roundMoney(proprios.reduce((s, t) => s + t.valor, 0) + embutidos.reduce((s, t) => s + t.juros, 0)), n: proprios.length + embutidos.length };
}
function _mesDestaques(r, saidas, porCat, m, a, fase) {
    const itens = [], cmp = porCat.filter(x => x.d != null && x.c !== '(sem categoria)');
    const alta = cmp.filter(x => x.d >= 100 && (!x.med || x.d / x.med >= 0.2)).sort((x, y) => y.d - x.d)[0];
    if (alta) itens.push(['📈', `<b>${escHtml(_mesIco(alta.c) + ' ' + _mesNomeCat(alta.c))}</b> subiu ${_mesR0(alta.d)} em relação à média (${_mesR0(alta.med)} → ${_mesR0(alta.cur)})`]);
    const queda = cmp.filter(x => x.d <= -100).sort((x, y) => x.d - y.d)[0];
    if (queda) itens.push(['📉', `<b>${escHtml(_mesIco(queda.c) + ' ' + _mesNomeCat(queda.c))}</b> caiu ${_mesR0(-queda.d)} (${_mesR0(queda.med)} → ${_mesR0(queda.cur)})`]);
    const { v: vj, n: nj } = _mesJuros(saidas);
    if (vj > 0) itens.push(['⚠️', `<b>${fmt(vj)} em juros, IOF e multas</b> (${nj} lançamento${nj !== 1 ? 's' : ''}, ${Math.round(vj / (r.gas || 1) * 100)}% dos gastos): dinheiro que não comprou nada`]);
    const dias = new Date(a, m + 1, 0).getDate(), porDia = Array(dias + 1).fill(0), qtd = Array(dias + 1).fill(0);
    saidas.forEach(t => { const d = +t.data.slice(8, 10); porDia[d] += t.valor; qtd[d]++; });
    const maior = porDia.reduce((b, v, d) => v > porDia[b] ? d : b, 1);
    if (porDia[maior] > 0) itens.push(['📅', `<b>${pad2(maior)}/${pad2(m + 1)}</b> foi o dia mais caro: ${fmt(porDia[maior])} em ${qtd[maior]} gasto${qtd[maior] !== 1 ? 's' : ''}`]);
    const ate = fase === 'atual' ? new Date().getDate() : fase === 'futuro' ? 0 : dias;
    if (ate > 0) {
        const sem = porDia.slice(1, ate + 1).filter(v => !v).length;
        itens.push(['🌿', sem ? `<b>${sem} dia${sem !== 1 ? 's' : ''}</b> sem nenhum gasto${fase === 'atual' ? ' até hoje' : ''}` : `Teve gasto em <b>todos os dias</b>${fase === 'atual' ? ' até hoje' : ''}`]);
    }
    const fds = saidas.reduce((s, t) => { const w = new Date(t.data + 'T00:00:00').getDay(); return s + (w === 0 || w === 6 ? t.valor : 0); }, 0);
    if (r.gas > 0 && itens.length < 5) itens.push(['🛋️', `<b>${Math.round(fds / r.gas * 100)}%</b> dos gastos foram no fim de semana`]);
    $('mDestaques').innerHTML = itens.length ? itens.slice(0, 5).map(([ic, h]) => `<li><span class="mes-d-ico" aria-hidden="true">${ic}</span><span>${h}</span></li>`).join('')
        : '<li class="mes-vazio">Sem gastos neste mês.</li>';
}

function _mesCalendario(r, m, a) {
    const dias = new Date(a, m + 1, 0).getDate(), ini = new Date(a, m, 1).getDay(), ym = ymKey(m, a);
    const gasto = Array(dias + 1).fill(0), entrou = Array(dias + 1).fill(0), n = Array(dias + 1).fill(0);
    r.lista.forEach(t => {
        const d = +t.data.slice(8, 10);
        if (t.tipo === 'saida') { gasto[d] += t.valor; n[d]++; } else if (t.tipo === 'entrada') entrou[d] += t.valor;
    });
    const max = Math.max(0, ...gasto), hoje = todayLocalISO(), curto = _mesCompacto();
    if (!_mesDia || _mesDia.ym !== ym) {
        const top = gasto.reduce((b, v, d) => v > gasto[b] ? d : b, 1);
        _mesDia = { ym, dia: gasto[top] > 0 ? top : null };
    }
    let h = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((x, i) => `<span class="mes-cal-sem" title="${MES_SEMANA[i]}">${x}</span>`).join('');
    for (let i = 0; i < ini; i++) h += '<span></span>';
    for (let d = 1; d <= dias; d++) {
        const v = gasto[d], iso = `${ym}-${pad2(d)}`;
        const k = v > 0 ? Math.min(_mesRampa().length - 1, Math.floor(Math.sqrt(v / max) * _mesRampa().length - 1e-9)) : -1;
        const tit = `${pad2(d)}/${pad2(m + 1)}: ${v ? `${fmt(v)} em ${n[d]} gasto${n[d] !== 1 ? 's' : ''}` : 'sem gastos'}${entrou[d] ? ` · entrada ${fmt(entrou[d])}` : ''}`;
        h += `<button class="mes-dia${k >= 3 ? ' esc' : ''}${iso === hoje ? ' hoje' : ''}${iso > hoje ? ' fut' : ''}" data-dia="${d}" aria-pressed="${_mesDia.dia === d}" title="${escHtml(tit)}" style="${k >= 0 ? `background:${_mesRampa()[k]}` : ''}">
            <b>${d}</b>${v && !curto ? `<span>${escHtml(v < 1000 ? String(Math.round(v)) : _fmtCompacto.format(v))}</span>` : ''}${entrou[d] ? '<i class="mes-ent" aria-label="teve entrada">+</i>' : ''}</button>`;
    }
    $('mCal').innerHTML = h;
    $('mCalLeg').innerHTML = `<span>menos</span>${_mesRampa().map(c => `<i style="background:${c}"></i>`).join('')}<span>mais</span><span class="mes-cal-leg-ent"><i class="mes-ent">+</i> entrada</span>`;
    _mesRenderDia(r, m);
}
function _mesRenderDia(r, m) {
    const el = $('mCalDia'), d = _mesDia && _mesDia.dia;
    if (!d) { el.innerHTML = '<div class="mes-vazio">Clique num dia para ver os lançamentos.</div>'; return; }
    const doDia = r.lista.filter(t => +t.data.slice(8, 10) === d && t.tipo !== 'investimento').sort((x, y) => y.valor - x.valor);
    const tot = roundMoney(doDia.reduce((s, t) => s + (t.tipo === 'saida' ? t.valor : 0), 0));
    const w = new Date(r.a, r.m, d).getDay();
    el.innerHTML = `<div class="mes-dia-h"><b>${MES_SEMANA[w]}, ${pad2(d)}/${pad2(m + 1)}</b><span>${tot ? `${fmt(tot)} em gastos` : 'sem gastos'}</span></div>`
        + (doDia.length ? doDia.slice(0, 8).map(t => `<div class="mes-li"><span class="mes-li-n">${escHtml(t.desc)}<small>${escHtml(catLabel(t))}${t.pagamento === 'credito' ? ' · crédito' : ''}</small></span><b class="${t.tipo === 'entrada' ? 'pos' : ''}">${t.tipo === 'entrada' ? '+' : '−'} ${fmt(t.valor)}</b></div>`).join('')
            + (doDia.length > 8 ? `<div class="mes-mais">+ ${doDia.length - 8} lançamento${doDia.length - 8 !== 1 ? 's' : ''} menores</div>` : '')
            : '<div class="mes-vazio">Nenhum lançamento neste dia.</div>');
}

function _mesListas(saidas) {
    const top = [...saidas].sort((x, y) => y.valor - x.valor).slice(0, 6);
    $('mTop').innerHTML = top.length ? top.map(t => `<div class="mes-li"><span class="mes-li-d">${t.data.slice(8, 10)}/${t.data.slice(5, 7)}</span><span class="mes-li-n">${escHtml(t.desc)}<small>${escHtml(catLabel(t))}</small></span><b>${fmt(t.valor)}</b></div>`).join('')
        : '<div class="mes-vazio">Sem gastos neste mês.</div>';
    // Lugares: agrupa pelo nome antes de " - " (sem "Parcela n/m"); só o que se repetiu
    const grupos = new Map();
    saidas.forEach(t => {
        if (MES_JUROS_RE.test(t.desc || '')) return;   // juros já aparecem nos destaques
        const nome = (t.desc || '').replace(MES_PARCELA_RE, '').split(/\s+-\s+/)[0].replace(/\s+/g, ' ').trim();
        if (!nome) return;
        const k = nome.toLocaleLowerCase('pt-BR');
        const g = grupos.get(k) || { nome, v: 0, n: 0 };
        g.v += t.valor; g.n++; grupos.set(k, g);
    });
    const lug = [...grupos.values()].filter(g => g.n >= 2).sort((x, y) => y.v - x.v).slice(0, 6);
    $('mLugares').innerHTML = lug.length ? lug.map(g => `<div class="mes-li"><span class="mes-li-x">${g.n}×</span><span class="mes-li-n">${escHtml(g.nome)}<small>média ${fmt(g.v / g.n)} por vez</small></span><b>${fmt(g.v)}</b></div>`).join('')
        : '<div class="mes-vazio">Nenhum lugar se repetiu neste mês.</div>';
}

// Ordem de "O que mudou por categoria": guardada neste aparelho
const MUDOU_ORDENS = ['mudanca', 'valor', 'alta', 'queda', 'nome', 'grupo_valor', 'grupo_mudanca'];
let _mudouSort = MUDOU_ORDENS.includes(lsGet('fin5_mudouSort')) ? lsGet('fin5_mudouSort') : 'mudanca';
function setMudouSort(v) {
    if (!MUDOU_ORDENS.includes(v)) return;
    _mudouSort = v; lsSet('fin5_mudouSort', v);
    safeRender(renderMensal);
}
function _mesMudou(porCat, base, m, a, gas, mGas, fase, ateTxt) {
    const meses = [-5, -4, -3, -2, -1, 0].map(k => _mesRel(m, a, k));
    const hist = new Map(meses.map(([mm, aa]) => [ymKey(mm, aa), _mesResumo(mm, aa).cat]));
    const ultimo = base.length ? base[base.length - 1] : null;
    $('mMudouBase').textContent = base.length
        ? `este mês × média de ${base.length === 1 ? MES_ABREV[base[0].m] : `${MES_ABREV[ultimo.m]}–${MES_ABREV[base[0].m]}`}${ateTxt}`
        : fase === 'futuro' ? 'mês futuro: só o que já foi lançado' : 'sem meses anteriores para comparar';
    // Sem meses para comparar não há "mudança": alta/queda/mudança caem para o maior gasto
    const dd = x => x.d == null ? 0 : x.d, cmp = base.length ? {
        mudanca: (x, y) => Math.abs(dd(y)) - Math.abs(dd(x)),
        alta:    (x, y) => dd(y) - dd(x),
        queda:   (x, y) => dd(x) - dd(y),
    } : {};
    // "Grupo + …": separa em Necessidades / Desejos / Sem categoria (com subtotal) e ordena dentro de cada grupo
    const porGrupo = _mudouSort.startsWith('grupo_'), chaveOrdem = porGrupo ? _mudouSort.slice(6) : _mudouSort;
    const ordem = cmp[chaveOrdem] || (chaveOrdem === 'nome' ? (x, y) => cmpText(_mesNomeCat(x.c), _mesNomeCat(y.c)) : (x, y) => 0);
    const sel = $('mMudouSort'); if (sel) sel.value = _mudouSort;
    const linhas = porCat.filter(x => x.cur > 0 || (x.med || 0) >= 1)
        .sort((x, y) => ordem(x, y) || y.cur - x.cur || cmpText(_mesNomeCat(x.c), _mesNomeCat(y.c)));
    if (!linhas.length) { $('mMudou').innerHTML = '<div class="mes-vazio" style="padding:16px">Sem gastos neste mês nem nos anteriores.</div>'; return; }
    const spark = x => {
        const vals = meses.map(([mm, aa], i) => i === 5 ? x.cur : (hist.get(ymKey(mm, aa)).get(x.c) || 0)), mx = Math.max(...vals) || 1;
        return `<span class="mes-spark" aria-hidden="true">${vals.map((v, i) => `<i style="height:${Math.max(v ? 8 : 3, v / mx * 100).toFixed(0)}%" class="${i === 5 ? 'cur' : ''}" title="${MES_ABREV[meses[i][0]]}/${String(meses[i][1]).slice(2)}: ${escHtml(fmt(v))}"></i>`).join('')}</span>`;
    };
    const dif = x => {
        if (x.med == null) return '<span class="mes-dif">—</span>';
        if (!x.med && x.cur) return '<span class="mes-dif up">novo</span>';
        const lim = Math.max(50, x.med * 0.1);
        if (Math.abs(x.d) < lim) return `<span class="mes-dif">≈ igual</span>`;
        return `<span class="mes-dif ${x.d > 0 ? 'up' : 'down'}">${_mesDelta(x.d)}${x.med ? ` <small>${x.d > 0 ? '+' : '−'}${Math.round(Math.abs(x.d) / x.med * 100)}%</small>` : ''}</span>`;
    };
    const coresLista = coresCategorias(linhas.map(l => l.c)), cores = new Map(linhas.map((x, i) => [x.c, coresLista[i]]));
    const linha = x => `<div class="mes-mrow mes-mcat" style="--cor:${cores.get(x.c)}">
        <span class="mes-m-cat"><span aria-hidden="true">${escHtml(_mesIco(x.c))}</span> ${escHtml(_mesNomeCat(x.c))}</span>
        <span class="mes-m-v">${fmt(x.cur)}</span>
        <span class="mes-m-v mes-m-med">${x.med == null ? '—' : fmt(x.med)}</span>
        ${dif(x)}
        ${spark(x)}
    </div>`;
    const total = { c: 'Total de gastos', cur: gas, med: mGas, d: mGas == null ? null : gas - mGas };
    const GRUPOS_MES = [['needs', 'Necessidades', '#2a78d6'], ['wants', 'Desejos', '#eb6834'], ['sem', 'Sem categoria', '#9aa0ab']];
    const grupoDe = x => x.c === '(sem categoria)' ? 'sem' : _budgetGroup(x.c);
    const cabGrupo = (nome, cor, itens) => {
        const cur = roundMoney(itens.reduce((t, x) => t + x.cur, 0)), med = base.length ? roundMoney(itens.reduce((t, x) => t + (x.med || 0), 0)) : null;
        return `<div class="mes-mrow mes-mgrp"><span class="mes-m-cat"><span class="orc-dot" style="background:${cor}"></span> ${nome} <small>${itens.length} categoria${itens.length !== 1 ? 's' : ''}</small></span><span class="mes-m-v">${fmt(cur)}</span><span class="mes-m-v mes-m-med">${med == null ? '—' : fmt(med)}</span>${dif({ cur, med, d: med == null ? null : cur - med })}<span></span></div>`;
    };
    const corpo = porGrupo
        ? GRUPOS_MES.map(([k, nome, cor]) => { const it = linhas.filter(x => grupoDe(x) === k); return it.length ? cabGrupo(nome, cor, it) + it.map(linha).join('') : ''; }).join('')
        : linhas.map(linha).join('');
    $('mMudou').innerHTML = `<div class="mes-mrow mes-mhead" aria-hidden="true"><span>Categoria</span><span>Este mês</span><span>Média</span><span>Diferença</span><span>Últimos 6 meses</span></div>`
        + corpo
        + `<div class="mes-mrow mes-mtotal"><span class="mes-m-cat">Total de gastos</span><span class="mes-m-v">${fmt(gas)}</span><span class="mes-m-v mes-m-med">${mGas == null ? '—' : fmt(mGas)}</span>${dif(total)}<span></span></div>`;
}

function _mesLigar() {
    if (_mesLigado || !$('mCal')) return;
    _mesLigado = true;
    $('mCal').addEventListener('click', e => {
        const b = e.target.closest('.mes-dia'); if (!b) return;
        const { m, a } = filtro();
        _mesDia = { ym: ymKey(m, a), dia: +b.dataset.dia };
        $('mCal').querySelectorAll('.mes-dia').forEach(x => x.setAttribute('aria-pressed', x === b));
        _mesRenderDia(_mesResumo(m, a), m);
    });
}

// ── GOALS ─────────────────────────────────────────────────────────────────────
// Metas com histórico aberto — sobrevivem aos re-renders (antes, adicionar um aporte
// recolhia o histórico que o usuário estava olhando)
const _goalHistOpen = new Set();

// Progresso e ritmo de uma meta. O % é truncado (99,6% não pode aparecer "100%" com
// "Faltam R$ 40"); com prazo, calcula quanto guardar por mês até lá (mês atual incluso).
function goalProgress(g) {
    const atual = roundMoney(g.aportes.reduce((s, a) => s + a.valor, 0));
    const falta = roundMoney(Math.max(0, g.meta - atual));
    const done  = g.meta > 0 && falta === 0;
    const pct   = g.meta > 0 ? (done ? 100 : Math.min(99, Math.floor(atual / g.meta * 100))) : 0;
    let ritmo = '';
    if (g.prazo && !done) {
        const now = new Date(), [py, pm] = g.prazo.split('-').map(Number);
        const meses = (py - now.getFullYear()) * 12 + (pm - 1 - now.getMonth()) + 1;
        ritmo = meses >= 1 ? `≈ ${fmt(falta / meses)}/mês por ${meses} ${meses === 1 ? 'mês' : 'meses'}` : '⚠️ prazo vencido';
    }
    return { atual, falta, done, pct, ritmo };
}

function renderGoals() {
    $('goalsGrid').innerHTML = goals.map(g => {
        if (!Array.isArray(g.aportes)) g.aportes = []; // defensive: Firebase strips empty arrays
        const { atual, falta, done, pct, ritmo } = goalProgress(g);
        const prazoStr = g.prazo ? new Date(g.prazo + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : 'Sem prazo';
        const histOpen = _goalHistOpen.has(g.id);
        // Histórico por data (mais recente primeiro), mantendo o índice real para editar/remover
        const aportesList = g.aportes.map((a, realIdx) => ({ a, realIdx }))
            .sort((x, y) => y.a.data.localeCompare(x.a.data) || y.realIdx - x.realIdx)
            .map(({ a, realIdx }) => {
            return `
            <div class="aporte-item">
                <span>${new Date(a.data + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}${a.nota ? ' · ' + escHtml(a.nota) : ''}</span>
                <span style="font-weight:600;color:var(--success)">+${fmt(a.valor)}</span>
                <span class="aporte-acts">
                    <button class="icon-btn" data-onclick="event.stopPropagation();editAporte(${g.id},${realIdx})" title="Editar" style="font-size:11px;opacity:.5">✏️</button>
                    <button class="icon-btn" data-onclick="event.stopPropagation();deleteAporte(${g.id},${realIdx})" title="Remover" style="font-size:11px;opacity:.5">🗑️</button>
                </span>
            </div>`;
        }).join('');
        return `
        <div class="goal-card">
            <div class="goal-accent" style="background:${g.cor}"></div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:10px">
                <div class="goal-name" style="margin-top:0">${escHtml(g.nome)}</div>
                <div class="goal-actions">
                    <button class="icon-btn" data-onclick="editarGoal(${g.id})" title="Editar">✏️</button>
                    <button class="icon-btn" data-onclick="removerGoal(${g.id})" title="Remover">🗑️</button>
                </div>
            </div>
            <div class="goal-desc">${g.descricao ? escHtml(g.descricao) : '&nbsp;'}</div>
            <div class="goal-amounts"><div class="goal-atual" style="color:${corTexto(g.cor)}">${fmt(atual)}</div><div class="goal-target">de ${fmt(g.meta)}</div></div>
            <div class="goal-track"><div class="goal-fill" style="width:${pct}%;background:${g.cor}"></div></div>
            <div class="goal-meta-row">
                <span class="goal-pct" style="color:${corTexto(g.cor)}">${pct}% concluído</span>
                <span>${done ? '✓ Concluído!' : 'Faltam ' + fmt(falta)}</span>
            </div>
            <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">📅 Prazo: ${prazoStr}${ritmo ? ` · <span style="${ritmo.startsWith('⚠️') ? 'color:var(--danger);font-weight:600' : ''}">${ritmo}</span>` : ''}</div>
            <button class="btn-aporte" style="background:${corLegivel(g.cor)}" data-onclick="abrirAporte(${g.id})">+ Adicionar Aporte</button>
            ${g.aportes.length ? `
                <button class="goal-hist-toggle" data-onclick="toggleHistory(this, ${g.id})">${histOpen ? 'Ocultar histórico' : `Ver histórico (${g.aportes.length} aportes)`}</button>
                <div class="goal-history ${histOpen ? 'open' : ''}">${aportesList}</div>` : ''}
        </div>`;
    }).join('') + `
    <div class="goal-add-card" data-onclick="abrirNovaGoal()">
        <span style="font-size:32px;opacity:.25">＋</span>
        <span style="font-size:13px;font-weight:500">Nova Meta</span>
    </div>`;
}

function toggleHistory(btn, goalId) {
    const hist = btn.nextElementSibling;
    hist.classList.toggle('open');
    if (hist.classList.contains('open')) _goalHistOpen.add(goalId); else _goalHistOpen.delete(goalId);
    const count = hist.querySelectorAll('.aporte-item').length;
    btn.textContent = hist.classList.contains('open') ? 'Ocultar histórico' : `Ver histórico (${count} aportes)`;
}

function renderColorPicker() {
    $('colorPicker').innerHTML = GOAL_COLORS.map(c => `
        <div class="color-opt ${c === selectedGoalColor ? 'selected' : ''}" style="background:${c}" title="Cor ${c}" aria-pressed="${c === selectedGoalColor}" data-onclick="selectColor('${c}')"></div>`).join('');
}

function selectColor(c) { selectedGoalColor = c; renderColorPicker(); }

function abrirNovaGoal() {
    $('goalModalTitle').textContent = 'Nova Meta';
    $('goalEditId').value = '';
    ['goalNome','goalDesc'].forEach(id => $(id).value = '');
    $('goalMeta').value  = '';
    $('goalPrazo').value = '';
    selectedGoalColor = GOAL_COLORS[0];
    renderColorPicker();
    $('ovNovaGoal').classList.add('open');
}

function editarGoal(id) {
    const g = goals.find(x => x.id === id);
    if (!g) return;
    $('goalModalTitle').textContent = 'Editar Meta';
    $('goalEditId').value  = id;
    $('goalNome').value    = g.nome;
    $('goalMeta').value    = fmtValorInput(g.meta);
    $('goalDesc').value    = g.descricao || '';
    $('goalPrazo').value   = g.prazo || '';
    selectedGoalColor = g.cor;
    renderColorPicker();
    $('ovNovaGoal').classList.add('open');
}

function closeNovaGoal(e) { closeOverlay('ovNovaGoal', e); }

function salvarGoal() {
    const nome    = $('goalNome').value.trim();
    const meta    = numInput($('goalMeta'));
    const prazo   = $('goalPrazo').value;
    const descricao = $('goalDesc').value.trim();
    const editId  = $('goalEditId').value;
    if (!nome)           return toast('⚠️ Digite um nome.', '#b45309');
    if (!(meta > 0) || !_valorOk(meta)) return toast('⚠️ Valor alvo inválido.', '#b45309');
    const idx = editId ? goals.findIndex(g => g.id === toId(editId)) : -1;
    if (editId && idx < 0) return toast('⚠️ Meta não encontrada.', '#b45309');
    pushUndo(idx >= 0 ? `Edição da meta "${nome}"` : `Nova meta "${nome}"`);
    if (idx >= 0) {
        goals[idx] = { ...goals[idx], nome, meta: roundMoney(meta), prazo, descricao, cor: selectedGoalColor };
        toast('✓ Meta atualizada!');
    } else {
        goals.push({ id: newId(), nome, meta: roundMoney(meta), prazo, descricao, cor: selectedGoalColor, aportes: [] });
        toast('🎯 Meta criada!');
    }
    commitGoals(); closeNovaGoal();
}

function removerGoal(id) {
    const g = goals.find(x => x.id === id);
    if (!g) return;
    confirmar(`Remover a meta "${g.nome}"?`, { ok: 'Remover', perigo: true }, () => {
        pushUndo(`Remoção da meta "${g.nome}"`);
        goals = goals.filter(x => x.id !== id);
        commitGoals();
        toast('Meta removida.', '#52525b');
    });
}

function abrirAporte(id) {
    const g = goals.find(x => x.id === id);
    if (!g) return;
    $('aporteGoalId').value   = id;
    $('aporteEditIdx').value  = -1;
    $('aporteGoalNome').textContent = g.nome;
    $('aporteModalTitle').textContent = 'Adicionar Aporte';
    $('aporteConfirmBtn').textContent = 'Adicionar';
    $('aporteValor').value    = '';
    $('aporteNota').value     = '';
    $('aporteData').value = todayLocalISO();
    $('ovAporte').classList.add('open');
}

// Aportes não têm id: o modal de edição guarda o índice E a assinatura do aporte. A sync
// em tempo real aplica mudanças de outro dispositivo com o modal aberto — se um aporte
// anterior sumir, o índice passa a apontar para OUTRO e salvar sobrescrevia o errado.
const _aporteSig = a => a ? `${a.data}|${a.valor}|${a.nota || ''}` : '';
let _aporteEditSig = '';
function _localizarAporte(goal, idx, sig) {
    if (goal.aportes[idx] && _aporteSig(goal.aportes[idx]) === sig) return idx;
    return goal.aportes.findIndex(a => _aporteSig(a) === sig);
}

function editAporte(goalId, aporteIdx) {
    const g = goals.find(x => x.id === goalId);
    if (!g || !g.aportes[aporteIdx]) return;
    const a = g.aportes[aporteIdx];
    _aporteEditSig = _aporteSig(a);
    $('aporteGoalId').value   = goalId;
    $('aporteEditIdx').value  = aporteIdx;
    $('aporteGoalNome').textContent = g.nome;
    $('aporteModalTitle').textContent = 'Editar Aporte';
    $('aporteConfirmBtn').textContent = 'Salvar';
    $('aporteValor').value    = fmtValorInput(a.valor);
    $('aporteNota').value     = a.nota || '';
    $('aporteData').value     = a.data;
    $('ovAporte').classList.add('open');
}

function deleteAporte(goalId, aporteIdx) {
    const g = goals.find(x => x.id === goalId);
    if (!g || !g.aportes[aporteIdx]) return;
    const a = g.aportes[aporteIdx];
    const sig = x => `${x.data}|${x.valor}|${x.nota || ''}`, alvo = sig(a);
    confirmar(`Remover aporte de ${fmt(a.valor)}?`, { ok: 'Remover', perigo: true }, () => {
        // a sync pode ter mexido na meta enquanto o modal estava aberto: relocaliza pelo conteúdo do aporte
        const g2 = goals.find(x => x.id === goalId), i = g2 ? g2.aportes.findIndex(x => sig(x) === alvo) : -1;
        if (i < 0) { toast('⚠️ Esse aporte já não existe.', '#b45309'); return; }
        pushUndo(`Remoção de aporte em "${g2.nome}"`);
        g2.aportes.splice(i, 1);
        commitGoals();
        toast('Aporte removido.', '#52525b');
    });
}

function closeAporte(e) { closeOverlay('ovAporte', e); }

function confirmarAporte() {
    const id    = toId($('aporteGoalId').value);
    let editIdx = parseInt($('aporteEditIdx').value, 10);
    const valor = numInput($('aporteValor'));
    const data  = $('aporteData').value;
    const nota  = $('aporteNota').value.trim();
    if (!(valor > 0) || !_valorOk(valor)) return toast('⚠️ Valor inválido.', '#b45309');
    if (!isValidISODate(data)) return toast('⚠️ Selecione uma data.', '#b45309');
    const goal = goals.find(g => g.id === id);
    if (!goal) { closeAporte(); return toast('⚠️ Meta não encontrada (removida em outro dispositivo?).', '#b45309'); }
    if (!Array.isArray(goal.aportes)) goal.aportes = [];
    if (editIdx >= 0) {
        editIdx = _localizarAporte(goal, editIdx, _aporteEditSig);
        if (editIdx < 0) { closeAporte(); return toast('⚠️ Este aporte foi alterado em outro dispositivo — confira e edite de novo.', '#b45309'); }
    }
    pushUndo(editIdx >= 0 ? `Edição de aporte em "${goal.nome}"` : `Aporte em "${goal.nome}"`);

    if (editIdx >= 0) {
        // Edit existing aporte
        goal.aportes[editIdx] = { valor: roundMoney(valor), data, nota };
        commitGoals(); closeAporte();
        toast('✓ Aporte atualizado!', '#16a34a');
    } else {
        // Add new aporte
        goal.aportes.push({ valor: roundMoney(valor), data, nota });
        commitGoals(); closeAporte();
        toast(`✓ Aporte de ${fmt(valor)} adicionado!`, '#16a34a');
    }
}

// ── ICON LIBRARY ─────────────────────────────────────────────────────────────
const ICON_LIB = [
    // Home & Bills
    '🏠','🏡','💡','🔑','🧹','🔧','📦',
    // Food & Drink
    '🍔','🍕','🍽️','☕','🍺','🥗','🧃','🛒',
    // Transport
    '🚗','⛽','🚌','✈️','🚲','🏍️',
    // Health & Care
    '💊','🏥','🦷','💇','🏋️',
    // Entertainment
    '🎉','🎬','🎮','🎵','📚','🎯','🏖️',
    // Tech & Subscriptions
    '📱','📡','💻','🖥️','🎧',
    // Shopping & Clothes
    '👗','👟','🛍️','🎁','🧸',
    // Family & Education
    '👨‍👩‍👧','🎓','🐶','🐱',
    // Finance
    '💰','💸','💳','📈','🛡️','₿','🏦','💼',
    // Work & Misc
    '⚙️','📝','🔔','🌟','🏢','📊','🔒',
];
// Estado do orçamento (budget) é carregado/validado junto com o resto em loadLocalState()

// ── Unified category helpers ───────────────────────────────────────────────────
function _allBudgetCats() {
    return [...(cats.saida || []), ...(cats.investimento || [])];
}

// ── CATEGORIA FORA DO ORÇAMENTO (só neste mês / daqui pra frente) ────────────
// budget.off[nome] = [{ de: 'AAAA-MM', ate?: 'AAAA-MM' }]: meses em que a categoria não entra no
// orçamento (sem `ate` = daí em diante). A categoria continua existindo: lançamentos, outros meses
// e o valor planejado (budget.allocs, que vale para todos os meses) ficam como estavam.
const _ymMais = (ym, n) => addMonthsISO(ym + '-01', n).slice(0, 7);
function _catOff(nome, ym) {
    return ((budget.off || {})[nome] || []).some(r => r.de <= ym && (!r.ate || ym <= r.ate));
}

// ── PLANEJAMENTO POR PERÍODO ("daqui pra frente") ────────────────────────────
// budget.allocsDe['AAAA-MM'] = { cat: % }: o planejamento que vale daquele mês em diante (até o próximo).
// Os meses antes do primeiro usam budget.allocs. Mexer na roda num mês altera o planejamento que vale
// nele; "Novo planejamento a partir deste mês" copia o vigente e separa daí em diante.
function _allocVersao(ym) {
    let v = null;
    for (const k of Object.keys(budget.allocsDe || {})) if (k <= ym && (!v || k > v)) v = k;
    return v;
}
// O mapa { cat: % } que vale no mês (o próprio objeto: escrever nele altera aquele planejamento)
function allocsDoMes(ym) { const v = ym ? _allocVersao(ym) : null; return v ? budget.allocsDe[v] : budget.allocs; }
function novoPlanejamentoDe(ym) {
    if (!budget.allocsDe) budget.allocsDe = {};
    if (budget.allocsDe[ym]) return false;
    budget.allocsDe[ym] = { ...allocsDoMes(ym) };
    return true;
}
function orcNovoPlanejamento() {
    const ym = ymKey(_budgetMonth, _budgetYear);
    if (budget.allocsDe && budget.allocsDe[ym]) return;
    pushUndo(`Novo planejamento a partir de ${MESES[_budgetMonth]}/${_budgetYear}`);
    novoPlanejamentoDe(ym);
    saveBudget(); renderBudget();
    toast(`✓ Daqui pra frente o planejamento é separado: mexer em ${MESES[_budgetMonth].toLowerCase()} não muda os meses anteriores.`, '#16a34a');
}
function orcJuntarPlanejamento() {
    const ym = ymKey(_budgetMonth, _budgetYear);
    if (!budget.allocsDe || !budget.allocsDe[ym]) return;
    const mes = _budgetMonth, ano = _budgetYear;
    confirmar(`Apagar o planejamento que começa em ${MESES[mes].toLowerCase()}/${ano}? Esses meses voltam a usar o planejamento anterior.`, { ok: 'Apagar', perigo: true }, () => {
        if (!budget.allocsDe || !budget.allocsDe[ym]) return;
        pushUndo(`Planejamento de ${MESES[mes]}/${ano} apagado`);
        delete budget.allocsDe[ym];
        saveBudget(); renderBudget();
    });
}
function _orcRenderVersao() {
    const el = $('orcVersao'); if (!el) return;
    const ym = ymKey(_budgetMonth, _budgetYear), v = _allocVersao(ym), ks = Object.keys(budget.allocsDe || {}).sort();
    const prox = ks.find(k => k > ym), ma = k => `${MES_ABREV[+k.slice(5, 7) - 1]}/${k.slice(0, 4)}`;
    const ate = prox ? ` até ${ma(_ymMais(prox, -1))}` : ' em diante';
    const desde = v ? `de ${ma(v)}${ate}` : ks.length ? `até ${ma(_ymMais(ks[0], -1))}` : 'em todos os meses';
    el.innerHTML = `<span>Planejamento valendo <b>${desde}</b></span>`
        + (v === ym ? (Object.keys(budget.allocsDe).length ? `<button class="orc-mini" data-onclick="orcJuntarPlanejamento()" title="Esses meses voltam a usar o planejamento anterior">Apagar este planejamento</button>` : '')
                    : `<button class="orc-mini" data-onclick="orcNovoPlanejamento()" title="Copia o planejamento atual; mexer daqui pra frente não muda os meses anteriores">Novo planejamento a partir de ${MESES[_budgetMonth].toLowerCase()}</button>`);
}
// As faixas de `nome` sem o período [de..ate] (ate null = para sempre)
function _offSubtrair(nome, de, ate) {
    const out = [];
    ((budget.off || {})[nome] || []).forEach(r => {
        if ((r.ate && r.ate < de) || (ate && r.de > ate)) { out.push(r); return; }              // sem sobreposição
        if (r.de < de) out.push({ de: r.de, ate: _ymMais(de, -1) });                              // sobra à esquerda
        if (ate && (!r.ate || r.ate > ate)) out.push(r.ate ? { de: _ymMais(ate, 1), ate: r.ate } : { de: _ymMais(ate, 1) });   // à direita
    });
    return out;
}
function _offGravar(nome, faixas) {
    if (!budget.off) budget.off = {};
    faixas.sort((x, y) => x.de.localeCompare(y.de) || String(x.ate || '').localeCompare(String(y.ate || '')));
    if (faixas.length) budget.off[nome] = faixas; else delete budget.off[nome];
}
const ocultarCategoriaNoOrcamento = (nome, de, ate = null) => _offGravar(nome, [..._offSubtrair(nome, de, ate), ate ? { de, ate } : { de }]);
const mostrarCategoriaNoOrcamento = (nome, de, ate = null) => _offGravar(nome, _offSubtrair(nome, de, ate));

function _isBudgetCatInvest(catName) {
    // accepts both old {nome} object and plain string
    const name = typeof catName === 'string' ? catName : catName.nome;
    return (cats.investimento || []).includes(name);
}

function _getSpentForBudgetCat(catName, saidasList, investList) {
    const name     = typeof catName === 'string' ? catName : catName.nome;
    const isInvest = _isBudgetCatInvest(name);
    const txList   = isInvest ? (investList || []) : saidasList;
    return txList.filter(t => t.cat === name).reduce((s, t) => s + t.valor, 0);
}

// Returns the effective total for a given month — custom override or global default
function getBudgetTotal(m, a) {
    const key = `${a}-${String(m + 1).padStart(2, '0')}`;
    return (budget.monthTotals[key] != null) ? budget.monthTotals[key] : budget.total;
}
function isMonthCustom(m, a) {
    const key = `${a}-${String(m + 1).padStart(2, '0')}`;
    return budget.monthTotals[key] != null;
}

let _budgetMonth = new Date().getMonth();
let _budgetYear  = new Date().getFullYear();

function resetMonthBudget() {
    pushUndo('Voltar orçamento padrão');
    delete budget.monthTotals[ymKey(_budgetMonth, _budgetYear)];
    saveBudget();
    renderBudget();
    toast('↩ Voltou ao orçamento padrão.', '#52525b');
}

function openAplicarMeses() {
    // Populate month checkboxes for the current budget year (all checked by default)
    const container = $('aplicarMesesGrid');
    if (!container) return;
    const a = _budgetYear;
    container.innerHTML = MESES.map((nome, i) => `<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:13px;font-weight:500">
            <input type="checkbox" value="${i}" checked style="accent-color:var(--accent)"> ${nome.slice(0,3)}
        </label>`).join('');

    // Set the value input to the current month's effective total
    const inp = $('aplicarMesesValor');
    const cur = getBudgetTotal(_budgetMonth, _budgetYear);
    if (inp) inp.value = cur > 0 ? cur.toLocaleString('pt-BR') : '';

    $('aplicarMesesAno').textContent = a;
    $('ovAplicarMeses').classList.add('open');
}

function confirmarAplicarMeses() {
    const val = parseValor($('aplicarMesesValor').value);
    if (!(val > 0)) return toast('⚠️ Valor inválido.', '#b45309');

    const checked = Array.from($('aplicarMesesGrid').querySelectorAll('input:checked'))
        .map(cb => parseInt(cb.value, 10));
    if (!checked.length) return toast('⚠️ Selecione ao menos um mês.', '#b45309');

    const a = _budgetYear;
    const isDefault = $('aplicarComoDefault').checked;
    pushUndo('Aplicar orçamento a vários meses');

    // "Definir como padrão": muda o total global e remove overrides dos meses marcados
    checked.forEach(m => {
        if (isDefault) delete budget.monthTotals[ymKey(m, a)];
        else budget.monthTotals[ymKey(m, a)] = val;
    });
    if (isDefault) budget.total = val;

    saveBudget();
    $('ovAplicarMeses').classList.remove('open');
    renderBudget();
    toast(`✓ Orçamento de ${fmt(val)} aplicado a ${checked.length} mese${checked.length !== 1 ? 's' : ''}!`, '#16a34a');
}

function budgetPrevMonth() {
    _budgetMonth--;
    if (_budgetMonth < 0) { _budgetMonth = 11; _budgetYear--; }
    renderBudget();
}

function budgetNextMonth() {
    _budgetMonth++;
    if (_budgetMonth > 11) { _budgetMonth = 0; _budgetYear++; }
    renderBudget();
}

// ── BUDGET CATEGORY CRUD ─────────────────────────────────────────────────────
// oninput (final=false) a cada tecla; onchange (final=true) ao sair do campo.
// Antes, apagar o campo num mês personalizado removia o override na hora e as teclas
// seguintes passavam a editar o orçamento PADRÃO de todos os meses.
const _renderBudgetSoon = debounce(() => renderBudget(), 250);
function onBudgetTotalChange(final = false) {
    const parsed = parseValor($('budgetTotal').value);
    const v = parsed > 0 ? roundMoney(parsed) : 0;
    const key = ymKey(_budgetMonth, _budgetYear), custom = isMonthCustom(_budgetMonth, _budgetYear);
    if (custom && !(v > 0) && !final) return;
    if (custom ? !(v > 0) || budget.monthTotals[key] !== v : budget.total !== v)
        pushUndo(custom ? `Orçamento de ${MESES[_budgetMonth]}/${_budgetYear}` : 'Orçamento padrão', 'orc-total:' + (custom ? key : 'padrao'));
    if (custom) {
        if (v > 0) budget.monthTotals[key] = v;
        else delete budget.monthTotals[key];   // campo vazio ao sair (final) = volta ao padrão
    } else {
        budget.total = v;
    }
    saveBudget();
    if (final) renderBudget(); else _renderBudgetSoon();
}

// casas = 2 quando o % é digitado; ao converter de R$ guarda 6 casas — com 2, R$ 1.000 de
// um total de R$ 7.777 virava 12,86% e voltava como R$ 1.000,12
function _setAlloc(catName, pct, casas = 2) {
    pct = Number.isFinite(pct) ? Math.max(0, Math.min(100, +pct.toFixed(casas))) : 0;
    const al = allocsDoMes(ymKey(_budgetMonth, _budgetYear));   // o planejamento que vale no mês aberto
    if ((al[catName] || 0) !== pct) pushUndo(`Alocação de "${catName}"`, 'orc-alloc:' + catName);
    if (pct > 0) al[catName] = pct; else delete al[catName];
    saveBudget();
    renderBudget();
}
function updateBudgetCatPct(safeKey, val) {
    _setAlloc(decodeURIComponent(safeKey), parseValor(val));
}

function _budgetGroup(catName) {
    if (_isBudgetCatInvest(catName)) return 'invest';
    const ov = budget.needsWants && budget.needsWants[catName];
    if (ov === 'needs' || ov === 'wants') return ov;   // user override wins over heuristic
    const n = catName.toLowerCase();
    const needs = ['moradia','aluguel','aliment','mercado','supermerc','saúde','saude','farm','transporte','ônibus','onibus','combust','gasolina','internet','telefone','celular','água','agua','luz','energia','gás','educa','escola','faculdade','fatura','conta ','plano','seguro','imposto','financ'];
    if (needs.some(k => n.includes(k))) return 'needs';
    return 'wants';
}


// Grupo Necessidade/Desejo de uma categoria de gasto (investimentos são um grupo à parte)
function setBudgetCatGroup(nome, group) {
    if (group !== 'needs' && group !== 'wants') return;
    if (budget.needsWants[nome] !== group) pushUndo(`"${nome}" como ${group === 'needs' ? 'necessidade' : 'desejo'}`, 'orc-nw:' + nome);
    budget.needsWants[nome] = group;
    saveBudget();
    renderBudget();
}

// ── ORÇAMENTO: RODA EDITÁVEL ────────────────────────────────────────────────
// Anel interno = Necessidades, Desejos e Investimentos (+ cinza "sem destino"); externo = as
// categorias de cada grupo. As alocações continuam guardadas em % do total do mês
// (budget.allocs); aqui as contas são em centavos inteiros e voltam como % com 6 casas.
// Regras (decididas com o dono): aumentar uma categoria tira das outras do MESMO grupo, em
// proporção, e o total do grupo não muda; sem de onde tirar, usa o dinheiro sem destino.
// Grupo cresce pelo sem destino e depois tirando dos outros grupos. Sobrar sem destino é
// permitido. Categoria com valor fixo (budget.locks) não muda quando se mexe nas outras.
const ORC_GRUPOS = [
    { key: 'needs',  label: 'Necessidades',  one: 'Necessidade',  cor: '#2a78d6' },
    { key: 'wants',  label: 'Desejos',       one: 'Desejo',       cor: '#eb6834' },
    { key: 'invest', label: 'Investimentos', one: 'Investimento', cor: '#1baf7a' },
];
const ORC_SEM_COR = '#d5d8df', ORC_PASSO = 1000;            // passo do arraste/setas: R$ 10
const ORC_CX = 160, ORC_CY = 160, ORC_EXT = [114, 150], ORC_INT = [88, 108], ORC_TONS = [.9, .66, .78];
let _orcSel = null;             // { type: 'cat' | 'group', id }
let _orcMov = null;             // "de onde veio": { antes: Map(nome → centavos), livre, alvo: [nomes], titulo }
let _orcDrag = null, _orcHover = null, _orcNomes = [], _orcLigado = false, _orcGesto = 0;
const _orcGrupo = k => ORC_GRUPOS.find(g => g.key === k);
const _orcSoma = (arr, f = c => c.vc) => arr.reduce((s, c) => s + f(c), 0);
const _orcR0 = c => fmt(c / 100).replace(/,00$/, '');        // centavos → "R$ 1.234" (sem ",00")
const _orcCompacto = () => IS_MOBILE || matchMedia('(max-width: 900px)').matches;
function _orcTom(hex, p) {
    const n = parseInt(hex.slice(1), 16), f = c => Math.round(c * p + 255 * (1 - p));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function _orcTipo(nome) { return _isBudgetCatInvest(nome) ? 'investimento' : 'saida'; }

function _orcModelo(m = _budgetMonth, a = _budgetYear) {
    const T = getBudgetTotal(m, a), lista = txMes(m, a);
    const saidas = lista.filter(t => t.tipo === 'saida'), invs = lista.filter(t => t.tipo === 'investimento');
    const locks = budget.locks || {}, ym = ymKey(m, a), cs = [], fora = [], al = allocsDoMes(ym);
    _allBudgetCats().forEach(nome => {
        const off = _catOff(nome, ym), spent = _getSpentForBudgetCat(nome, saidas, invs);
        if (off) fora.push(nome);
        if (off && !spent) return;   // fora do orçamento neste mês (com gasto ela continua à vista, "sem plano")
        // `locked` vale para as contas da roda: categoria fora do mês não recebe nem cede dinheiro.
        // `fixa` é o valor fixo escolhido pelo dono (é o que a tela mostra)
        cs.push({ nome, grupo: _budgetGroup(nome), vc: off ? 0 : Math.round(T * (al[nome] || 0)),
            spent, locked: off || !!locks[nome], fixa: !!locks[nome], off });
    });
    return { m, a, T, Tc: Math.round(T * 100), cats: cs, fora, saidas, invs };
}
const _orcLivre = mod => Math.max(0, mod.Tc - _orcSoma(mod.cats));
const _orcDoGrupo = (mod, g) => mod.cats.filter(c => c.grupo === g);
// Tira/dá em proporção ao valor atual (maiores restos). Valor redondo em reais é repartido em
// reais inteiros (arrastar R$ 10 não espalha centavos); valor com centavos, em centavos.
function _orcRepartir(pool, n, peso, cap) {
    const bruto = pool.map((c, i) => n * peso[i]), base = bruto.map((b, i) => Math.min(cap[i], Math.floor(b)));
    let resto = n - base.reduce((s, v) => s + v, 0);
    const ordem = bruto.map((b, i) => [b - Math.floor(b), i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]).map(([, i]) => i);
    for (let volta = 0; volta < 2 && resto > 0; volta++)
        for (const i of ordem) { if (resto > 0 && base[i] < cap[i]) { base[i]++; resto--; } }
    return base;
}
function _orcTirar(pool, quanto) {
    const tem = _orcSoma(pool), tira = Math.min(quanto, tem);
    if (tira <= 0) return 0;
    const u = tira % 100 === 0 ? 100 : 1, n = tira / u;
    const base = _orcRepartir(pool, n, pool.map(c => c.vc / tem), pool.map(c => Math.floor(c.vc / u)));
    pool.forEach((c, i) => { c.vc -= base[i] * u; });
    return base.reduce((s, v) => s + v, 0) * u;
}
function _orcDar(pool, quanto) {
    if (!pool.length || quanto <= 0) return 0;
    const w = _orcSoma(pool), u = quanto % 100 === 0 ? 100 : 1, n = quanto / u;
    const base = _orcRepartir(pool, n, pool.map(c => w ? c.vc / w : 1 / pool.length), pool.map(() => Infinity));
    pool.forEach((c, i) => { c.vc += base[i] * u; });
    return quanto;
}
function _orcMudaCat(mod, c, delta) {
    if (c.off) return 0;   // fora do orçamento neste mês: nada a ajustar
    const irmas = mod.cats.filter(x => x.grupo === c.grupo && x !== c && !x.locked);
    if (delta > 0) {
        const tirou = _orcTirar(irmas, delta), livre = Math.min(delta - tirou, _orcLivre(mod));
        c.vc += tirou + livre;
        return tirou + livre;
    }
    const d = Math.min(-delta, c.vc);
    c.vc -= d;
    if (irmas.length) _orcDar(irmas, d);
    return -d;
}
// Alça de uma PONTA da fatia: a fronteira com o vizinho daquele lado do anel anda e só os dois
// mudam (a categoria cresce o que o vizinho perde, e vice-versa). Vizinho = o mais próximo
// do mesmo grupo, sem valor fixo; sem ele (ponta do grupo), vale a regra de sempre.
function _orcMudaBorda(mod, c, lado, delta) {
    if (c.off) return 0;
    const grupo = _orcDoGrupo(mod, c.grupo), i = grupo.indexOf(c);
    const viz = (lado === 'ini' ? grupo.slice(0, i).reverse() : grupo.slice(i + 1)).find(x => !x.locked);
    if (!viz) return _orcMudaCat(mod, c, delta);
    if (delta > 0) {
        const tirou = Math.min(delta, viz.vc), livre = Math.min(delta - tirou, _orcLivre(mod));
        viz.vc -= tirou; c.vc += tirou + livre;
        return tirou + livre;
    }
    const d = Math.min(-delta, c.vc);
    c.vc -= d; viz.vc += d;
    return -d;
}
function _orcMudaGrupo(mod, g, delta) {
    const proprias = mod.cats.filter(c => c.grupo === g && !c.locked);
    if (!proprias.length) return 0;
    if (delta > 0) {
        const livre = Math.min(delta, _orcLivre(mod));
        const tirou = delta > livre ? _orcTirar(mod.cats.filter(c => c.grupo !== g && !c.locked), delta - livre) : 0;
        _orcDar(proprias, livre + tirou);
        return livre + tirou;
    }
    return -_orcTirar(proprias, -delta);
}
function _orc503020(mod) {
    const parte = { needs: .5, wants: .3, invest: .2 };
    ORC_GRUPOS.forEach(g => {
        const proprias = mod.cats.filter(c => c.grupo === g.key && !c.locked);
        if (!proprias.length) return;
        const quer = Math.max(0, Math.round(mod.Tc * parte[g.key]) - _orcSoma(mod.cats.filter(c => c.grupo === g.key && c.locked)));
        const tem = _orcSoma(proprias);
        if (quer > tem) _orcDar(proprias, quer - tem); else _orcTirar(proprias, tem - quer);
    });
}
// Grava o modelo no planejamento que vale no mês (% com 6 casas: ida e volta exata em centavos)
function _orcGravar(mod) {
    const al = allocsDoMes(ymKey(mod.m, mod.a));
    mod.cats.forEach(c => {
        if (c.off) return;   // fora do mês: o planejado dela (que vale para os outros meses) não se mexe
        const p = mod.T > 0 ? Math.min(100, +(c.vc / mod.T).toFixed(6)) : 0;
        if (p > 0) al[c.nome] = p; else delete al[c.nome];
    });
}
// Aplica uma mudança: desfazer agrupado por gesto, grava e mostra "de onde veio"
function _orcMudar(fn, { alvo = null, titulo = null, label = 'Ajuste na roda do orçamento', gesto = null } = {}) {
    const mod = _orcModelo();
    if (!(mod.T > 0)) { toast('⚠️ Defina o total do mês primeiro.', '#b45309'); renderBudget(); return 0; }
    const antes = new Map(mod.cats.map(c => [c.nome, c.vc])), livre = _orcLivre(mod);
    const feito = fn(mod);
    if (mod.cats.every(c => c.vc === antes.get(c.nome))) { renderBudget(); return 0; }
    pushUndo(label, gesto || 'orc-roda:' + (++_orcGesto));
    _orcGravar(mod);
    if (!gesto || !_orcMov || _orcMov.gesto !== gesto) _orcMov = { antes, livre, alvo: alvo || [], titulo, gesto };
    if (_orcDrag) _orcRenderTudo(_orcModelo());
    else { saveBudget(); renderBudget(); }
    return feito || 1;
}
// alvo = { type: 'cat' | 'group', id } (padrão: a seleção atual)
function _orcAjustar(deltaC, alvo = _orcSel) {
    if (!alvo) return 0;
    const ref = _orcModelo();
    return _orcMudar(mod => {
        if (alvo.type === 'cat') { const c = mod.cats.find(x => x.nome === alvo.id); return c ? _orcMudaCat(mod, c, deltaC) : 0; }
        return _orcMudaGrupo(mod, alvo.id, deltaC);
    }, { alvo: alvo.type === 'cat' ? [alvo.id] : _orcDoGrupo(ref, alvo.id).map(c => c.nome), titulo: alvo.type === 'group' ? _orcGrupo(alvo.id).label : null });
}
function _orcDefinir(valorTxt, alvo = _orcSel) {
    if (!alvo) return;
    const v = parseValor(valorTxt);
    if (!Number.isFinite(v) || v < 0) { renderBudget(); return; }
    const mod = _orcModelo(), quer = Math.round(roundMoney(v) * 100);
    const c = alvo.type === 'cat' ? mod.cats.find(x => x.nome === alvo.id) : null;
    if (alvo.type === 'cat' && !c) { renderBudget(); return; }
    const atual = c ? c.vc : _orcSoma(_orcDoGrupo(mod, alvo.id));
    if (!_orcAjustar(quer - atual, alvo)) renderBudget();
}
// Digitar o planejado na tabela muda SÓ aquela categoria: nada é tirado nem dado às outras.
// O que falta (ou passa) do total do mês aparece na faixa do topo (_orcRenderFalta).
function _orcDefinirSolto(valorTxt, nome) {
    const v = parseValor(valorTxt);
    if (!Number.isFinite(v) || v < 0) { renderBudget(); return; }
    const quer = Math.round(roundMoney(v) * 100), cat = _orcModelo().cats.find(x => x.nome === nome), atual = cat && cat.vc;
    if (cat && cat.off) { toast('⚠️ Esta categoria está fora do orçamento deste mês. Use "Voltar" em "Categorias fora deste mês".', '#b45309'); renderBudget(); return; }
    if (atual === undefined || quer === atual) { renderBudget(); return; }
    _orcMudar(mod => { mod.cats.find(x => x.nome === nome).vc = quer; return quer - atual; },
        { alvo: [nome], label: `Planejado de "${nome}"` });
}
// Valor fixo: a categoria não muda quando se mexe nas outras (roda, setas, 50/30/20)
function _orcTravar(nome) {
    const travar = !(budget.locks && budget.locks[nome]);
    pushUndo(travar ? `Fixar valor de "${nome}"` : `Soltar valor de "${nome}"`);
    if (!budget.locks) budget.locks = {};
    if (travar) budget.locks[nome] = true; else delete budget.locks[nome];
    saveBudget(); renderBudget();
}

// ── Desenho ──
function _orcPt(r, a) { const t = (a - 90) * Math.PI / 180; return [ORC_CX + r * Math.cos(t), ORC_CY + r * Math.sin(t)]; }
function _orcArco(r0, r1, a0, a1, pad) {
    a0 += pad; a1 -= pad;
    if (a1 - a0 < 0.4) return '';
    if (a1 - a0 >= 359.5) return _orcArco(r0, r1, a0 - pad, a0 + 180, pad) + _orcArco(r0, r1, a0 + 180, a1 + pad, pad);
    const lg = a1 - a0 > 180 ? 1 : 0, f = n => n.toFixed(2);
    const [x0, y0] = _orcPt(r1, a0), [x1, y1] = _orcPt(r1, a1), [x2, y2] = _orcPt(r0, a1), [x3, y3] = _orcPt(r0, a0);
    return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${lg} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${lg} 0 ${f(x3)} ${f(y3)}Z`;
}
// Escala da roda: o total do mês (ou a soma, se as alocações antigas passarem do total)
const _orcEscala = mod => Math.max(mod.Tc, _orcSoma(mod.cats));
function _orcLayout(mod) {
    const S = _orcEscala(mod), segs = [], grupos = [];
    let a = 0;
    ORC_GRUPOS.forEach(g => {
        const g0 = a;
        _orcDoGrupo(mod, g.key).forEach((c, i) => {
            const span = S ? c.vc / S * 360 : 0;
            segs.push({ c, a0: a, a1: a + span, i });
            a += span;
        });
        grupos.push({ g, a0: g0, a1: a, n: _orcDoGrupo(mod, g.key).length });
    });
    return { segs, grupos, fim: a };
}
function _orcRenderRoda(mod) {
    const svgSl = $('orcSlices'); if (!svgSl) return;
    const ch = $('orcCatHandle'), ci = $('orcCatHandleIni'), gh = $('orcGHandles');
    if (!(mod.T > 0) || !mod.cats.length) {
        svgSl.innerHTML = `<path d="${_orcArco(ORC_INT[0], ORC_EXT[1], 0, 360, 0)}" fill="${ORC_SEM_COR}" opacity=".55"></path>`;
        $('orcLabels').innerHTML = ''; gh.innerHTML = ''; ch.style.display = 'none'; ci.style.display = 'none';
        return;
    }
    const { segs, grupos, fim } = _orcLayout(mod), sel = _orcSel || {};
    const idx = new Map(_orcNomes.map((n, i) => [n, i]));
    let h = '', lab = '';
    if (fim < 359.6) h += `<path d="${_orcArco(ORC_INT[0], ORC_EXT[1], fim, 360, 0.6)}" fill="${ORC_SEM_COR}" data-kind="none"><title>Sem destino: ${escHtml(_orcR0(_orcLivre(mod)))}</title></path>`;
    grupos.forEach(({ g, a0, a1 }) => {
        const on = sel.type === 'group' && sel.id === g.key;
        h += `<path d="${_orcArco(ORC_INT[0], ORC_INT[1] + (on ? 4 : 0), a0, a1, 0.7)}" fill="${g.cor}" data-kind="group" data-g="${g.key}"><title>${g.label}: ${escHtml(_orcR0(_orcSoma(_orcDoGrupo(mod, g.key))))}</title></path>`;
    });
    segs.forEach(({ c, a0, a1, i }) => {
        const on = sel.type === 'cat' && sel.id === c.nome, hov = _orcHover === c.nome;
        const dim = (sel.type === 'cat' && !on && !hov) || (_orcHover && !hov && !on);
        h += `<path d="${_orcArco(ORC_EXT[0], ORC_EXT[1] + (on || hov ? 6 : 0), a0, a1, 0.55)}" fill="${_orcTom(_orcGrupo(c.grupo).cor, ORC_TONS[i % 3])}" data-kind="cat" data-i="${idx.get(c.nome)}" style="opacity:${dim ? .72 : 1}"><title>${escHtml(c.nome)}: ${escHtml(_orcR0(c.vc))}</title></path>`;
        if (a1 - a0 >= 17) {
            const [x, y] = _orcPt((ORC_EXT[0] + ORC_EXT[1]) / 2, (a0 + a1) / 2);
            lab += `<text class="orc-ico" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${escHtml(splitCatName(c.nome).icon || '📦')}</text>`;
        }
    });
    svgSl.innerHTML = h;
    $('orcLabels').innerHTML = lab;
    // Alças dos grupos: elementos persistentes (recriar no meio do arraste perderia o ponteiro)
    if (!gh.children.length) ORC_GRUPOS.forEach(g => gh.insertAdjacentHTML('beforeend',
        `<g class="orc-handle" data-g="${g.key}" aria-hidden="true"><circle r="16" fill="transparent"></circle><circle class="knob" r="6.5" style="stroke:${g.cor}"></circle></g>`));
    grupos.forEach(({ g, a1, n }) => {
        const el = gh.querySelector(`[data-g="${g.key}"]`), [x, y] = _orcPt((ORC_INT[0] + ORC_INT[1]) / 2, a1);
        el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        el.style.display = n ? '' : 'none';
    });
    const s = sel.type === 'cat' && segs.find(x => x.c.nome === sel.id);
    // A categoria selecionada tem alça nas DUAS pontas: cada uma move a fronteira com o vizinho do seu lado
    if (s) {
        [[ch, s.a1], [ci, s.a0]].forEach(([el, ang]) => {
            const [x, y] = _orcPt((ORC_EXT[0] + ORC_EXT[1]) / 2 + 3, ang);
            el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
            el.querySelector('.knob').style.stroke = _orcGrupo(s.c.grupo).cor;
            el.style.display = '';
        });
    } else { ch.style.display = 'none'; ci.style.display = 'none'; }
}
function _orcRenderCentro(mod) {
    const el = $('orcCenter'); if (!el) return;
    if (!(mod.T > 0)) { el.innerHTML = `<small>Planejado</small><span class="free">Digite o total do mês acima para montar a roda</span>`; return; }
    const livre = _orcLivre(mod), alem = _orcSoma(mod.cats) - mod.Tc;
    el.innerHTML = `<small>Planejado</small><b>${escHtml(_orcR0(mod.Tc))}</b>`
        + (alem > 0 ? `<span class="free over">⚠️ ${escHtml(_orcR0(alem))} além do total</span>`
            : `<span class="free ${livre ? '' : 'ok'}">${livre ? `${escHtml(_orcR0(livre))} sem destino` : 'Tudo com destino ✓'}</span>`);
}
function _orcRenderChips(mod) {
    const el = $('orcChips'); if (!el) return;
    if (!(mod.T > 0)) { el.innerHTML = ''; return; }
    const S = _orcEscala(mod), pc = v => fmtPct(S ? v / S * 100 : 0), sel = _orcSel || {};
    el.innerHTML = ORC_GRUPOS.filter(g => _orcDoGrupo(mod, g.key).length).map(g =>
        `<button class="orc-chip" data-g="${g.key}" aria-pressed="${sel.type === 'group' && sel.id === g.key}"><span class="orc-dot" style="background:${g.cor}"></span><b>${g.label}</b><span class="n">${pc(_orcSoma(_orcDoGrupo(mod, g.key)))}</span></button>`).join('')
        + `<span class="orc-chip"><span class="orc-dot" style="background:${ORC_SEM_COR}"></span><b>Sem destino</b><span class="n">${pc(_orcLivre(mod))}</span></span>`;
}
function _orcStatus(c) {
    const plano = c.vc / 100, sobra = roundMoney(plano - c.spent);
    if (c.grupo === 'invest') {
        if (!plano) return c.spent ? { cls: 'good', lbl: 'guardado', v: fmt(c.spent) } : { cls: 'muted', lbl: 'sem plano', v: '—' };
        return sobra <= 0 ? { cls: 'good', lbl: 'guardado', v: fmt(c.spent) } : { cls: 'warn', lbl: 'a guardar', v: fmt(sobra) };
    }
    if (!plano) return c.spent ? { cls: 'warn', lbl: 'sem plano', v: fmt(c.spent) } : { cls: 'muted', lbl: 'sem gastos', v: '—' };
    if (sobra < 0) return { cls: 'bad', lbl: 'passou', v: fmt(-sobra) };
    return { cls: c.spent / plano >= .8 ? 'warn' : 'good', lbl: 'resta', v: fmt(sobra) };
}
const _orcValTxt = c => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function _orcRenderSel(mod) {
    const el = $('orcSel'); if (!el) return;
    if (!(mod.T > 0) || !_orcSel) { el.innerHTML = mod.T > 0 && mod.cats.length ? '<div class="orc-sel-vazio">Clique numa fatia ou numa categoria para ajustar.</div>' : ''; return; }
    const S = _orcEscala(mod), pc = v => fmtPct(S ? v / S * 100 : 0);
    if (_orcSel.type === 'cat') {
        const c = mod.cats.find(x => x.nome === _orcSel.id); if (!c) { el.innerHTML = ''; return; }
        const st = _orcStatus(c), g = _orcGrupo(c.grupo), p = splitCatName(c.nome);
        el.innerHTML = `
        <div class="orc-sel-head"><div class="orc-sel-ico">${escHtml(p.icon || '📦')}</div>
            <div style="min-width:0"><div class="orc-sel-name">${escHtml(p.label || c.nome)}</div><div class="orc-sel-kind"><span class="orc-dot" style="background:${g.cor}"></span>${g.one}</div></div>
            ${c.off ? '<span class="orc-off" title="Tirada do orçamento deste mês (veja \'Categorias fora deste mês\')">fora do mês</span>'
                : `<button class="orc-lock" data-act="lock" aria-pressed="${c.fixa}" title="Valor fixo não muda quando você mexe nas outras categorias">${c.fixa ? '🔒 Valor fixo' : '🔓 Fixar valor'}</button>`}</div>
        <div class="orc-step"><button data-act="menos" aria-label="Diminuir R$ 10">−</button>
            <input id="orcValIn" inputmode="decimal" value="${_orcValTxt(c.vc)}" aria-label="Valor planejado para ${escHtml(p.label || c.nome)} em reais">
            <button data-act="mais" aria-label="Aumentar R$ 10">+</button><span class="pct">${pc(c.vc)}</span></div>
        <div class="orc-sel-spent">Gastou ${fmt(c.spent)} · <span class="orc-st-${st.cls}">${st.lbl}${st.v === '—' ? '' : ' ' + st.v}</span></div>
        ${c.grupo === 'invest' ? '' : `<div class="orc-gsw">Grupo: ${ORC_GRUPOS.filter(x => x.key !== 'invest').map(x => `<button data-move="${x.key}" aria-pressed="${x.key === c.grupo}"><span class="orc-dot" style="background:${x.cor}"></span>${x.one}</button>`).join('')}</div>`}
        <details class="orc-edit"><summary>✏️ Renomear ou excluir</summary>
            <div class="btd-row"><input autocomplete="off" type="text" id="orcRenameIn" class="btd-rename" maxlength="${CAT_MAX}" value="${escHtml(c.nome)}" aria-label="Nome da categoria">
            <button class="btd-save" data-act="renomear">✓</button><button class="btd-del" data-act="excluir" title="Excluir categoria">🗑️</button></div>
        </details>`;
    } else {
        const g = _orcGrupo(_orcSel.id), cs = _orcDoGrupo(mod, g.key), fixas = cs.filter(c => c.fixa).length, v = _orcSoma(cs);
        el.innerHTML = `
        <div class="orc-sel-head"><div class="orc-sel-ico"><span class="orc-dot" style="width:16px;height:16px;background:${g.cor}"></span></div>
            <div><div class="orc-sel-name">${g.label}</div><div class="orc-sel-kind">${cs.length} categoria${cs.length !== 1 ? 's' : ''}${fixas ? ` · ${fixas} com valor fixo` : ''}</div></div></div>
        <div class="orc-step"><button data-act="menos" aria-label="Diminuir R$ 10">−</button>
            <input id="orcValIn" inputmode="decimal" value="${_orcValTxt(v)}" aria-label="Valor planejado para ${g.label} em reais">
            <button data-act="mais" aria-label="Aumentar R$ 10">+</button><span class="pct">${pc(v)}</span></div>
        <div class="orc-sel-spent">Gastou ${fmt(_orcSoma(cs, c => c.spent))} de ${escHtml(_orcR0(v))} planejados</div>`;
    }
}
function _orcRenderGuia(mod) {
    const el = $('orcGuide'); if (!el) return;
    if (!(mod.T > 0) || !mod.cats.length) { el.style.display = 'none'; return; }
    el.style.display = '';
    const S = _orcEscala(mod), p = k => Math.round(S ? _orcSoma(_orcDoGrupo(mod, k)) / S * 100 : 0);
    el.innerHTML = `<span>Seu plano <b>${p('needs')} · ${p('wants')} · ${p('invest')}</b>, guia <b>50 · 30 · 20</b></span>
        <button class="orc-soft" data-act="503020" title="Necessidades 50%, Desejos 30%, Investimentos 20% do total (valores fixos não mudam)">Aplicar 50/30/20</button>`;
}
function _orcRenderMov(mod) {
    const el = $('orcMoved'); if (!el) return;
    const mv = _orcMov;
    if (!mv || !(mod.T > 0)) { el.textContent = ''; return; }
    const mud = mod.cats.map(c => ({ c, d: c.vc - (mv.antes.get(c.nome) ?? c.vc) })).filter(x => x.d);
    const dn = _orcLivre(mod) - mv.livre;
    if (!mud.length && !dn) { el.textContent = ''; return; }
    const sg = d => (d > 0 ? '+' : '−') + _orcR0(Math.abs(d)), nome = c => splitCatName(c.nome).label || c.nome;
    const prin = mud.filter(x => mv.alvo.includes(x.c.nome)), resto = mud.filter(x => !mv.alvo.includes(x.c.nome)).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    const partes = resto.slice(0, 3).map(x => `${escHtml(nome(x.c))} ${sg(x.d)}`);
    if (resto.length > 3) partes.push(`+${resto.length - 3} categoria${resto.length - 3 !== 1 ? 's' : ''}`);
    if (dn) partes.push(`sem destino ${sg(dn)}`);
    let cab = '';
    if (prin.length === 1 && !mv.titulo) cab = `<b>${escHtml(nome(prin[0].c))} ${sg(prin[0].d)}</b>`;
    else if (prin.length) cab = `<b>${escHtml(mv.titulo || 'Selecionadas')} ${sg(_orcSoma(prin, x => x.d))}</b>`;
    el.innerHTML = [cab, partes.join(' · ')].filter(Boolean).join(' · ');
}
function _orcRenderHero(mod) {
    const num = $('orcHeroNum'); if (!num) return;
    const gasto = _orcSoma(mod.saidas, t => t.valor), inv = _orcSoma(_orcDoGrupo(mod, 'invest')) / 100;
    if (!(mod.T > 0)) {
        $('orcHeroLabel').textContent = 'Sem orçamento neste mês';
        num.textContent = '—'; num.classList.remove('neg');
        $('orcHeroSub').textContent = `Digite o total do mês na roda para ver quanto ainda pode gastar · gastou ${fmt(gasto)}`;
    } else {
        const limite = roundMoney(spendBudgetOf(mod.T, ymKey(mod.m, mod.a))), resta = roundMoney(limite - gasto), passou = resta < 0;
        $('orcHeroLabel').textContent = passou ? 'Você passou do limite em'
            : { passado: 'Sobrou do limite', futuro: 'Você poderá gastar', atual: 'Você ainda pode gastar' }[periodoFase(mod.a, mod.m)];
        num.textContent = fmt(Math.abs(resta)); num.classList.toggle('neg', passou);
        $('orcHeroSub').textContent = `Limite de gastos ${fmt(limite)}${inv ? ` = total ${fmt(mod.T)} − investir ${fmt(inv)}` : ''} · gastou ${fmt(gasto)}`;
    }
    $('orcHeroGroups').innerHTML = ORC_GRUPOS.filter(g => _orcDoGrupo(mod, g.key).length).map(g => {
        const cs = _orcDoGrupo(mod, g.key), plano = _orcSoma(cs) / 100, sp = _orcSoma(cs, c => c.spent), r = plano ? sp / plano : (sp ? 2 : 0);
        const txt = g.key === 'invest' ? `${fmt(sp)} de ${fmt(plano)} guardados` : `${fmt(sp)} gastos de ${fmt(plano)}`;
        return `<div class="ohg"><b>${g.label}</b><span>${txt}</span><div class="ohg-bar ${g.key !== 'invest' && r > 1 ? 'over' : ''}"><i style="width:${Math.min(100, r * 100).toFixed(1)}%"></i></div></div>`;
    }).join('');
}

// 'ordem' (padrão) = a mesma ordem das fatias da roda; não muda enquanto se digita os valores
// A escolha fica guardada neste aparelho (valor desconhecido/antigo volta para 'ordem')
const _BUDGET_SORT_CYCLE = ['ordem','alloc_desc','alloc_asc','used_desc','used_asc','name_asc','name_desc'];
let _budgetCatSort = _BUDGET_SORT_CYCLE.includes(lsGet('fin5_catSort')) ? lsGet('fin5_catSort') : 'ordem';
const _BUDGET_SORT_LABELS = {
    ordem: '↕ Ordem da roda',
    alloc_desc: '↓ Planejado', alloc_asc: '↑ Planejado',
    used_desc:  '↓ % Gasto',   used_asc:  '↑ % Gasto',
    name_asc:   '↑ Nome',      name_desc: '↓ Nome',
};
function toggleBudgetCatSort() {
    const idx = _BUDGET_SORT_CYCLE.indexOf(_budgetCatSort);
    _budgetCatSort = _BUDGET_SORT_CYCLE[(idx + 1) % _BUDGET_SORT_CYCLE.length];
    lsSet('fin5_catSort', _budgetCatSort);
    renderBudget();
}
function _orcOrdenar(lista) {
    const usado = c => c.vc ? c.spent / (c.vc / 100) : (c.spent ? Infinity : 0), nome = c => splitCatName(c.nome).label || c.nome;
    const f = {
        alloc_desc: (x, y) => y.vc - x.vc, alloc_asc: (x, y) => x.vc - y.vc,
        used_desc: (x, y) => usado(y) - usado(x) || y.spent - x.spent, used_asc: (x, y) => usado(x) - usado(y) || x.spent - y.spent,
        name_asc: (x, y) => cmpText(nome(x), nome(y)), name_desc: (x, y) => cmpText(nome(y), nome(x)),
    }[_budgetCatSort];
    return f ? [...lista].sort(f) : lista;
}
function _orcRenderLista(mod) {
    const el = $('budgetCatList'); if (!el) return;
    const sortBtn = $('btnBudgetSort');
    if (sortBtn) sortBtn.textContent = _BUDGET_SORT_LABELS[_budgetCatSort] || _budgetCatSort;
    const hint = $('orcListHint');
    if (hint) hint.textContent = _orcCompacto() ? 'toque para ajustar' : 'digite o valor e aperte Enter · as outras não mudam';
    if (!mod.cats.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:12px">Nenhuma categoria. Crie uma na linha abaixo.</div>'; return; }
    // O redesenho recria a tabela: devolve o foco ao campo (ou ao cadeado) que o tinha
    const ativo = document.activeElement, emFoco = ativo && ativo.closest && ativo.closest('#budgetCatList');
    const foco = emFoco && ativo.classList.contains('orc-plan') ? _orcNomes[+ativo.dataset.i] : null;
    const focoLock = emFoco && ativo.classList.contains('orc-r-lock') ? _orcNomes[+ativo.dataset.i] : null;
    const idx = new Map(_orcNomes.map((n, i) => [n, i])), sel = _orcSel || {};
    // Durante o arraste a ordem fica congelada (linhas pulando enquanto o valor muda)
    const ordem = _orcDrag && _orcDrag.ordem ? _orcDrag.ordem : null;
    el.innerHTML = ORC_GRUPOS.map(g => {
        let cs = _orcDoGrupo(mod, g.key);
        if (!cs.length) return '';
        cs = ordem ? [...cs].sort((x, y) => ordem.indexOf(x.nome) - ordem.indexOf(y.nome)) : _orcOrdenar(cs);
        const plano = _orcSoma(cs), sp = _orcSoma(cs, c => c.spent);
        return `<div class="orc-grp-h"><span class="orc-dot" style="background:${g.cor}"></span>${g.label}<span class="s">${fmt(sp)} de ${escHtml(_orcR0(plano))}</span></div>`
            + cs.map(c => {
                const st = _orcStatus(c), i = idx.get(c.nome), p = splitCatName(c.nome);
                const r = c.vc ? Math.min(1, c.spent / (c.vc / 100)) : (c.spent ? 1 : 0);
                return `<div class="orc-row" data-i="${i}" aria-current="${sel.type === 'cat' && sel.id === c.nome}">
                    <span class="orc-r-ico">${escHtml(p.icon || '📦')}</span>
                    <span class="orc-r-name">${escHtml(p.label || c.nome)}${c.fixa ? ' <span class="orc-lk" title="Valor fixo">🔒</span>' : ''}${c.off ? ' <span class="orc-off" title="Tirada do orçamento deste mês">fora do mês</span>' : ''}</span>
                    <span class="orc-r-lockc"><button type="button" class="orc-r-lock" data-i="${i}" aria-pressed="${c.fixa}" aria-label="Valor fixo de ${escHtml(p.label || c.nome)}"${c.off ? ' disabled' : ''} title="${c.fixa ? 'Valor fixo: não muda quando você mexe nas outras. Clique para soltar' : 'Fixar o valor: não muda quando você mexe nas outras categorias'}">${c.fixa ? '🔒' : '🔓'}</button></span>
                    <span class="orc-r-plan"><input class="orc-plan" data-i="${i}" inputmode="decimal" value="${_orcValTxt(c.vc)}" aria-label="Planejado para ${escHtml(p.label || c.nome)} em reais"${mod.T > 0 ? (c.off ? ' disabled title="Fora do orçamento deste mês"' : '') : ' disabled title="Defina o total do mês primeiro"'}></span>
                    <span class="orc-r-spent">${fmt(c.spent)}</span>
                    <span class="orc-r-bar"><i class="orc-fill-${st.cls === 'muted' ? 'good' : st.cls}" style="width:${(r * 100).toFixed(1)}%"></i></span>
                    <span class="orc-r-st orc-st-${st.cls}"><span class="v">${st.v}</span>${st.lbl}</span>
                    <span class="orc-r-sub">${fmt(c.spent)} de ${escHtml(_orcR0(c.vc))}</span>
                </div>`;
            }).join('');
    }).join('');
    if (foco != null) { const inp = el.querySelector(`.orc-plan[data-i="${idx.get(foco)}"]`); if (inp) { inp.focus(); inp.select(); } }
    if (focoLock != null) { const b = el.querySelector(`.orc-r-lock[data-i="${idx.get(focoLock)}"]`); if (b) b.focus(); }
}
// Faixa no topo das categorias: quanto falta (ou passou) para completar o total do mês.
// `prev` = { nome, vc }: valor que está sendo digitado numa linha (ainda não confirmado)
function _orcRenderFalta(mod, prev = null) {
    const el = $('orcFalta'); if (!el) return;
    if (!(mod.T > 0) || !mod.cats.length) { el.className = 'orc-falta'; el.innerHTML = ''; return; }
    const soma = _orcSoma(mod.cats) + (prev ? prev.vc - (mod.cats.find(c => c.nome === prev.nome) || { vc: 0 }).vc : 0);
    const dif = mod.Tc - soma, pct = Math.max(0, Math.min(100, soma / mod.Tc * 100));
    el.className = 'orc-falta ' + (dif > 0 ? '' : dif < 0 ? 'over' : 'ok');
    el.innerHTML = (dif > 0 ? `<b>Falta ${escHtml(_orcR0(dif))}</b><span>para completar o orçamento</span>`
        : dif < 0 ? `<b>Passou ${escHtml(_orcR0(-dif))}</b><span>do total do mês</span>` : '<b>Orçamento completo ✓</b>')
        + `<span class="n">planejado ${escHtml(_orcR0(soma))} de ${escHtml(_orcR0(mod.Tc))}</span>`
        + `<span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span>`;
}
// Categorias tiradas do orçamento deste mês (só neste mês / daqui pra frente): dá para voltar
let _orcOcultas = [];
function _orcRenderOcultas(mod) {
    const box = $('orcOcultas'); if (!box) return;
    const ym = ymKey(mod.m, mod.a);
    _orcOcultas = mod.fora;
    box.style.display = _orcOcultas.length ? '' : 'none';
    $('orcOcultasSum').textContent = `Categorias fora deste mês (${_orcOcultas.length})`;
    $('orcOcultasList').innerHTML = _orcOcultas.map((nome, i) => {
        const daquiPraFrente = ((budget.off || {})[nome] || []).some(r => !r.ate && r.de <= ym);
        return `<div class="orc-oc-row"><span class="orc-oc-n">${escHtml(nome)}</span>
            <button class="orc-mini" data-oc="mes" data-i="${i}">↩ Voltar neste mês</button>
            ${daquiPraFrente ? `<button class="orc-mini" data-oc="desde" data-i="${i}">↩ Voltar daqui pra frente</button>` : ''}</div>`;
    }).join('');
}
// Categorias de entrada não têm valor planejado: ficam recolhidas, só para renomear/excluir
function _orcRenderEntradas() {
    const box = $('orcEntradas'); if (!box) return;
    const lista = cats.entrada || [];
    box.style.display = lista.length ? '' : 'none';
    $('orcEntradasSum').textContent = `Categorias de entrada (${lista.length})`;
    $('orcEntradasList').innerHTML = lista.map((nome, i) => `<div class="btd-row orc-ent-row">
        <input autocomplete="off" type="text" class="btd-rename" data-ent="${i}" maxlength="${CAT_MAX}" value="${escHtml(nome)}" aria-label="Nome da categoria de entrada">
        <button class="btd-save" data-ent-act="renomear" data-ent="${i}" title="Renomear">✓</button>
        <button class="btd-del" data-ent-act="excluir" data-ent="${i}" title="Excluir">🗑️</button></div>`).join('');
}

// ── BUDGET RENDERING ─────────────────────────────────────────────────────────
function _orcRenderTudo(mod) {
    _orcRenderHero(mod); _orcRenderRoda(mod); _orcRenderCentro(mod); _orcRenderChips(mod);
    _orcRenderMov(mod); _orcRenderSel(mod); _orcRenderGuia(mod); _orcRenderFalta(mod); _orcRenderLista(mod); _orcRenderVersao();
}
function renderBudget() {
    if (currentView === 'dashboard') renderBudgetRemaining();
    const m = _budgetMonth, a = _budgetYear;
    const monthLabel = $('budgetMonthLabel');
    if (monthLabel) monthLabel.textContent = `${MESES[m]} ${a}`;
    const custom = isMonthCustom(m, a), totalBudget = getBudgetTotal(m, a);
    const totalInput = $('budgetTotal');
    if (totalInput && document.activeElement !== totalInput) totalInput.value = totalBudget > 0 ? totalBudget.toLocaleString('pt-BR') : '';
    const badge = $('budgetTypeBadge');
    if (badge) {
        badge.textContent = custom ? '⚡ Personalizado' : '✅ Padrão';
        badge.title = custom ? 'Total só deste mês' : 'Total padrão de todos os meses';
        badge.className = 'orc-badge ' + (custom ? 'custom' : 'padrao');
    }
    const resetBtn = $('btnResetMonthBudget');
    if (resetBtn) resetBtn.style.display = custom ? '' : 'none';
    _orcLigar();
    const mod = _orcModelo();
    _orcNomes = mod.cats.map(c => c.nome);
    // Seleção some se a categoria saiu; sem seleção, começa pela maior (a alça ensina o arraste)
    if (_orcSel && (_orcSel.type === 'cat' ? !_orcNomes.includes(_orcSel.id) : !_orcDoGrupo(mod, _orcSel.id).length)) _orcSel = null;
    if (!_orcSel && mod.cats.length) _orcSel = { type: 'cat', id: [...mod.cats].sort((x, y) => y.vc - x.vc)[0].nome };
    _orcRenderTudo(mod);
    _orcRenderOcultas(mod);
    _orcRenderEntradas();
    renderBudgetFixos(m, a);
    safeRender(renderBudgetParcelas, m, a);
    safeRender(renderLoans);
    renderVencimentos();
}

// ── Interação da roda (ligada uma vez, por delegação: nomes nunca vão para handlers inline) ──
function _orcAngulo(e) {
    const r = $('orcRing').getBoundingClientRect(), k = 320 / r.width;
    const x = (e.clientX - r.left) * k - ORC_CX, y = (e.clientY - r.top) * k - ORC_CY;
    return (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360;
}
function _orcIniciaArraste(e, tipo, id, lado = 'fim') {
    const mod = _orcModelo();
    if (!(mod.T > 0) || !id) return;
    e.preventDefault(); e.stopPropagation();
    if (tipo === 'group') _orcSel = { type: 'group', id };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    const ordem = [];
    $('budgetCatList').querySelectorAll('.orc-row').forEach(r => ordem.push(_orcNomes[+r.dataset.i]));
    _orcDrag = { tipo, id, lado, ultimo: _orcAngulo(e), acc: 0, gesto: 'orc-arraste:' + (++_orcGesto), ordem, mudou: false };
    _orcMov = null;
    _orcRenderTudo(mod);
}
function _orcMoveArraste(e) {
    const d0 = _orcDrag; if (!d0) return;
    const a = _orcAngulo(e);
    let d = a - d0.ultimo; if (d > 180) d -= 360; if (d < -180) d += 360;
    d0.ultimo = a;
    // Na ponta de início, girar no sentido horário ENCOLHE a fatia (a fronteira entra nela)
    d0.acc += (d0.lado === 'ini' ? -1 : 1) * d / 360 * _orcEscala(_orcModelo());
    const passo = Math.trunc(d0.acc / ORC_PASSO) * ORC_PASSO;
    if (!passo) return;
    d0.acc -= passo;
    const feito = _orcMudar(mod => {
        if (d0.tipo === 'cat') { const c = mod.cats.find(x => x.nome === d0.id); return c ? _orcMudaBorda(mod, c, d0.lado, passo) : 0; }
        return _orcMudaGrupo(mod, d0.id, passo);
    }, { alvo: d0.tipo === 'cat' ? [d0.id] : _orcDoGrupo(_orcModelo(), d0.id).map(c => c.nome), titulo: d0.tipo === 'group' ? _orcGrupo(d0.id).label : null, gesto: d0.gesto });
    if (feito) d0.mudou = true; else d0.acc = 0;
}
function _orcFimArraste() {
    const d0 = _orcDrag; if (!d0) return;
    _orcDrag = null;
    if (d0.mudou) saveBudget();
    renderBudget();
}
// Ligação única dos eventos do Orçamento (roda, tabela, painel lateral e listas), em blocos por região
function _orcLigar() {
    if (_orcLigado || !$('orcRing')) return;
    _orcLigado = true;
    const nomeDe = el => _orcNomes[+el.dataset.i];
    const escolher = s => { _orcSel = s; _orcMov = null; renderBudget(); };
    _orcLigarArraste();
    _orcLigarRoda(nomeDe, escolher);
    _orcLigarTabela(nomeDe, escolher);
    _orcLigarPainel();
    _orcLigarListas();
}
function _orcLigarArraste() {
    const ch = $('orcCatHandle'), ci = $('orcCatHandleIni'), gh = $('orcGHandles');
    const catSel = () => _orcSel && _orcSel.type === 'cat' ? _orcSel.id : null;
    ch.addEventListener('pointerdown', e => _orcIniciaArraste(e, 'cat', catSel(), 'fim'));
    ci.addEventListener('pointerdown', e => _orcIniciaArraste(e, 'cat', catSel(), 'ini'));
    gh.addEventListener('pointerdown', e => { const h = e.target.closest('[data-g]'); if (h) _orcIniciaArraste(e, 'group', h.dataset.g); });
    [ch, ci, gh].forEach(el => {
        el.addEventListener('pointermove', _orcMoveArraste);
        el.addEventListener('pointerup', _orcFimArraste);
        el.addEventListener('pointercancel', _orcFimArraste);
        el.addEventListener('lostpointercapture', _orcFimArraste);
    });
}
function _orcLigarRoda(nomeDe, escolher) {
    $('orcSlices').addEventListener('click', e => {
        const p = e.target.closest('path[data-kind]'); if (!p) return;
        if (p.dataset.kind === 'group') escolher({ type: 'group', id: p.dataset.g });
        else if (p.dataset.kind === 'cat') escolher({ type: 'cat', id: nomeDe(p) });
    });
    $('orcChips').addEventListener('click', e => { const b = e.target.closest('button[data-g]'); if (b) escolher({ type: 'group', id: b.dataset.g }); });
}
function _orcLigarTabela(nomeDe, escolher) {
    const lista = $('budgetCatList');
    // Seleciona a categoria sem redesenhar a tabela (o campo em foco seria recriado)
    const selLeve = (nome, row) => {
        if (_orcSel && _orcSel.type === 'cat' && _orcSel.id === nome) return;
        _orcSel = { type: 'cat', id: nome }; _orcMov = null;
        const mod = _orcModelo(); _orcRenderRoda(mod); _orcRenderChips(mod); _orcRenderMov(mod); _orcRenderSel(mod);
        lista.querySelectorAll('.orc-row').forEach(r => r.setAttribute('aria-current', r === row));
    };
    lista.addEventListener('click', e => {
        const row = e.target.closest('.orc-row'); if (!row) return;
        const nome = nomeDe(row);
        if (e.target.closest('.orc-r-lock')) { _orcTravar(nome); return; }
        if (e.target.closest('.orc-plan')) { selLeve(nome, row); return; }
        escolher({ type: 'cat', id: nome });
        if (_orcCompacto()) $('orcRingCard').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    lista.addEventListener('focusin', e => { const inp = e.target.closest('.orc-plan'); if (inp) selLeve(nomeDe(inp), inp.closest('.orc-row')); });
    // Depois do Tab o foco já está no próximo campo; o redesenho o devolve a ele
    lista.addEventListener('change', e => {
        const inp = e.target.closest('.orc-plan'); if (!inp) return;
        const nome = nomeDe(inp), txt = inp.value;
        setTimeout(() => _orcDefinirSolto(txt, nome), 0);
    });
    // Enquanto digita, a faixa do topo já mostra quanto falta com esse valor
    lista.addEventListener('input', e => {
        const inp = e.target.closest('.orc-plan'); if (!inp) return;
        const v = parseValor(inp.value);
        if (Number.isFinite(v) && v >= 0) _orcRenderFalta(_orcModelo(), { nome: nomeDe(inp), vc: Math.round(roundMoney(v) * 100) });
    });
    lista.addEventListener('keydown', e => {
        const inp = e.target.closest('.orc-plan'); if (!inp) return;
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { inp.value = inp.defaultValue; inp.blur(); }
    });
    lista.addEventListener('mouseover', e => {
        if (_orcDrag) return;
        const r = e.target.closest('.orc-row'), nome = r ? nomeDe(r) : null;
        if (nome !== _orcHover) { _orcHover = nome; _orcRenderRoda(_orcModelo()); }
    });
    lista.addEventListener('mouseleave', () => { if (_orcHover) { _orcHover = null; _orcRenderRoda(_orcModelo()); } });
}
function _orcLigarPainel() {
    const sel = $('orcSel');
    sel.addEventListener('click', e => {
        const b = e.target.closest('[data-act], [data-move]'); if (!b || !_orcSel) return;
        const act = b.dataset.act, nome = _orcSel.id;
        if (act === 'menos') _orcAjustar(-ORC_PASSO);
        else if (act === 'mais') _orcAjustar(ORC_PASSO);
        else if (act === 'lock') _orcTravar(nome);
        else if (act === 'renomear') {
            const novo = ($('orcRenameIn').value || '').trim();
            if (novo && novo !== nome && renameCategory(_orcTipo(nome), nome, novo)) { _orcSel = { type: 'cat', id: novo }; toast(`✓ Renomeado para "${novo}"`, '#16a34a'); renderBudget(); }
        } else if (act === 'excluir') deleteCategoryFlow(_orcTipo(nome), nome);
        else if (b.dataset.move && _orcSel.type === 'cat' && b.dataset.move !== _budgetGroup(nome)) setBudgetCatGroup(nome, b.dataset.move);
    });
    // No celular o campo da tabela some e o painel é o único lugar para digitar: lá digitar também não
    // mexe nas outras (como na tabela); no computador o painel fica do lado da roda e reajusta
    sel.addEventListener('change', e => {
        if (e.target.id !== 'orcValIn') return;
        if (_orcCompacto() && _orcSel && _orcSel.type === 'cat') _orcDefinirSolto(e.target.value, _orcSel.id); else _orcDefinir(e.target.value);
    });
    sel.addEventListener('keydown', e => {
        if (e.target.id === 'orcValIn' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        if (e.target.id === 'orcRenameIn' && e.key === 'Enter') { e.preventDefault(); sel.querySelector('[data-act="renomear"]').click(); }
    });
    $('orcGuide').addEventListener('click', e => {
        if (!e.target.closest('[data-act="503020"]')) return;
        if (_orcMudar(_orc503020, { titulo: 'Guia 50/30/20', label: 'Guia 50/30/20 no orçamento' })) toast('✓ 50/30/20 aplicado. Use Desfazer para voltar.', '#16a34a');
    });
    $('orcRingCard').addEventListener('keydown', e => {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) || e.target.closest('input, select, textarea, summary')) return;
        e.preventDefault();
        _orcAjustar((e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 5 : 1) * ORC_PASSO);
    });
}
function _orcLigarListas() {
    $('orcOcultasList').addEventListener('click', e => {
        const b = e.target.closest('[data-oc]'); if (!b) return;
        const nome = _orcOcultas[+b.dataset.i]; if (nome == null) return;
        const ym = ymKey(_budgetMonth, _budgetYear);
        pushUndo(`Voltar "${nome}" ao orçamento`);
        mostrarCategoriaNoOrcamento(nome, ym, b.dataset.oc === 'mes' ? ym : null);
        saveBudget(); renderBudget();
        toast(`✓ "${nome}" voltou ao orçamento ${b.dataset.oc === 'mes' ? 'deste mês' : 'daqui pra frente'}.`, '#16a34a');
    });
    $('orcEntradasList').addEventListener('click', e => {
        const b = e.target.closest('[data-ent-act]'); if (!b) return;
        const i = +b.dataset.ent, nome = (cats.entrada || [])[i]; if (nome == null) return;
        if (b.dataset.entAct === 'excluir') { deleteCategoryFlow('entrada', nome); return; }
        const inp = $('orcEntradasList').querySelector(`input[data-ent="${i}"]`), novo = inp ? inp.value.trim() : '';
        if (novo && novo !== nome && renameCategory('entrada', nome, novo)) { toast(`✓ Renomeado para "${novo}"`, '#16a34a'); renderBudget(); }
    });
    $('orcEntradasList').addEventListener('keydown', e => {
        const inp = e.target.closest('input[data-ent]');
        if (inp && e.key === 'Enter') { e.preventDefault(); $('orcEntradasList').querySelector(`[data-ent-act="renomear"][data-ent="${inp.dataset.ent}"]`).click(); }
    });
}

// Create a category (any type) from the budget box's add-row
function addBudgetCategory() {
    const sel = $('budgetCatType');
    addCatHub(sel ? sel.value : 'saida');   // usa catHubInput + ícone escolhido
    renderBudget();
}

function renderBudgetFixos(m, a) {
    const fixos = txMes(m, a).filter(t => t.fixo);
    const totalEl = $('budgetFixosTotal');
    const listEl  = $('budgetFixosList');
    if (!totalEl || !listEl) return;
    if (!fixos.length) {
        totalEl.textContent = '';
        listEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-3);font-size:12px">Nenhum fixo neste mês.</div>';
        return;
    }
    totalEl.textContent = fmt(fixoSaidaTotal(fixos));
    listEl.innerHTML = [...fixos].sort((a, b) => a.data.localeCompare(b.data)).map(t => {
        const day = parseInt(t.data.split('-')[2]);
        const payBadge = txPayBadge(t);
        const info = fixoSerieInfo(t.serie);
        const fimTag = info && info.endingSoon
            ? `<span class="tag-fixo" style="background:var(--t-amber-bg2);color:var(--warn);cursor:pointer" data-onclick="abrirPopupFixos()" title="Série termina — renovar em Gerenciar">⚠️ TERMINA</span>` : '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 16px;border-bottom:1px solid var(--border-light);font-size:12px">
            <span style="color:var(--text-3);width:30px">dia ${day}</span>
            <span style="flex:1;font-weight:500;margin:0 10px">${escHtml(t.desc)} ${payBadge}${fimTag}</span>
            <span style="font-weight:600;color:${txCor(t)}">${txPre(t)} ${fmt(t.valor)}</span>
        </div>`;
    }).join('');
}

// ── MONTH NAV (arrow buttons in topbar) ──────────────────────────────────────
function changeMonth(delta) {
    const { m, a } = filtro();
    setFiltro(m + delta, a);
}

function changeYear(delta) {
    const { m, a } = filtro();
    setFiltro(m, a + delta);
}

function updateMonthNavLabel() {
    const { m, a } = filtro();
    const el = $('monthNavLabel');
    if (el) el.textContent = MESES[m] + ' ' + a;
    const yr = $('yearNavLabel');
    if (yr) yr.textContent = a;
}

// ── ANNUAL YEAR NAV ──────────────────────────────────────────────────────────
function anualChangeYear(delta) { changeYear(delta); }   // setFiltro já re-renderiza a view anual

// ── FIREBASE INIT ────────────────────────────────────────────────────────────
const FB_CONFIG = {
    apiKey:            "AIzaSyBJ-CK1s_ySQqvM98sJbi15SejsIoicVvo",
    authDomain:        "webapps-cbefa.firebaseapp.com",
    databaseURL:       "https://webapps-cbefa-default-rtdb.firebaseio.com",
    projectId:         "webapps-cbefa",
    storageBucket:     "webapps-cbefa.firebasestorage.app",
    messagingSenderId: "817788828725",
    appId:             "1:817788828725:web:612f5d62662b88274d457c",
};

// Sem SDK (offline/bloqueador) o app não pode quebrar no carregamento do script
const FIREBASE_OK  = typeof firebase !== 'undefined';
const SYNC_ENABLED = FIREBASE_OK && !PREVIEW_MODE;   // preview nunca escreve na nuvem
let fbAuth = null, fbDb = null;
if (FIREBASE_OK) {
    firebase.initializeApp(FB_CONFIG);
    fbAuth = firebase.auth();
    fbDb   = firebase.database();
}

let _currentUser    = null;
let _autoSyncTimer  = null;

// ── AUTH ──────────────────────────────────────────────────────────────────────
// Chamado no fim do script, depois de todas as declarações (evita TDZ em consts)
function bootApp() {
    if (PREVIEW_MODE) {
        const previewUser = { uid: 'preview', displayName: 'Preview', email: 'preview@local', photoURL: null };
        _currentUser = previewUser;
        init();                 // selects/listeners ANTES do 1º render (showApp → navTo)
        showApp(previewUser);
        console.info('%cFinances preview mode — no login, no cloud sync.', 'color:#0b62f0;font-weight:600');
        return;
    }
    $('loginScreen').classList.remove('hidden');
    if (!FIREBASE_OK) {
        $('loginError').textContent = 'Não foi possível carregar o Firebase. Verifique a conexão e recarregue a página.';
        return;
    }
    // Volta de um login por redirecionamento (fallback do popup): o sucesso chega pelo
    // onAuthStateChanged; aqui só aparece o erro, se houver
    fbAuth.getRedirectResult().catch(e => { const msg = _authErroMsg(e); if (msg) $('loginError').textContent = msg; });
    fbAuth.onAuthStateChanged(user => {
        if (user) {
            _currentUser = user;
            _claimLocalData(user.uid);
            init();             // selects/listeners ANTES do 1º render (showApp → navTo)
            showApp(user);
            // Caixa de entrada do Claude: só depois da 1ª sync (aplica sobre o estado da nuvem)
            reconcile({ initial: true }).then(() => checkInbox());
            checkDbRules();
            setupAutoSync();
        } else {
            _currentUser = null;
            clearInterval(_autoSyncTimer);
            stopRemoteWatch();
            showLoginScreen();
        }
    });
}

// Os dados locais pertencem a UM usuário. Ao entrar com outra conta no mesmo
// navegador, antes o app mostrava (e enviava para a conta nova!) os dados de quem
// usou o navegador antes.
// Dados do dono anterior que NÃO chegaram à nuvem (sessão expirou sem "Sair", navegador
// fechado offline) ficam guardados à parte e voltam quando ele entrar de novo — a sync de
// 3 vias os mescla com a nuvem. Antes eram sobrescritos pela conta nova e se perdiam.
const _pendKey = uid => 'fin5_pendente_' + uid;
// A quarentena (registros inválidos) também é do dono dos dados: ficava no navegador e a
// conta nova a via na seção Backup e a levava no backup exportado. Agora acompanha o dono:
// guardada à parte ao sair e devolvida quando ele voltar.
const _quarKey = uid => 'fin5_quarentena_' + uid;
function _trocarQuarentena(saindo, entrando) {
    const q = loadJSON('fin5_quarantine', []);
    if (q.length) storeJSON(_quarKey(saindo), q);
    const volta = loadJSON(_quarKey(entrando), []);
    if (volta.length) storeJSON('fin5_quarantine', volta); else lsDel('fin5_quarantine');
    lsDel(_quarKey(entrando));
    renderQuarentena();
}
function _claimLocalData(uid) {
    const owner = loadJSON('fin5_owner', null);
    const h = _stateHash(), vazio = h === _stateHash(sanitizeState({}));
    const deOutro = !!owner && owner !== uid;
    if (deOutro) {
        const meta = loadJSON(_syncKey(owner), null);
        if ((!meta || meta.hash !== h) && !vazio)
            storeJSON(_pendKey(owner), { t: tx, c: cats, g: goals, k: cards, b: budget, l: loans });
        _trocarQuarentena(owner, uid);
    }
    const pend = loadJSON(_pendKey(uid), null);
    // Pendentes desta conta voltam se o que está no navegador é de outra conta ou está vazio
    // (ex.: alguém saiu apagando os dados deste navegador — o que remove o registro de dono)
    if (deOutro || (pend && vazio)) {
        const s = sanitizeState(pend || {});      // pendentes desta conta, ou vazio + categorias padrão
        _quarantine(s.report);
        restoreState(s);
        persistAll();
        lsDel(_pendKey(uid));
        undoStack = []; redoStack = []; _updateUndoBtn();
    } else if (!owner) {
        _migrateLegacySyncMeta(uid);              // instalação anterior: dados são deste usuário
    }
    storeJSON('fin5_owner', uid);
}

function showLoginScreen() {
    $('loginScreen').classList.remove('hidden');
    // Hide the main app
    $('view-dashboard').style.display = 'none';
    ['anual','mensal','metas'].forEach(v => $('view-' + v).classList.remove('active'));
    $('userChip').style.display  = 'none';
    $('btnSync').style.display   = 'none';
    $('btnUndo').style.display   = 'none'; $('btnRedo').style.display = 'none';
    setSyncState('', 'Sync');
}

function showApp(user) {
    $('loginScreen').classList.add('hidden');
    $('btnSync').style.display  = SYNC_ENABLED ? '' : 'none';
    $('btnUndo').style.display  = ''; $('btnRedo').style.display = '';
    _updateUndoBtn();

    const chip = $('userChip');
    chip.style.display = 'flex';
    $('userName').textContent = user.displayName ? user.displayName.split(' ')[0] : user.email;

    // Avatar: substitui o nó inteiro (antes, no 2º login o <img> recebia textContent)
    const cur = $('userInitials');
    let el;
    if (user.photoURL) {
        el = document.createElement('img');
        el.className = 'user-avatar';
        el.src = user.photoURL;
        el.referrerPolicy = 'no-referrer';
    } else {
        el = document.createElement('div');
        el.className = 'user-avatar-initials';
        el.textContent = (user.displayName || user.email || '?')[0].toUpperCase();
    }
    el.id = 'userInitials';
    if (cur) cur.replaceWith(el);

    navTo(_viewDoHash() || 'dashboard', null, { hist: 'replace' });
}

// Erros de login em pt-BR (antes aparecia o texto cru do Firebase, ex.: "Firebase: Error
// (auth/popup-blocked)"). null = o próprio usuário cancelou → sem mensagem.
const _AUTH_ERROS = {
    'auth/popup-closed-by-user':  null,
    'auth/cancelled-popup-request': null,
    'auth/user-cancelled':        null,
    'auth/network-request-failed': 'Sem conexão com a internet. Verifique e tente de novo.',
    'auth/too-many-requests':     'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
    'auth/user-disabled':         'Esta conta foi desativada.',
    'auth/unauthorized-domain':   'Este endereço não está autorizado no Firebase (Authentication → Settings → Authorized domains).',
    'auth/web-storage-unsupported': 'O navegador está bloqueando o armazenamento (modo privado/cookies). Libere e tente de novo.',
};
// Popup bloqueado ou impossível no ambiente (celular, navegador embutido) → redirecionamento
const _AUTH_USA_REDIRECT = new Set(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment']);
function _authErroMsg(e) {
    const code = e && e.code;
    if (code in _AUTH_ERROS) return _AUTH_ERROS[code];
    return 'Não foi possível entrar' + (code ? ` (${code.replace(/^auth\//, '')})` : '') + '. Tente de novo.';
}

async function signInWithGoogle() {
    const btn = $('btnGoogleSignIn');
    const err = $('loginError');
    if (!FIREBASE_OK) return;
    btn.innerHTML = '<div class="login-spinner"></div> Entrando...';
    btn.disabled  = true;
    err.textContent = '';
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        await fbAuth.signInWithPopup(provider);
        // onAuthStateChanged handles the rest
    } catch (e) {
        if (_AUTH_USA_REDIRECT.has(e && e.code)) {
            try { await fbAuth.signInWithRedirect(provider); return; }   // a página sai; o boot trata o retorno
            catch (e2) { err.textContent = _authErroMsg(e2) || ''; }
        } else err.textContent = _authErroMsg(e) || '';
    } finally {
        btn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google"> Entrar com Google';
        btn.disabled  = false;
    }
}

async function signOut() {
    if (PREVIEW_MODE || !FIREBASE_OK) return;
    const dirty = _localDirty();
    if (!await confirmarP(dirty ? 'Há alterações ainda não sincronizadas. Sincronizar e sair?' : 'Sair da conta?', { ok: dirty ? 'Sincronizar e sair' : 'Sair', titulo: 'Sair da conta' })) return;
    if (dirty) await reconcile({ manual: true });
    if (_localDirty() && !await confirmarP('A sincronização falhou — as alterações ficam só neste navegador. Sair mesmo assim?', { ok: 'Sair mesmo assim', perigo: true, titulo: 'Sair da conta' })) return;
    // Só oferece apagar quando tudo já está na nuvem (nada se perde)
    let wipe = _localDirty() ? 'sair' : await new Promise(res => perguntar('Apagar também os dados guardados NESTE navegador?\n\nRecomendado em computador compartilhado. Seus dados continuam na nuvem e voltam no próximo login.',
        [{ label: 'Sair e apagar daqui', valor: 'apagar', perigo: true }, { label: 'Só sair', valor: 'sair' }], res, { titulo: 'Sair da conta' }));
    if (wipe === null) return;      // Cancelar/Esc/voltar na última pergunta: continua logado
    wipe = wipe === 'apagar';
    const uid = _currentUser && _currentUser.uid;   // _currentUser vira null no signOut
    clearInterval(_autoSyncTimer);
    stopRemoteWatch();
    await fbAuth.signOut();
    if (wipe) wipeLocalData(uid);
    toast(wipe ? 'Até logo! Dados deste navegador apagados.' : 'Até logo!', '#52525b');
}

// Remove do navegador os dados do app (do namespace atual) e zera o estado em memória.
// Preserva o que é de OUTRA conta (alterações pendentes e metadados de sync dela): não
// estão na nuvem, e "apagar os dados deste navegador" é sobre a conta que está saindo.
function wipeLocalData(uid = null) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(LS_PREFIX)) continue;
        const nome = k.slice(LS_PREFIX.length), dono = nome.match(/^(?:fin5_pendente_|fb_sync_|fb_base_|fin5_inbox_)(.+?)(?:_copia)?$/);
        if (dono && dono[1] !== uid) continue;
        if (/^(fin5_|fb_)/.test(nome)) keys.push(k);
    }
    keys.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    restoreState(sanitizeState({}));
    undoStack = []; redoStack = []; _updateUndoBtn();
}

// ── SYNC UI ───────────────────────────────────────────────────────────────────
function setSyncState(state, label) {
    const dot = $('syncDot');
    const lbl = $('syncLabel');
    const btn = $('btnSync');
    dot.className = 'sync-dot' + (state ? ' ' + state : '');
    if (label) lbl.textContent = label;
    btn.classList.toggle('syncing', state === 'busy');
}

function updateSyncTime() {
    const t  = lsGet('fb_lastSync');
    const el = $('syncTime');
    if (!t) { el.textContent = ''; return; }
    const diff = Math.round((Date.now() - parseInt(t, 10)) / 60000);
    el.textContent = diff < 1 ? 'agora' : diff + 'min';
}

// ── SINCRONIZAÇÃO (modelo de 3 vias) ─────────────────────────────────────────
// Cada dispositivo guarda { ts, hash } do último estado sincronizado:
//   • remoto mudou?  → remote.ts ≠ meta.ts   (igualdade, imune a relógio adiantado)
//   • local mudou?   → hash(estado atual) ≠ meta.hash
// só remoto → baixa · só local → sobe · ambos → conflito · nenhum → nada.
// Antes: todo salvamento fazia set() cego (apagando o que outro dispositivo tinha
// gravado) e ao abrir o app o remoto sobrescrevia alterações locais não enviadas.

// Chaves do Firebase não aceitam . # $ [ ] / — e o orçamento usa nomes de categoria
// como chave ("📡 Internet/Telefone"). O set() lançava erro e a sync parava em silêncio.
const _FB_ESC = { '%': '%25', '.': '%2E', '#': '%23', '$': '%24', '[': '%5B', ']': '%5D', '/': '%2F' };
const _fbKeyEnc = k => k.replace(/[%.#$[\]\/]/g, c => _FB_ESC[c]);
const _fbKeyDec = k => k.replace(/%(25|2E|23|24|5B|5D|2F)/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
function _mapKeys(v, fn) {
    if (Array.isArray(v)) return v.map(x => _mapKeys(x, fn));
    if (v && typeof v === 'object') {
        const o = {};
        for (const k of Object.keys(v)) o[fn(k)] = _mapKeys(v[k], fn);
        return o;
    }
    return v;
}

// Forma canônica igual ao que o Firebase devolve (sem null/vazios, chaves ordenadas)
function _canon(v) {
    if (Array.isArray(v)) { const a = v.map(_canon).filter(x => x !== undefined); return a.length ? a : undefined; }
    if (v && typeof v === 'object') {
        const o = {};
        for (const k of Object.keys(v).sort()) { const c = _canon(v[k]); if (c !== undefined) o[k] = c; }
        return Object.keys(o).length ? o : undefined;
    }
    return (v == null || (typeof v === 'number' && !Number.isFinite(v))) ? undefined : v;
}
function _cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function _stateHash(s = { tx, cats, goals, cards, budget, loans }) {
    return _cyrb53(JSON.stringify(_canon({ t: s.tx, c: s.cats, g: s.goals, k: s.cards, b: s.budget, l: s.loans })) || '');
}

const _syncKey = uid => 'fb_sync_' + uid;
function _getSyncMeta() { return _currentUser ? loadJSON(_syncKey(_currentUser.uid), null) : null; }
function _setSyncMeta(meta) { if (_currentUser) storeJSON(_syncKey(_currentUser.uid), meta); }
// Base do merge: cópia do último estado sincronizado (o "ancestral comum" dos dois lados)
// A base carrega o ts da versão que representa: só vale se bater com a meta atual. Se a
// gravação falhar (cota cheia), a base antiga é apagada — nunca se mescla contra um
// ancestral errado (no pior caso cai no diálogo de conflito).
const _baseKey = uid => 'fb_base_' + uid;
function _setSyncBase(st, ts) {
    if (!_currentUser) return;
    const key = _baseKey(_currentUser.uid);
    if (!storeJSON(key, { ts, t: st.tx, c: st.cats, g: st.goals, k: st.cards, b: st.budget, l: st.loans })) {
        lsDel(key);
    }
}
function _getSyncBase() {
    const raw = _currentUser ? loadJSON(_baseKey(_currentUser.uid), null) : null;
    const meta = _getSyncMeta();
    return raw && meta && raw.ts === meta.ts ? sanitizeState(raw) : null;
}

// ── MERGE DE 3 VIAS ───────────────────────────────────────────────────────────
// Quando os dois lados mudaram, combina item a item usando a base: se só um lado
// alterou um item em relação à base, vale esse lado; se os dois alteraram o MESMO item
// de formas diferentes, é conflito real (aí sim o usuário escolhe). Antes qualquer
// mudança simultânea obrigava a descartar um dos lados inteiro.
const _same = (a, b) => JSON.stringify(_canon(a) ?? null) === JSON.stringify(_canon(b) ?? null);
function _pick3(b, l, r) {
    if (_same(l, r)) return { v: l };
    if (_same(l, b)) return { v: r };
    if (_same(r, b)) return { v: l };
    return { conflict: true };
}
// Conflito = o MESMO item mudou dos dois lados. `ctx.prefer`: null → o item fica de fora
// (só é listado); 'local'/'remote' → resolvido por esse lado (escolha do usuário) sem
// perder o resto da mescla. `ctx.reg(chave técnica, nome legível)` registra o conflito.
const _ladoPreferido = (ctx, l, r) => ctx.prefer === 'local' ? l : ctx.prefer === 'remote' ? r : undefined;
// Planejamentos por período: mesmo mês dos dois lados → mescla por categoria; criado/apagado de um lado só → vale esse lado
function _mergeVersoes(base = {}, local = {}, remote = {}, ctx) {
    const out = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
        const b = base[k], l = local[k], r = remote[k];
        if (l && r) { out[k] = _mergeKeyed(b || {}, l, r, ctx, 'alocação ' + k); continue; }
        const p = _pick3(b, l, r);
        if (p.conflict) {
            ctx.reg(`planejamento ${k}`, `planejamento de ${k}`);
            const v = _ladoPreferido(ctx, l, r);
            if (v !== undefined) out[k] = v;
            continue;
        }
        if (p.v !== undefined) out[k] = p.v;
    }
    return out;
}
// Coleções com id (lançamentos, metas, cartões); undefined = removido
function _mergeById(base, local, remote, ctx, label) {
    const B = new Map(base.map(x => [x.id, x])), L = new Map(local.map(x => [x.id, x])), R = new Map(remote.map(x => [x.id, x]));
    const ids = [...local.map(x => x.id), ...remote.map(x => x.id).filter(id => !L.has(id))];
    const out = [];
    for (const id of ids) {
        const l = L.get(id), r = R.get(id), p = _pick3(B.get(id), l, r);
        if (p.conflict) {
            const x = l || r || B.get(id), nome = (x && (x.desc || x.nome)) || id;
            ctx.reg(`${label} ${id}`, `${label} "${nome}"${!l ? ' — removido aqui' : !r ? ' — removido no outro dispositivo' : ''}`);
            const v = _ladoPreferido(ctx, l, r);
            if (v !== undefined) out.push(v);
            continue;
        }
        if (p.v !== undefined) out.push(p.v);
    }
    return out;
}
// Mapas chave → valor (alocações, totais por mês, necessidade/desejo)
function _mergeKeyed(base = {}, local = {}, remote = {}, ctx, label) {
    const out = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
        const p = _pick3(base[k], local[k], remote[k]);
        if (p.conflict) {
            ctx.reg(`${label} ${k}`, `${label} de "${k}"`);
            const v = _ladoPreferido(ctx, local[k], remote[k]);
            if (v !== undefined) out[k] = v;
            continue;
        }
        if (p.v !== undefined) out[k] = p.v;
    }
    return out;
}
// Listas de nomes (categorias): pertence ao resultado se o lado que mudou diz que sim
function _mergeSet(base = [], local = [], remote = []) {
    const inB = new Set(base), inL = new Set(local), inR = new Set(remote);
    return [...new Set([...local, ...remote])].filter(x => inL.has(x) === inB.has(x) ? inR.has(x) : inL.has(x));
}
// prefer = null: mescla e lista os conflitos (itens em conflito ficam de fora).
// prefer = 'local'/'remote': mesma mescla, com os conflitos resolvidos por esse lado.
function mergeStates(base, local, remote, prefer = null) {
    const conflicts = [], nomes = [];
    const ctx = { prefer, reg: (chave, nome) => { conflicts.push(chave); nomes.push(nome); } };
    const total = _pick3(base.budget.total, local.budget.total, remote.budget.total);
    if (total.conflict) ctx.reg('orçamento total', 'orçamento total do mês padrão');
    const merged = {
        tx:    _mergeById(base.tx, local.tx, remote.tx, ctx, 'lançamento'),
        goals: _mergeById(base.goals, local.goals, remote.goals, ctx, 'meta'),
        cards: _mergeById(base.cards, local.cards, remote.cards, ctx, 'cartão'),
        loans: _mergeById(base.loans, local.loans, remote.loans, ctx, 'empréstimo'),
        cats:  Object.fromEntries(TIPOS.map(tp => [tp, _mergeSet(base.cats[tp], local.cats[tp], remote.cats[tp])])),
        budget: {
            total:       total.conflict ? (prefer === 'remote' ? remote.budget.total : local.budget.total) : total.v,
            allocs:      _mergeKeyed(base.budget.allocs, local.budget.allocs, remote.budget.allocs, ctx, 'alocação'),
            allocsDe:    _mergeVersoes(base.budget.allocsDe, local.budget.allocsDe, remote.budget.allocsDe, ctx),
            monthTotals: _mergeKeyed(base.budget.monthTotals, local.budget.monthTotals, remote.budget.monthTotals, ctx, 'orçamento do mês'),
            needsWants:  _mergeKeyed(base.budget.needsWants, local.budget.needsWants, remote.budget.needsWants, ctx, 'grupo'),
            locks:       _mergeKeyed(base.budget.locks, local.budget.locks, remote.budget.locks, ctx, 'valor fixo'),
            off:         _mergeKeyed(base.budget.off, local.budget.off, remote.budget.off, ctx, 'categoria fora do orçamento'),
        },
    };
    return { merged, conflicts, nomes };
}
function _localDirty() { const m = _getSyncMeta(); return SYNC_ENABLED && (!m || m.hash !== _stateHash()); }
// Versão anterior guardava fb_localTs + fb_lastKnown (cópia completa dos dados)
function _migrateLegacySyncMeta(uid) {
    const ts = parseInt(lsGet('fb_localTs') || '', 10);
    const lastKnown = loadJSON('fb_lastKnown', null);
    if (Number.isFinite(ts) && lastKnown) {
        const base = sanitizeState(lastKnown, 2);
        storeJSON(_syncKey(uid), { ts, hash: _stateHash(base) });
        storeJSON(_baseKey(uid), { ts, t: base.tx, c: base.cats, g: base.goals, k: base.cards, b: base.budget });
    }
    lsDel('fb_lastKnown'); lsDel('fb_localTs');
}

function _userRef() {
    if (!_currentUser || !fbDb) throw new Error('Não autenticado');
    return fbDb.ref(`finances/${_currentUser.uid}`);
}
// ── BACKUP DIÁRIO NA NUVEM ────────────────────────────────────────────────────
// A sync sobrescreve a base inteira em todos os aparelhos; um engano (ou bug) se espalharia sem volta.
// Caminho irmão `finances_bak/{uid}` (regra no database.rules.json; sem ela o app só avisa, 1×/dia):
//   meta/{AAAA-MM-DD} = { ts, n, appV, v }   (pequeno: é o que a lista lê)
//   dados/{AAAA-MM-DD} = base crua do servidor (mesmo formato do nó finances/{uid})
// Guarda o que o SERVIDOR tinha ao abrir o dia, antes de este aparelho gravar por cima — sem download
// extra. No máximo 1 por dia, só se mudou desde o último, e poda além de CONFIG.BAK_DIAS dias.
let _bakRef = () => {       // trocado pelos testes; no preview nunca toca no Firebase real
    if (PREVIEW_MODE || !_currentUser || !fbDb) throw new Error('backup indisponível');
    return fbDb.ref(`finances_bak/${_currentUser.uid}`);
};
const _erroPermissao = e => /permission/i.test((e && (e.code || e.message)) || '');
let _bakEmCurso = false;
async function _backupDiario(remote) {
    if (!_currentUser || !remote || _remotoMaisNovo(remote) || _bakEmCurso) return;   // um por vez: o 2º veria já o estado enviado
    const hoje = todayLocalISO(), marca = 'fin5_bak_' + _currentUser.uid;
    if (lsGet(marca) === hoje) return;
    _bakEmCurso = true;
    try {
        const ref = _bakRef();
        const meta = (await _comPrazo(ref.child('meta').once('value'), CONFIG.SYNC_PRAZO_MS, 'backup sem resposta')).val() || {};
        const dias = Object.keys(meta).sort(), ult = dias.length ? meta[dias[dias.length - 1]] : null;
        if (meta[hoje] || (ult && ult.ts === (remote.ts || 0))) { lsSet(marca, hoje); return; }
        const up = { ['dados/' + hoje]: remote, ['meta/' + hoje]: { ts: remote.ts || 0, n: _asList(remote.t).length, appV: remote.appV || 0, v: Number(remote.v) || 0 } };
        dias.concat(hoje).sort().slice(0, -CONFIG.BAK_DIAS).forEach(d => { up['dados/' + d] = null; up['meta/' + d] = null; });
        await _comPrazo(ref.update(up), CONFIG.SYNC_PRAZO_MS, 'backup sem confirmação');
        lsSet(marca, hoje);
    } catch (e) {
        if (_erroPermissao(e)) {      // regra ainda não publicada no console do Firebase
            if (lsGet('fb_bakAviso') !== hoje) { lsSet('fb_bakAviso', hoje); console.warn('Backup diário indisponível: publique database.rules.json (inclui finances_bak).'); }
        } else if (!(e && e.message === 'backup indisponível')) console.warn('Backup diário falhou:', e && e.message);
    } finally { _bakEmCurso = false; }
}
function closeBackups() { $('ovBackups').classList.remove('open'); }
async function abrirBackups() {
    if (PREVIEW_MODE || !SYNC_ENABLED || !_currentUser) { toast('Backups da nuvem só existem com login.', '#52525b'); return; }
    $('bakLista').textContent = 'Carregando…'; $('ovBackups').classList.add('open');
    try {
        const meta = (await _comPrazo(_bakRef().child('meta').once('value'), CONFIG.SYNC_PRAZO_MS, 'sem resposta do servidor')).val() || {};
        const dias = Object.keys(meta).sort().reverse(), box = $('bakLista'); box.textContent = '';
        if (!dias.length) { box.textContent = 'Ainda não há cópias (a primeira é criada no próximo uso com internet).'; return; }
        dias.forEach(d => {
            const b = document.createElement('button'); b.className = 'btn-mcancel'; b.style.textAlign = 'left';
            b.textContent = `${d.split('-').reverse().join('/')} · ${meta[d].n} lançamentos`; b.onclick = () => restaurarBackup(d);
            box.appendChild(b);
        });
    } catch (e) {
        $('bakLista').textContent = _erroPermissao(e) ? 'Sem permissão: publique database.rules.json no Firebase (inclui finances_bak).' : '❌ ' + e.message;
    }
}
async function restaurarBackup(dia) {
    try {
        const raw = (await _comPrazo(_bakRef().child('dados/' + dia).once('value'), CONFIG.SYNC_PRAZO_MS, 'sem resposta do servidor')).val();
        if (!raw) { toast('⚠️ Essa cópia não existe mais.', '#b45309'); return; }
        if (_remotoMaisNovo(raw)) { toast('⚠️ Essa cópia é de uma versão mais nova do app — recarregue a página.', '#b45309'); return; }
        const d = _mapKeys(raw, _fbKeyDec);
        closeBackups();
        confirmar(`Substituir os dados atuais pela cópia de ${dia.split('-').reverse().join('/')} (${_asList(d.t).length} lançamentos)?\nDá para desfazer com Ctrl+Z.`, { ok: 'Restaurar', perigo: true }, () => _aplicarBackup({ t: [], g: [], k: [], l: [], b: {}, ...d }));   // o Firebase não guarda vazios: ausente = vazio (como em _applyRemote)
    } catch (e) { toast('❌ Não consegui ler a cópia: ' + e.message, '#dc2626'); }
}
function _buildPayload() {
    // JSON round-trip remove undefined/NaN (o set() do Firebase rejeita undefined)
    const data = JSON.parse(JSON.stringify({ t: tx, c: cats, g: goals, k: cards, b: budget, l: loans }));
    return { ..._mapKeys(data, _fbKeyEnc), ts: Date.now(), v: SCHEMA_VERSION, appV: APP_BUILD };
}

// Servidor com esquema mais novo que este app: este app ainda NÃO conhece campos que o outro grava e
// os descartaria ao regravar a base inteira em todos os aparelhos. Então não aplica, não mescla e não
// grava; as edições locais ficam salvas neste aparelho (pendentes) até recarregar a página.
const _remotoMaisNovo = r => !!r && Number(r.v) > SCHEMA_VERSION;
let _appDesatualizado = false;
function _marcarDesatualizado(remote) {
    if (!_appDesatualizado) {
        _appDesatualizado = true;
        const cons = remote && remote.appV ? ` (outro aparelho está na versão ${remote.appV})` : '';
        toast('⚠️ Este app está desatualizado' + cons + ' — recarregue a página. Nada foi sincronizado; suas alterações ficam salvas aqui.', '#d97706');
        try { navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {}); } catch (e) {}
    }
    setSyncState('err', 'Atualize');
    return 'stale';
}

let _syncing = null, _syncQueued = false, _conflictOpen = false, _pendingConflictRemote = null;

let _lastRemoteCheck = 0;
const PASSIVE_SYNC_MIN_MS = CONFIG.SYNC_PASSIVA_MIN_MS;
// passive = gatilhos oportunistas (foco, visibilidade, timer): pulam se houve checagem
// recente e não há nada local pendente — cada checagem baixa a base inteira
// Sem conexão o SDK do Firebase não falha: once()/transaction() ficam pendurados até a rede
// voltar — o botão mostrava "Sync…" para sempre e "Sair" com pendências travava em silêncio.
// Offline declarado → estado "Offline" na hora (o evento 'online' retoma); conexão instável
// → prazo vira erro. Uma transação que ainda confirme depois é segura (é condicional ao ts).
const SYNC_PRAZO_MS = CONFIG.SYNC_PRAZO_MS;
function _comPrazo(promessa, ms, msg) {
    let t;
    return Promise.race([promessa, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}
// ── DISJUNTOR DA SINCRONIZAÇÃO ────────────────────────────────────────────────
// Cada ida ao servidor baixa (e às vezes sobe) a base inteira. Um bug que faça dois aparelhos se reativarem em laço
// (um grava → o outro reage e grava → ...) geraria tráfego sem fim — e, em plano pago do Firebase, conta. Uso normal fica
// longe do limite (edições são agrupadas a cada 1,5 s + 1 checagem a cada 5 min); passou de SYNC_DISJUNTOR_MAX idas em 10 min,
// a sincronização pausa sozinha por 15 min (o botão Sync retoma na hora). Os dados continuam salvos neste aparelho.
const _rodadasSync = [];
let _syncPausadoAte = 0;
function _disjuntorRegistra(agora = Date.now()) {
    _rodadasSync.push(agora);
    while (_rodadasSync.length && agora - _rodadasSync[0] > CONFIG.SYNC_DISJUNTOR_JANELA_MS) _rodadasSync.shift();
    if (_rodadasSync.length < CONFIG.SYNC_DISJUNTOR_MAX) return false;
    _syncPausadoAte = agora + CONFIG.SYNC_DISJUNTOR_PAUSA_MS; _rodadasSync.length = 0;
    return true;
}
const _syncPausado = (agora = Date.now()) => agora < _syncPausadoAte;
const _disjuntorReseta = () => { _syncPausadoAte = 0; _rodadasSync.length = 0; };
const _offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

async function reconcile({ initial = false, manual = false, passive = false } = {}) {
    if (!SYNC_ENABLED || !_currentUser || _conflictOpen) return;
    if (_offline()) {
        setSyncState('err', 'Offline');
        if (manual) toast('📴 Sem internet — as alterações ficam salvas neste aparelho e sobem quando a conexão voltar.', '#52525b');
        return;
    }
    if (_syncPausado()) {
        if (!manual) { setSyncState('err', 'Pausado'); return; }
        _disjuntorReseta();            // o dono pediu: tenta de novo
    }
    if (passive && Date.now() - _lastRemoteCheck < PASSIVE_SYNC_MIN_MS && !_localDirty()) return;
    if (_syncing) { _syncQueued = true; return _syncing; }   // uma rodada por vez
    setSyncState('busy', initial ? 'Carregando…' : 'Sync…');
    _syncing = (async () => {
        try {
            if (_disjuntorRegistra()) {
                setSyncState('err', 'Pausado');
                toast('⏸️ Sincronização pausada: muitas idas ao servidor em pouco tempo (possível laço). Seus dados estão salvos neste aparelho — toque em Sync para tentar de novo.', '#d97706');
                console.error('Disjuntor da sincronização aberto: ' + CONFIG.SYNC_DISJUNTOR_MAX + ' rodadas em 10 min');
                return;
            }
            const r = await _reconcileOnce();
            if (r !== 'stale') {      // app desatualizado não sincronizou: nada de "sincronizado agora"
                lsSet('fb_lastSync', String(Date.now()));
                updateSyncTime();
                setSyncState(r === 'conflict' ? 'err' : 'ok', r === 'conflict' ? 'Conflito' : 'Sync');
            }
            if (r === 'pulled' && !initial) toast('🔥 Dados atualizados de outro dispositivo.', '#f97316');
            if (manual && r === 'noop') toast('✓ Tudo sincronizado.');
        } catch (e) {
            setSyncState('err', 'Sync');
            console.error('Firebase sync error:', e);
            if (manual || initial) toast('❌ Sincronização falhou: ' + e.message, '#dc2626');
        }
    })();
    try { await _syncing; }
    finally {
        _syncing = null;
        if (_syncQueued) { _syncQueued = false; reconcile(); }
    }
}

async function _reconcileOnce() {
    const meta   = _getSyncMeta();
    const remote = (await _comPrazo(_userRef().once('value'), SYNC_PRAZO_MS, 'sem resposta do servidor (conexão instável?)')).val();
    _lastRemoteCheck = Date.now();
    if (_remotoMaisNovo(remote)) return _marcarDesatualizado(remote);
    if (remote) _backupDiario(remote);   // sem await: o backup não atrasa nem derruba a sync
    _appDesatualizado = false;      // o servidor voltou a ser compatível (ex.: outra conta nesta página)
    const localDirty = !meta || meta.hash !== _stateHash();
    if (!remote) return _pushCAS(null);                      // conta nova: sobe o local
    const remoteTs = remote.ts || 0;
    const remoteChanged = !meta || meta.ts !== remoteTs;
    if (!remoteChanged && !localDirty) return 'noop';
    if (!remoteChanged) return _pushCAS(remoteTs);
    if (!localDirty || !meta) { _applyRemote(remote); return 'pulled'; }   // dispositivo novo: remoto vence
    return _mergeOrConflict(remote);
}

// Os dois lados mudaram: tenta o merge de 3 vias; só pergunta se houver conflito real
async function _mergeOrConflict(remote, attempt = 0) {
    if (_remotoMaisNovo(remote)) return _marcarDesatualizado(remote);
    const base = _getSyncBase();
    if (base && attempt < 3) {
        const rs = sanitizeState(_mapKeys(remote, _fbKeyDec), Number(remote.v) || 2);
        const { merged, conflicts, nomes } = mergeStates(base, snapshotState(), rs);
        if (conflicts.length) {
            console.info('Merge automático impossível — mesmos itens alterados nos dois lados:', conflicts);
            _showConflict(remote, nomes);     // escolha resolve SÓ esses itens (resolveConflict)
            return 'conflict';
        }
        restoreState(sanitizeState({ t: merged.tx, c: merged.cats, g: merged.goals, k: merged.cards, b: merged.budget, l: merged.loans }));
        persistAll();
        undoStack = []; redoStack = []; _updateUndoBtn();   // snapshots antigos desfariam o que veio do outro dispositivo
        renderAll(); renderGoals(); renderCartoesMini();
        const r = await _pushCAS(remote.ts || 0, attempt + 1);
        if (r === 'pushed') { toast('🔀 Alterações deste e de outro dispositivo foram combinadas.', '#0b62f0'); return 'merged'; }
        return r;
    }
    _showConflict(remote);                    // sem base de merge: só dá para escolher um lado inteiro
    return 'conflict';
}

// Escrita condicional: só grava se o remoto ainda estiver na versão lida (expectedTs).
// Se outro dispositivo gravou no meio do caminho, aborta e vira conflito.
async function _pushCAS(expectedTs, attempt = 0) {
    const hash = _stateHash(), payload = _buildPayload(), baseSnap = snapshotState();
    // O `ts` é a "versão" que os outros aparelhos comparam por IGUALDADE: dois envios no mesmo milissegundo (ou o relógio deste
    // aparelho atrasado) davam o mesmo ts e o outro lado achava que nada mudou, perdendo a alteração. Sempre maior que o substituído.
    payload.ts = Math.max(payload.ts, (expectedTs || 0) + 1);
    _pushingTs = payload.ts;
    const res = await _comPrazo(_userRef().transaction(cur => {
        // cur === null pode ser só cache vazio: devolve o payload e o servidor
        // re-executa com o valor real se ele não bater
        if (cur !== null && (cur.ts || 0) !== expectedTs) return;   // aborta
        if (cur !== null && _remotoMaisNovo(cur)) return;           // outro aparelho já tem esquema mais novo
        return payload;
    }, undefined, false), SYNC_PRAZO_MS, 'gravação sem confirmação do servidor (conexão instável?)');
    if (!res.committed) {
        const remote = res.snapshot.val();
        if (_remotoMaisNovo(remote)) return _marcarDesatualizado(remote);
        if (remote) return _mergeOrConflict(remote, attempt);
        throw new Error('gravação não confirmada');
    }
    _setSyncMeta({ ts: payload.ts, hash });
    _setSyncBase(baseSnap, payload.ts);
    return 'pushed';
}

function _applyRemote(remote, { keepUndo = false } = {}) {
    const v = Number(remote.v) || 2;
    const s = sanitizeState(_mapKeys(remote, _fbKeyDec), v);
    _quarantine(s.report);
    restoreState(s);
    persistAll();
    // Snapshots antigos desfariam mudanças feitas em outro dispositivo
    if (!keepUndo) { undoStack = []; redoStack = []; _updateUndoBtn(); }
    renderAll(); renderGoals(); renderCartoesMini();
    // Se a migração de esquema alterou algo, marca como sujo para subir a versão nova
    _setSyncMeta({ ts: remote.ts || 0, hash: v < SCHEMA_VERSION ? 'migrated' : _stateHash() });
    _setSyncBase(s, remote.ts || 0);
    if (v < SCHEMA_VERSION) schedulePush();
}

// Salvamentos locais disparam uma sincronização agrupada (várias edições seguidas = 1 envio)
const _syncSoon = debounce(() => reconcile(), CONFIG.SYNC_DEBOUNCE_MS);
function schedulePush() { if (SYNC_ENABLED && _currentUser) _syncSoon(); }
function syncNow() { return reconcile({ manual: true }); }

// ── CONFLICT RESOLUTION ───────────────────────────────────────────────────────
// nomes (há base de merge): só esses itens mudaram dos DOIS lados — a escolha vale para eles
// e todo o resto (mudanças em itens diferentes, dos dois dispositivos) é mantido. Antes a
// escolha era sempre do estado inteiro: "Manter Local" apagava o que o outro dispositivo
// tinha mudado em OUTROS itens, e "Usar Firebase" o que foi feito aqui.
function _showConflict(remote, nomes = null) {
    _conflictOpen = true;
    _pendingConflictRemote = remote;
    const rDate = remote.ts ? new Date(remote.ts).toLocaleString('pt-BR') : '—';
    const porItem = Array.isArray(nomes) && nomes.length > 0;
    if (porItem) {
        const n = nomes.length, lista = nomes.slice(0, 6).map(x => `<li>${escHtml(x)}</li>`).join('') + (n > 6 ? `<li>… e mais ${n - 6}</li>` : '');
        $('conflictMsg').textContent = `${n === 1 ? 'Este item foi alterado' : `Estes ${n} itens foram alterados`} aqui e em outro dispositivo (${rDate}). As demais mudanças dos dois lados serão mantidas.`;
        $('conflictDetails').innerHTML = `<ul style="grid-column:1/-1;margin:4px 0 0 16px;line-height:1.6">${lista}</ul>`;
    } else {
        $('conflictMsg').textContent = 'Você tem mudanças locais e o Firebase foi atualizado em outro dispositivo.';
        $('conflictDetails').innerHTML = `
            <div><strong>💾 Local</strong><br>${tx.length} transações<br><span style="color:var(--text-3)">alterações não enviadas</span></div>
            <div><strong>🔥 Firebase</strong><br>${_asList(remote.t).length} transações<br><span style="color:var(--text-3)">${escHtml(rDate)}</span></div>`;
    }
    $('conflictSub').textContent = porItem ? 'Qual versão desses itens manter?' : 'Os dados locais e do Firebase são diferentes. Qual versão manter?';
    $('btnConflictLocal').textContent  = porItem ? 'Manter as minhas' : 'Manter Local';
    $('btnConflictRemote').textContent = porItem ? 'Usar as do outro dispositivo' : 'Usar Firebase';
    $('ovConflict').classList.add('open');
}

async function resolveConflict(choice) {
    $('ovConflict').classList.remove('open');
    const remote = _pendingConflictRemote;
    _pendingConflictRemote = null;
    _conflictOpen = false;
    if (!remote) return;
    if (_remotoMaisNovo(remote)) { _marcarDesatualizado(remote); return; }
    try {
        const base = _getSyncBase();
        if (base) {
            // Resolve só os itens em conflito pelo lado escolhido; o resto da mescla fica
            pushUndo('Resolver conflito de sincronização');
            const rs = sanitizeState(_mapKeys(remote, _fbKeyDec), Number(remote.v) || 2);
            const { merged } = mergeStates(base, snapshotState(), rs, choice === 'remote' ? 'remote' : 'local');
            restoreState(sanitizeState({ t: merged.tx, c: merged.cats, g: merged.goals, k: merged.cards, b: merged.budget, l: merged.loans }));
            persistAll();
            renderAll(); renderGoals(); renderCartoesMini();
            if (!['pushed', 'merged'].includes(await _pushCAS(remote.ts || 0))) return;   // conflito/app desatualizado: nada subiu
            toast(choice === 'remote' ? '✓ Usadas as versões do outro dispositivo; o resto foi combinado.' : '✓ Mantidas as suas versões; o resto foi combinado.', '#0b62f0');
        } else if (choice === 'remote') {
            pushUndo('Aplicar dados do Firebase');       // dá para voltar ao local com Ctrl+Z
            _applyRemote(remote, { keepUndo: true });
            toast('🔥 Dados do Firebase aplicados.', '#f97316');
        } else {
            if (!['pushed', 'merged'].includes(await _pushCAS(remote.ts || 0))) return;
            toast('💾 Dados locais enviados ao Firebase.', '#16a34a');
        }
        setSyncState('ok', 'Sync');
        lsSet('fb_lastSync', String(Date.now()));
        updateSyncTime();
    } catch (e) {
        setSyncState('err', 'Sync');
        toast('❌ Erro ao resolver conflito: ' + e.message, '#dc2626');
    }
}

// ── AUTO-SYNC ─────────────────────────────────────────────────────────────────
let _syncListenersOn = false, _tsRef = null, _pushingTs = null;
// ── AUTOVERIFICAÇÃO DAS REGRAS DO FIREBASE ───────────────────────────────────
// A privacidade real depende das regras do Realtime Database (fora deste arquivo). Teste
// não intrusivo: ler um caminho VIZINHO inexistente. Com as regras certas
// (auth.uid === $uid) a leitura é negada; se for permitida, as regras estão abertas e
// qualquer conta logada leria as finanças das outras. Checa no máximo 1×/dia.
const DB_RULES_RECOMENDADAS = {
    rules: {
        finances:     { $uid: { '.read': 'auth != null && auth.uid === $uid', '.write': 'auth != null && auth.uid === $uid' } },
        finances_bak: { $uid: { '.read': 'auth != null && auth.uid === $uid', '.write': 'auth != null && auth.uid === $uid' } },
    }
};
async function checkDbRules(db = fbDb) {
    if (!SYNC_ENABLED || !_currentUser || !db) return null;
    const hoje = todayLocalISO();
    if (lsGet('fb_rulesCheck') === hoje) return null;
    let aberto;
    try {
        await db.ref('finances/__probe_' + Math.random().toString(36).slice(2)).once('value');
        aberto = true;    // leitura permitida fora do próprio uid
    } catch (e) {
        if (!/permission/i.test(e.code || e.message || '')) return null;   // erro de rede etc.: tenta outro dia
        aberto = false;
    }
    // Escrita em caminho vizinho (set(null): não cria nada): regra de escrita aberta passava sem aviso
    let escritaAberta = false;
    try { await db.ref('finances/__probe_' + Math.random().toString(36).slice(2)).set(null); escritaAberta = true; }
    catch (e) { if (!/permission/i.test(e.code || e.message || '')) return null; }
    lsSet('fb_rulesCheck', hoje);
    if (escritaAberta && !aberto) console.warn('⚠️ Regras do Firebase permitem ESCRITA fora do próprio uid. Aplique:\n' + JSON.stringify(DB_RULES_RECOMENDADAS, null, 2));
    if (escritaAberta && !aberto) { toast('⚠️ Segurança: as regras do Firebase permitem escrita em dados de outras contas — veja o console.', '#dc2626'); }
    if (aberto) {
        console.warn('⚠️ Regras do Firebase ABERTAS: qualquer conta logada pode ler dados de outras.\n'
            + 'Firebase Console → Realtime Database → Regras, aplique:\n' + JSON.stringify(DB_RULES_RECOMENDADAS, null, 2));
        toast('⚠️ Segurança: as regras do Firebase permitem ler dados de outras contas — veja o console.', '#dc2626');
    }
    return aberto || escritaAberta;
}

function setupAutoSync() {
    clearInterval(_autoSyncTimer);
    _autoSyncTimer = setInterval(() => { reconcile({ passive: true }); updateSyncTime(); checkInbox(); }, CONFIG.SYNC_INTERVALO_MS);
    _watchRemoteTs();
    if (_syncListenersOn) return;
    _syncListenersOn = true;
    // Volta à aba/reconecta → confere mudanças (com limite de frequência)
    window.addEventListener('focus',  () => { reconcile({ passive: true }); checkInbox(); });
    window.addEventListener('online', () => reconcile());
    window.addEventListener('offline', () => setSyncState('err', 'Offline'));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { reconcile({ passive: true }); checkInbox(); }
        else if (_localDirty()) reconcile();   // saindo da aba: tenta enviar o pendente
    });
}
// Tempo real barato: escuta só o campo `ts` (bytes) e baixa a base inteira apenas
// quando outro dispositivo gravou. Antes, mudanças do celular só apareciam no PC no
// próximo foco da janela ou em até 5 min — e cada checagem baixava tudo.
function _watchRemoteTs() {
    stopRemoteWatch();
    if (!SYNC_ENABLED || !_currentUser) return;
    _tsRef = _userRef().child('ts');
    _tsRef.on('value', snap => {
        const ts = snap.val(), meta = _getSyncMeta();
        if (ts == null || ts === _pushingTs || (meta && meta.ts === ts)) return;   // nada novo / gravação nossa
        reconcile();
    }, err => console.warn('Firebase: falha ao observar mudanças remotas', err));
}
function stopRemoteWatch() { if (_tsRef) { _tsRef.off(); _tsRef = null; } }


// ═══════════════════════════════════════════════════════════════
// CREDIT CARD MANAGEMENT
// ═══════════════════════════════════════════════════════════════

const CARD_COLORS = ['#6d28d9','#0284c7','#dc2626','#16a34a','#f59e0b','#ec4899','#0f766e','#b45309','#0e7490','#0b62f0'];
let _selCardColor = CARD_COLORS[0];

// ── FATURA CALCULATION ────────────────────────────────────────
// Compra até o dia de fechamento (inclusive) entra na fatura que fecha neste mês;
// depois dele, na que fecha no mês seguinte. O vencimento é o primeiro dia
// `vencimento` APÓS o fechamento: no mesmo mês se vencimento > fechamento, senão no
// mês seguinte. A fórmula antiga ignorava esse segundo caso — num cartão que fecha
// dia 25 e vence dia 5, uma compra em 20/jan caía numa fatura vencida em 05/jan.
function _calcFatura(card, spendDate) {
    const [y, m, d] = spendDate.split('-').map(Number);
    let idx = y * 12 + (m - 1) + (d > card.fechamento ? 1 : 0);   // mês do fechamento
    if (card.vencimento <= card.fechamento) idx++;                 // vence no mês seguinte
    const dy = Math.floor(idx / 12), dm = idx % 12;
    return `${dy}-${pad2(dm + 1)}-${pad2(Math.min(card.vencimento, new Date(dy, dm + 1, 0).getDate()))}`;
}
// Fórmula anterior (esquema < 3) — só para reconhecer e migrar datas geradas por ela
function _calcFaturaLegacy(card, spendDate) {
    const [y, m, d] = spendDate.split('-').map(Number);
    const idx = y * 12 + (m - 1) + (d > card.fechamento ? 1 : 0);
    const dy = Math.floor(idx / 12), dm = idx % 12;
    return `${dy}-${pad2(dm + 1)}-${pad2(Math.min(card.vencimento, new Date(dy, dm + 1, 0).getDate()))}`;
}
function calcFaturaData(cardId, spendDate) {
    const card = cards.find(c => c.id === toId(cardId));
    return card && isValidISODate(spendDate) ? _calcFatura(card, spendDate) : null;
}

function _faturaInfoHtml(cardId, spendDate) {
    if (!cardId || !spendDate) return null;
    const card = cards.find(c => c.id == cardId);
    if (!card) return null;
    const fd = calcFaturaData(cardId, spendDate);
    if (!fd) return null;
    const [fy, fm, fdia] = fd.split('-');   // dia real (vencimento 31 em fevereiro = dia 28)
    return `💳 <strong>${escHtml(card.nome)}</strong> &mdash; fatura de <strong>${MESES[parseInt(fm)-1]}</strong> (vence dia ${+fdia})`;
}

// ── TIPO / PAGAMENTO / CARTÃO / AVISO DE FATURA — os 3 formulários ────────────
// Uma implementação guiada pelos descritores FORM_*. Antes eram 3 cópias de cada
// handler (desktop, celular, editar no celular) e a de edição no celular ficou sem
// atualizar o aviso "fatura de X" ao trocar a data (mostrava a fatura antiga).
function _mostrar(id, on) { const el = id && $(id); if (el) el.style.display = on ? '' : 'none'; }
function formTipoChange(F, selectedCat) {
    const tipo = $(F.tipo).value;
    _mostrar(F.pagField, tipo === 'saida');
    _mostrar(F.maisField, tipo === 'saida');   // parcelas e juros só existem em gastos
    if (tipo === 'saida') formPagChange(F);
    else { _mostrar(F.cartaoField, false); _mostrar(F.faturaInfo, false); }
    populateCatSelect($(F.cat), tipo, selectedCat);   // undefined (troca de tipo) = mantém se existir
}
function formPagChange(F) {
    const show = $(F.pag).value === 'credito' && cards.length > 0;
    _mostrar(F.cartaoField, show);
    _mostrar(F.faturaInfo, false);
    if (show) { _populateCardSelect(F.cartao); formFaturaInfo(F); }
}
function formFaturaInfo(F) {
    const el = F.faturaInfo && $(F.faturaInfo);   // editor inline não tem aviso
    if (!el) return;
    const html = $(F.tipo).value === 'saida' && $(F.pag).value === 'credito'
        ? _faturaInfoHtml($(F.cartao)?.value, $(F.data).value) : null;
    if (html) el.innerHTML = html;
    el.style.display = html ? '' : 'none';
}
// Nomes usados pelos atributos on* do HTML
function onTipoChange()            { formTipoChange(FORM_DESKTOP); }
function onPagChange()             { formPagChange(FORM_DESKTOP); }
function onCartaoChange()          { formFaturaInfo(FORM_DESKTOP); }
function mobOnTipoChange()         { formTipoChange(FORM_MOBILE); }
function mobOnPagChange()          { formPagChange(FORM_MOBILE); }
function mobOnCartaoChange()       { formFaturaInfo(FORM_MOBILE); }
function mobEditTipoChange(cat)    { formTipoChange(FORM_MOB_EDIT, cat); }
function mobEditPagChange()        { formPagChange(FORM_MOB_EDIT); }
function mobEditCartaoChange()     { formFaturaInfo(FORM_MOB_EDIT); }

// ── SHARED ────────────────────────────────────────────────────
// Cartão sugerido para compra nova no crédito: o último usado (se ainda existe) ou o
// único cadastrado. Antes vinha "— sem cartão —" e a compra ficava fora de qualquer fatura.
function defaultCardId() {
    const last = toId(lsGet('fin5_lastCard'));
    if (last && cards.some(c => c.id === last)) return last;
    return cards.length === 1 ? cards[0].id : '';
}
function _populateCardSelect(selId, selectedId) {
    const sel = $(selId);
    if (!sel) return;
    // selectedId explícito (edição, inclusive null = "sem cartão") é respeitado
    let prev = selectedId !== undefined ? selectedId : sel.value;
    if (selectedId === undefined && !prev) prev = defaultCardId();
    sel.innerHTML = '<option value="">— sem cartão —</option>' +
        cards.map(c => `<option value="${c.id}" ${c.id == prev ? 'selected' : ''}>${escHtml(c.nome)}</option>`).join('');
}

// ── SIDEBAR MINI ──────────────────────────────────────────────
function renderCartoesMini() {
    const lbl  = $('cartoesMiniLabel');
    const list = $('cartoesMiniList');
    if (!lbl || !list) return;
    if (!cards.length) {
        lbl.textContent = 'Nenhum cartão';
        list.innerHTML  = '';
        return;
    }
    const { m, a } = filtro();
    lbl.textContent = cards.length + (cards.length === 1 ? ' cartão' : ' cartões');
    list.innerHTML = cards.map(c => {
        // Show credit spending on this card for the current month (by spend date)
        const net = (s, t) => s + (t.tipo === 'entrada' ? -t.valor : t.valor);   // estorno abate
        const monthSpend = txMes(m, a).filter(t => t.cartaoId === c.id && t.pagamento === 'credito').reduce(net, 0);
        // Also check fatura due this month
        const faturaTotal = txFaturaMes(m, a).filter(t => t.cartaoId === c.id).reduce(net, 0);
        const faturaLabel = faturaTotal > 0 ? `fatura: ${fmt(faturaTotal)}` : '';
        const spendLabel  = monthSpend > 0 ? `gastos: ${fmt(monthSpend)}` : '';
        const sub = [spendLabel, faturaLabel].filter(Boolean).join(' · ') || '—';
        return `<div class="fixos-mini-item" style="flex-direction:column;align-items:stretch;gap:2px;padding:8px 0">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span class="n" style="display:flex;align-items:center;gap:6px">
                    <span style="width:8px;height:8px;border-radius:50%;background:${c.cor};display:inline-block;flex-shrink:0"></span>
                    ${escHtml(c.nome)}
                </span>
            </div>
            <div style="font-size:10px;color:var(--text-3);padding-left:14px">${sub}</div>
        </div>`;
    }).join('');
}

// ── CARD MODAL ────────────────────────────────────────────────
function abrirCartoes() {
    _selCardColor = CARD_COLORS[0];
    _renderCardColorPicker();
    _renderCartaoList();
    $('ovCartoes').classList.add('open');
}

function closeCartoes() {
    $('ovCartoes').classList.remove('open');
    resetCartaoForm();
}

function _renderCartaoList() {
    const body = $('cartaoListBody');
    if (!body) return;
    if (!cards.length) {
        body.innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;color:var(--text-3)">Nenhum cartão cadastrado.</div>';
        return;
    }
    body.innerHTML = cards.map(c => `
        <div class="cartao-item">
            <div class="cartao-dot" style="background:${c.cor}"></div>
            <div>
                <div class="cartao-name">${escHtml(c.nome)}</div>
                <div class="cartao-meta">Fecha dia <strong>${c.fechamento}</strong> · Vence dia <strong>${c.vencimento}</strong></div>
            </div>
            <div class="cartao-acts">
                <button class="icon-btn" data-onclick="editarCartao(${c.id})" title="Editar">✏️</button>
                <button class="icon-btn" data-onclick="removerCartao(${c.id})" title="Remover">🗑️</button>
            </div>
        </div>`).join('');
}

function _renderCardColorPicker() {
    const el = $('cardColorPicker');
    if (!el) return;
    el.innerHTML = CARD_COLORS.map(c =>
        `<div class="card-color-opt ${c === _selCardColor ? 'sel' : ''}" style="background:${c}" title="Cor ${c}" aria-pressed="${c === _selCardColor}" data-onclick="selectCardColor('${c}')"></div>`
    ).join('');
}

function selectCardColor(c) { _selCardColor = c; _renderCardColorPicker(); }

function salvarCartao() {
    const nome = $('cartaoNome').value.trim();
    const fech = parseInt($('cartaoFech').value, 10);
    const venc = parseInt($('cartaoVenc').value, 10);
    const editId = toId($('cartaoEditId').value);

    if (!nome)                          return toast('⚠️ Digite o nome do cartão.', '#b45309');
    if (!(fech >= 1 && fech <= 31))     return toast('⚠️ Dia de fechamento inválido (1-31).', '#b45309');
    if (!(venc >= 1 && venc <= 31))     return toast('⚠️ Dia de vencimento inválido (1-31).', '#b45309');

    const idx = editId ? cards.findIndex(c => c.id === editId) : -1;
    if (editId && idx < 0) return toast('⚠️ Cartão não encontrado.', '#b45309');
    pushUndo(idx >= 0 ? `Edição do cartão "${nome}"` : `Novo cartão "${nome}"`);
    let recalcId = null;
    if (idx >= 0) {
        const prev = cards[idx];
        if (prev.fechamento !== fech || prev.vencimento !== venc) recalcId = prev.id;
        cards[idx] = { ...prev, nome, fechamento: fech, vencimento: venc, cor: safeColor(_selCardColor) };
        toast('✓ Cartão atualizado!');
    } else {
        cards.push({ id: newId(), nome, fechamento: fech, vencimento: venc, cor: safeColor(_selCardColor) });
        toast('💳 Cartão adicionado!');
    }
    // commitAll: antes só salvava local (saveCards) e o cartão não ia para a nuvem
    commitAll();
    _renderCartaoList();
    resetCartaoForm();
    if (recalcId !== null) promptRecalcFaturas(recalcId);
}

// ── RECALCULATE FATURAS AFTER A CARD'S DATES CHANGE ──────────────────────────
let _recalcPendingCardId = null;
function promptRecalcFaturas(cardId) {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    const affected = tx.filter(t => t.cartaoId === cardId && t.pagamento === 'credito' && t.faturaData);
    if (!affected.length) return; // no credit purchases to move
    _recalcPendingCardId = cardId;
    const sub = $('recalcFaturaSub');
    if (sub) sub.innerHTML = `Você alterou as datas de <strong>${escHtml(card.nome)}</strong>. `
        + `Em qual fatura as <strong>${affected.length}</strong> compra(s) já lançadas devem aparecer?`;
    const ov = $('ovRecalcFatura');
    if (ov) ov.classList.add('open');
}
function closeRecalcFatura() {
    const ov = $('ovRecalcFatura'); if (ov) ov.classList.remove('open');
    _recalcPendingCardId = null;
}
function doRecalcFaturas(scope) {
    const cardId = _recalcPendingCardId;
    if (cardId === null || scope === 'none') { closeRecalcFatura(); return; }
    const cutoff = ymKey(new Date().getMonth(), new Date().getFullYear()) + '-01';
    pushUndo('Recalcular faturas');
    let n = 0;
    tx = tx.map(t => {
        if (t.cartaoId !== cardId || t.pagamento !== 'credito') return t;
        if (scope === 'future' && t.data < cutoff) return t; // keep past invoices intact
        const fd = calcFaturaData(cardId, t.data);
        if (fd && fd !== t.faturaData) { n++; return { ...t, faturaData: fd }; }
        return t;
    });
    commit();
    closeRecalcFatura();
    toast(`✓ ${n} lançamento(s) recalculado(s).`, '#16a34a');
}

function editarCartao(id) {
    const c = cards.find(x => x.id === id);
    if (!c) return;
    $('cartaoEditId').value = id;
    $('cartaoNome').value   = c.nome;
    $('cartaoFech').value   = c.fechamento;
    $('cartaoVenc').value   = c.vencimento;
    _selCardColor = c.cor;
    _renderCardColorPicker();
    $('cartaoFormTitle').textContent = 'Editar Cartão';
    $('cartaoNome').focus();
}

function removerCartao(id) {
    const c = cards.find(x => x.id === id);
    if (!c) return;
    const n = tx.filter(t => t.cartaoId === id).length;
    const aviso = n ? `\n\n${n} lançamento(s) deste cartão continuam salvos, mas deixam de aparecer em faturas.` : '';
    confirmar(`Remover "${c.nome}"?${aviso}\nDá para desfazer com Ctrl+Z.`, { ok: 'Remover', perigo: true }, () => {
    pushUndo(`Remoção do cartão "${c.nome}"`);
    cards = cards.filter(x => x.id !== id);
    commitAll();
    _renderCartaoList();
    toast('Cartão removido.', '#52525b');
    });
}

function resetCartaoForm() {
    $('cartaoEditId').value = '';
    $('cartaoNome').value   = '';
    $('cartaoFech').value   = '';
    $('cartaoVenc').value   = '';
    $('cartaoFormTitle').textContent = 'Novo Cartão';
    _selCardColor = CARD_COLORS[0];
    _renderCardColorPicker();
}

// ── IMPORTAÇÃO DE EXTRATO (CSV / OFX) ────────────────────────────────────────
// (Havia um segundo sistema de importação completo, nunca aberto por nenhum botão,
// com parsers e regras duplicados — removido; o que tinha de melhor veio para cá.)
let _extParsed = []; // [{ checked, date, desc, valor, tipo, cat, flag, extId }]
let _extSkipped = 0;  // linhas com conteúdo mas data/valor ilegível no último arquivo lido

// Texto normalizado para comparação: sem acento, minúsculo, só letras/dígitos/espaço
const _normTxt = s => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

// Regras por palavra inteira (com plural opcional). Antes era substring: "tim" batia
// em "estimativa", "eth" em "method", e "pagamento" de qualquer boleto virava Salário.
// Cada regra só vale se a categoria existir para o TIPO do lançamento.
const EXT_CAT_RULES = [
    { kw: ['supermercado','mercado','atacadao','carrefour','pao de acucar','assai','extra hiper','condor','angeloni','bistek','fort atacadista','big bompreco','hortifruti','sacolao','mercearia','acougue'], cat: '🍔 Alimentação' },
    { kw: ['uber trip','uber','99app','99 pop','cabify','taxi','gasolina','combustivel','etanol','estacionamento','ipva','pedagio','sem parar','conectcar','auto posto','posto','shell','ipiranga'], cat: '🚗 Transporte' },
    { kw: ['netflix','spotify','disney','hbo','max','amazon prime','youtube premium','apple com','google one','icloud','deezer','globoplay','paramount','crunchyroll','star','twitch','chatgpt','openai','adobe','microsoft 365'], cat: '📱 Assinaturas' },
    { kw: ['restaurante','burger','pizza','pizzaria','sushi','ifood','rappi','uber eats','lanchonete','padaria','cafe','cafeteria','starbucks','subway','mcdonald','bk','habib','outback','madero','bar','boteco','churrascaria','ze delivery'], cat: '🍽️ Restaurantes' },
    { kw: ['farmacia','drogaria','droga raia','drogasil','pacheco','hospital','clinica','medico','dentista','unimed','amil','sulamerica','hapvida','odonto','laboratorio','otica'], cat: '💊 Saúde' },
    { kw: ['internet','claro','vivo','tim','oi fibra','telefone','celular','telecom'], cat: '📡 Internet/Telefone' },
    { kw: ['aluguel','condominio','iptu','energia','luz','cemig','celesc','copel','cpfl','enel','equatorial','agua','sabesp','sanepar','compesa','copasa','comgas','gas natural'], cat: '🏠 Moradia' },
    { kw: ['shopping','loja','amazon','mercado livre','mercadolivre','shopee','magalu','magazine luiza','americanas','casas bahia','kabum','ponto frio','aliexpress','leroy merlin','kalunga'], cat: '🛒 Compras' },
    { kw: ['cinema','cinemark','teatro','show','ingresso','balada','festa','parque','boliche','karaoke','sinuca','viagem','hotel','airbnb','booking','museu'], cat: '🎉 Lazer' },
    { kw: ['salario','prolabore','pro labore','folha','holerite','remuneracao','freelance'], cat: '💰 Salário' },
    { kw: ['dividendo','rendimento','juros sobre capital','provento','jscp','jcp'], cat: '💸 Dividendos' },
    { kw: ['tesouro','cdb','lci','lca','fundo','debenture','renda fixa','poupanca'], cat: '🛡️ Renda Fixa' },
    { kw: ['acao','b3','bolsa','etf','fii','btg','xp','clear','rico','nuinvest','inter invest'], cat: '📈 Ações' },
    { kw: ['bitcoin','btc','ethereum','eth','cripto','crypto','binance','mercado bitcoin','foxbit'], cat: '₿ Cripto' },
    { kw: ['jogo','game','steam','playstation','psn','xbox','nintendo','riot','epic games','blizzard'], cat: '🎮 Jogos' },
    { kw: ['roupa','vestuario','calcado','tenis','sapato','havan','riachuelo','renner','c a','zara','shein','marisa','centauro','netshoes','hering'], cat: '👗 Roupas' },
].map(r => ({ cat: r.cat, re: new RegExp('(?:^| )(?:' + r.kw.map(k => _normTxt(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')s?(?: |$)') }));

// Movimentações que não são receita/despesa (entre contas próprias, pagamento de fatura,
// linhas de saldo) → desmarcadas por padrão. Tarifas/IOF/anuidade/juros NÃO entram aqui:
// são despesas reais e antes eram escondidas como "transferência".
const EXT_TRANSFER_KW = [
    'transferencia entre contas','transf entre contas','movimentacao interna',
    'aplicacao automatica','resgate automatico','resgate aplicacao','aplicacao','aporte invest',
    'pagamento de fatura','pgto fatura','pagto cartao','pag cartao','pag fatura','pagamento fatura',
    'pagamento recebido','saldo anterior','saldo do dia','saldo final',
].map(_normTxt);
const EXT_TRANSFER_LIKELY = [
    'pix enviado','pix recebido','ted enviado','ted recebido','doc enviado','doc recebido',
    'transf','transferencia',
].map(_normTxt);

function _extDetectTransfer(desc) {
    const low = ' ' + _normTxt(desc) + ' ';
    if (EXT_TRANSFER_KW.some(kw => low.includes(' ' + kw + ' ')))     return 'transfer'; // hard skip
    if (EXT_TRANSFER_LIKELY.some(kw => low.includes(' ' + kw + ' '))) return 'maybe';    // flag but still checkable
    return null;
}

// Chave de "estabelecimento": descrição sem dígitos (datas, parcelas, códigos)
const _merchantKey = desc => _normTxt(desc).replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();

// Categoria: 1º o que VOCÊ já usou para esse estabelecimento; 2º regras por palavra
function _buildLearnedCats() {
    const map = new Map();
    [...tx].sort((a, b) => a.data.localeCompare(b.data)).forEach(t => {
        const k = _merchantKey(t.desc);
        if (k && t.cat) map.set(t.tipo + '|' + k, t.cat);   // o mais recente vence
    });
    return map;
}
function _extAutoCategory(desc, tipo, learned) {
    const hist = learned && learned.get(tipo + '|' + _merchantKey(desc));
    if (hist) return hist;
    const txt = _normTxt(desc);
    const rule = EXT_CAT_RULES.find(r => (cats[tipo] || []).includes(r.cat) && r.re.test(txt));
    return rule ? rule.cat : '';
}

// Duplicatas: por id do banco (FITID/Identificador) ou por data+valor, contando
// ocorrências — dois cafés iguais no mesmo dia no extrato, com um já lançado, marcam
// só um como duplicado (antes marcava ambos). O tipo fica fora da chave de propósito:
// reimportar uma fatura escolhendo "conta corrente" inverte os sinais, e aí nada era
// reconhecido. Na dúvida, prefere marcar (fica desmarcado para revisão) a duplicar.
function _extDupChecker() {
    const ids = new Set(tx.filter(t => t.extId).map(t => t.extId));
    const counts = new Map();
    const key = (d, v) => `${d}|${Math.round(v * 100)}`;
    tx.forEach(t => { const k = key(t.data, t.valor); counts.set(k, (counts.get(k) || 0) + 1); });
    return (date, valor, tipo, extId) => {
        if (extId && ids.has(extId)) return true;
        const k = key(date, valor), n = counts.get(k) || 0;
        if (n > 0) { counts.set(k, n - 1); return true; }
        return false;
    };
}

// ── LEITURA DO ARQUIVO ──────────────────────────────────────────
// Bancos brasileiros exportam muito em Windows-1252 (OFX com CHARSET:1252, CSV do
// Excel). Ler tudo como UTF-8 gerava "SalÃ¡rio"/"Farm�cia" e quebrava as regras.
function _readFileText(file) {
    return file.arrayBuffer().then(buf => {
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
        catch (e) { text = new TextDecoder('windows-1252').decode(buf); }
        return text.replace(/^\uFEFF/, '');
    });
}

// Meses por extenso/abreviados (pt e en) → número
const _MES_NOME = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
                    set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
// Faturas costumam trazer "15/09" ou "15 SET" sem ano: escolhe o ano que deixa a data mais
// próxima de hoje, aceitando no máximo ~2 meses no futuro (lançamentos agendados/parcelas)
function _inferirAno(dia, mes, hoje = new Date()) {
    const ref = hoje.getTime(), limite = ref + 62 * 86400000;
    let best = null;
    for (const y of [hoje.getFullYear() - 1, hoje.getFullYear(), hoje.getFullYear() + 1]) {
        const iso = `${y}-${pad2(mes)}-${pad2(dia)}`;
        if (!isValidISODate(iso)) continue;
        const t = new Date(iso + 'T00:00:00').getTime();
        if (t > limite) continue;
        if (!best || Math.abs(t - ref) < Math.abs(best.t - ref)) best = { iso, t };
    }
    return best ? best.iso : null;
}
// Datas: YYYY-MM-DD (ou com / .), DD/MM/YYYY, DD-MM-YY, DD/MM (sem ano), "15 SET 2026",
// "15 set", "Sep 15, 2026" — com ou sem hora; valida calendário. Antes, datas sem ano/mês
// por extenso eram descartadas em silêncio na importação.
function parseFlexDate(raw, hoje = new Date()) {
    if (!raw) return null;
    const s = String(raw).trim().replace(/['"]/g, '');
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:$|[T\s])/);
    let iso = m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : null;
    if (!iso && (m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})(?:$|\s)/))) {
        const y = m[3].length === 2 ? (parseInt(m[3], 10) > 50 ? '19' : '20') + m[3] : m[3];
        iso = `${y}-${pad2(m[2])}-${pad2(m[1])}`;
    }
    if (!iso && (m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:$|\s)/))) iso = _inferirAno(+m[1], +m[2], hoje);
    if (!iso && (m = fold(s).match(/^(\d{1,2})[\s\/\-.]+([a-z]{3})[a-z]*\.?(?:[\s\/\-.]+(\d{2}|\d{4}))?(?:$|\s)/)) && _MES_NOME[m[2]]) {
        const mes = _MES_NOME[m[2]];
        iso = m[3] ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad2(mes)}-${pad2(m[1])}` : _inferirAno(+m[1], mes, hoje);
    }
    // Mês antes do dia (exportações em inglês: "Sep 15, 2026", "SET 15")
    if (!iso && (m = fold(s).match(/^([a-z]{3})[a-z]*\.?[\s\/\-.]+(\d{1,2})(?:,?[\s\/\-.]+(\d{2}|\d{4}))?(?:$|\s)/)) && _MES_NOME[m[1]]) {
        const mes = _MES_NOME[m[1]];
        iso = m[3] ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad2(mes)}-${pad2(m[2])}` : _inferirAno(+m[2], mes, hoje);
    }
    return iso && isValidISODate(iso) ? iso : null;
}

// ── CSV PARSER ──────────────────────────────────────────────────
// Tokenizador de verdade: aspas com "" escapado, separador e quebra de linha dentro
// de campo entre aspas, CRLF.
function _csvRows(text, sep) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
            if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
            else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === sep) { row.push(cur.trim()); cur = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cur.trim()); cur = '';
            if (row.some(c => c !== '')) rows.push(row);
            row = [];
        } else cur += ch;
    }
    row.push(cur.trim());
    if (row.some(c => c !== '')) rows.push(row);
    return rows;
}
function _csvDetectSep(text) {
    const sample = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 10).join('\n');
    let best = ',', bestScore = -1;
    [';', ',', '\t'].forEach(sep => {
        const counts = _csvRows(sample, sep).map(r => r.length);
        if (!counts.length) return;
        const cols = counts.sort((a, b) => b - a)[Math.floor(counts.length / 2)];   // mediana
        const score = cols > 1 ? cols * 10 + counts.filter(c => c === cols).length : 0;
        if (score > bestScore) { bestScore = score; best = sep; }
    });
    return best;
}

const _CSV_ALIASES = {
    date:   ['data','date','data lancamento','data transacao','data da transacao','data do lancamento','data compra','dt'],
    desc:   ['descricao','description','titulo','title','historico','lancamento','memo','nome','estabelecimento','detalhes'],
    valor:  ['valor','amount','value','quantia','montante','valor r'],
    credit: ['credito','credit','entrada','entradas'],
    debit:  ['debito','debit','saida','saidas'],
    id:     ['identificador','id transacao','fitid','id'],
    // Só nome EXATO: "Tipo de pagamento: Crédito" (meio de pagamento) não pode virar sinal
    sinal:  ['d c','dc','c d','deb cred','debito credito','credito debito','natureza','tipo','tipo lancamento',
             'tipo de lancamento','tipo transacao','tipo de transacao','sinal'],
    cat:    ['categoria','category'],
};
function _csvFindCols(header) {
    const h = header.map(_normTxt);
    const find = (aliases, exclude = []) => h.findIndex((c, i) => !exclude.includes(i) && aliases.some(a => c === a || c.startsWith(a + ' ')));
    const findExact = (aliases, exclude = []) => h.findIndex((c, i) => !exclude.includes(i) && aliases.includes(c));
    const date = find(_CSV_ALIASES.date);
    const valor = find(_CSV_ALIASES.valor);
    const cols = { date, valor, desc: find(_CSV_ALIASES.desc, [date, valor]), id: find(_CSV_ALIASES.id, [date, valor]),
                   sinal: findExact(_CSV_ALIASES.sinal, [date, valor]), cat: findExact(_CSV_ALIASES.cat, [date, valor]) };
    if (valor < 0) { cols.credit = find(_CSV_ALIASES.credit); cols.debit = find(_CSV_ALIASES.debit); }
    return cols;
}

// Célula de valor sem nenhum dígito ("", "-", "—") = vazia → 0 (linha de saldo/informativa);
// com dígito mas ilegível → NaN, contada como ignorada na revisão
const _valorCel = c => /\d/.test(c || '') ? parseValor(c) : 0;
// Coluna de natureza (D/C, Débito/Crédito, saída/entrada — inclusive o CSV do próprio app):
// bancos como Santander/Caixa exportam o valor sempre positivo e todo débito virava ganho.
// Valor não reconhecido ("PIX", "Compra") não mexe no sinal.
const _SINAL_NEG = new Set(['d', 'db', 'deb', 'debito', 'saida', 'despesa', 'gasto', 'investimento', '-']);
const _SINAL_POS = new Set(['c', 'cr', 'cred', 'credito', 'entrada', 'receita', 'ganho', '+']);
function _sinalCel(c) {
    const v = fold(c).trim().replace(/\.$/, '');
    return _SINAL_NEG.has(v) ? -1 : _SINAL_POS.has(v) ? 1 : 0;
}

function _extParseCSV(text) {
    const rows = _csvRows(text, _csvDetectSep(text));
    if (rows.length < 2) return null;

    // Cabeçalho pode não estar na 1ª linha (Itaú/BB têm linhas de conta/período antes)
    let hIdx = -1, cols = null;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const c = _csvFindCols(rows[i]);
        if (c.date >= 0 && (c.valor >= 0 || (c.credit >= 0 && c.debit >= 0))) { hIdx = i; cols = c; break; }
    }
    if (!cols) {
        // Sem cabeçalho reconhecível: posicional (Nubank cartão: date, category, title, amount)
        const w = rows[0].length;
        if (w < 3) return null;
        cols = w >= 4 ? { date: 0, desc: 2, valor: 3, id: -1 } : { date: 0, desc: 1, valor: 2, id: -1 };
        hIdx = parseFlexDate(rows[0][0]) ? -1 : 0;
    }
    if (cols.desc < 0) cols.desc = rows[Math.max(hIdx, 0)].findIndex((_, i) => ![cols.date, cols.valor, cols.credit, cols.debit, cols.id, cols.sinal, cols.cat].includes(i));

    const results = []; let skipped = 0;
    for (const row of rows.slice(hIdx + 1)) {
        const date = parseFlexDate(row[cols.date]);
        // Sem dígito na coluna de data é rótulo ("Total", "Saldo anterior"), não data ilegível
        if (!date) { if (/\d/.test(row[cols.date] || '')) skipped++; continue; }
        let valor;
        if (cols.valor >= 0) {
            valor = _valorCel(row[cols.valor]);
            const sg = cols.sinal >= 0 ? _sinalCel(row[cols.sinal]) : 0;
            if (sg && Number.isFinite(valor)) valor = sg * Math.abs(valor);
        } else {
            const cr = _valorCel(row[cols.credit]), db = _valorCel(row[cols.debit]);
            valor = cr > 0 ? cr : (!Number.isFinite(cr) || !Number.isFinite(db) ? NaN : db !== 0 ? -Math.abs(db) : 0);
        }
        if (!Number.isFinite(valor)) { skipped++; continue; }
        if (valor === 0) continue;   // linha de saldo/informativa
        const extId = cols.id >= 0 && row[cols.id] ? 'csv:' + row[cols.id] : null;
        const r = { date, desc: _csvDesfaz((row[cols.desc] || '').replace(/\s+/g, ' ').trim()), valor, extId };
        if (cols.cat >= 0 && row[cols.cat]) r.catHint = _csvDesfaz(row[cols.cat].trim());
        results.push(r);
    }
    // Linhas com conteúdo mas data/valor ilegível são contadas e mostradas na revisão
    results.skipped = skipped;
    return results.length || skipped ? results : null;
}

// ── OFX PARSER ──────────────────────────────────────────────────
// OFX pode ser SGML (tags de valor sem fechamento) — parse por regex, bloco a bloco
function _extParseOFX(text) {
    const transactions = []; let skipped = 0;
    text.split(/<STMTTRN>/i).slice(1).forEach(chunk => {
        const end = chunk.search(/<\/STMTTRN>/i);
        const block = end >= 0 ? chunk.slice(0, end) : chunk;
        const getField = name => {
            const m2 = block.match(new RegExp('<' + name + '>([^<\\r\\n]+)', 'i'));
            return m2 ? m2[1].trim() : null;
        };
        const rawDate = getField('DTPOSTED');
        const date    = rawDate ? parseFlexDate(`${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`) : null;
        const valor   = parseValor(getField('TRNAMT'));
        if (!date || !Number.isFinite(valor)) { skipped++; return; }
        if (valor === 0) return;
        const fitid = getField('FITID');
        const desc  = (getField('MEMO') || getField('NAME') || getField('PAYEE') || '').replace(/\s+/g, ' ').trim();
        transactions.push({ date, desc, valor, extId: fitid ? 'ofx:' + fitid : null });
    });
    transactions.skipped = skipped;
    return transactions.length || skipped ? transactions : null;
}

// ── MAIN IMPORT LOGIC ───────────────────────────────────────────
function abrirExtrato() {
    $('extStep1').style.display = '';
    $('extStep2').style.display = 'none';
    $('extBackBtn').style.display = 'none';
    $('extImportBtn').style.display = 'none';
    $('extFileInput').value = '';
    $('extAccType').value = 'debito';
    // Populate card selector
    const sel = $('extCardId');
    sel.innerHTML = '<option value="">— Nenhum —</option>';
    cards.forEach(c => sel.add(new Option(c.nome, c.id)));
    extOnAccTypeChange();
    _extParsed = [];
    $('ovExtrato').classList.add('open');
}

function extOnAccTypeChange() {
    const isCredit = $('extAccType').value === 'credito';
    $('extCardField').style.display = isCredit ? '' : 'none';
}

function closeExtrato() {
    $('ovExtrato').classList.remove('open');
    _extParsed = [];
}

// Drag and drop
(function() {
    const drop = $('extDrop');
    if (!drop) return;
    ['dragenter','dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('dragover'); }));
    ['dragleave','drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('dragover'); }));
    drop.addEventListener('drop', ev => {
        if (ev.dataTransfer.files.length) extHandleFile(ev.dataTransfer.files[0]);
    });
})();

async function extHandleFile(file) {
    if (!file) return;
    let raw = null;
    try {
        const text = await _readFileText(file);
        const isOFX = /\.(ofx|qfx)$/i.test(file.name) || /<OFX>/i.test(text.slice(0, 2000));
        raw = isOFX ? _extParseOFX(text) : _extParseCSV(text);
    } catch (e) {
        console.error('Falha ao ler extrato', e);
    }
    if (!raw || !raw.length) {
        toast(raw && raw.skipped
            ? `⚠️ Nenhuma transação lida: ${raw.skipped} linha${raw.skipped > 1 ? 's' : ''} com data ou valor em formato não reconhecido.`
            : '⚠️ Não foi possível ler o extrato. Verifique o formato.', '#b45309');
        $('extFileInput').value = '';
        return;
    }
    _extSkipped = raw.skipped || 0;

    // Fatura de cartão: normaliza sinais. CSV da Nubank traz compras com valor
    // POSITIVO (viravam "Ganho"); OFX traz compras negativas. O sinal majoritário
    // numa fatura é compra → vira saída; o minoritário (estorno/pagamento) → entrada.
    if ($('extAccType').value === 'credito') {
        const positivos = raw.filter(r => r.valor > 0).length;
        const buySign = positivos >= raw.length - positivos ? 1 : -1;
        raw.forEach(r => { r.valor = (r.valor * buySign > 0) ? -Math.abs(r.valor) : Math.abs(r.valor); });
    }

    const learned = _buildLearnedCats();
    const isDup = _extDupChecker();
    _extParsed = raw.map((r, i) => {
        const tipo  = r.valor > 0 ? 'entrada' : 'saida';
        const valor = roundMoney(Math.abs(r.valor));
        const transferFlag = _extDetectTransfer(r.desc);
        const dup = isDup(r.date, valor, tipo, r.extId);

        // Default: check new non-transfers, uncheck transfers & duplicates
        let checked = true, flag = 'new';
        if (transferFlag === 'transfer')   { checked = false; flag = 'transfer'; }
        else if (transferFlag === 'maybe') { checked = false; flag = 'maybe_transfer'; }
        if (dup) { checked = false; flag = 'dup'; }

        return { idx: i, checked, date: r.date, desc: r.desc || '(sem descrição)', valor, tipo,
                 cat: _extCatDoArquivo(r.catHint, tipo) || _extAutoCategory(r.desc, tipo, learned), flag, extId: r.extId || null };
    });

    _extRenderPreview();
}

// Categoria vinda do arquivo (CSV do próprio app, coluna "category" do Nubank) só vale se
// já existir para o tipo — pelo nome exato ou pelo rótulo sem ícone/acento/pontuação
function _extCatDoArquivo(hint, tipo) {
    if (!hint) return '';
    const list = cats[tipo] || [], h = _normTxt(splitCatName(hint).label);
    return list.find(c => c === hint) || (h && list.find(c => _normTxt(splitCatName(c).label) === h)) || '';
}

function _extCatOptions(tipo, selected) {
    const list = cats[tipo] || [];
    let opts = `<option value="" ${!selected ? 'selected' : ''}>— sem categoria —</option>`
        + list.map(c => `<option value="${escHtml(c)}" ${selected === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('');
    if (selected && !list.includes(selected)) opts += `<option value="${escHtml(selected)}" selected>${escHtml(selected)}</option>`;
    return opts;
}

function _extRenderPreview() {
    $('extStep1').style.display = 'none';
    $('extStep2').style.display = '';
    $('extBackBtn').style.display = '';
    $('extImportBtn').style.display = '';

    // Stats
    const total    = _extParsed.length;
    const newCount = _extParsed.filter(r => r.flag === 'new').length;
    const dupCount = _extParsed.filter(r => r.flag === 'dup').length;
    const trCount  = _extParsed.filter(r => r.flag === 'transfer' || r.flag === 'maybe_transfer').length;

    $('extStats').innerHTML = `
        <div class="ext-stat green"><strong>${total}</strong> transações encontradas</div>
        <div class="ext-stat"><strong>${newCount}</strong> novas</div>
        ${dupCount ? `<div class="ext-stat amber"><strong>${dupCount}</strong> possíveis duplicatas</div>` : ''}
        ${trCount ? `<div class="ext-stat gray"><strong>${trCount}</strong> transferências</div>` : ''}
        ${_extSkipped ? `<div class="ext-stat amber" title="Linhas com data ou valor que não foi possível ler — confira no arquivo"><strong>${_extSkipped}</strong> linha${_extSkipped > 1 ? 's' : ''} ignorada${_extSkipped > 1 ? 's' : ''} (data/valor ilegível)</div>` : ''}
    `;

    $('extTbody').innerHTML = _extParsed.map((r, i) => {
        const [y, m, d] = r.date.split('-');
        const cor = r.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)';
        const tipoOpts = [['saida', 'Gasto'], ['entrada', 'Ganho'], ['investimento', 'Invest.']]
            .map(([v, l]) => `<option value="${v}" ${r.tipo === v ? 'selected' : ''}>${l}</option>`).join('');
        const flagBadge = {
            transfer:       '<span class="ext-badge transf">TRANSF</span>',
            maybe_transfer: '<span class="ext-badge transf">PIX/TED</span>',
            dup:            '<span class="ext-badge dup">DUPLICATA?</span>',
        }[r.flag] || '<span class="ext-badge new">NOVO</span>';

        return `<tr class="${_extRowClass(r)}" id="extRow-${i}">
            <td><input type="checkbox" ${r.checked ? 'checked' : ''} data-onchange="_extToggle(${i},this.checked)"></td>
            <td style="white-space:nowrap;font-size:11px;color:var(--text-3)">${d}/${m}/${y}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.desc)}">${escHtml(r.desc)}</td>
            <td id="extVal-${i}" style="text-align:right;font-weight:600;color:${cor};white-space:nowrap">${r.tipo === 'entrada' ? '+' : '−'} ${fmt(r.valor)}</td>
            <td><select data-onchange="_extChangeType(${i},this.value)">${tipoOpts}</select></td>
            <td><select data-onchange="_extChangeCat(${i},this.value)" id="extCat-${i}">${_extCatOptions(r.tipo, r.cat)}</select></td>
            <td>${flagBadge}</td>
        </tr>`;
    }).join('');

    _extUpdateSelectedCount();
}

const _extRowClass = r => !r.checked ? 'ext-skip' : (r.flag === 'dup' ? 'ext-dup' : '');

function _extToggle(idx, checked) {
    _extParsed[idx].checked = checked;
    const row = $('extRow-' + idx);
    if (row) row.className = _extRowClass(_extParsed[idx]);
    _extUpdateSelectedCount();
}

function _extChangeType(idx, tipo) {
    const r = _extParsed[idx];
    r.tipo = tipo;
    // Recalcula a sugestão para o novo tipo (a categoria anterior pode não existir nele)
    if (!(cats[tipo] || []).includes(r.cat)) r.cat = _extAutoCategory(r.desc, tipo, _buildLearnedCats());
    const sel = $('extCat-' + idx);
    if (sel) sel.innerHTML = _extCatOptions(tipo, r.cat);
    const val = $('extVal-' + idx);
    if (val) {
        val.style.color = tipo === 'entrada' ? 'var(--success)' : 'var(--danger)';
        val.textContent = `${tipo === 'entrada' ? '+' : '−'} ${fmt(r.valor)}`;
    }
}

function _extChangeCat(idx, cat) {
    _extParsed[idx].cat = cat;
}

function _extUpdateSelectedCount() {
    const count = _extParsed.filter(r => r.checked).length;
    $('extSelectedCount').textContent = `${count} selecionado${count !== 1 ? 's' : ''}`;
    $('extImportBtn').disabled = count === 0;
    $('extImportBtn').textContent = `Importar ${count} Lançamento${count !== 1 ? 's' : ''}`;
}

function _extSetChecked(fn) {
    _extParsed.forEach((r, i) => {
        r.checked = fn(r);
        const cb = document.querySelector(`#extRow-${i} input[type="checkbox"]`);
        if (cb) cb.checked = r.checked;
        const row = $('extRow-' + i);
        if (row) row.className = _extRowClass(r);
    });
    _extUpdateSelectedCount();
}
function extSelectAll(val) { _extSetChecked(() => val); $('extCheckAll').checked = val; }
function extSelectNew()    { _extSetChecked(r => r.flag === 'new'); $('extCheckAll').checked = false; }
function extToggleAll(checked) { extSelectAll(checked); }

function extGoBack() {
    $('extStep1').style.display = '';
    $('extStep2').style.display = 'none';
    $('extBackBtn').style.display = 'none';
    $('extImportBtn').style.display = 'none';
    $('extFileInput').value = '';   // permite escolher o mesmo arquivo de novo
    _extParsed = [];
}

function extConfirmImport() {
    const toImport = _extParsed.filter(r => r.checked);
    if (!toImport.length) return;

    const isCredit = $('extAccType').value === 'credito';
    const cardId   = isCredit ? toId($('extCardId').value) : null;

    pushUndo(`Importação de extrato (${toImport.length} lançamentos)`);
    let catsChanged = false;
    const novos = toImport.map(r => {
        catsChanged = ensureCat(r.tipo, r.cat) || catsChanged;
        const t = makeTx({
            desc: r.desc, valor: r.valor, data: r.date, tipo: r.tipo, cat: r.cat, fixo: false,
            // No cartão, estornos (entradas) também ficam no crédito para abater da fatura
            pagamento: isCredit && r.tipo !== 'investimento' ? 'credito' : (r.tipo === 'saida' ? 'debito' : null),
            cartaoId: cardId,
        });
        if (r.extId) t.extId = r.extId;
        return t;
    });
    tx = tx.concat(novos);
    if (catsChanged) saveCats();
    commit();
    closeExtrato();
    toast(`✅ ${toImport.length} lançamento${toImport.length > 1 ? 's' : ''} importado${toImport.length > 1 ? 's' : ''}!`, '#16a34a');
}

// ── EMPRÉSTIMOS ───────────────────────────────────────────────────────────────
// Um empréstimo é o contrato (valor, taxa, parcelas, 1ª data); as parcelas são lançamentos de saída
// gerados automaticamente ("Nome - Parcela k/N", categoria Empréstimos), ligados por loan.serie e
// com a parte de JUROS de cada uma embutida (t.juros — alimenta "juros e tarifas" no Mensal).
// O painel calcula tudo pelo cronograma do contrato: parcela com data até hoje conta como paga.
const LOAN_CAT = '💸 Empréstimos';

// Parcela pela tabela Price: P·i / (1 − (1+i)^−n); sem taxa, valor ÷ n
function loanPmt(valor, taxaPct, n) {
    const i = taxaPct / 100;
    if (!(valor > 0) || !(n >= 1)) return 0;
    return roundMoney(i > 0 ? valor * i / (1 - Math.pow(1 + i, -n)) : valor / n);
}
// Parcelas do contrato, cada uma com os juros que carrega: saldo × taxa quando há taxa; sem ela,
// o total de juros (parcelas − valor emprestado) é rateado igualmente
function loanCronograma(l) {
    const n = l.n, p = l.parcela, i = l.taxa / 100, jurosTotal = Math.max(0, roundMoney(p * n - l.valor));
    const rateio = i > 0 ? null : parcelasDividir(jurosTotal, n);
    let saldo = l.valor;
    const cron = Array.from({ length: n }, (_, idx) => {
        let j;
        if (i > 0) { j = roundMoney(saldo * i); saldo = roundMoney(saldo - (p - j)); } else j = rateio[idx];
        return { k: idx + 1, data: l.primeira ? addMonthsISO(l.primeira, idx) : '', valor: p, juros: roundMoney(Math.min(Math.max(j, 0), p)) };
    });
    // Arredondamentos: a última parcela fecha a conta, para a soma dos juros ser exatamente parcelas − valor
    const resto = roundMoney(jurosTotal - cron.reduce((s, x) => s + x.juros, 0)), ult = cron[n - 1];
    ult.juros = roundMoney(Math.min(Math.max(ult.juros + resto, 0), p));
    return cron;
}
function loanResumo(l, hoje = todayLocalISO()) {
    const cron = loanCronograma(l), venceu = x => !!x.data && x.data <= hoje;
    const pagas = cron.filter(venceu), faltam = cron.filter(x => !venceu(x));
    const soma = (arr, f = x => x.valor) => roundMoney(arr.reduce((s, x) => s + f(x), 0));
    return { cron, pagas: pagas.length, faltam: faltam.length, total: soma(cron), pago: soma(pagas), falta: soma(faltam),
             jurosTotal: soma(cron, x => x.juros), jurosPagos: soma(pagas, x => x.juros), jurosFalta: soma(faltam, x => x.juros),
             proxima: faltam[0] || null, fim: cron.length ? cron[cron.length - 1].data : '' };
}
// Lançamentos (já normalizados, ainda não gravados) do empréstimo. modo 'juros' (padrão, regra do dono:
// o valor recebido não é receita e o principal pago não é gasto) lança só os juros de cada parcela
// ("Nome - Juros - Parcela k/N"); 'parcela' lança a parcela inteira, com os juros embutidos
function loanTx(l, modo = 'juros') {
    const soJuros = modo === 'juros', rot = soJuros ? ' - Juros' : '';
    return loanCronograma(l).filter(p => !soJuros || p.juros > 0).map(p => {
        const suf = _sufixoParcela(p.k, l.n);
        const t = makeTx({ desc: l.nome.slice(0, DESC_MAX - suf.length - rot.length) + rot + suf, valor: soJuros ? p.juros : p.valor, data: p.data, tipo: 'saida',
                           cat: LOAN_CAT, fixo: false, pagamento: 'debito', cartaoId: null, juros: soJuros ? 0 : p.juros });
        t.parcela = { serie: l.serie, k: p.k, n: l.n };
        return t;
    });
}
const _mesAno = iso => iso ? `${MES_ABREV[+iso.slice(5, 7) - 1]}/${iso.slice(0, 4)}` : '—';
const _dataBR = iso => iso ? iso.split('-').reverse().join('/') : '—';

function renderLoans() {
    const grid = $('loansGrid'), res = $('loansResumo');
    if (!grid || !res) return;
    const hoje = todayLocalISO(), ym = ymKey(_budgetMonth, _budgetYear);
    const infos = loans.map(l => ({ l, r: loanResumo(l, hoje) }));
    const novo = `<div class="goal-add-card" data-onclick="abrirNovoLoan()">
        <span style="font-size:32px;opacity:.25">＋</span>
        <span style="font-size:13px;font-weight:500">${infos.length ? 'Novo empréstimo' : 'Cadastrar empréstimo'}</span>
        ${infos.length ? '' : '<span style="font-size:11px;text-align:center;padding:0 18px;opacity:.85">As parcelas entram sozinhas nos lançamentos, com os juros de cada uma</span>'}</div>`;
    if (!infos.length) { res.innerHTML = ''; grid.innerHTML = novo; return; }

    // O todo: tudo que falta, o que vence no mês aberto, o já pago e os juros
    const soma = f => roundMoney(infos.reduce((s, x) => s + f(x), 0));
    const doMes = infos.flatMap(({ l, r }) => r.cron.filter(p => p.data.slice(0, 7) === ym).map(p => ({ l, p })));
    const fimGeral = infos.map(x => x.r.fim).filter(Boolean).sort().pop() || '';
    const faltamN = infos.reduce((s, x) => s + x.r.faltam, 0);
    res.innerHTML = `
        <div class="loan-tile"><small>Falta pagar</small><b>${fmt(soma(x => x.r.falta))}</b><span>${faltamN ? `${faltamN} parcela${faltamN !== 1 ? 's' : ''}${fimGeral ? ` · quita tudo em ${_mesAno(fimGeral)}` : ''}` : '✓ tudo quitado'}</span></div>
        <div class="loan-tile"><small>Parcelas de ${MESES[_budgetMonth]}</small><b>${fmt(roundMoney(doMes.reduce((s, x) => s + x.p.valor, 0)))}</b><span>${doMes.length ? `${doMes.length} parcela${doMes.length !== 1 ? 's' : ''}` : 'nenhuma neste mês'}</span></div>
        <div class="loan-tile"><small>Já pago</small><b>${fmt(soma(x => x.r.pago))}</b><span>de ${fmt(soma(x => x.r.total))} no total</span></div>
        <div class="loan-tile"><small>Juros no total</small><b>${fmt(soma(x => x.r.jurosTotal))}</b><span>${fmt(soma(x => x.r.jurosFalta))} ainda por pagar</span></div>`;
    grid.innerHTML = infos.map(({ l, r }) => {
        const pct = l.n ? Math.min(100, Math.floor(r.pagas / l.n * 100)) : 0, quitado = r.faltam === 0;
        return `<div class="goal-card">
            <div class="goal-accent" style="background:var(--invest)"></div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:10px">
                <div class="goal-name" style="margin-top:0">🏦 ${escHtml(l.nome)}</div>
                <div class="goal-actions">
                    <button class="icon-btn" data-onclick="abrirEditLoan(${l.id})" title="Editar nome e nota">✏️</button>
                    <button class="icon-btn" data-onclick="removerLoan(${l.id})" title="Remover">🗑️</button>
                </div>
            </div>
            <div class="goal-desc">${l.nota ? escHtml(l.nota) : '&nbsp;'}</div>
            <div class="goal-amounts"><div class="goal-atual" style="color:var(--invest)">${quitado ? '✓ Quitado' : fmt(r.falta)}</div><div class="goal-target">${quitado ? fmt(r.total) : 'falta pagar'}</div></div>
            <div class="goal-track"><div class="goal-fill" style="width:${pct}%;background:var(--invest)"></div></div>
            <div class="goal-meta-row"><span class="goal-pct" style="color:var(--invest)">${r.pagas} de ${l.n} parcelas pagas</span><span>${pct}%</span></div>
            <div class="loan-facts">
                <div><small>Parcela</small><b>${fmt(l.parcela)}</b></div>
                <div><small>Emprestado</small><b>${fmt(l.valor)}</b></div>
                <div><small>Juros no total</small><b>${fmt(r.jurosTotal)}${l.taxa ? ` · ${escHtml(fmtPct(l.taxa))} a.m.` : ''}</b></div>
                <div><small>Total a pagar</small><b>${fmt(r.total)}</b></div>
                <div><small>${quitado ? 'Quitado em' : 'Próxima parcela'}</small><b>${quitado ? _mesAno(r.fim) : _dataBR(r.proxima && r.proxima.data)}</b></div>
                <div><small>Termina em</small><b>${_mesAno(r.fim)}</b></div>
            </div>
        </div>`;
    }).join('') + novo;
}

function _loanCampos(on) {   // na edição só nome e nota mudam (o contrato gerou lançamentos)
    ['loanValor', 'loanTaxa', 'loanN', 'loanParcela', 'loanPrimeira'].forEach(id => { $(id).disabled = !on; });
    $('loanGerarRow').style.display = on ? '' : 'none';
}
function abrirNovoLoan() {
    $('loanModalTitle').textContent = 'Novo empréstimo';
    $('loanEditId').value = '';
    ['loanNome', 'loanValor', 'loanTaxa', 'loanN', 'loanParcela', 'loanNota'].forEach(id => { $(id).value = ''; });
    $('loanPrimeira').value = addMonthsISO(todayLocalISO(), 1);
    $('loanLancar').value = 'juros';
    _loanCampos(true); loanPreview();
    $('ovLoan').classList.add('open');
}
function abrirEditLoan(id) {
    const l = loans.find(x => x.id === id); if (!l) return;
    $('loanModalTitle').textContent = 'Editar empréstimo';
    $('loanEditId').value = String(l.id);
    $('loanNome').value = l.nome; $('loanNota').value = l.nota;
    $('loanValor').value = fmtValorInput(l.valor); $('loanTaxa').value = l.taxa ? String(l.taxa).replace('.', ',') : '';
    $('loanN').value = String(l.n); $('loanParcela').value = fmtValorInput(l.parcela); $('loanPrimeira').value = l.primeira;
    _loanCampos(false); loanPreview();
    $('ovLoan').classList.add('open');
}
function closeLoan(e) { closeOverlay('ovLoan', e); }
// Prévia do contrato: parcela (a estimada pela tabela Price quando o campo está vazio), total e juros
function loanPreview() {
    const el = $('loanPreview'), v = numInput($('loanValor')), taxa = numInput($('loanTaxa')) || 0, n = Math.round(+$('loanN').value) || 0;
    const pTxt = $('loanParcela').value.trim(), p = pTxt ? numInput($('loanParcela')) : loanPmt(v, taxa, n);
    if (!(v > 0) || !(n >= 2) || !(p > 0)) { el.style.display = 'none'; return; }
    const total = roundMoney(p * n), juros = Math.max(0, roundMoney(total - v));
    el.innerHTML = `Parcela <b>${escHtml(fmt(p))}</b>${pTxt ? '' : ' (estimada pela tabela Price)'} · total <b>${escHtml(fmt(total))}</b> · juros <b>${escHtml(fmt(juros))}</b> (${escHtml(fmtPct(juros / v * 100))} do valor)`;
    el.style.display = '';
}
function salvarLoan() {
    const nome = $('loanNome').value.trim(), nota = $('loanNota').value.trim(), editId = $('loanEditId').value;
    if (!nome) return toast('⚠️ Digite um nome.', '#b45309');
    if (editId) {   // só nome e nota
        const l = loans.find(x => x.id === toId(editId));
        if (!l) return toast('⚠️ Empréstimo não encontrado.', '#b45309');
        pushUndo(`Edição do empréstimo "${nome}"`);
        loans = loans.map(x => x.id === l.id ? { ...x, nome: nome.slice(0, DESC_MAX), nota: nota.slice(0, CONFIG.NOTA_MAX) } : x);
        // parcelas já lançadas acompanham o novo nome
        tx = tx.map(t => {
            if (!t.parcela || t.parcela.serie !== l.serie) return t;
            const suf = _sufixoParcela(t.parcela.k, t.parcela.n), rot = / - Juros - Parcela \d+\/\d+$/i.test(t.desc) ? ' - Juros' : '';
            return { ...t, desc: nome.slice(0, DESC_MAX - suf.length - rot.length) + rot + suf };
        });
        commitAll(); closeLoan(); toast('✓ Empréstimo atualizado!');
        return;
    }
    const valor = numInput($('loanValor')), taxa = numInput($('loanTaxa')) || 0, n = Math.round(+$('loanN').value) || 0, primeira = $('loanPrimeira').value;
    const pTxt = $('loanParcela').value.trim(), parcela = pTxt ? numInput($('loanParcela')) : loanPmt(valor, taxa, n);
    if (!(valor > 0) || !_valorOk(valor)) return toast('⚠️ Valor emprestado inválido.', '#b45309');
    if (!Number.isFinite(taxa) || taxa < 0 || taxa > 100) return toast('⚠️ Taxa inválida (0 a 100% ao mês).', '#b45309');
    if (!(n >= 2 && n <= LOAN_N_MAX)) return toast(`⚠️ Informe de 2 a ${LOAN_N_MAX} parcelas.`, '#b45309');
    if (!(parcela > 0) || !_valorOk(parcela)) return toast('⚠️ Valor da parcela inválido.', '#b45309');
    if (!isValidISODate(primeira)) return toast('⚠️ Informe a data da 1ª parcela.', '#b45309');
    const id = newId(), l = { id, nome: nome.slice(0, DESC_MAX), valor: roundMoney(valor), taxa: +taxa.toFixed(4), n, parcela: roundMoney(parcela), primeira, serie: 'E' + id, nota: nota.slice(0, CONFIG.NOTA_MAX) };
    const modo = $('loanLancar').value, gerar = modo === 'juros' || modo === 'parcela';
    pushUndo(`Novo empréstimo "${nome}"`);
    loans = loans.concat(l);
    let lancados = [];
    if (gerar) { ensureCat('saida', LOAN_CAT); saveCats(); lancados = loanTx(l, modo); tx = tx.concat(lancados); }
    commitAll(); closeLoan();
    toast(!gerar ? '🏦 Empréstimo criado (nada lançado nos lançamentos).'
        : `🏦 Empréstimo criado: ${lancados.length} lançamento${lancados.length !== 1 ? 's' : ''} ${modo === 'juros' ? 'de juros' : `de ${fmt(l.parcela)}`}.`);
}
function removerLoan(id) {
    const l = loans.find(x => x.id === id); if (!l) return;
    const hoje = todayLocalISO(), futuras = tx.filter(t => t.parcela && t.parcela.serie === l.serie && t.data > hoje);
    const efetivar = (tirar) => {
        if (!loans.some(x => x.id === id)) return;
        pushUndo(`Remoção do empréstimo "${l.nome}"`);
        loans = loans.filter(x => x.id !== id);
        if (tirar.size) tx = tx.filter(t => !tirar.has(t.id));
        commitAll();
        toast('Empréstimo removido.', '#52525b');
    };
    // Parcelas já vencidas ficam no histórico; as que ainda vão vencer podem sair junto
    if (!futuras.length) { confirmar(`Remover o empréstimo "${l.nome}"?`, { ok: 'Remover', perigo: true }, () => efetivar(new Set())); return; }
    const n = futuras.length;
    perguntar(`Remover o empréstimo "${l.nome}"?\n\nHá ${n} parcela${n !== 1 ? 's' : ''} que ainda vão vencer nos lançamentos. As já vencidas ficam no histórico.`,
        [{ label: 'Remover e tirar as futuras', valor: 'tirar', perigo: true }, { label: 'Remover, manter lançamentos', valor: 'manter', perigo: true }],
        v => { if (v) efetivar(v === 'tirar' ? new Set(futuras.map(t => t.id)) : new Set()); });
}

// Caixa "Parcelas do mês" (Orçamento): o que vence no mês, quantas faltam e o quanto
function renderBudgetParcelas(m, a) {
    const box = $('parcBox'); if (!box) return;
    const doMes = txMes(m, a).filter(t => t.parcela);
    box.style.display = doMes.length ? '' : 'none';
    if (!doMes.length) return;
    $('parcTotal').textContent = fmt(roundMoney(doMes.reduce((s, t) => s + t.valor, 0)));
    $('parcList').innerHTML = [...doMes].sort((x, y) => y.valor - x.valor).map(t => {
        const serie = parcelasDaSerie(t.parcela.serie), depois = serie.filter(x => x.parcela.k > t.parcela.k), fim = serie[serie.length - 1];
        const resta = depois.length ? `restam ${depois.length} · ${fmt(roundMoney(depois.reduce((s, x) => s + x.valor, 0)))} · termina ${_mesAno(fim.data)}` : 'última parcela';
        return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid var(--border-light);font-size:12px">
            <span style="min-width:0"><span style="font-weight:600;overflow-wrap:anywhere">${escHtml(_descSemParcela(t.desc) || t.desc)}</span><span class="tag-parc">${t.parcela.k}/${t.parcela.n}</span>${t.juros ? `<span class="tag-juros">juros ${escHtml(fmt(t.juros))}</span>` : ''}
                <br><span style="color:var(--text-3);font-size:11px">${escHtml(resta)}</span></span>
            <span style="font-weight:700;color:var(--danger);white-space:nowrap">${fmt(t.valor)}</span></div>`;
    }).join('');
}

// ── PATRIMÔNIO (net-worth trend) + PROJEÇÃO (phase 4) ─────────────────────────
function renderPatrimonio() {
    const card = $('patrimonioCard');
    if (!card) return;
    // Fica na Visão Anual: o ano escolhido, até dezembro (ou até o mês de hoje, no ano em curso).
    // Ano futuro não tem o que mostrar — fixos agendados não são patrimônio.
    const a = filtro().a, realYm = todayLocalISO().slice(0, 7);
    const curYm = `${a}-12` < realYm ? `${a}-12` : realYm;

    // Monthly net delta (income − expenses; investments are transfers → net-worth neutral)
    const monthly = {};
    tx.forEach(t => {
        if (!t.data) return;
        const ym = t.data.slice(0, 7);
        const d = t.tipo === 'entrada' ? t.valor : t.tipo === 'saida' ? -t.valor : 0;
        monthly[ym] = (monthly[ym] || 0) + d;
    });
    const mlabel   = ym => { const [yy, mm] = ym.split('-'); return MESES[+mm - 1].slice(0, 3) + '/' + yy.slice(2); };
    const addMonth = (ym, n) => addMonthsISO(ym + '-01', n).slice(0, 7);

    // Série CONTÍNUA do 1º mês com dados até o mês filtrado. Meses sem lançamentos
    // entram com variação 0 — antes eram omitidos: o eixo pulava de Fev para Out e a
    // projeção fazia média só dos meses com dados (1 mês antigo virava "ritmo" eterno).
    const firstYm = Object.keys(monthly).sort()[0];
    if (!firstYm || firstYm > curYm || curYm < `${a}-01`) { card.style.display = 'none'; destroyChart('grafPatrimonio'); return; }
    card.style.display = '';
    const yms = [];
    for (let ym = firstYm; ym <= curYm; ym = addMonth(ym, 1)) yms.push(ym);

    let run = 0;
    const pts = yms.map(ym => { run = roundMoney(run + (monthly[ym] || 0)); return { ym, v: run }; });
    const windowPts = pts.filter(p => p.ym.startsWith(a + '-'));   // acumulado desde o início, só os meses do ano

    const latest = windowPts[windowPts.length - 1].v;
    const prev   = pts.length > 1 ? pts[pts.length - 2].v : 0;   // mês anterior (pode ser do ano passado)
    $('patrimonioVal').textContent = fmt(latest);

    const diff = roundMoney(latest - prev);
    const deltaEl = $('patrimonioDelta');
    if (pts.length > 1 && prev !== 0) {
        const pctD = Math.round(diff / Math.abs(prev) * 100);
        deltaEl.textContent = (diff >= 0 ? '▲ +' : '▼ ') + fmt(Math.abs(diff)) + ` (${pctD >= 0 ? '+' : ''}${pctD}%)`;
    } else {
        deltaEl.textContent = (diff >= 0 ? '▲ +' : '▼ ') + fmt(Math.abs(diff));
    }
    deltaEl.className = 'patrimonio-delta ' + (diff >= 0 ? 'up' : 'down');

    // Projeção: média dos últimos (até 6) meses COMPLETOS. O mês em andamento fica de fora
    // (só parte dele aconteceu — ex.: salário já entrou, gastos não) e exige-se histórico
    // mínimo; antes 1 mês incompleto virava "ritmo" e projetava R$ 17 mil em 3 meses.
    const MIN_MESES_PROJECAO = 2;
    const mesAtualReal = todayLocalISO().slice(0, 7);
    const completos = yms.filter(ym => ym < mesAtualReal).slice(-6);
    const temProjecao = completos.length >= MIN_MESES_PROJECAO && curYm >= mesAtualReal;   // ano passado não projeta
    const avg = temProjecao ? roundMoney(completos.reduce((s, ym) => s + (monthly[ym] || 0), 0) / completos.length) : 0;
    const projLabels = temProjecao ? [addMonth(curYm, 1), addMonth(curYm, 2), addMonth(curYm, 3)] : [];
    const proj = projLabels.map((_, i) => latest + (i + 1) * avg);
    $('patrimonioSub').textContent = temProjecao
        ? `Projeção: ${fmt(proj[2])} em ${mlabel(projLabels[2])} · ritmo ${avg >= 0 ? '+' : ''}${fmt(avg)}/mês (média de ${completos.length} meses)`
        : curYm < mesAtualReal ? `acumulado desde o início dos registros, até ${mlabel(curYm)}`
        : `acumulado desde o início dos registros · projeção após ${MIN_MESES_PROJECAO} meses completos de histórico`;

    const labels   = windowPts.map(p => mlabel(p.ym)).concat(projLabels.map(mlabel));
    const actual   = windowPts.map(p => p.v).concat(proj.map(() => null));
    const projData = windowPts.map(() => null);
    if (temProjecao) { projData[projData.length - 1] = latest; projData.push(...proj); }

    upsertChart('grafPatrimonio', $('grafPatrimonio'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                // 1 mês só = 1 ponto: sem raio o valor real ficava invisível
                // Verde acima de zero (poupou), vermelho abaixo (gastou mais do que entrou)
                { data: actual, borderColor: '#16a34a', borderWidth: 3, pointRadius: windowPts.length === 1 ? 4 : 0, tension: .35,
                  pointBackgroundColor: c => (c.parsed && c.parsed.y < 0 ? '#dc2626' : '#16a34a'),
                  segment: { borderColor: c => (c.p1.parsed.y < 0 ? '#dc2626' : '#16a34a') },
                  fill: { target: 'origin', above: 'rgba(22,163,74,.10)', below: 'rgba(220,38,38,.10)' } },
                { data: projData, borderColor: '#94a3b8', borderDash: [5, 5], borderWidth: 2, pointRadius: 0, tension: .35, fill: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.y) } } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 9, family: 'Inter' }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
                y: { ticks: { font: { size: 9 }, callback: fmtEixo } }
            }
        }
    });
}

// ── DISTRIBUIÇÃO DOS GASTOS (Visor-style donut + category list · phase 3) ──────
function renderDistribution(dados) {
    const wrap = $('wrapGastos');
    if (!wrap) return;
    const entries = Object.keys(dados).map(k => [k, dados[k]]).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
        destroyChart('grafGas');
        wrap.innerHTML = `<div class="chart-empty"><span style="font-size:24px;opacity:.3">📉</span>Sem dados</div>`;
        return;
    }
    const total  = entries.reduce((s, e) => s + e[1], 0);
    const cores = coresCategorias(entries.map(e => e[0])), colorOf = i => cores[i];
    const pcts = pctPartes(entries.map(e => e[1]));
    const rows = entries.map(([name, val], i) => {
        const pct = pcts[i];
        return `<div class="dist-row">
            <span class="dist-dot" style="background:${colorOf(i)}"></span>
            <span class="dist-name">${escHtml(name)}</span>
            <span class="dist-val">${fmt(val)}</span>
            <span class="dist-pct">${pct}%</span>
        </div>`;
    }).join('');
    // Estrutura criada uma vez; depois só lista e total são trocados (canvas preservado)
    if (!wrap.querySelector('canvas#grafGas')) {
        wrap.innerHTML = `<div class="dist-wrap">
            <div class="dist-donut">
                <canvas id="grafGas"></canvas>
                <div class="dist-center">
                    <div class="dist-center-lbl">Total</div>
                    <div class="dist-center-val"></div>
                </div>
            </div>
            <div class="dist-list"></div>
        </div>`;
    }
    wrap.querySelector('.dist-center-val').textContent = fmt(total);
    wrap.querySelector('.dist-list').innerHTML = rows;
    upsertChart('grafGas', $('grafGas'), {
        type: 'doughnut',
        data: { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => e[1]), backgroundColor: entries.map((_, i) => colorOf(i)), borderWidth: 2, borderColor: _cssVar('--surface', '#fff') }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }
    });
}

// ── SAFE-TO-SPEND HERO + SPENDING PACE (phase 2) ──────────────────────────────
function renderHero() {
    const card = $('heroCard');
    if (!card) return;
    const { m, a } = filtro();
    const lista = txMes(m, a);
    const daysInMonth = new Date(a, m + 1, 0).getDate();
    const perDay = Array(daysInMonth + 1).fill(0); // index 1..daysInMonth
    let ent = 0, gas = 0, inv = 0;
    lista.forEach(t => {
        if (t.tipo === 'entrada') { ent += t.valor; return; }
        if (t.tipo === 'investimento') { inv += t.valor; return; }
        if (t.tipo !== 'saida') return;
        gas += t.valor;
        const d = parseInt((t.data || '').slice(8, 10), 10);
        if (d >= 1 && d <= daysInMonth) perDay[d] += t.valor;
    });

    // Teto do mês: parte gastável do orçamento; sem orçamento, a renda menos o que foi
    // investido (antes ignorava investimentos e o "ainda pode gastar" passava do saldo)
    const totalBudget = getBudgetTotal(m, a);
    const limit = roundMoney(totalBudget ? spendBudgetOf(totalBudget, ymKey(m, a)) : ent - inv);
    if (!limit || limit <= 0) { card.style.display = 'none'; destroyChart('heroPace'); return; }
    card.style.display = '';

    // Mês passado é balanço, futuro é previsão (só agendados); ritmo/"por dia" só no atual
    const fase = periodoFase(a, m);
    const remaining = roundMoney(limit - gas);
    const overLimit = remaining < 0;
    const numEl = $('heroNum');
    numEl.textContent = overLimit ? fmt(-remaining) : fmt(remaining);
    numEl.classList.toggle('neg', overLimit);
    $('heroLabel').textContent = overLimit ? 'Você passou do limite em'
        : { passado: 'Sobrou do limite', futuro: 'Você poderá gastar', atual: 'Você ainda pode gastar' }[fase];
    $('heroSub').textContent = `do limite de ${fmt(limit)} ${totalBudget ? 'deste mês' : inv ? '· renda − investimentos do mês' : '· renda do mês'}`;

    // "Hoje" dentro do mês exibido: mês inteiro se passado, nenhum dia se futuro
    const now = new Date();
    const todayDay = fase === 'atual' ? Math.min(now.getDate(), daysInMonth) : fase === 'futuro' ? 0 : daysInMonth;
    const daysLeft = daysInMonth - todayDay + (fase === 'atual' ? 1 : 0);   // inclui hoje

    // cumulative actual (up to today) vs linear pace line
    // Ritmo compara só o gasto ATÉ HOJE — fixos já lançados para dias futuros do mês
    // não contam como gastos (antes contavam e o card acusava "acima do ritmo")
    // O gráfico mostra a FOLGA: ritmo esperado − gasto acumulado. Linha tracejada em zero = no
    // ritmo; acima = gastou menos (folga, como patrimônio crescendo); abaixo = gastou mais do
    // que devia. Antes subia com o gasto acumulado, e subir parecia bom quando era o contrário.
    const folga = []; let run = 0, spentToDate = 0;
    for (let i = 1; i <= daysInMonth; i++) { run += perDay[i]; if (i <= todayDay) spentToDate = run; folga.push(i <= todayDay ? roundMoney(limit * i / daysInMonth - run) : null); }
    const paceLine = Array(daysInMonth).fill(0);
    const expectedToday = limit * todayDay / daysInMonth;
    const paceDiff = roundMoney(expectedToday - spentToDate); // >0 => gastou menos que o ritmo (folga)

    // Ritmo só existe com o mês em andamento (passado = o próprio saldo; futuro = R$ 0)
    const pill = $('heroPacePill');
    if (paceDiff >= 0) { pill.textContent = `▲ ${fmt(paceDiff)} de folga no ritmo`; pill.classList.remove('over'); }
    else { pill.textContent = `▼ ${fmt(-paceDiff)} acima do ritmo`; pill.classList.add('over'); }
    pill.style.display = fase === 'atual' ? '' : 'none';

    // Local, rule-based tip (no LLM)
    const usedPct = pctDoLimite(gas, limit);
    const tip = $('heroTip'), tipText = $('heroTipText');
    tipText.textContent =
        fase === 'passado' ? (overLimit ? `O mês fechou ${fmt(-remaining)} acima do limite.` : `Você fechou o mês usando ${usedPct}% do limite.`)
      : fase === 'futuro'  ? (overLimit ? `Os gastos já agendados passam do limite em ${fmt(-remaining)}.`
                                        : `${gas ? `Já há ${fmt(gas)} em gastos agendados (${usedPct}% do limite). ` : ''}Isso dá cerca de ${fmt(remaining / daysLeft)} por dia.`)
      : overLimit ? `Você passou do limite em ${fmt(-remaining)}. Segure os gastos para fechar o mês no azul.`
                  : `Você já usou ${usedPct}% do limite. Dá pra gastar cerca de ${fmt(remaining / daysLeft)} por dia até o fim do mês.`;
    tip.style.display = '';

    // Spending-pace chart
    const labels = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    upsertChart('heroPace', $('heroPace'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { data: paceLine, borderColor: 'rgba(255,255,255,.45)', borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0 },
                { data: folga, ...HERO_FOLGA_ESTILO, pointRadius: ctx => ctx.dataIndex === todayDay - 1 ? 4 : 0 }
            ]
        },
        options: HERO_FOLGA_OPCOES
    });
}
// Linha de folga: verde acima do ritmo (gastou menos), coral abaixo (gastou mais)
const HERO_VERDE = '#7CF5B4', HERO_CORAL = '#FFB4A2';
const HERO_FOLGA_ESTILO = {
    borderColor: HERO_VERDE, borderWidth: 3, tension: .35,
    fill: { target: 'origin', above: 'rgba(124,245,180,.14)', below: 'rgba(255,140,120,.26)' },
    segment: { borderColor: c => (c.p1.parsed.y < 0 ? HERO_CORAL : HERO_VERDE) },
    pointBackgroundColor: '#fff', pointBorderWidth: 2,   // o hero é azul nos dois temas
    pointBorderColor: c => (c.parsed && c.parsed.y < 0 ? HERO_CORAL : HERO_VERDE),
};
const HERO_FOLGA_OPCOES = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: { x: { display: false }, y: { display: false, beginAtZero: true, grace: '12%' } },
    animation: { duration: 400 }
};

// ── SAFE-TO-SPEND HERO — YEARLY (Anual view) ──────────────────────────────────
function renderHeroAnual() {
    const card = $('heroCardAnual');
    if (!card) return;
    const a = filtro().a;
    const perMonth = Array(12).fill(0);
    let entYear = 0, gasYear = 0, invYear = 0;
    for (let mo = 0; mo < 12; mo++) {             // índice mensal em vez de varrer todos os anos
        txMes(mo, a).forEach(t => {
            if (t.tipo === 'entrada') entYear += t.valor;
            else if (t.tipo === 'investimento') invYear += t.valor;
            else if (t.tipo === 'saida') { gasYear += t.valor; perMonth[mo] += t.valor; }
        });
    }

    // Teto do ano: soma dos orçamentos mensais (sem a fatia de investimento); sem
    // orçamento, renda do ano menos investimentos — mesmo critério do hero mensal
    let limit = 0, anyBudget = false;
    for (let mm = 0; mm < 12; mm++) {
        const tb = getBudgetTotal(mm, a);
        if (tb) { anyBudget = true; limit += spendBudgetOf(tb, ymKey(mm, a)); }
    }
    if (!anyBudget) limit = entYear - invYear;
    limit = roundMoney(limit);
    if (!limit || limit <= 0) { card.style.display = 'none'; destroyChart('heroPaceAnual'); return; }
    card.style.display = '';

    const fase = periodoFase(a);
    const remaining = roundMoney(limit - gasYear);
    const overLimit = remaining < 0;
    $('heroNumAnual').textContent = overLimit ? fmt(-remaining) : fmt(remaining);
    $('heroNumAnual').classList.toggle('neg', overLimit);
    $('heroLabelAnual').textContent = overLimit ? `Você passou do limite de ${a} em`
        : { passado: `Sobrou do limite de ${a}`, futuro: `Você poderá gastar em ${a}`, atual: `Você ainda pode gastar em ${a}` }[fase];
    $('heroSubAnual').textContent = `do limite de ${fmt(limit)} ${anyBudget ? 'no ano' : invYear ? '· renda − investimentos do ano' : '· renda do ano'}`;

    const now = new Date();
    // Ano passado: tudo decorrido · ano futuro: nada decorrido
    const curMonthIdx = fase === 'atual' ? now.getMonth() : fase === 'passado' ? 11 : -1;
    const monthsElapsed = curMonthIdx + 1;
    const monthsLeft = fase === 'atual' ? 12 - curMonthIdx : 12;   // inclui o mês atual

    // Só meses já decorridos entram no ritmo (fixos replicados para os próximos meses não)
    // Mesma leitura do hero mensal: folga = ritmo esperado − gasto acumulado (para cima = gastou menos)
    const folga = []; let run = 0, spentToDate = 0;
    for (let i = 0; i < 12; i++) { run += perMonth[i]; if (i <= curMonthIdx) spentToDate = run; folga.push(i <= curMonthIdx ? roundMoney(limit * (i + 1) / 12 - run) : null); }
    const paceLine = Array(12).fill(0);
    const paceDiff = roundMoney((limit * monthsElapsed / 12) - spentToDate);

    const pill = $('heroPacePillAnual');
    if (paceDiff >= 0) { pill.textContent = `▲ ${fmt(paceDiff)} de folga no ritmo`; pill.classList.remove('over'); }
    else { pill.textContent = `▼ ${fmt(-paceDiff)} acima do ritmo`; pill.classList.add('over'); }
    pill.style.display = fase === 'atual' ? '' : 'none';

    const usedPct = pctDoLimite(gasYear, limit);
    $('heroTipTextAnual').textContent =
        fase === 'passado' ? (overLimit ? `${a} fechou ${fmt(-remaining)} acima do limite.` : `Você fechou ${a} usando ${usedPct}% do limite anual.`)
      : fase === 'futuro'  ? (overLimit ? `Os gastos já agendados para ${a} passam do limite em ${fmt(-remaining)}.`
                                        : `${gasYear ? `Já há ${fmt(gasYear)} em gastos agendados (${usedPct}% do limite). ` : ''}Isso dá cerca de ${fmt(remaining / monthsLeft)} por mês.`)
      : overLimit ? `Você passou do limite anual em ${fmt(-remaining)}. Segure os gastos para fechar o ano no azul.`
                  : `Você já usou ${usedPct}% do limite anual. Dá pra gastar cerca de ${fmt(remaining / monthsLeft)} por mês até dezembro.`;
    $('heroTipAnual').style.display = '';

    const labels = MESES.map(mn => mn.slice(0, 3));
    upsertChart('heroPaceAnual', $('heroPaceAnual'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { data: paceLine, borderColor: 'rgba(255,255,255,.45)', borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0 },
                { data: folga, ...HERO_FOLGA_ESTILO, pointRadius: ctx => ctx.dataIndex === curMonthIdx ? 4 : 0 }
            ]
        },
        options: HERO_FOLGA_OPCOES
    });
}

// ── BOOT ─────────────────────────────────────────────────────────────────────
// Por último: todas as declarações (const/let) do script já existem aqui.
_aplicarTema();
bootApp();
// Instalável como app e abre sem rede (sw.js: rede primeiro, cópia local como reserva).
// Fora do preview e só em http(s); falha de registro nunca atrapalha o app.
// Pede armazenamento persistente: sem isso o iOS/Safari pode apagar o localStorage (e as alterações ainda não sincronizadas)
if (!PREVIEW_MODE) { try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {} }
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !PREVIEW_MODE) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
