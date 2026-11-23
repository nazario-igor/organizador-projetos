// Hierarquia (subtarefas) e dependências entre tarefas.
// - parentId: a tarefa é subtarefa de outra. A tarefa-mãe tem datas e progresso calculados.
// - deps: lista de ids das tarefas que precisam terminar antes desta começar.
const TaskTree = (() => {
  const endOf = (t) => (t.type === 'entrega' ? t.start : t.end);

  function childrenMap(tasks) {
    const ids = new Set(tasks.map((t) => t.id));
    const map = {};
    for (const t of tasks) if (t.parentId && ids.has(t.parentId)) (map[t.parentId] ||= []).push(t);
    return map;
  }
  const hasChildren = (tasks, id) => tasks.some((t) => t.parentId === id);

  function descendants(tasks, id) {
    const kids = childrenMap(tasks);
    const out = [];
    const seen = new Set([id]);
    const walk = (pid) => (kids[pid] || []).forEach((c) => { if (!seen.has(c.id)) { seen.add(c.id); out.push(c); walk(c.id); } });
    walk(id);
    return out;
  }
  function ancestors(tasks, t) {
    const byId = Object.fromEntries(tasks.map((x) => [x.id, x]));
    const out = [];
    const seen = new Set([t.id]);
    let p = byId[t.parentId];
    while (p && !seen.has(p.id)) { out.push(p); seen.add(p.id); p = byId[p.parentId]; }
    return out;
  }

  // Corrige referências quebradas (mãe inexistente, ciclos, dependências apagadas).
  function normalize(tasks) {
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    for (const t of tasks) {
      if (t.parentId && (!byId[t.parentId] || byId[t.parentId].projectId !== t.projectId || byId[t.parentId].type === 'entrega')) t.parentId = null;
      const anc = new Set();
      let p = t.parentId ? byId[t.parentId] : null;
      while (p) {
        if (p.id === t.id || anc.has(p.id)) { t.parentId = null; break; }
        anc.add(p.id);
        p = p.parentId ? byId[p.parentId] : null;
      }
      t.deps = [...new Set((t.deps || []).filter((d) => d !== t.id && byId[d] && byId[d].projectId === t.projectId))];
    }
  }

  // Calcula datas, progresso e conclusão das tarefas-mãe a partir das subtarefas.
  function rollup(tasks) {
    const kids = childrenMap(tasks);
    const done = new Set();
    const visit = (t) => {
      if (done.has(t.id)) return;
      done.add(t.id);
      const ch = kids[t.id];
      if (!ch || !ch.length) return;
      ch.forEach(visit);
      t.type = 'tarefa';
      t.start = ch.reduce((m, c) => (c.start < m ? c.start : m), ch[0].start);
      t.end = ch.reduce((m, c) => (endOf(c) > m ? endOf(c) : m), endOf(ch[0]));
      let w = 0;
      let tot = 0;
      for (const c of ch) {
        const d = U.diffDays(c.start, endOf(c)) + 1;
        w += d;
        tot += d * (c.done ? 100 : +c.progress || 0);
      }
      t.progress = Math.round(tot / Math.max(1, w));
      t.done = ch.every((c) => c.done);
    };
    tasks.forEach(visit);
  }

  function shift(tasks, t, days) {
    if (!days) return;
    const group = [t, ...descendants(tasks, t.id)];
    for (const x of group) {
      x.start = U.addDays(x.start, days);
      x.end = U.addDays(x.type === 'entrega' ? x.start : x.end, x.type === 'entrega' ? 0 : days);
      if (x.type === 'entrega') x.end = x.start;
    }
  }

  // Data mínima de início de uma tarefa segundo suas dependências.
  function earliestStart(tasks, t) {
    const byId = Object.fromEntries(tasks.map((x) => [x.id, x]));
    let earliest = null;
    for (const d of t.deps || []) {
      const p = byId[d];
      if (!p) continue;
      const e = p.type === 'entrega' ? p.start : U.addDays(endOf(p), 1);
      if (!earliest || e > earliest) earliest = e;
    }
    return earliest;
  }

  // Empurra para frente as tarefas que começariam antes de suas dependências terminarem.
  function schedule(tasks) {
    for (let pass = 0; pass < 60; pass++) {
      rollup(tasks);
      let changed = false;
      for (const t of tasks) {
        if (!t.deps || !t.deps.length) continue;
        const e = earliestStart(tasks, t);
        if (e && t.start < e) { shift(tasks, t, U.diffDays(t.start, e)); changed = true; }
      }
      if (!changed) return;
    }
    rollup(tasks);
  }

  // Mover uma tarefa no Gantt: se for mãe, leva as subtarefas junto.
  function move(tasks, t, start, end) {
    if (hasChildren(tasks, t.id)) shift(tasks, t, U.diffDays(t.start, start));
    else { t.start = start; t.end = t.type === 'entrega' ? start : end; }
  }

  // Pode "to" depender de "from"? Retorna null se pode, ou o motivo se não pode.
  function linkProblem(tasks, fromId, toId) {
    if (fromId === toId) return 'Uma tarefa não pode depender dela mesma.';
    const byId = Object.fromEntries(tasks.map((x) => [x.id, x]));
    const from = byId[fromId];
    const to = byId[toId];
    if (!from || !to) return 'Tarefa não encontrada.';
    if (from.projectId !== to.projectId) return 'As tarefas precisam ser do mesmo projeto.';
    if ((to.deps || []).includes(fromId)) return 'Essa dependência já existe.';
    if (ancestors(tasks, to).some((a) => a.id === fromId) || ancestors(tasks, from).some((a) => a.id === toId)) {
      return 'Não dá para ligar uma tarefa à sua própria tarefa-mãe ou subtarefa.';
    }
    // Ciclo: "from" já espera (direta ou indiretamente) por "to"? Considera os grupos:
    // uma tarefa espera pelas dependências das suas mães, e um grupo pelas das subtarefas.
    const related = new Set([toId, ...ancestors(tasks, to).map((a) => a.id), ...descendants(tasks, toId).map((d) => d.id)]);
    const seen = new Set();
    const stack = [fromId];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      if (related.has(id)) return 'Isso criaria um ciclo (uma tarefa esperando pela outra).';
      const x = byId[id];
      if (!x) continue;
      stack.push(...(x.deps || []));
      for (const a of ancestors(tasks, x)) stack.push(...(a.deps || []));
      for (const d of descendants(tasks, id)) stack.push(d.id);
    }
    return null;
  }

  // Lista em ordem de exibição (mãe seguida das subtarefas), com profundidade.
  function ordered(tasks, collapsed = {}) {
    const kids = childrenMap(tasks);
    const ids = new Set(tasks.map((t) => t.id));
    const cmp = (a, b) => a.start.localeCompare(b.start) || endOf(a).localeCompare(endOf(b)) || a.title.localeCompare(b.title);
    const out = [];
    const walk = (list, depth, hiddenBy) => {
      list.slice().sort(cmp).forEach((t) => {
        const has = !!(kids[t.id] && kids[t.id].length);
        out.push({ t, depth, has, hiddenBy });
        if (has) walk(kids[t.id], depth + 1, hiddenBy || (collapsed[t.id] ? t.id : null));
      });
    };
    walk(tasks.filter((t) => !t.parentId || !ids.has(t.parentId)), 0, null);
    return out;
  }

  return { endOf, childrenMap, hasChildren, descendants, ancestors, normalize, rollup, schedule, move, shift, earliestStart, linkProblem, ordered };
})();
