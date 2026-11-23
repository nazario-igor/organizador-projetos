// Funções utilitárias compartilhadas.
const U = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const DIAS_LONGOS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const CORES = ['#5b6cff', '#8a3ffc', '#e5484d', '#f76b15', '#f5b400', '#30a46c', '#12a594', '#0090ff', '#d6409f', '#6e6e80'];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Datas no formato 'AAAA-MM-DD', sempre no fuso local.
  const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayKey = () => toKey(new Date());
  const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
  const diffDays = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000); // b - a
  const fmtDate = (k) => { if (!k) return ''; const d = fromKey(k); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  const fmtDateLong = (k) => { const d = fromKey(k); return `${DIAS_LONGOS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; };
  const fmtTime = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  };
  const dur = (ms) => {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}min`;
    return `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ''}`;
  };
  const hoursDecimal = (ms) => (ms / 3600000).toFixed(2).replace('.', ',');

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // Markdown simples para a visualização das anotações.
  function markdown(src) {
    const lines = esc(src || '').split('\n');
    let html = '';
    let list = null;
    const inline = (t) => t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>');
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    lines.forEach((line, i) => {
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)/))) { closeList(); html += `<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`; }
      else if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s*(.*)/))) {
        if (list !== 'ul') { closeList(); html += '<ul class="checklist">'; list = 'ul'; }
        const done = m[1].toLowerCase() === 'x';
        html += `<li class="${done ? 'done' : ''}"><input type="checkbox" data-line="${i}" ${done ? 'checked' : ''}> ${inline(m[2])}</li>`;
      }
      else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
      else if (/^\s*---+\s*$/.test(line)) { closeList(); html += '<hr>'; }
      else if (line.trim() === '') { closeList(); }
      else { closeList(); html += `<p>${inline(line)}</p>`; }
    });
    closeList();
    return html;
  }

  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\n');

  return {
    pad, MESES, MESES_CURTOS, DIAS, CORES, uid, toKey, fromKey, todayKey, addDays, diffDays,
    fmtDate, fmtDateLong, fmtTime, clock, dur, hoursDecimal, esc, debounce, markdown, toCsv,
  };
})();
