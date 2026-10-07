// Tema (automático pelo sistema, ou claro/escuro escolhido): aplicado antes de pintar para não piscar claro
(function () { try { var t = localStorage.getItem('fin5_tema'); var d = t === 'escuro' || (t !== 'claro' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-tema', d ? 'escuro' : 'claro'); } catch (e) {} })();
