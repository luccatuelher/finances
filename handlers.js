// Handlers declarativos do app.
//
// O HTML não usa atributos onclick/onchange/...: o código fica em data-onclick/data-onchange/... (atributos
// inertes) e este executor — sem eval nem Function — interpreta só o subconjunto de JavaScript que o app usa.
// Com isso a Content-Security-Policy bloqueia todo script inline (um HTML injetado por engano não executa nada).
//
// Subconjunto aceito (qualquer outra coisa vira console.error, nunca é executada):
//   instrução  := if ( expr ===|!== expr ) instrução | expr          (várias, separadas por ;)
//   expr       := literal | this | event | ident | expr . nome | expr [ expr ] | expr ( args ) | param => alvo = literal
//   chamadas   := funções globais DO APP (as nativas do navegador, como alert/eval/fetch, são recusadas)
//                 e alguns métodos de DOM/evento (click, classList.toggle/add/remove, querySelectorAll, forEach,
//                 stopPropagation, preventDefault, focus, select)
// Carregado ANTES do app.js: o instantâneo abaixo guarda o que é nativo do navegador.
(function () {
    'use strict';
    const NATIVOS = new Set(Object.getOwnPropertyNames(window));
    const PROPS = new Set(['value', 'checked', 'dataset', 'files', 'parentElement', 'classList', 'target', 'key', 'id', 'nextElementSibling', 'previousElementSibling', 'length']);
    const METODOS = new Set(['click', 'toggle', 'add', 'remove', 'querySelectorAll', 'forEach', 'stopPropagation', 'preventDefault', 'focus', 'select']);
    const cache = new Map();

    // ── tokenizador ──
    function tokenizar(src) {
        const t = []; let i = 0;
        while (i < src.length) {
            const c = src[i];
            if (/\s/.test(c)) { i++; continue; }
            if (c === "'" || c === '"') {
                let j = i + 1, v = '';
                while (j < src.length && src[j] !== c) {
                    if (src[j] === '\\') {
                        const n = src[j + 1];
                        if (n === 'u') { v += String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)); j += 6; continue; }
                        if (n === 'x') { v += String.fromCharCode(parseInt(src.slice(j + 2, j + 4), 16)); j += 4; continue; }
                        v += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[n] ?? n; j += 2; continue;
                    }
                    v += src[j++];
                }
                if (src[j] !== c) throw new Error('texto sem fechar');
                t.push({ k: 'str', v }); i = j + 1; continue;
            }
            let m;
            if ((m = /^\d+(?:\.\d+)?/.exec(src.slice(i)))) { t.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
            if ((m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i)))) { t.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
            if ((m = /^(===|!==|=>|[(),;.\[\]=!-])/.exec(src.slice(i)))) { t.push({ k: 'p', v: m[0] }); i += m[0].length; continue; }
            throw new Error('caractere inesperado "' + c + '"');
        }
        return t;
    }

    // ── analisador (gera uma árvore) ──
    function analisar(src) {
        const tk = tokenizar(src); let p = 0;
        const ver = () => tk[p], prox = () => tk[p++];
        const eh = v => tk[p] && tk[p].k === 'p' && tk[p].v === v;
        const exige = v => { if (!eh(v)) throw new Error('esperava "' + v + '"'); p++; };
        function primario() {
            const x = prox(); if (!x) throw new Error('fim inesperado');
            if (x.k === 'str' || x.k === 'num') return { t: 'lit', v: x.v };
            if (x.k === 'p' && x.v === '-' && ver() && ver().k === 'num') return { t: 'lit', v: -prox().v };
            if (x.k === 'id') {
                if (x.v === 'true') return { t: 'lit', v: true };
                if (x.v === 'false') return { t: 'lit', v: false };
                if (x.v === 'null') return { t: 'lit', v: null };
                if (x.v === 'undefined') return { t: 'lit', v: undefined };
                if (eh('=>')) {                        // param => alvo.prop = literal
                    p++; const alvo = posfixo(primario());
                    exige('='); const v = primario();
                    if (alvo.t !== 'mem') throw new Error('atribuição inválida');
                    return { t: 'arrow', param: x.v, alvo, v };
                }
                return { t: 'id', n: x.v };
            }
            throw new Error('inesperado "' + x.v + '"');
        }
        function posfixo(e) {
            for (;;) {
                if (eh('.')) { p++; const n = prox(); if (!n || n.k !== 'id') throw new Error('nome esperado'); e = { t: 'mem', o: e, n: n.v }; }
                else if (eh('[')) { p++; const i = expr(); exige(']'); e = { t: 'idx', o: e, i }; }
                else if (eh('(')) {
                    p++; const a = [];
                    if (!eh(')')) { do { a.push(expr()); } while (eh(',') && p++ >= 0); }
                    exige(')'); e = { t: 'call', f: e, a };
                } else return e;
            }
        }
        function expr() { return posfixo(primario()); }
        function instrucao() {
            const x = ver();
            if (x && x.k === 'id' && x.v === 'if') {
                p++; exige('('); const l = expr(); const op = prox();
                if (!op || (op.v !== '===' && op.v !== '!==')) throw new Error('só === e !== em if');
                const r = expr(); exige(')');
                return { t: 'if', op: op.v, l, r, s: instrucao() };
            }
            return expr();
        }
        const lista = [];
        while (p < tk.length) { if (eh(';')) { p++; continue; } lista.push(instrucao()); if (p < tk.length) exige(';'); }
        return lista;
    }

    // ── execução ──
    const dominio = window;
    function ehNativoRecusado(n) { return NATIVOS.has(n) && n !== '$'; }
    function avaliar(n, env) {
        switch (n.t) {
            case 'lit': return n.v;
            case 'id':
                if (n.n === 'this') return env.el;
                if (n.n === 'event') return env.ev;
                if (env.local && n.n === env.local.nome) return env.local.valor;
                throw new Error('identificador solto "' + n.n + '"');
            case 'mem': {
                const o = avaliar(n.o, env);
                if (o == null) throw new Error('"' + n.n + '" de nulo');
                if (PROPS.has(n.n) || (typeof DOMStringMap !== 'undefined' && o instanceof DOMStringMap)) return o[n.n];
                throw new Error('propriedade não permitida "' + n.n + '"');
            }
            case 'idx': { const o = avaliar(n.o, env), i = avaliar(n.i, env); if (typeof i !== 'number') throw new Error('índice inválido'); return o[i]; }
            case 'call': {
                const a = n.a.map(x => avaliar(x, env));
                if (n.f.t === 'id') {
                    const nome = n.f.n;
                    if (ehNativoRecusado(nome) || typeof dominio[nome] !== 'function') throw new Error('função não permitida "' + nome + '"');
                    return dominio[nome](...a);
                }
                if (n.f.t === 'mem') {
                    const o = avaliar(n.f.o, env), nome = n.f.n;
                    if (!METODOS.has(nome) || o == null || typeof o[nome] !== 'function') throw new Error('método não permitido "' + nome + '"');
                    if (nome === 'stopPropagation') env.parou = true;
                    return o[nome](...a);
                }
                throw new Error('chamada inválida');
            }
            case 'arrow': return (v) => { const o = avaliar(n.alvo.o, { ...env, local: { nome: n.param, valor: v } }); o[n.alvo.n] = avaliar(n.v, env); };
            case 'if': {
                const l = avaliar(n.l, env), r = avaliar(n.r, env);
                return (n.op === '===' ? l === r : l !== r) ? avaliar(n.s, env) : undefined;
            }
            default: throw new Error('nó desconhecido');
        }
    }
    function rodar(codigo, el, ev) {
        let ast = cache.get(codigo);
        if (!ast) { ast = analisar(codigo); cache.set(codigo, ast); }
        const env = { el, ev, parou: false };
        for (const st of ast) avaliar(st, env);
        return env;
    }

    // ── delegação de eventos ──
    // Percorre os ancestrais (como o bubbling nativo, caminho fixado antes de executar) e roda o código de cada
    // elemento que tem o atributo; event.stopPropagation() no código interrompe a subida.
    function despachar(ev, attr, filtro) {
        const cadeia = [];
        for (let el = ev.target; el && el.nodeType === 1; el = el.parentElement) {
            const c = el.getAttribute(attr);
            if (c && (!filtro || filtro(el, ev))) cadeia.push([el, c]);
        }
        for (const [el, c] of cadeia) {
            let env;
            try { env = rodar(c, el, ev); }
            catch (e) { console.error('Handler "' + c.slice(0, 80) + '": ' + e.message); continue; }
            if (env.parou) break;
        }
    }
    ['click', 'change', 'input', 'keydown', 'keyup'].forEach(t => document.addEventListener(t, ev => despachar(ev, 'data-on' + t)));
    document.addEventListener('focusin', ev => despachar(ev, 'data-onfocus', (el) => el === ev.target));
    document.addEventListener('mouseover', ev => despachar(ev, 'data-onmouseenter', (el) => !el.contains(ev.relatedTarget)));

    window.__hx = { rodar, analisar };
})();
