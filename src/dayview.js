// Visão "Horas" do cronograma: um dia por vez. A lista da esquerda é a mesma do Gantt (concluir, grupos,
// subtarefas, prioridade, ＋); à direita, os horários. Arrastar muda o horário (de 15 em 15 min), as bordas
// mudam a duração; numa linha sem horário, arraste no espaço vazio para marcar um horário; para tirar o
// horário, solte a barra no cabeçalho.
const DayView = (() => {
  const STEP = 15;
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const fromMin = (n) => `${U.pad(Math.floor(n / 60))}:${U.pad(n % 60)}`;

  // rows: [{ key, kind: 'task'|'meeting'|'project', id, start?, end?, isMs?, group?, color, title, done, late }]
  // labelHtml(row) → HTML da coluna da esquerda; footerHtml → linha final (＋ Tarefa…)
  // links: [{ from, to, bad }] (keys)
  // hourPx: largura de uma hora (0 = cabe na tela). focus: { min, x } mantém o horário sob o mouse.
  function render(host, { date, rows, links = [], hours = [8, 18], labelHtml, footerHtml = '', onEdit, onTime, hourPx = 0, focus = null }) {
    const today = U.todayKey();
    let h0 = hours[0], h1 = hours[1];
    for (const r of rows) {
      if (!r.start) continue;
      h0 = Math.min(h0, Math.floor(toMin(r.start) / 60));
      h1 = Math.max(h1, Math.ceil((r.end ? toMin(r.end) : toMin(r.start) + 60) / 60)); // entrega: espaço para o rótulo
    }
    h1 = Math.min(24, Math.max(h1, h0 + 1));
    const total = (h1 - h0) * 60;
    const pct = (min) => ((min - h0 * 60) / total) * 100;
    const nHours = h1 - h0;

    const bar = (r) => {
      if (r.kind === 'project' || !r.start) return '';
      const s = toMin(r.start);
      if (r.isMs) {
        return `<div class="dv-ms${r.done ? ' done' : ''}" data-key="${r.key}" style="left:${pct(s)}%" title="${U.esc(r.title)} · ${r.start}"></div>
          <span class="dv-ms-t" style="left:${pct(s)}%">${r.start}</span>`;
      }
      const e = toMin(r.end);
      const cls = r.group ? 'dv-sum' : `dv-bar${r.kind === 'meeting' ? ' meet' : ''}${r.late ? ' late' : ''}`;
      return `<div class="${cls}${r.done ? ' done' : ''}" data-key="${r.key}" style="left:${pct(s)}%;width:${Math.max(0.8, pct(e) - pct(s))}%" title="${U.esc(r.title)} · ${r.start}–${r.end}">
        ${r.group ? '' : '<span class="dv-h dv-hl"></span>'}<span class="dv-bar-t">${r.start}–${r.end}</span>${r.group ? '' : '<span class="dv-h dv-hr"></span>'}</div>`;
    };

    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const showNow = date === today && nowMin >= h0 * 60 && nowMin <= h1 * 60;
    host.innerHTML = `<div class="dv-scroll"><div class="dv" style="--n:${nHours};--c:var(--accent)">
      <div class="g-row dv-head">
        <div class="g-label g-corner dv-corner"><span class="dv-corner-t">Tarefas, entregas e reuniões</span><span class="dv-drop-t">Solte aqui para tirar o horário</span></div>
        <div class="dv-scale">${Array.from({ length: nHours }, (_, i) => `<span style="left:${(i / nHours) * 100}%">${h0 + i}h</span>`).join('')}</div>
      </div>
      <div class="dv-body">
        ${rows.map((r) => `<div class="g-row dv-row${r.kind === 'project' ? ' dv-proj' : ''}${r.group ? ' parent' : ''}" data-row="${r.key}" style="--c:${r.color}">
          ${labelHtml(r)}
          <div class="dv-track${r.kind === 'task' && !r.group && !r.start ? ' free' : ''}" data-key="${r.key}">${bar(r)}${r.kind === 'task' && !r.group && !r.start ? '<span class="dv-free-t">sem horário · arraste aqui para marcar</span>' : ''}</div>
        </div>`).join('')}
        ${!rows.length ? '<div class="dv-empty muted small">Nada marcado para este dia.</div>' : ''}
        <svg class="dv-links"></svg>
        ${showNow ? `<div class="dv-now" style="left:calc(350px + (100% - 350px) * ${pct(nowMin) / 100})"></div>` : ''}
      </div>
      ${footerHtml ? `<div class="g-row g-row-add">${footerHtml}<div class="dv-track"></div></div>` : ''}
    </div></div>`;

    const root = host.querySelector('.dv');
    host.dataset.h0 = h0;
    host.dataset.h1 = h1;
    if (hourPx) root.style.minWidth = `${350 + nHours * hourPx}px`;
    if (focus && focus.min != null && hourPx) {
      host.querySelector('.dv-scroll').scrollLeft = Math.max(0, ((focus.min - h0 * 60) / 60) * hourPx - focus.x);
    }
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    const trackRect = () => root.querySelector('.dv-scale').getBoundingClientRect();
    const minAtX = (x) => {
      const r = trackRect();
      const m = h0 * 60 + ((x - r.left) / r.width) * total;
      return Math.max(h0 * 60, Math.min(h1 * 60 - STEP, Math.floor(m / STEP) * STEP));
    };

    // Barras curtas: o horário vai para fora, à direita da barra.
    const fitLabels = () => root.querySelectorAll('.dv-bar, .dv-sum').forEach((b) => {
      const t = b.querySelector('.dv-bar-t');
      b.classList.remove('outside');
      if (t.scrollWidth > t.clientWidth + 1) b.classList.add('outside');
    });
    // Setas de dependência entre tarefas com horário.
    const drawLinks = () => {
      const svg = root.querySelector('.dv-links');
      const body = root.querySelector('.dv-body').getBoundingClientRect();
      svg.setAttribute('width', body.width); svg.setAttribute('height', body.height);
      svg.innerHTML = `<defs><marker id="dv-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="dv-arr-head"/></marker>
        <marker id="dv-arr-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="dv-arr-head bad"/></marker></defs>` +
        links.map((l) => {
          const a = root.querySelector(`.dv-body .dv-track [data-key="${l.from}"]`), b = root.querySelector(`.dv-body .dv-track [data-key="${l.to}"]`);
          if (!a || !b) return '';
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          const x1 = ra.right - body.left, y1 = ra.top + ra.height / 2 - body.top;
          const x2 = rb.left - body.left - 2, y2 = rb.top + rb.height / 2 - body.top;
          const d = x2 > x1 + 14 ? `M${x1},${y1} H${x1 + 8} V${y2} H${x2}` : `M${x1},${y1} H${x1 + 8} V${(y1 + y2) / 2} H${x2 - 10} V${y2} H${x2}`;
          return `<path d="${d}" class="dv-link${l.bad ? ' bad' : ''}" marker-end="url(#dv-arr${l.bad ? '-bad' : ''})"><title>${l.bad ? 'Conflito: começa antes da anterior terminar' : 'Dependência'}</title></path>`;
        }).join('');
    };
    requestAnimationFrame(() => { fitLabels(); drawLinks(); });

    const onHead = (x, y) => { const o = document.elementFromPoint(x, y); return !!(o && o.closest('.dv-head')); };

    root.querySelector('.dv-body').addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      const el = ev.target.closest('.dv-bar, .dv-ms, .dv-sum');
      if (el) return startDrag(ev, el);
      const free = ev.target.closest('.dv-track.free');
      if (free) startDraw(ev, free);
    });

    // Arrastar barras: mover, esticar, ou soltar no cabeçalho para tirar o horário.
    function startDrag(ev, el) {
      ev.preventDefault();
      const r = byKey[el.dataset.key];
      if (r.group) { const up = () => { window.removeEventListener('mouseup', up); onEdit(r); }; window.addEventListener('mouseup', up); return; }
      const mode = ev.target.classList.contains('dv-hl') ? 'l' : ev.target.classList.contains('dv-hr') ? 'r' : 'move';
      const s0 = toMin(r.start), e0 = r.isMs ? s0 : toMin(r.end);
      const perPx = total / trackRect().width;
      const x0 = ev.clientX;
      let s = s0, e = e0, moved = false;
      const onMove = (mv) => {
        const dm = Math.round(((mv.clientX - x0) * perPx) / STEP) * STEP;
        if (!moved && Math.abs(mv.clientX - x0) + Math.abs(mv.clientY - ev.clientY) > 3) { moved = true; el.classList.add('dragging'); root.classList.add('dragging'); }
        if (!moved) return;
        if (mode === 'move') { s = Math.max(0, Math.min(24 * 60 - (e0 - s0) - (r.isMs ? STEP : 0), s0 + dm)); e = s + (e0 - s0); }
        else if (mode === 'l') s = Math.min(e0 - STEP, Math.max(0, s0 + dm));
        else e = Math.max(s0 + STEP, Math.min(24 * 60, e0 + dm));
        el.style.left = `${pct(s)}%`;
        if (!r.isMs) { el.style.width = `${pct(e) - pct(s)}%`; el.querySelector('.dv-bar-t').textContent = `${fromMin(s)}–${fromMin(e)}`; }
        root.querySelector('.dv-head').classList.toggle('drop', r.kind === 'task' && onHead(mv.clientX, mv.clientY));
      };
      const onUp = (up) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        el.classList.remove('dragging');
        root.classList.remove('dragging');
        root.querySelector('.dv-head').classList.remove('drop');
        if (!moved) { onEdit(r); return; }
        if (r.kind === 'task' && onHead(up.clientX, up.clientY)) { onTime(r, null); return; }
        if (s !== s0 || e !== e0) onTime(r, { start: fromMin(s), end: r.isMs ? '' : fromMin(e) });
        else { fitLabels(); drawLinks(); }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    // Linha sem horário: arrastar no espaço vazio desenha o horário (um clique marca 1 hora).
    function startDraw(ev, track) {
      ev.preventDefault();
      const r = byKey[track.dataset.key];
      const a = minAtX(ev.clientX);
      let b = a, moved = false;
      const ghost = document.createElement('div');
      ghost.className = r.isMs ? 'dv-ms ghost' : 'dv-bar ghost';
      ghost.innerHTML = r.isMs ? '' : '<span class="dv-bar-t"></span>';
      track.appendChild(ghost);
      const draw = () => {
        const s = Math.min(a, b), e = r.isMs ? s : Math.max(a, b) + STEP;
        ghost.style.left = `${pct(s)}%`;
        if (!r.isMs) { ghost.style.width = `${pct(e) - pct(s)}%`; ghost.querySelector('.dv-bar-t').textContent = `${fromMin(s)}–${fromMin(e)}`; }
      };
      draw();
      const onMove = (mv) => { if (Math.abs(mv.clientX - ev.clientX) > 4) moved = true; b = minAtX(mv.clientX); draw(); };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const s = Math.min(a, b);
        const e = r.isMs ? s : moved ? Math.max(a, b) + STEP : Math.min(24 * 60, s + 60);
        onTime(r, { start: fromMin(s), end: r.isMs ? '' : fromMin(e) });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  }

  return { render, toMin, fromMin };
})();
