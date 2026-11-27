// Gráfico de Gantt: subtarefas (grupos recolhíveis), dependências com setas, barras arrastáveis e zoom.
const Gantt = (() => {
  const ZOOMS = { dia: 34, semana: 15, mes: 5 };
  // Três níveis em cada formato (largura de um dia, em px): do mais detalhado ao mais amplo.
  const LEVELS = { dia: [50, 38, 28], semana: [21, 16, 12], mes: [8, 6, 4] };
  const widthOf = (zoom, level, fallback) => (LEVELS[zoom] || LEVELS[fallback])[level ?? 1] || ZOOMS[fallback];
  const LABEL_W = 350;
  const scrollMemory = {};

  function range(tasks, zoom) {
    const today = U.todayKey();
    let min = U.addDays(today, -7);
    let max = U.addDays(today, 30);
    for (const t of tasks) {
      const end = t.type === 'entrega' ? t.start : t.end;
      if (t.start < min) min = t.start;
      if (end > max) max = end;
    }
    const pad = zoom === 'dia' ? 7 : zoom === 'semana' ? 14 : 30;
    let start = U.addDays(min, -pad);
    if (zoom !== 'dia') start = start.slice(0, 8) + '01'; // começa no dia 1 do mês
    const end = U.addDays(max, pad * 2);
    return { start, end, days: U.diffDays(start, end) + 1 };
  }

  function headerHtml(start, days, dayW, zoom) {
    let months = '';
    let daysHtml = '';
    let i = 0;
    while (i < days) {
      const d = U.fromKey(U.addDays(start, i));
      const inMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1;
      const span = Math.min(inMonth, days - i);
      const label = zoom === 'mes' ? `${U.MESES_CURTOS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : `${U.MESES[d.getMonth()]} ${d.getFullYear()}`;
      months += `<div class="g-month" style="left:${i * dayW}px;width:${span * dayW}px"><span>${label}</span></div>`;
      i += span;
    }
    const today = U.todayKey();
    for (let j = 0; j < days; j++) {
      const k = U.addDays(start, j);
      const d = U.fromKey(k);
      const wk = d.getDay() === 0 || d.getDay() === 6;
      let txt = '';
      if (zoom === 'dia') txt = `${d.getDate()}<small>${U.DIAS[d.getDay()]}</small>`;
      else if (zoom === 'semana' && d.getDay() === 1) txt = `${d.getDate()}`;
      else if (zoom === 'mes' && d.getDay() === 1 && d.getDate() <= 7) txt = '';
      if (!txt && k !== today) continue;
      daysHtml += `<div class="g-day${wk ? ' wk' : ''}${zoom !== 'dia' && txt ? ' wl' : ''}${k === today ? ' today' : ''}" style="left:${j * dayW}px;width:${zoom === 'dia' || !txt ? dayW : dayW * 7}px">${txt || '•'}</div>`;
    }
    return `<div class="g-months">${months}</div><div class="g-days">${daysHtml}</div>`;
  }

  const ROW_H = 38;

  // Caminho em "cotovelo" da seta de dependência (fim da anterior → início da seguinte).
  function depPath(x1, y1, x2, y2) {
    const g = 10;
    if (x2 - g >= x1 + g) return `M${x1},${y1} H${x1 + g} V${y2} H${x2}`;
    const yb = y2 > y1 ? y2 - ROW_H / 2 : y2 + ROW_H / 2;
    return `M${x1},${y1} H${x1 + g} V${yb} H${x2 - g} V${y2} H${x2}`;
  }

  // Marcador de reunião (◷) na data dela; clique abre a reunião.
  function meetMark(m, x, small) {
    const past = m.date < U.todayKey();
    return `<button class="g-meet${small ? ' small' : ''}${past ? ' done' : ''}" style="left:${x - (small ? 7 : 8)}px" data-action="edit-meeting" data-id="${m.id}"
      title="◷ Reunião ${U.fmtDate(m.date)}, ${m.start}${m.end ? '–' + m.end : ''}: ${U.esc(m.title)}">◷</button>`;
  }
  const meetDates = (meetings) => meetings.map((m) => ({ start: m.date, end: m.date }));

  // Depois de trocar o zoom: deixa o dia que estava sob o mouse no mesmo lugar da tela.
  function applyFocus(host, scroller, start, dayW, focus) {
    host.dataset.start = start;
    host.dataset.dayw = dayW;
    if (!focus || !focus.date) return false;
    scroller.scrollLeft = Math.max(0, U.diffDays(start, focus.date) * dayW + dayW / 2 - focus.x);
    return true;
  }

  function render(host, { projectId, color, tasks, meetings = [], zoom, collapsed, onEdit, onChange, onLink, onMeetEdit, onMeetChange, focus, level }) {
    const dayW = widthOf(zoom, level, 'dia');
    const { start, days } = range([...tasks, ...meetDates(meetings)], zoom);
    const width = days * dayW;
    const today = U.todayKey();
    const order = TaskTree.ordered(tasks, collapsed);
    const taskRows = order.filter((r) => !r.hiddenBy);
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    const kidsCount = TaskTree.childrenMap(tasks);

    // Reuniões viram linhas: logo abaixo da tarefa/entrega ligada (escondidas se o grupo estiver recolhido);
    // as sem tarefa entram entre as tarefas principais, pela data.
    const byTime = (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start);
    const shownTasks = new Set(taskRows.map((r) => r.t.id));
    const meetUnder = {};
    const loose = [];
    for (const m of meetings) {
      const t = m.taskId && byId[m.taskId];
      if (t) { if (shownTasks.has(t.id)) (meetUnder[t.id] ||= []).push(m); } else loose.push(m);
    }
    loose.sort(byTime);
    const visible = [];
    let li = 0;
    for (const r of taskRows) {
      if (r.depth === 0) while (li < loose.length && loose[li].date < r.t.start) visible.push({ m: loose[li++], depth: 0 });
      visible.push(r);
      for (const m of (meetUnder[r.t.id] || []).sort(byTime)) visible.push({ m, depth: r.depth + 1 });
    }
    while (li < loose.length) visible.push({ m: loose[li++], depth: 0 });
    const rowIndex = {};
    visible.forEach((r, i) => { rowIndex[r.t ? r.t.id : `m:${r.m.id}`] = i; });
    const meetById = Object.fromEntries(meetings.map((m) => [m.id, m]));

    // Barra da reunião: ocupa a parte do dia correspondente ao horário.
    const fromMin = (n) => (n >= 1440 ? '23:59' : DayView.fromMin(n));
    const mStart = (m) => DayView.toMin(m.start);
    const mEnd = (m) => (m.end && m.end > m.start ? DayView.toMin(m.end) : Math.min(1440, mStart(m) + 60));
    const mGeo = (m, s = mStart(m), e = mEnd(m), date = m.date) => ({ left: U.diffDays(start, date) * dayW + (s / 1440) * dayW, w: Math.max(8, ((e - s) / 1440) * dayW) });
    const meetRow = (m, depth) => {
      const past = m.date < today;
      const g = mGeo(m);
      return `<div class="g-row g-mrow" data-meet="${m.id}">
        <div class="g-label" style="padding-left:${10 + depth * 18}px">
          <span class="g-caret-sp"></span><span class="meet-ic" title="Reunião">◷</span>
          <button class="g-title${past ? ' done' : ''}" data-action="edit-meeting" data-id="${m.id}" title="${U.esc(m.title)}">${U.esc(m.title)}</button>
          ${m.link && !past ? `<button class="meet-join" data-action="meeting-join" data-id="${m.id}" title="${U.esc(m.link)}">Entrar ↗</button>` : ''}
          <span class="g-dates">${U.fmtDate(m.date)} · ${m.start}</span>
        </div>
        <div class="g-track" style="width:${width}px">
          <div class="g-mbar${past ? ' done' : ''}" data-meet="${m.id}" style="left:${g.left}px;width:${g.w}px" title="${U.esc(m.title)} — arraste para mudar o dia; puxe as pontas para ajustar o horário"><div class="g-h g-h-l"></div><div class="g-h g-h-r"></div></div>
          <div class="g-out-label" style="left:${g.left + g.w + 8}px">${m.start}–${fromMin(mEnd(m))} · ${U.esc(m.title)}</div>
        </div>
      </div>`;
    };

    // Posição horizontal de cada tarefa.
    const geo = (t) => {
      const isMs = t.type === 'entrega';
      const left = U.diffDays(start, t.start) * dayW;
      if (isMs) { const c = left + dayW / 2; return { left: c - 9, right: c + 9, w: 18, isMs }; }
      const w = (U.diffDays(t.start, t.end) + 1) * dayW;
      return { left, right: left + w, w, isMs };
    };

    const satIdx = (6 - U.fromKey(start).getDay() + 7) % 7;
    const gridStyle = [
      `width:${width}px`,
      `--dw:${dayW}px`,
      `background-size:${dayW * 7}px 100%${zoom === 'dia' ? `, ${dayW}px 100%` : ''}`,
      `background-position-x:${satIdx * dayW}px${zoom === 'dia' ? ', 0' : ''}`,
    ].join(';');

    const rows = visible.map((vr) => {
      if (vr.m) return meetRow(vr.m, vr.depth);
      const { t, depth, has } = vr;
      const isMs = t.type === 'entrega';
      const end = TaskTree.endOf(t);
      const late = !t.done && end < today;
      const g = geo(t);
      const dates = isMs ? `◆ ${U.fmtDate(t.start)}` : `${U.fmtDate(t.start)} – ${U.fmtDate(end)}`;
      const isCollapsed = has && collapsed[t.id];
      let bar;
      if (isMs) {
        bar = `<div class="g-ms${t.done ? ' done' : ''}" data-id="${t.id}" style="left:${g.left}px" title="${U.esc(t.title)}"></div>
           <div class="g-ms-label" style="left:${g.right + 6}px">${U.esc(t.title)}</div>`;
      } else if (has) {
        bar = `<div class="g-sum${t.done ? ' done' : ''}${isCollapsed ? ' collapsed' : ''}" data-id="${t.id}" style="left:${g.left}px;width:${g.w}px" title="${U.esc(t.title)} (${dates}) — arraste para mover o grupo inteiro">
             <div class="g-prog" style="width:${t.progress || 0}%"></div></div>
           <div class="g-out-label strong" style="left:${g.right + 8}px">${U.esc(t.title)} · ${t.progress || 0}%${isCollapsed ? ` · ${kidsCount[t.id].length} subtarefa(s)` : ''}</div>`;
      } else {
        bar = `<div class="g-bar${t.done ? ' done' : ''}${late ? ' late' : ''}" data-id="${t.id}" style="left:${g.left}px;width:${g.w}px" title="${U.esc(t.title)} (${dates})">
             <div class="g-prog" style="width:${t.done ? 100 : t.progress || 0}%"></div>
             ${g.w < 110 ? '' : `<span class="g-bar-label">${U.esc(t.title)}</span>`}
             <div class="g-h g-h-l"></div><div class="g-h g-h-r"></div>
           </div>${g.w < 110 ? `<div class="g-out-label" style="left:${g.right + 8}px">${U.esc(t.title)}</div>` : ''}`;
      }
      const link = `<div class="g-link" data-id="${t.id}" style="left:${g.right + 1}px" title="Arraste até outra tarefa para criar uma dependência"></div>`;
      return `<div class="g-row${has ? ' parent' : ''}" data-id="${t.id}">
        ${labelHtml(t, { depth, has, isCollapsed, late, dates })}
        <div class="g-track" style="width:${width}px">${bar}${link}</div>
      </div>`;
    }).join('');

    // Setas de dependência. Tarefas escondidas em grupos recolhidos usam a linha do grupo.
    const visibleRowOf = (t) => {
      if (rowIndex[t.id] != null) return t;
      const anc = TaskTree.ancestors(tasks, t).reverse().find((a) => rowIndex[a.id] != null && collapsed[a.id]);
      return anc || null;
    };
    const seenPairs = new Set();
    let arrows = '';
    for (const t of tasks) {
      for (const d of t.deps || []) {
        const p = byId[d];
        if (!p) continue;
        const from = visibleRowOf(p);
        const to = visibleRowOf(t);
        if (!from || !to || from.id === to.id) continue;
        const pair = `${from.id}>${to.id}`;
        if (seenPairs.has(pair)) continue;
        seenPairs.add(pair);
        const e = TaskTree.earliestStart(tasks, { deps: [p.id] }); // mesma regra do agendamento
        const bad = t.start < e;
        const gf = geo(from);
        const gt = geo(to);
        const path = depPath(gf.right, rowIndex[from.id] * ROW_H + ROW_H / 2, gt.left - 2, rowIndex[to.id] * ROW_H + ROW_H / 2);
        const tip = `${p.title} → ${t.title}${bad ? ' (conflito: começa antes da anterior terminar)' : ''} — clique para remover`;
        arrows += `<g class="g-dep${bad ? ' bad' : ''}">
          <path d="${path}" marker-end="url(#g-arr${bad ? '-bad' : ''})"/>
          <path class="g-dep-hit" d="${path}" data-action="remove-dep" data-from="${p.id}" data-to="${t.id}"><title>${U.esc(tip)}</title></path>
        </g>`;
      }
    }

    const todayLeft = (U.diffDays(start, today) + 0.5) * dayW;
    const bodyH = visible.length * ROW_H;
    host.innerHTML = `
      <div class="g-scroll" style="--c:${color}">
        <div class="g-inner" style="width:${LABEL_W + width}px">
          <div class="g-head">
            <div class="g-label g-corner">Tarefas, entregas e reuniões</div>
            <div class="g-scale" style="width:${width}px">${headerHtml(start, days, dayW, zoom)}</div>
          </div>
          <div class="g-body">
            <div class="g-grid g-grid-${zoom}" style="left:${LABEL_W}px;${gridStyle}">
              <div class="g-today" style="left:${todayLeft}px"></div>
            </div>
            ${rows}
            <svg class="g-deps" style="left:${LABEL_W}px;width:${width}px;height:${bodyH}px" width="${width}" height="${bodyH}">
              <defs>
                <marker id="g-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="g-arr-head"/></marker>
                <marker id="g-arr-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="g-arr-head bad"/></marker>
              </defs>
              ${arrows}
              <path class="g-temp" d=""/>
            </svg>
            <div class="g-row g-row-add">
              <div class="g-label">
                <button class="link-btn" data-action="new-task" data-type="tarefa">＋ Tarefa</button>
                <button class="link-btn" data-action="new-task" data-type="entrega">＋ Entrega</button>
                <button class="link-btn" data-action="new-meeting" data-project="${projectId}">＋ Reunião</button>
              </div>
              <div class="g-track" style="width:${width}px"></div>
            </div>
          </div>
        </div>
      </div>`;

    const scroller = host.querySelector('.g-scroll');
    const memKey = `${projectId}:${zoom}`;
    if (scrollMemory[memKey] != null) scroller.scrollLeft = scrollMemory[memKey];
    else scroller.scrollLeft = Math.max(0, todayLeft - 7 * dayW * (zoom === 'dia' ? 1 : 2));
    if (applyFocus(host, scroller, start, dayW, focus)) scrollMemory[memKey] = scroller.scrollLeft;
    if (scrollMemory[projectId + ':top'] != null) scroller.scrollTop = scrollMemory[projectId + ':top'];
    scroller.addEventListener('scroll', () => {
      scrollMemory[memKey] = scroller.scrollLeft;
      scrollMemory[projectId + ':top'] = scroller.scrollTop;
    });

    const body = scroller.querySelector('.g-body');
    const svg = scroller.querySelector('.g-deps');
    const temp = svg.querySelector('.g-temp');

    body.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const linkEl = e.target.closest('.g-link');
      if (linkEl) return startLink(e, linkEl);
      const mbar = e.target.closest('.g-mbar');
      if (mbar) return startMeetDrag(e, mbar);
      const bar = e.target.closest('.g-bar, .g-ms, .g-sum');
      if (bar) startDrag(e, bar);
    });

    // Criar dependência arrastando a bolinha da ponta da barra.
    function startLink(e, linkEl) {
      e.preventDefault();
      const fromId = linkEl.dataset.id;
      const fromRow = rowIndex[fromId];
      const x0 = parseFloat(linkEl.style.left) + 5;
      const y0 = fromRow * ROW_H + ROW_H / 2;
      const svgRect = () => svg.getBoundingClientRect();
      body.classList.add('linking');
      let hoverRow = null;
      const onMove = (ev) => {
        const r = svgRect();
        temp.setAttribute('d', `M${x0},${y0} L${ev.clientX - r.left},${ev.clientY - r.top}`);
        const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.g-row[data-id]');
        if (hoverRow && hoverRow !== row) hoverRow.classList.remove('link-target');
        hoverRow = row && row.dataset.id !== fromId ? row : null;
        if (hoverRow) hoverRow.classList.add('link-target');
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        body.classList.remove('linking');
        temp.setAttribute('d', '');
        if (hoverRow) { hoverRow.classList.remove('link-target'); onLink(fromId, hoverRow.dataset.id); }
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    // Arrastar reunião: o meio muda o dia (mantém o horário); as pontas ajustam o horário (15 min a cada 4 px).
    function startMeetDrag(e, el) {
      e.preventDefault();
      const m = meetById[el.dataset.meet];
      if (!m) return;
      const mode = e.target.classList.contains('g-h-l') ? 'l' : e.target.classList.contains('g-h-r') ? 'r' : 'move';
      const s0 = mStart(m), e0 = mEnd(m), x0 = e.clientX;
      let date = m.date, s = s0, en = e0, moved = false;
      const label = el.parentElement.querySelector('.g-out-label');
      const tip = document.createElement('div');
      tip.className = 'g-tip';
      document.body.appendChild(tip);
      const onMove = (ev) => {
        const dx = ev.clientX - x0;
        if (Math.abs(dx) > 3) { moved = true; el.classList.add('dragging'); }
        if (!moved) return;
        if (mode === 'move') date = U.addDays(m.date, Math.round(dx / dayW));
        else {
          const dm = Math.round(dx / 4) * 15;
          if (mode === 'l') s = Math.max(0, Math.min(e0 - 15, s0 + dm));
          else en = Math.min(1440, Math.max(s0 + 15, e0 + dm));
        }
        const g = mGeo(m, s, en, date);
        el.style.left = `${g.left}px`;
        el.style.width = `${g.w}px`;
        label.style.left = `${g.left + g.w + 8}px`;
        label.textContent = `${fromMin(s)}–${fromMin(en)} · ${m.title}`;
        tip.textContent = `${U.fmtDate(date)} · ${fromMin(s)}–${fromMin(en)}`;
        tip.style.left = `${ev.clientX + 12}px`;
        tip.style.top = `${ev.clientY + 14}px`;
        tip.style.display = 'block';
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        tip.remove();
        el.classList.remove('dragging');
        if (!moved) { onMeetEdit && onMeetEdit(m); return; }
        if (date !== m.date || s !== s0 || en !== e0) onMeetChange && onMeetChange(m, { date, start: fromMin(s), end: fromMin(en) });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    // Arrastar barras (mover / redimensionar).
    function startDrag(e, bar) {
      e.preventDefault();
      const task = byId[bar.dataset.id];
      if (!task) return;
      const isSum = bar.classList.contains('g-sum');
      const mode = !isSum && e.target.classList.contains('g-h-l') ? 'l' : !isSum && e.target.classList.contains('g-h-r') ? 'r' : 'move';
      const isMs = task.type === 'entrega';
      const x0 = e.clientX;
      const origLeft = parseFloat(bar.style.left);
      const origW = bar.offsetWidth;
      const track = bar.parentElement;
      const outLabel = track.querySelector('.g-out-label, .g-ms-label');
      const origLabelLeft = outLabel ? parseFloat(outLabel.style.left) : 0;
      const linkDot = track.querySelector('.g-link');
      const origLinkLeft = linkDot ? parseFloat(linkDot.style.left) : 0;
      let dd = 0;
      let moved = false;
      const tip = document.createElement('div');
      tip.className = 'g-tip';
      document.body.appendChild(tip);

      const newDates = () => {
        let s = task.start;
        let en = TaskTree.endOf(task);
        if (mode === 'move') { s = U.addDays(s, dd); en = U.addDays(en, dd); }
        else if (mode === 'l') { s = U.addDays(s, dd); if (s > en) s = en; }
        else { en = U.addDays(en, dd); if (en < s) en = s; }
        return { s, en };
      };
      const onMove = (ev) => {
        const dx = ev.clientX - x0;
        if (Math.abs(dx) > 3) { moved = true; bar.classList.add('dragging'); body.classList.add('dragging'); }
        if (!moved) return;
        dd = Math.round(dx / dayW);
        const { s, en } = newDates();
        let newLeft = origLeft + dd * dayW;
        let newW = origW;
        if (!isMs && mode !== 'move') {
          newLeft = U.diffDays(start, s) * dayW;
          newW = (U.diffDays(s, en) + 1) * dayW;
        }
        bar.style.left = `${newLeft}px`;
        if (!isMs) bar.style.width = `${newW}px`;
        const shiftRight = (newLeft + newW) - (origLeft + origW);
        if (outLabel) outLabel.style.left = `${origLabelLeft + shiftRight}px`;
        if (linkDot) linkDot.style.left = `${origLinkLeft + shiftRight}px`;
        tip.textContent = isMs ? U.fmtDate(s) : `${U.fmtDate(s)} – ${U.fmtDate(en)} (${U.diffDays(s, en) + 1} dias)`;
        tip.style.left = `${ev.clientX + 12}px`;
        tip.style.top = `${ev.clientY + 14}px`;
        tip.style.display = 'block';
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        tip.remove();
        bar.classList.remove('dragging');
        body.classList.remove('dragging');
        if (!moved) { onEdit(task); return; }
        if (dd === 0) {
          bar.style.left = `${origLeft}px`; bar.style.width = `${origW}px`;
          if (outLabel) outLabel.style.left = `${origLabelLeft}px`;
          if (linkDot) linkDot.style.left = `${origLinkLeft}px`;
          return;
        }
        const { s, en } = newDates();
        onChange(task, { start: s, end: isMs ? s : en });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
  }

  // Coluna da esquerda de uma tarefa (usada também na visão Horas): concluir, grupo, prioridade, tags, link, ＋ subtarefa.
  function labelHtml(t, { depth = 0, has = false, isCollapsed = false, late = false, dates = '' } = {}) {
    const isMs = t.type === 'entrega';
    return `<div class="g-label" style="padding-left:${10 + depth * 18}px">
      ${has
        ? `<button class="g-caret${isCollapsed ? ' closed' : ''}" data-action="gantt-collapse" data-id="${t.id}" title="${isCollapsed ? 'Expandir' : 'Recolher'}">▾</button>`
        : '<span class="g-caret-sp"></span>'}
      <input type="checkbox" data-action="toggle-done" data-id="${t.id}" ${t.done ? 'checked' : ''} title="Concluída">
      <button class="g-title${t.done ? ' done' : ''}" data-action="edit-task" data-id="${t.id}" title="${U.esc(t.title)}${(t.tags || []).length ? ' · #' + t.tags.map(U.esc).join(' #') : ''}">${t.priority === 'alta' ? '<span class="prio p-alta">⚑</span> ' : ''}${isMs ? '<span class="ms-icon">◆</span>' : ''}${U.esc(t.title)}${(t.tags || []).length ? `<span class="g-tagdots">${t.tags.slice(0, 3).map((tg) => `<i style="background:${tagColor(tg)}"></i>`).join('')}</span>` : ''}</button>
      ${(t.links || []).length ? `<button class="link-ic" data-action="open-task-link" data-id="${t.id}" title="${t.links.length === 1 ? 'Abrir link' : t.links.length + ' links'}">🔗</button>` : ''}
      ${!isMs ? `<button class="g-add" data-action="new-subtask" data-id="${t.id}" title="Adicionar subtarefa">＋</button>` : ''}
      <button class="g-add g-addm" data-action="new-meeting" data-task="${t.id}" title="Adicionar reunião ${isMs ? 'para esta entrega' : 'para esta tarefa'}">◷</button>
      <span class="g-dates${late ? ' late' : ''}">${dates}</span>
    </div>`;
  }

  // Cronograma geral: uma linha por projeto (barra do início ao fim + entregas),
  // que pode ser expandida para mostrar as tarefas principais. Só visualização.
  function renderOverview(host, { projects, tasks, meetings = [], zoom, expanded, projectInfo, focus, level }) {
    const dayW = widthOf(zoom, level, 'semana');
    const { start, days } = range([...tasks, ...meetDates(meetings)], zoom);
    const width = days * dayW;
    const today = U.todayKey();
    const xOf = (k) => U.diffDays(start, k) * dayW;
    const satIdx = (6 - U.fromKey(start).getDay() + 7) % 7;
    const gridStyle = [
      `width:${width}px`, `--dw:${dayW}px`,
      `background-size:${dayW * 7}px 100%${zoom === 'dia' ? `, ${dayW}px 100%` : ''}`,
      `background-position-x:${satIdx * dayW}px${zoom === 'dia' ? ', 0' : ''}`,
    ].join(';');

    const msHtml = (t, color, small) => {
      const x = xOf(t.start) + dayW / 2;
      return `<button class="ov-ms${small ? ' small' : ''}${t.done ? ' done' : ''}" style="left:${x - (small ? 6 : 8)}px;--c:${color}" data-action="edit-task" data-id="${t.id}" title="◆ ${U.esc(t.title)} — ${U.fmtDate(t.start)}"></button>`;
    };

    let rows = '';
    for (const p of projects) {
      const info = projectInfo(p);
      const pts = tasks.filter((t) => t.projectId === p.id);
      const isOpen = !!expanded[p.id];
      const late = pts.filter((t) => !t.done && !info.isGroup(t) && TaskTree.endOf(t) < today).length;
      let bar = '';
      if (pts.length) {
        const s = pts.reduce((m, t) => (t.start < m ? t.start : m), pts[0].start);
        const e = pts.reduce((m, t) => (TaskTree.endOf(t) > m ? TaskTree.endOf(t) : m), TaskTree.endOf(pts[0]));
        const left = xOf(s);
        const w = (U.diffDays(s, e) + 1) * dayW;
        bar = `<button class="ov-bar${p.status !== 'ativo' ? ' muted-bar' : ''}" style="left:${left}px;width:${w}px;--c:${p.color}" data-action="open-project-gantt" data-id="${p.id}"
                 title="${U.esc(p.name)}: ${U.fmtDate(s)} – ${U.fmtDate(e)} · ${info.progress ?? 0}% — clique para abrir o cronograma">
                 <span class="ov-prog" style="width:${info.progress || 0}%"></span>
               </button>
               ${pts.filter((t) => t.type === 'entrega').map((t) => msHtml(t, p.color, false)).join('')}
               <span class="ov-label" style="left:${left + w + 10}px">${U.esc(p.name)}</span>`;
      }
      rows += `<div class="g-row ov-proj">
        <div class="g-label">
          ${pts.length ? `<button class="g-caret${isOpen ? '' : ' closed'}" data-action="ov-toggle" data-id="${p.id}" title="${isOpen ? 'Recolher' : 'Ver tarefas'}">▾</button>` : '<span class="g-caret-sp"></span>'}
          <span class="dot" style="background:${p.color}"></span>
          <button class="g-title ov-name" data-action="open-project-gantt" data-id="${p.id}">${U.esc(p.name)}${p.client ? `<small>${U.esc(p.client)}</small>` : ''}</button>
          ${p.status === 'pausado' ? '<span class="pi-badge">pausado</span>' : p.status === 'concluido' ? '<span class="pi-badge">concluído</span>' : ''}
          ${late ? `<span class="ov-late" title="${late} tarefa(s) atrasada(s)">${late}</span>` : ''}
          <span class="g-dates">${info.progress == null ? '—' : info.progress + '%'}</span>
        </div>
        <div class="g-track" style="width:${width}px">${bar}${meetings.filter((m) => m.projectId === p.id).map((m) => meetMark(m, xOf(m.date) + dayW / 2, true)).join('')}</div>
      </div>`;

      if (isOpen) {
        const top = TaskTree.ordered(pts).filter((r) => r.depth === 0).map((r) => r.t);
        for (const t of top) {
          const isMs = t.type === 'entrega';
          const lateT = !t.done && TaskTree.endOf(t) < today;
          let tb;
          if (isMs) tb = msHtml(t, p.color, true) + `<span class="ov-label small" style="left:${xOf(t.start) + dayW / 2 + 10}px">${U.esc(t.title)}</span>`;
          else {
            const left = xOf(t.start);
            const w = (U.diffDays(t.start, t.end) + 1) * dayW;
            tb = `<button class="ov-task${info.isGroup(t) ? ' group' : ''}${t.done ? ' done' : ''}${lateT ? ' late' : ''}" style="left:${left}px;width:${w}px;--c:${p.color}" data-action="edit-task" data-id="${t.id}" title="${U.esc(t.title)} (${U.fmtDate(t.start)} – ${U.fmtDate(t.end)})">
                  <span class="ov-prog" style="width:${t.done ? 100 : t.progress || 0}%"></span></button>
                  <span class="ov-label small" style="left:${left + w + 8}px">${U.esc(t.title)}</span>`;
          }
          rows += `<div class="g-row ov-sub">
            <div class="g-label" style="padding-left:52px">
              <button class="g-title${t.done ? ' done' : ''}" data-action="edit-task" data-id="${t.id}">${isMs ? '<span class="ms-icon" style="--c:' + p.color + '">◆</span>' : ''}${U.esc(t.title)}</button>
              <span class="g-dates${lateT ? ' late' : ''}">${isMs ? '◆ ' + U.fmtDate(t.start) : U.fmtDate(t.start) + ' – ' + U.fmtDate(t.end)}</span>
            </div>
            <div class="g-track" style="width:${width}px">${tb}</div>
          </div>`;
        }
      }
    }

    const todayLeft = (U.diffDays(start, today) + 0.5) * dayW;
    host.innerHTML = `
      <div class="g-scroll ov">
        <div class="g-inner" style="width:${LABEL_W + width}px">
          <div class="g-head">
            <div class="g-label g-corner">Projetos</div>
            <div class="g-scale" style="width:${width}px">${headerHtml(start, days, dayW, zoom)}</div>
          </div>
          <div class="g-body">
            <div class="g-grid g-grid-${zoom}" style="left:${LABEL_W}px;${gridStyle}">
              <div class="g-today" style="left:${todayLeft}px"></div>
            </div>
            ${rows}
          </div>
        </div>
      </div>`;
    const scroller = host.querySelector('.g-scroll');
    // A posição salva depende do início do cronograma (que muda com o filtro de projetos).
    host.dataset.memId = `__overview@${start}`;
    const memKey = `${host.dataset.memId}:${zoom}`;
    scroller.scrollLeft = scrollMemory[memKey] ?? Math.max(0, todayLeft - 10 * dayW * (zoom === 'dia' ? 1 : 2));
    if (applyFocus(host, scroller, start, dayW, focus)) scrollMemory[memKey] = scroller.scrollLeft;
    scroller.addEventListener('scroll', () => { scrollMemory[memKey] = scroller.scrollLeft; });
  }

  function scrollToToday(host, projectId, zoom) {
    const sc = host.querySelector('.g-scroll');
    const line = host.querySelector('.g-today');
    if (!sc || !line) return;
    const left = parseFloat(line.style.left) - 200;
    sc.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    scrollMemory[`${projectId}:${zoom}`] = Math.max(0, left);
  }

  return { render, renderOverview, scrollToToday, labelHtml, ZOOMS, LEVELS };
})();
