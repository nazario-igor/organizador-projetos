// Calendário mensal com tarefas de vários dias desenhadas como barras contínuas.
const Calendar = (() => {
  const LANE_H = 22;
  const TOP = 30;

  function weeksOfMonth(monthKey) {
    const first = U.fromKey(monthKey);
    const startKey = U.addDays(monthKey, -first.getDay()); // domingo antes do dia 1
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const endKey = U.addDays(U.toKey(last), 6 - last.getDay());
    const weeks = [];
    for (let k = startKey; k <= endKey; k = U.addDays(k, 7)) weeks.push(k);
    return weeks;
  }

  function render(host, { monthKey, items, hoursByDay }) {
    const month = U.fromKey(monthKey).getMonth();
    const today = U.todayKey();
    const weeks = weeksOfMonth(monthKey);

    const head = U.DIAS.map((d) => `<div>${d}</div>`).join('');
    const body = weeks.map((wStart) => {
      const wEnd = U.addDays(wStart, 6);
      const inWeek = items
        .filter((it) => it.start <= wEnd && it.end >= wStart)
        .sort((a, b) => a.start.localeCompare(b.start) || U.diffDays(b.start, b.end) - U.diffDays(a.start, a.end));
      const lanes = [];
      const bars = inWeek.map((it) => {
        const c0 = Math.max(0, U.diffDays(wStart, it.start));
        const c1 = Math.min(6, U.diffDays(wStart, it.end));
        let lane = lanes.findIndex((lastCol) => lastCol < c0);
        if (lane === -1) { lane = lanes.length; lanes.push(c1); } else lanes[lane] = c1;
        const contL = it.start < wStart;
        const contR = it.end > wEnd;
        const cls = ['c-ev', it.type === 'entrega' ? 'ms' : '', it.type === 'reuniao' ? 'mt' : '', it.done ? 'done' : '', it.late ? 'late' : '', contL ? 'cont-l' : '', contR ? 'cont-r' : ''].join(' ');
        const tip = it.type === 'reuniao'
          ? `${it.project ? it.project + ' — ' : ''}Reunião ${U.fmtDate(it.start)}, ${it.time}: ${it.title.replace(/^\S+ /, '')}`
          : `${it.project ? it.project + ' — ' : ''}${it.title}${it.type === 'entrega' ? ' (entrega ' + U.fmtDate(it.start) + ')' : ' (' + U.fmtDate(it.start) + ' – ' + U.fmtDate(it.end) + ')'}`;
        return `<button class="${cls}" data-action="${it.action || 'edit-task'}" data-id="${it.id}" title="${U.esc(tip)}"
          style="--c:${it.color};left:calc(${c0} * 100% / 7 + 3px);width:calc(${c1 - c0 + 1} * 100% / 7 - 6px);top:${TOP + lane * LANE_H}px">
          ${it.type === 'entrega' ? '◆ ' : it.type === 'reuniao' ? '◷ ' : ''}${U.esc(it.title)}</button>`;
      }).join('');
      const height = Math.max(112, TOP + lanes.length * LANE_H + 12);
      const days = [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const k = U.addDays(wStart, i);
        const d = U.fromKey(k);
        const h = hoursByDay[k];
        return `<div class="c-day${d.getMonth() !== month ? ' other' : ''}${k === today ? ' today' : ''}${i === 0 || i === 6 ? ' wk' : ''}" data-action="cal-day" data-date="${k}">
          <span class="c-num">${d.getDate()}</span>${h ? `<span class="c-hours" title="Horas registradas">⏱ ${U.dur(h)}</span>` : ''}
        </div>`;
      }).join('');
      return `<div class="c-week" style="height:${height}px"><div class="c-days">${days}</div><div class="c-events">${bars}</div></div>`;
    }).join('');

    host.innerHTML = `<div class="cal"><div class="c-head">${head}</div>${body}</div>`;
  }

  return { render };
})();
