// Visão "Horas" do cronograma: um dia por vez, com tarefas em horário, reuniões e a faixa "Dia todo".
// Arrastar muda o horário (de 15 em 15 min), as bordas mudam a duração; da faixa "Dia todo" para a
// linha do tempo dá um horário à tarefa, e de volta para a faixa tira o horário.
const DayView = (() => {
  const STEP = 15;
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const fromMin = (n) => `${U.pad(Math.floor(n / 60))}:${U.pad(n % 60)}`;
  const hLabel = (h) => `${h}h`;

  // items: [{ key, kind: 'task'|'meeting', id, title, start, end, isMs, color, project, done, late }]
  // allDay: [{ key, kind, id, title, isMs, color, project, done }]
  // links: [{ from, to, bad }] (keys)
  function render(host, { date, items, allDay, links = [], hours = [8, 18], showProject, onEdit, onTime }) {
    const today = U.todayKey();
    let h0 = hours[0], h1 = hours[1];
    for (const it of items) {
      h0 = Math.min(h0, Math.floor(toMin(it.start) / 60));
      h1 = Math.max(h1, Math.ceil((it.end ? toMin(it.end) : toMin(it.start) + 60) / 60)); // entrega: espaço para o rótulo
    }
    h1 = Math.min(24, Math.max(h1, h0 + 1));
    const total = (h1 - h0) * 60;
    const pct = (min) => ((min - h0 * 60) / total) * 100;
    const nHours = h1 - h0;

    const lbl = (it) => `<span class="dot" style="background:${it.color}"></span>
      <span class="dv-ltext"><span class="dv-lname">${it.kind === 'meeting' ? '◷ ' : it.isMs ? '◆ ' : ''}${U.esc(it.title)}</span>${showProject && it.project ? `<small>${U.esc(it.project)}</small>` : ''}</span>`;

    const bar = (it) => {
      const s = toMin(it.start);
      if (it.isMs) {
        return `<div class="dv-ms${it.done ? ' done' : ''}" data-key="${it.key}" style="--c:${it.color};left:${pct(s)}%" title="${U.esc(it.title)} · ${it.start}"></div>
          <span class="dv-ms-t" style="left:${pct(s)}%">${it.start}</span>`;
      }
      const e = toMin(it.end);
      return `<div class="dv-bar${it.kind === 'meeting' ? ' meet' : ''}${it.done ? ' done' : ''}${it.late ? ' late' : ''}" data-key="${it.key}"
          style="--c:${it.color};left:${pct(s)}%;width:${Math.max(0.8, pct(e) - pct(s))}%" title="${U.esc(it.title)} · ${it.start}–${it.end}">
        <span class="dv-h dv-hl"></span><span class="dv-bar-t">${it.start}–${it.end}</span><span class="dv-h dv-hr"></span></div>`;
    };

    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const showNow = date === today && nowMin >= h0 * 60 && nowMin <= h1 * 60;
    host.innerHTML = `<div class="dv" style="--n:${nHours}">
      <div class="dv-row dv-head"><div class="dv-lbl muted small">${items.length || allDay.length ? 'Tarefas e reuniões' : ''}</div>
        <div class="dv-scale">${Array.from({ length: nHours }, (_, i) => `<span style="left:${(i / nHours) * 100}%">${hLabel(h0 + i)}</span>`).join('')}</div></div>
      <div class="dv-row dv-allday"><div class="dv-lbl muted small">☀ Dia todo</div>
        <div class="dv-chips">${allDay.length ? allDay.map((it) => `<button class="dv-chip${it.done ? ' done' : ''}" data-key="${it.key}" style="--c:${it.color}" title="Arraste para a linha do tempo para dar um horário">${it.isMs ? '◆ ' : ''}${U.esc(it.title)}${showProject && it.project ? ` <small>· ${U.esc(it.project)}</small>` : ''}</button>`).join('')
          : '<span class="muted small">Tarefas do dia sem horário aparecem aqui. Arraste uma barra para cá para tirar o horário.</span>'}</div></div>
      <div class="dv-body">
        ${items.map((it) => `<div class="dv-row" data-row="${it.key}"><button class="dv-lbl" data-key="${it.key}">${lbl(it)}</button><div class="dv-track">${bar(it)}</div></div>`).join('')}
        ${!items.length ? `<div class="dv-empty muted small">${allDay.length ? 'Arraste as tarefas de cima para um horário para montar o dia.' : 'Nada marcado para este dia.'}</div>` : ''}
        <svg class="dv-links"></svg>
        ${showNow ? `<div class="dv-now" style="left:calc(var(--lw) + (100% - var(--lw)) * ${pct(nowMin) / 100})"></div>` : ''}
      </div>
    </div>`;

    const root = host.querySelector('.dv');
    const byKey = Object.fromEntries([...items, ...allDay].map((it) => [it.key, it]));
    const trackRect = () => { const t = root.querySelector('.dv-track') || root.querySelector('.dv-scale'); return t.getBoundingClientRect(); };
    const minAtX = (x) => {
      const r = trackRect();
      const m = h0 * 60 + ((x - r.left) / r.width) * total;
      return Math.max(h0 * 60, Math.min(h1 * 60 - STEP, Math.round(m / STEP) * STEP));
    };

    // Setas de dependência entre tarefas com horário no mesmo dia.
    const drawLinks = () => {
      const svg = root.querySelector('.dv-links');
      const body = root.querySelector('.dv-body').getBoundingClientRect();
      svg.setAttribute('width', body.width); svg.setAttribute('height', body.height);
      svg.innerHTML = `<defs><marker id="dv-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="dv-arr-head"/></marker>
        <marker id="dv-arr-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="dv-arr-head bad"/></marker></defs>` +
        links.map((l) => {
          const a = root.querySelector(`.dv-body [data-key="${l.from}"]:not(.dv-lbl)`), b = root.querySelector(`.dv-body [data-key="${l.to}"]:not(.dv-lbl)`);
          if (!a || !b) return '';
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          const x1 = ra.right - body.left, y1 = ra.top + ra.height / 2 - body.top;
          const x2 = rb.left - body.left - 2, y2 = rb.top + rb.height / 2 - body.top;
          const mx = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 12));
          const d = x2 > x1 + 14 ? `M${x1},${y1} H${mx} V${y2} H${x2}` : `M${x1},${y1} H${x1 + 8} V${(y1 + y2) / 2} H${x2 - 10} V${y2} H${x2}`;
          return `<path d="${d}" class="dv-link${l.bad ? ' bad' : ''}" marker-end="url(#dv-arr${l.bad ? '-bad' : ''})"><title>${l.bad ? 'Conflito: começa antes da anterior terminar' : 'Dependência'}</title></path>`;
        }).join('');
    };
    // Barras curtas: o horário vai para fora, à direita da barra.
    const fitLabels = () => root.querySelectorAll('.dv-bar').forEach((b) => {
      const t = b.querySelector('.dv-bar-t');
      b.classList.remove('outside');
      if (t.scrollWidth > t.clientWidth + 1) b.classList.add('outside');
    });
    requestAnimationFrame(() => { fitLabels(); drawLinks(); });

    // Clique no nome abre a tarefa/reunião.
    root.querySelectorAll('.dv-lbl[data-key]').forEach((b) => b.addEventListener('click', () => onEdit(byKey[b.dataset.key])));

    // Arrastar barras: mover, esticar, ou soltar na faixa "Dia todo" para tirar o horário.
    root.querySelectorAll('.dv-body .dv-bar, .dv-body .dv-ms').forEach((el) => {
      el.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const it = byKey[el.dataset.key];
        const mode = ev.target.classList.contains('dv-hl') ? 'l' : ev.target.classList.contains('dv-hr') ? 'r' : 'move';
        const s0 = toMin(it.start), e0 = it.isMs ? s0 : toMin(it.end);
        const r = trackRect();
        const perPx = total / r.width;
        const x0 = ev.clientX;
        let s = s0, e = e0, moved = false;
        el.classList.add('dragging');
        const onMove = (mv) => {
          const dm = Math.round(((mv.clientX - x0) * perPx) / STEP) * STEP;
          if (Math.abs(mv.clientX - x0) > 3) moved = true;
          if (mode === 'move') { s = Math.max(0, Math.min(24 * 60 - (e0 - s0) - (it.isMs ? STEP : 0), s0 + dm)); e = s + (e0 - s0); }
          else if (mode === 'l') s = Math.min(e0 - STEP, Math.max(0, s0 + dm));
          else e = Math.max(s0 + STEP, Math.min(24 * 60, e0 + dm));
          el.style.left = `${pct(s)}%`;
          if (!it.isMs) { el.style.width = `${pct(e) - pct(s)}%`; el.querySelector('.dv-bar-t').textContent = `${fromMin(s)}–${fromMin(e)}`; }
          const over = document.elementFromPoint(mv.clientX, mv.clientY);
          root.querySelector('.dv-allday').classList.toggle('drop', !!(it.kind === 'task' && over && over.closest('.dv-allday')));
        };
        const onUp = (up) => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          el.classList.remove('dragging');
          root.querySelector('.dv-allday').classList.remove('drop');
          if (!moved) { onEdit(it); return; }
          const over = document.elementFromPoint(up.clientX, up.clientY);
          if (it.kind === 'task' && over && over.closest('.dv-allday')) { onTime(it, null); return; }
          if (s !== s0 || e !== e0) onTime(it, { start: fromMin(s), end: it.isMs ? '' : fromMin(e) });
          else { fitLabels(); drawLinks(); }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    });

    // Arrastar da faixa "Dia todo" para um horário.
    root.querySelectorAll('.dv-chip').forEach((chip) => {
      chip.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const it = byKey[chip.dataset.key];
        let ghost = null;
        const x0 = ev.clientX, y0 = ev.clientY;
        const onMove = (mv) => {
          if (!ghost && Math.hypot(mv.clientX - x0, mv.clientY - y0) > 4) {
            ghost = document.createElement('div');
            ghost.className = 'dv-ghost';
            ghost.style.setProperty('--c', it.color);
            root.appendChild(ghost);
          }
          if (!ghost) return;
          const rr = root.getBoundingClientRect();
          const m = minAtX(mv.clientX);
          ghost.textContent = `${it.title} · ${fromMin(m)}`;
          ghost.style.left = `${mv.clientX - rr.left + 12}px`;
          ghost.style.top = `${mv.clientY - rr.top + 8}px`;
        };
        const onUp = (up) => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          if (!ghost) { onEdit(it); return; }
          ghost.remove();
          const over = document.elementFromPoint(up.clientX, up.clientY);
          if (!over || !over.closest('.dv-body, .dv-head')) return;
          const m = minAtX(up.clientX);
          onTime(it, { start: fromMin(m), end: it.isMs ? '' : fromMin(Math.min(24 * 60, m + 60)) });
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    });
  }

  return { render, toMin, fromMin };
})();
