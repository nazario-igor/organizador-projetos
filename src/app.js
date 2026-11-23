// Interface principal do Organizador de Projetos.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let S = null; // estado completo (projetos, tarefas, anotações, horas, timer)
let BASE = null; // base de dados aberta: { id, name }

// ---------- Preferências de tela (ficam só neste Mac) ----------
const prefs = (() => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('prefs') || '{}'); } catch { p = {}; }
  return p;
})();
const savePrefs = () => { try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch { /* ignora */ } };
let view = prefs.view || { name: 'dashboard' };
prefs.zoom ||= 'dia';
prefs.tabs ||= {};
prefs.notes ||= {};
prefs.collapsed ||= {};

// ---------- Persistência ----------
let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(flush, 250); }
async function flush() { clearTimeout(saveT); saveT = null; await api.setState(S, BASE?.id); }
// Recalcula grupos (subtarefas) e, se ligado, empurra tarefas dependentes.
function scheduleTasks() {
  TaskTree.normalize(S.tasks);
  if (prefs.autoSchedule !== false) TaskTree.schedule(S.tasks); else TaskTree.rollup(S.tasks);
  refreshGroups();
}
function commit() { scheduleTasks(); save(); render(); }

// Ids das tarefas que têm subtarefas (recalculado a cada alteração, em vez de procurar a cada consulta).
let GROUP_IDS = new Set();
const refreshGroups = () => { GROUP_IDS = new Set(S.tasks.map((t) => t.parentId).filter(Boolean)); };
const isGroup = (t) => GROUP_IDS.has(t.id);

// Cores e logo vindos de um arquivo editado por fora (ou backup importado) são validados antes de ir para a tela.
const safeColor = (c, fallback = '#6e6e80') => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : fallback);
function sanitizeState() {
  for (const p of S.projects) p.color = safeColor(p.color, U.CORES[0]);
  for (const meta of Object.values(S.tagMeta || {})) if (meta && meta.color) meta.color = safeColor(meta.color);
  if (S.profile) {
    if (S.profile.color) S.profile.color = safeColor(S.profile.color, '#5b6cff');
    if (S.profile.logo && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(S.profile.logo)) S.profile.logo = '';
  }
}
// Ao carregar (abrir o app, importar backup, sincronizar do outro Mac): valida e conserta antes de desenhar.
function prepareState() {
  if (!Array.isArray(S.meetings)) S.meetings = [];
  S.meetings = S.meetings.filter((m) => m && m.id && /^\d{4}-\d{2}-\d{2}$/.test(m.date || '') && /^\d{2}:\d{2}$/.test(m.start || ''));
  sanitizeState();
  if (syncMeetingEntries()) save();
  TaskTree.normalize(S.tasks);
  TaskTree.repairDeps(S.tasks);
  TaskTree.rollup(S.tasks);
  refreshGroups();
}

// ---------- Consultas ----------
const proj = (id) => S.projects.find((p) => p.id === id);
const task = (id) => S.tasks.find((t) => t.id === id);
const taskEnd = (t) => (t.type === 'entrega' ? t.start : t.end);
const liveProjects = () => S.projects.filter((p) => !p.archived); // arquivados ficam fora das telas do dia a dia

// ---------- Reuniões ----------
// { id, projectId, title, date 'AAAA-MM-DD', start 'HH:MM', end 'HH:MM', link, location, participants, notes,
//   remind (minutos antes; 0 = sem lembrete), logHours (lança as horas no projeto quando terminar), entryId }
const meeting = (id) => (S.meetings || []).find((m) => m.id === id);
const meetStart = (m) => new Date(`${m.date}T${m.start}:00`);
function meetEnd(m) {
  const e = new Date(`${m.date}T${m.end || m.start}:00`);
  if (e <= meetStart(m)) e.setTime(meetStart(m).getTime() + (m.end && m.end !== m.start ? 86400000 : 3600000)); // passou da meia-noite / sem fim: 1 h
  return e;
}
const meetTime = (m) => `${m.start}${m.end ? '–' + m.end : ''}`;
// Reuniões dos projetos que aparecem no dia a dia (não arquivados nem concluídos).
const liveMeetings = () => (S.meetings || []).filter((m) => { const p = proj(m.projectId); return p && !p.archived && p.status !== 'concluido'; });
const byMeetTime = (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start);

// Reuniões com "lançar horas": quando terminam, viram um registro de horas no projeto (e acompanham as edições).
function syncMeetingEntries() {
  let changed = false;
  const now = Date.now();
  for (const m of S.meetings || []) {
    const e = m.entryId ? S.timeEntries.find((x) => x.id === m.entryId) : null;
    if (m.entryId && !e) { delete m.entryId; m.logHours = false; changed = true; continue; } // registro apagado em Horas
    const want = m.logHours && proj(m.projectId) && meetEnd(m).getTime() <= now;
    if (!want) {
      if (e) { S.timeEntries = S.timeEntries.filter((x) => x !== e); delete m.entryId; changed = true; }
      continue;
    }
    const data = { projectId: m.projectId, start: meetStart(m).toISOString(), end: meetEnd(m).toISOString() };
    if (!e) {
      const id = U.uid();
      S.timeEntries.push({ id, taskId: null, description: `Reunião: ${m.title}`, meetingId: m.id, ...data });
      m.entryId = id;
      changed = true;
    } else if (e.start !== data.start || e.end !== data.end || e.projectId !== data.projectId) {
      Object.assign(e, data);
      changed = true;
    }
  }
  return changed;
}

function meetingWhen(m) {
  const today = U.todayKey();
  const day = m.date === today ? 'hoje' : m.date === U.addDays(today, 1) ? 'amanhã' : U.fmtDate(m.date);
  return `${day} ${meetTime(m)}`;
}
function meetingLine(m, { showProject = true } = {}) {
  const p = proj(m.projectId);
  const past = meetEnd(m).getTime() < Date.now();
  return `<div class="task-line meet-line${past ? ' done' : ''}">
    <span class="meet-ic" title="Reunião">◷</span>
    <button class="tl-title" data-action="edit-meeting" data-id="${m.id}">${U.esc(m.title)}</button>
    ${m.link && !past ? `<button class="meet-join" data-action="meeting-join" data-id="${m.id}" title="Entrar: ${U.esc(m.link)}">Entrar ↗</button>` : ''}
    ${showProject && p ? `<button class="tag" style="--c:${p.color}" data-action="open-project" data-id="${p.id}">${U.esc(p.name)}</button>` : ''}
    <span class="tl-when">${meetingWhen(m)}</span>
  </div>`;
}
const visibleProjects = () => liveProjects().filter((p) => prefs.showArchived || p.status !== 'concluido');
const activeProjects = () => liveProjects().filter((p) => p.status !== 'concluido');

function allEntries() {
  const list = S.timeEntries.slice();
  if (S.timer.running) {
    list.push({ id: '__run', running: true, projectId: S.timer.projectId, taskId: S.timer.taskId, description: S.timer.description, start: S.timer.startedAt, end: new Date().toISOString() });
  }
  return list;
}
const entryMs = (e) => new Date(e.end) - new Date(e.start);
function msInRange(e, from, to) {
  const a = Math.max(+new Date(e.start), from ? +from : -Infinity);
  const b = Math.min(+new Date(e.end), to ? +to : Infinity);
  return Math.max(0, b - a);
}
function periodRange(p) {
  const n = new Date();
  const d0 = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const add = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
  switch (p) {
    case 'hoje': return [d0, add(d0, 1)];
    case 'semana': { const s = add(d0, -((d0.getDay() + 6) % 7)); return [s, add(s, 7)]; }
    case 'semanapassada': { const s = add(d0, -((d0.getDay() + 6) % 7) - 7); return [s, add(s, 7)]; }
    case 'mes': return [new Date(n.getFullYear(), n.getMonth(), 1), new Date(n.getFullYear(), n.getMonth() + 1, 1)];
    case 'mespassado': return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 1)];
    case 'custom': {
      const f = prefs.hFrom ? U.fromKey(prefs.hFrom) : null;
      const t = prefs.hTo ? add(U.fromKey(prefs.hTo), 1) : null;
      return [f, t];
    }
    default: return [null, null];
  }
}
function projectProgress(pid) {
  const ts = S.tasks.filter((t) => t.projectId === pid && !isGroup(t));
  if (!ts.length) return null;
  return Math.round(ts.reduce((a, t) => a + (t.done ? 100 : +t.progress || 0), 0) / ts.length);
}
function projectHours(pid, from, to) {
  return allEntries().filter((e) => !pid || e.projectId === pid).reduce((a, e) => a + msInRange(e, from, to), 0);
}

// ---------- Navegação ----------
function go(v) {
  view = v;
  if (v.name === 'project' && v.tab) prefs.tabs[v.projectId] = v.tab;
  prefs.view = view;
  savePrefs();
  render(true);
}

// ---------- Renderização ----------
let lastViewKey = '';
function render(navigated = false) {
  if (view.name === 'project' && !proj(view.projectId)) view = { name: 'dashboard' };
  const key = JSON.stringify(view);
  const content = $('#content');
  const keepScroll = !navigated && key === lastViewKey ? content.scrollTop : 0;
  lastViewKey = key;
  renderSidebar();
  renderTitle();
  renderTimer(true);
  renderContent();
  content.scrollTop = keepScroll;
}

function renderBaseSwitch() {
  const el = $('#baseSwitch');
  if (!el || !BASE) return;
  el.innerHTML = `<button class="base-btn" data-action="bases-open" title="Trocar de base de dados">
    <span class="base-ic">◫</span><span class="base-name">${U.esc(BASE.name)}</span><span class="base-caret">▾</span></button>`;
}

function renderSidebar() {
  renderBaseSwitch();
  const nav = [
    ['dashboard', '◧', 'Painel'],
    ['timeline', '☰', 'Cronograma geral'],
    ['calendar', '▦', 'Calendário'],
    ['hours', '⏱', 'Horas'],
    ['tags', '#', 'Tags'],
  ];
  $('#projectsLink').classList.toggle('active', view.name === 'projects');
  $('#mainNav').innerHTML = nav.map(([id, ic, label]) =>
    `<button class="nav-item${view.name === id ? ' active' : ''}" data-action="nav" data-view="${id}"><span class="nav-ic">${ic}</span>${label}</button>`).join('');

  const list = visibleProjects().slice().sort((a, b) => (a.status === 'concluido') - (b.status === 'concluido') || a.name.localeCompare(b.name));
  $('#projectList').innerHTML = list.length ? list.map((p) => {
    const rec = S.timer.running && S.timer.projectId === p.id;
    return `<button class="project-item${view.name === 'project' && view.projectId === p.id ? ' active' : ''}${p.status === 'concluido' ? ' archived' : ''}" data-action="open-project" data-id="${p.id}">
      <span class="dot" style="background:${p.color}"></span>
      <span class="pi-text"><span class="pi-name">${U.esc(p.name)}</span>${p.client ? `<span class="pi-client">${U.esc(p.client)}</span>` : ''}</span>
      ${rec ? '<span class="rec-dot" title="Gravando horas"></span>' : p.status === 'pausado' ? '<span class="pi-badge">pausado</span>' : ''}
    </button>`;
  }).join('') : '<p class="muted small pad">Nenhum projeto ainda.</p>';
  const archivedCount = liveProjects().filter((p) => p.status === 'concluido').length;
  const btn = $('#btnArchived');
  btn.textContent = prefs.showArchived ? 'Ocultar concluídos' : `Mostrar concluídos${archivedCount ? ` (${archivedCount})` : ''}`;
  btn.style.display = archivedCount || prefs.showArchived ? '' : 'none';
}

function renderTitle() {
  const el = $('#viewTitle');
  if (view.name === 'project') {
    const p = proj(view.projectId);
    el.innerHTML = `<span class="dot big" style="background:${p.color}"></span><h1>${U.esc(p.name)}</h1>
      ${p.client ? `<span class="muted">${U.esc(p.client)}</span>` : ''}
      <button class="icon-btn" data-action="edit-project" title="Editar projeto">✎</button>
      ${p.archived ? `<span class="pi-badge">arquivado</span><button class="link-btn" data-action="adm-unarchive" data-id="${p.id}">Desarquivar</button>` : ''}`;
  } else {
    el.innerHTML = `<h1>${{ dashboard: 'Painel', projects: 'Projetos', timeline: 'Cronograma geral', calendar: 'Calendário', hours: 'Horas trabalhadas', tags: 'Tags', profile: 'Perfil' }[view.name]}</h1>`;
  }
}

function renderTimer(force = false) {
  const box = $('#timerBox');
  const t = S.timer;
  const running = t.running;
  const focused = box.contains(document.activeElement);
  const clockEl = $('.timer-clock', box);
  if (focused && !force) return updateClock();
  if (focused && clockEl && box.dataset.running === String(running)) return updateClock();

  const projects = activeProjects();
  const pid = t.projectId && proj(t.projectId) ? t.projectId : (view.name === 'project' ? view.projectId : projects[0]?.id);
  const tasks = S.tasks.filter((x) => x.projectId === pid && (!x.done || x.id === t.taskId));
  box.dataset.running = String(running);
  box.className = running ? 'running' : 'idle';
  box.innerHTML = `
    ${running ? '<span class="pulse"></span>' : ''}
    <select data-bind="timer-project" title="Projeto" ${projects.length ? '' : 'disabled'}>
      ${projects.length ? projects.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${U.esc(p.name)}</option>`).join('') : '<option>Crie um projeto</option>'}
    </select>
    <select data-bind="timer-task" title="Tarefa (opcional)">
      <option value="">Sem tarefa</option>
      ${tasks.map((x) => `<option value="${x.id}" ${x.id === t.taskId ? 'selected' : ''}>${U.esc(x.title)}</option>`).join('')}
    </select>
    <input data-bind="timer-desc" placeholder="No que você está trabalhando?" value="${U.esc(t.description || '')}">
    <span class="timer-clock">${running ? U.clock(Date.now() - new Date(t.startedAt)) : '00:00:00'}</span>
    ${running
      ? '<button class="btn-pause" data-action="timer-pause" title="Pausar (salva o tempo)">❚❚ Pausar</button>'
      : `<button class="btn-rec" data-action="timer-start" ${projects.length ? '' : 'disabled'} title="Começar a contar horas"><span class="rec-circle"></span>Rec</button>`}
  `;
}
function updateClock() {
  const el = $('#timerBox .timer-clock');
  if (el && S.timer.running) el.textContent = U.clock(Date.now() - new Date(S.timer.startedAt));
}

function renderContent() {
  const c = $('#content');
  c.className = '';
  if (view.name === 'dashboard') return renderDashboard(c);
  if (view.name === 'projects') return renderProjectsAdmin(c);
  if (view.name === 'tags') return renderTagsAdmin(c);
  if (view.name === 'profile') return renderProfile(c);
  if (view.name === 'timeline') return renderTimeline(c);
  if (view.name === 'calendar') return renderCalendar(c);
  if (view.name === 'hours') return renderHours(c, null);
  if (view.name === 'project') return renderProject(c);
}

// ---------- Tags, prioridade e foco ----------
const PRIOS = [['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']];
const PRIO_W = { alta: 0, media: 1, baixa: 3 };
const prioW = (t) => PRIO_W[t.priority] ?? 2;
const allTags = () => [...new Set([...S.tasks.flatMap((t) => t.tags || []), ...Object.keys(S.tagMeta || {})])].sort((a, b) => a.localeCompare(b));
function tagColor(tag) {
  const custom = S.tagMeta?.[tag]?.color;
  if (custom) return custom;
  let h = 0;
  for (const ch of tag.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return U.CORES[h % U.CORES.length];
}
const tagChip = (tag, extra = '') => `<span class="tchip" style="--c:${tagColor(tag)}" ${extra}>#${U.esc(tag)}</span>`;
const prioFlag = (t) => (t.priority ? `<span class="prio p-${t.priority}" title="Prioridade ${PRIOS.find((x) => x[0] === t.priority)?.[1]}">⚑</span>` : '');
const isFocus = (t) => t.focusDate === U.todayKey();

// ---------- Links (Drive, Docs, Figma, pastas do Mac…) ----------
const isLocalPath = (u) => /^(\/|~\/|file:)/i.test(u);
function linkInfo(url) {
  const u = String(url || '');
  if (isLocalPath(u)) {
    const name = decodeURIComponent(u.replace(/^file:\/\//i, '')).replace(/\/+$/, '').split('/').pop() || u;
    return { icon: /\.[a-z0-9]{2,5}$/i.test(name) ? '📄' : '📁', kind: 'No Mac', name };
  }
  let host = '';
  try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { return { icon: '🔗', kind: 'Link', name: u }; }
  const rules = [
    [/drive\.google\.com\/drive\/(u\/\d+\/)?folders/, '📁', 'Pasta do Drive'],
    [/drive\.google\.com/, '📄', 'Arquivo do Drive'],
    [/docs\.google\.com\/document/, '📝', 'Google Docs'],
    [/docs\.google\.com\/spreadsheets/, '📊', 'Google Planilhas'],
    [/docs\.google\.com\/presentation/, '📽', 'Google Apresentações'],
    [/docs\.google\.com\/forms|forms\.gle/, '📋', 'Google Forms'],
    [/figma\.com/, '🎨', 'Figma'],
    [/canva\.com/, '🎨', 'Canva'],
    [/dropbox\.com/, '📦', 'Dropbox'],
    [/onedrive|sharepoint\.com|1drv\.ms/, '☁️', 'OneDrive'],
    [/icloud\.com/, '☁️', 'iCloud'],
    [/notion\.(so|site)/, '📓', 'Notion'],
    [/miro\.com/, '🧩', 'Miro'],
    [/trello\.com/, '📌', 'Trello'],
    [/wetransfer\.com|we\.tl/, '📦', 'WeTransfer'],
    [/youtube\.com|youtu\.be|vimeo\.com/, '▶️', 'Vídeo'],
    [/github\.com/, '💻', 'GitHub'],
  ];
  for (const [re, icon, kind] of rules) if (re.test(u)) return { icon, kind, name: kind };
  return { icon: '🔗', kind: host, name: host };
}
const linkLabel = (l) => l.label || linkInfo(l.url).name;
const linkChip = (l, extra = '') => {
  const info = linkInfo(l.url);
  return `<button class="lchip" data-action="open-link" data-url="${U.esc(l.url)}" title="${U.esc(info.kind)} — ${U.esc(l.url)}" ${extra}><span class="li">${info.icon}</span>${U.esc(linkLabel(l))}</button>`;
};
async function openLink(url) {
  const ok = await api.openLink(url);
  if (!ok) alert(`Não consegui abrir:\n${url}\n\nSe for uma pasta do Mac, ela pode ter sido movida ou renomeada.`);
}
const linkIcon = (t) => ((t.links || []).length
  ? `<button class="link-ic" data-action="open-task-link" data-id="${t.id}" title="${t.links.length === 1 ? 'Abrir: ' + U.esc(linkLabel(t.links[0])) : t.links.length + ' links'}">🔗${t.links.length > 1 ? `<small>${t.links.length}</small>` : ''}</button>`
  : '');

// Editor de links reutilizável (formulário da tarefa e links do projeto). Altera o array recebido.
function mountLinksEditor(box, links) {
  const draw = () => {
    box.innerHTML = `
      <div class="le-list">${links.map((l, i) => {
        const info = linkInfo(l.url);
        return `<div class="le-row">
          <span class="li">${info.icon}</span>
          <input class="le-label" data-i="${i}" value="${U.esc(l.label || '')}" placeholder="${U.esc(info.name)}" title="Nome do link (opcional)">
          <span class="le-kind muted small" title="${U.esc(l.url)}">${U.esc(info.kind)}</span>
          <button type="button" class="icon-btn" data-open="${i}" title="Abrir">↗</button>
          <button type="button" class="icon-btn danger" data-del="${i}" title="Remover">×</button>
        </div>`;
      }).join('')}</div>
      <div class="le-add">
        <input class="le-url" placeholder="Cole o link de compartilhamento (Drive, Docs, Figma…) e tecle Enter">
        <button type="button" class="btn" data-add>Adicionar</button>
      </div>
      <div class="le-hint muted small">Dica: arraste aqui uma pasta ou arquivo do Finder (ex.: do Google Drive para computador) ou um link do navegador.</div>`;
  };
  const add = (raw) => {
    for (const piece of String(raw || '').split(/\s+/)) {
      const url = piece.trim();
      if (!url) continue;
      const ok = /^(https?:\/\/|mailto:)/i.test(url) || isLocalPath(url);
      const fixed = ok ? url : (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(url) ? 'https://' + url : null);
      if (fixed && !links.some((l) => l.url === fixed)) links.push({ id: U.uid(), url: fixed, label: '' });
    }
    draw();
    box.querySelector('.le-url').focus();
  };
  box.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('le-url') && e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); e.stopPropagation(); add(e.target.value); }
  }, true);
  box.addEventListener('input', (e) => { if (e.target.classList.contains('le-label')) links[+e.target.dataset.i].label = e.target.value.trim(); });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-add')) add(box.querySelector('.le-url').value);
    if (b.dataset.del != null) { links.splice(+b.dataset.del, 1); draw(); }
    if (b.dataset.open != null) openLink(links[+b.dataset.open].url);
  });
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    box.classList.remove('drop');
    const files = [...(e.dataTransfer.files || [])].map((f) => { try { return api.pathForFile(f); } catch { return ''; } }).filter(Boolean);
    if (files.length) add(files.join(' '));
    else add(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'));
  });
  draw();
}

function projectLinksModal(p) {
  const links = (p.links || []).map((l) => ({ ...l }));
  const { el } = modal({
    title: `Links de ${U.esc(p.name)}`,
    wide: true,
    body: '<p class="muted small" style="margin-top:-6px">Pasta do projeto no Drive, contrato, apresentação, arquivos do cliente…</p><div class="links-editor"></div>',
    buttons: [{ label: 'Cancelar' }, { label: 'Salvar', cls: 'primary', action: (m) => {
      const pending = $('.le-url', m).value.trim();
      if (pending) { alert('Tecle Enter ou clique em Adicionar para incluir o link digitado.'); return false; }
      p.links = links; commit();
    } }],
  });
  mountLinksEditor($('.links-editor', el), links);
}

function projectLinksBar(p) {
  const links = p.links || [];
  return `<div class="links-bar">
    <span class="lb-label">Links</span>
    ${links.map((l) => linkChip(l)).join('')}
    <button class="link-btn small" data-action="project-links" data-id="${p.id}">${links.length ? '✎ Editar' : '＋ Adicionar pasta do Drive ou outro link'}</button>
  </div>`;
}

// ---------- Painel ----------
function taskLine(t, { showProject = true } = {}) {
  const p = proj(t.projectId);
  const end = taskEnd(t);
  const today = U.todayKey();
  const late = !t.done && end < today;
  const tm = t.timeStart ? ` ${t.timeStart}${t.type !== 'entrega' && t.timeEnd ? '–' + t.timeEnd : ''}` : '';
  const when = t.type === 'entrega' ? `◆ ${U.fmtDate(t.start)}${tm}`
    : t.timeStart && t.start <= today && end >= today ? `hoje${tm}` : end === today ? 'hoje' : `até ${U.fmtDate(end)}`;
  const parent = t.parentId ? task(t.parentId) : null;
  return `<div class="task-line${t.done ? ' done' : ''}">
    <input type="checkbox" data-action="toggle-done" data-id="${t.id}" ${t.done ? 'checked' : ''}>
    <button class="sun${isFocus(t) ? ' on' : ''}" data-action="toggle-focus" data-id="${t.id}" title="${isFocus(t) ? 'Tirar do foco de hoje' : 'Colocar no foco de hoje'}">☀</button>
    ${prioFlag(t)}
    <button class="tl-title" data-action="edit-task" data-id="${t.id}">${parent ? `<span class="muted">${U.esc(parent.title)} › </span>` : ''}${U.esc(t.title)}</button>
    ${linkIcon(t)}
    ${(t.tags || []).map((tg) => tagChip(tg, `data-action="dash-tag" data-tag="${U.esc(tg)}" title="Filtrar por #${U.esc(tg)}"`)).join('')}
    ${showProject && p ? `<button class="tag" style="--c:${p.color}" data-action="open-project" data-id="${p.id}">${U.esc(p.name)}</button>` : ''}
    <span class="tl-when${late ? ' late' : ''}">${late ? 'atrasada · ' : ''}${when}</span>
  </div>`;
}

// Filtros do painel (ficam salvos neste Mac).
function dashFilters() {
  prefs.dash ||= { tags: [], project: '', prio: '', range: 14 };
  const f = prefs.dash;
  // Projeto filtrado que foi arquivado, concluído ou excluído: o filtro é desfeito (senão o painel fica vazio).
  if (f.project && S && !activeProjects().some((p) => p.id === f.project)) f.project = '';
  return f;
}
function passesDash(t) {
  const f = dashFilters();
  if (f.project && t.projectId !== f.project) return false;
  if (f.prio && (t.priority || '') !== f.prio) return false;
  if (f.tags.length && !f.tags.every((tg) => (t.tags || []).includes(tg))) return false;
  return true;
}

function renderDashboard(c) {
  if (!liveProjects().length) {
    c.innerHTML = `<div class="empty-hero">
      <div class="hero-icon">◧</div>
      <h2>Bem-vindo ao seu organizador</h2>
      <p>Crie um projeto para montar o cronograma (Gantt), o briefing, as anotações e começar a contar horas.</p>
      <button class="btn primary" data-action="new-project">＋ Criar primeiro projeto</button>
    </div>`;
    return;
  }
  const today = U.todayKey();
  const in14 = U.addDays(today, 14);
  const f = dashFilters();
  const rangeEnd = f.range === 'all' ? '9999-12-31' : U.addDays(today, +f.range || 14);
  const live = S.tasks.filter((t) => proj(t.projectId)?.status !== 'concluido' && !proj(t.projectId)?.archived && !isGroup(t));
  const open = live.filter((t) => !t.done);
  const byPrio = (a, b) => prioW(a) - prioW(b) || taskEnd(a).localeCompare(taskEnd(b));
  const focus = live.filter((t) => isFocus(t)).sort((a, b) => (a.done - b.done) || byPrio(a, b));
  const shown = open.filter(passesDash);
  const lateAll = open.filter((t) => taskEnd(t) < today).length; // contador geral, sem filtros
  const late = shown.filter((t) => taskEnd(t) < today).sort((a, b) => taskEnd(a).localeCompare(taskEnd(b)) || prioW(a) - prioW(b));
  // Com horário primeiro, na ordem do dia; depois as demais por prioridade.
  const now = shown.filter((t) => t.start <= today && taskEnd(t) >= today && t.type !== 'entrega')
    .sort((a, b) => (!!b.timeStart - !!a.timeStart) || (a.timeStart || '').localeCompare(b.timeStart || '') || byPrio(a, b));
  const upcoming = shown.filter((t) => taskEnd(t) >= today && taskEnd(t) <= rangeEnd && !now.includes(t))
    .sort((a, b) => taskEnd(a).localeCompare(taskEnd(b)) || prioW(a) - prioW(b));
  const tags = allTags();
  const anyFilter = f.project || f.prio || f.tags.length;
  const focusDone = focus.filter((t) => t.done).length;
  const [d0, d1] = periodRange('hoje');
  const [w0, w1] = periodRange('semana');
  const hToday = projectHours(null, d0, d1);
  const hWeek = projectHours(null, w0, w1);
  const deliveries = open.filter((t) => t.type === 'entrega' && t.start >= today && t.start <= in14).length;
  // Reuniões entram no painel quando não há filtro de prioridade ou tag (que são só de tarefas).
  const meetShown = f.prio || f.tags.length ? [] : liveMeetings().filter((m) => !f.project || m.projectId === f.project);
  const meetToday = meetShown.filter((m) => m.date === today).sort(byMeetTime);
  const meetNext = meetShown.filter((m) => m.date > today && m.date <= rangeEnd).sort(byMeetTime);
  const nextList = [...upcoming.map((t) => ({ k: taskEnd(t) + ' 99', html: taskLine(t) })), ...meetNext.map((m) => ({ k: `${m.date} ${m.start}`, html: meetingLine(m) }))]
    .sort((a, b) => a.k.localeCompare(b.k));

  const weekBy = activeProjects().map((p) => ({ p, ms: projectHours(p.id, w0, w1) })).filter((x) => x.ms > 0).sort((a, b) => b.ms - a.ms);
  const maxMs = Math.max(1, ...weekBy.map((x) => x.ms));

  c.innerHTML = `
    <div class="dash-date">${U.fmtDateLong(today)}</div>
    <div class="stats">
      <div class="stat"><span class="stat-v">${U.dur(hToday)}</span><span class="stat-l">trabalhadas hoje</span></div>
      <div class="stat"><span class="stat-v">${U.dur(hWeek)}</span><span class="stat-l">nesta semana</span></div>
      <div class="stat${lateAll ? ' warn' : ''}"><span class="stat-v">${lateAll}</span><span class="stat-l">tarefas atrasadas</span></div>
      <div class="stat"><span class="stat-v">${deliveries}</span><span class="stat-l">entregas em 14 dias</span></div>
    </div>
    <div class="card focus-card">
      <div class="card-head">
        <h3>☀ Foco de hoje</h3>
        ${focus.length ? `<span class="muted small">${focusDone} de ${focus.length} concluída(s)</span>
          <span class="bar focus-bar"><span style="width:${(focusDone / focus.length) * 100}%;background:var(--accent)"></span></span>` : ''}
      </div>
      ${focus.length ? focus.map((t) => taskLine(t)).join('') : '<p class="muted">Escolha no que trabalhar hoje: clique no ☀ das tarefas abaixo (ou no formulário da tarefa). Use os filtros para achar o que importa.</p>'}
    </div>
    <div class="filter-bar">
      <span class="fb-label">Filtrar</span>
      <select data-bind="dash-project">
        <option value="">Todos os projetos</option>
        ${activeProjects().map((p) => `<option value="${p.id}" ${p.id === f.project ? 'selected' : ''}>${U.esc(p.name)}</option>`).join('')}
      </select>
      <div class="seg">
        <button class="${!f.prio ? 'active' : ''}" data-action="dash-prio" data-p="">Qualquer prioridade</button>
        ${PRIOS.map(([v, l]) => `<button class="${f.prio === v ? 'active' : ''}" data-action="dash-prio" data-p="${v}"><span class="prio p-${v}">⚑</span> ${l}</button>`).join('')}
      </div>
      <div class="fb-tags">
        ${tags.length ? tags.map((tg) => `<button class="tchip${f.tags.includes(tg) ? ' on' : ''}" style="--c:${tagColor(tg)}" data-action="dash-tag" data-tag="${U.esc(tg)}">#${U.esc(tg)}</button>`).join('') : '<span class="muted small">Sem tags ainda — adicione no formulário da tarefa.</span>'}
      </div>
      ${anyFilter ? '<button class="link-btn" data-action="dash-clear">Limpar filtros</button>' : ''}
    </div>
    <div class="dash-grid">
      <div class="card">
        <h3>Em andamento hoje</h3>
        ${meetToday.length ? `<div class="sub-h">Reuniões de hoje</div>${meetToday.map((m) => meetingLine(m)).join('')}` : ''}
        ${late.length ? `<div class="sub-h late">Atrasadas</div>${late.map((t) => taskLine(t)).join('')}` : ''}
        ${now.length ? `${late.length || meetToday.length ? '<div class="sub-h">Tarefas de hoje</div>' : ''}${now.map((t) => taskLine(t)).join('')}` : ''}
        ${!late.length && !now.length && !meetToday.length ? '<p class="muted">Nada em andamento hoje. 🎉</p>' : ''}
      </div>
      <div class="card">
        <div class="card-head"><h3>Próximas</h3>
          <div class="seg small">${[[7, '7 dias'], [14, '14 dias'], [30, '30 dias'], ['all', 'Todas']].map(([v, l]) => `<button class="${String(f.range) === String(v) ? 'active' : ''}" data-action="dash-range" data-r="${v}">${l}</button>`).join('')}</div>
        </div>
        ${nextList.length ? nextList.map((x) => x.html).join('') : `<p class="muted">${anyFilter ? 'Nenhuma tarefa com esses filtros.' : 'Sem prazos, entregas ou reuniões nesse período.'}</p>`}
      </div>
      <div class="card">
        <h3>Projetos</h3>
        ${activeProjects().map((p) => {
          const prog = projectProgress(p.id);
          const next = S.tasks.filter((t) => t.projectId === p.id && !t.done && !isGroup(t) && taskEnd(t) >= today).sort((a, b) => taskEnd(a).localeCompare(taskEnd(b)))[0];
          return `<button class="proj-row" data-action="open-project" data-id="${p.id}">
            <span class="dot" style="background:${p.color}"></span>
            <span class="pr-name"><span>${U.esc(p.name)}${p.status === 'pausado' ? ' <span class="pi-badge">pausado</span>' : ''}</span><small>${next ? `próximo: ${U.esc(next.title)} · ${U.fmtDate(taskEnd(next))}` : 'sem prazos pendentes'}</small></span>
            <span class="pr-prog"><span class="bar"><span style="width:${prog || 0}%;background:${p.color}"></span></span><small>${prog == null ? '—' : prog + '%'}</small></span>
            <span class="pr-hours">${U.dur(projectHours(p.id))}</span>
          </button>`;
        }).join('') || '<p class="muted">Todos os projetos estão concluídos.</p>'}
      </div>
      <div class="card">
        <h3>Horas nesta semana</h3>
        ${weekBy.length ? weekBy.map((x) => `<div class="hbar-row"><span class="hb-name">${U.esc(x.p.name)}</span>
          <span class="hb-bar"><span style="width:${(x.ms / maxMs) * 100}%;background:${x.p.color}"></span></span>
          <span class="hb-v">${U.dur(x.ms)}</span></div>`).join('') : '<p class="muted">Nenhuma hora registrada nesta semana. Use o botão <b>Rec</b> lá em cima.</p>'}
      </div>
    </div>`;
}

// ---------- Administração de projetos ----------
async function archiveProject(p) {
  if (S.timer.running && S.timer.projectId === p.id) { await flush(); S = await api.timerPause(); }
  p.archived = true;
  p.archivedAt = new Date().toISOString();
  if (view.name === 'project' && view.projectId === p.id) view = { name: 'projects' };
  commit();
}
function unarchiveProject(p) {
  delete p.archived;
  delete p.archivedAt;
  commit();
}

async function deleteProject(p) {
  const counts = `${S.tasks.filter((t) => t.projectId === p.id).length} tarefas, ${(S.meetings || []).filter((m) => m.projectId === p.id).length} reuniões, ${S.notes.filter((n) => n.projectId === p.id).length} anotações e ${S.timeEntries.filter((e) => e.projectId === p.id).length} registros de horas`;
  if (!confirm(`Excluir "${p.name}" definitivamente?\n\nIsso apaga também ${counts}. Não dá para desfazer (a não ser por um backup).`)) return false;
  if (S.timer.running && S.timer.projectId === p.id) { await flush(); S = await api.timerPause(); }
  S.projects = S.projects.filter((x) => x.id !== p.id);
  S.tasks = S.tasks.filter((x) => x.projectId !== p.id);
  S.notes = S.notes.filter((x) => x.projectId !== p.id);
  S.meetings = (S.meetings || []).filter((x) => x.projectId !== p.id);
  S.timeEntries = S.timeEntries.filter((x) => x.projectId !== p.id);
  if (view.name === 'project' && view.projectId === p.id) view = { name: 'projects' };
  commit();
  return true;
}

// Duplica o projeto como modelo: briefing e tarefas (com grupos e dependências), tudo zerado.
function duplicateProject(p) {
  const np = { ...JSON.parse(JSON.stringify(p)), id: U.uid(), name: `${p.name} (cópia)`, status: 'ativo', createdAt: new Date().toISOString() };
  const map = {};
  const src = S.tasks.filter((t) => t.projectId === p.id);
  src.forEach((t) => { map[t.id] = U.uid(); });
  const copies = src.map((t) => ({
    ...JSON.parse(JSON.stringify(t)),
    id: map[t.id], projectId: np.id, parentId: t.parentId ? map[t.parentId] || null : null,
    deps: (t.deps || []).map((d) => map[d]).filter(Boolean),
    done: false, progress: 0, prevProgress: undefined, focusDate: null, createdAt: new Date().toISOString(),
  }));
  // A cópia começa hoje: o cronograma inteiro é deslocado mantendo durações e intervalos.
  if (copies.length) {
    const first = copies.reduce((m, t) => (t.start < m ? t.start : m), copies[0].start);
    const shift = U.diffDays(first, U.todayKey());
    copies.forEach((t) => { t.start = U.addDays(t.start, shift); t.end = U.addDays(t.end || t.start, shift); });
  }
  S.projects.push(np);
  S.tasks.push(...copies);
  commit();
  return np;
}

function projectStats(p) {
  const today = U.todayKey();
  const ts = S.tasks.filter((t) => t.projectId === p.id);
  const leaves = ts.filter((t) => !isGroup(t));
  const start = ts.length ? ts.reduce((m, t) => (t.start < m ? t.start : m), ts[0].start) : '';
  const end = ts.length ? ts.reduce((m, t) => (taskEnd(t) > m ? taskEnd(t) : m), taskEnd(ts[0])) : '';
  const open = leaves.filter((t) => !t.done);
  const next = open.filter((t) => taskEnd(t) >= today).sort((a, b) => taskEnd(a).localeCompare(taskEnd(b)))[0];
  return {
    start, end, next,
    total: leaves.length,
    done: leaves.length - open.length,
    late: open.filter((t) => taskEnd(t) < today).length,
    progress: projectProgress(p.id),
    hours: projectHours(p.id),
    hoursMonth: projectHours(p.id, ...periodRange('mes')),
    notes: S.notes.filter((n) => n.projectId === p.id).length,
  };
}

const STATUS = [['ativo', 'Ativo'], ['pausado', 'Pausado'], ['concluido', 'Concluído']];
const ADMIN_COLS = [
  ['name', 'Projeto'], ['status', 'Status'], ['start', 'Início'], ['end', 'Fim'],
  ['progress', 'Progresso'], ['tasks', 'Tarefas'], ['next', 'Próximo prazo'], ['hours', 'Horas'],
];
function renderProjectsAdmin(c) {
  prefs.adm ||= { status: '', q: '', sort: 'name', dir: 1 };
  const a = prefs.adm;
  const q = (a.q || '').toLowerCase();
  const archivedView = a.status === 'arquivado';
  const rows = S.projects
    .filter((p) => (archivedView ? p.archived : !p.archived && (!a.status || p.status === a.status)) && (!q || `${p.name} ${p.client || ''}`.toLowerCase().includes(q)))
    .map((p) => ({ p, st: projectStats(p) }));
  const key = {
    name: (r) => r.p.name.toLowerCase(),
    status: (r) => ['ativo', 'pausado', 'concluido'].indexOf(r.p.status),
    start: (r) => r.st.start || '9999',
    end: (r) => r.st.end || '9999',
    progress: (r) => r.st.progress ?? -1,
    tasks: (r) => r.st.total - r.st.done,
    next: (r) => (r.st.next ? taskEnd(r.st.next) : '9999'),
    hours: (r) => r.st.hours,
  }[a.sort] || ((r) => r.p.name);
  rows.sort((x, y) => { const kx = key(x); const ky = key(y); return (kx < ky ? -1 : kx > ky ? 1 : 0) * a.dir; });
  const count = (s) => (s === 'arquivado' ? S.projects.filter((p) => p.archived).length : liveProjects().filter((p) => !s || p.status === s).length);
  const totalHours = rows.reduce((t, r) => t + r.st.hours, 0);
  const totalMonth = rows.reduce((t, r) => t + r.st.hoursMonth, 0);
  const totalLate = rows.reduce((t, r) => t + r.st.late, 0);
  const today = U.todayKey();

  c.innerHTML = `
    <div class="stats">
      <div class="stat"><span class="stat-v">${count('ativo')}</span><span class="stat-l">ativos · ${count('pausado')} pausados · ${count('concluido')} concluídos</span></div>
      <div class="stat"><span class="stat-v">${U.dur(totalMonth)}</span><span class="stat-l">horas neste mês (projetos listados)</span></div>
      <div class="stat"><span class="stat-v">${U.dur(totalHours)}</span><span class="stat-l">horas no total (projetos listados)</span></div>
      <div class="stat${totalLate ? ' warn' : ''}"><span class="stat-v">${totalLate}</span><span class="stat-l">tarefas atrasadas</span></div>
    </div>
    <div class="toolbar wrap">
      <div class="seg">
        ${[['', 'Todos'], ...STATUS.map(([v, l]) => [v, l + 's'])].map(([v, l]) => `<button class="${a.status === v ? 'active' : ''}" data-action="adm-status" data-v="${v}">${l} (${count(v)})</button>`).join('')}
      </div>
      <button class="btn archive-tab${archivedView ? ' active' : ''}" data-action="adm-status" data-v="${archivedView ? '' : 'arquivado'}" title="Projetos arquivados">🗄 Arquivados (${count('arquivado')})</button>
      <input type="search" class="adm-search" data-bind="adm-q" placeholder="Buscar projeto ou cliente" value="${U.esc(a.q || '')}">
      <div class="spacer"></div>
      <button class="btn" data-action="report-general" title="Relatório de todos os projetos em PDF">⤓ Relatório PDF</button>
      <button class="btn primary" data-action="new-project">＋ Novo projeto</button>
    </div>
    <div class="adm-table-wrap">
      <table class="adm-table">
        <thead><tr>
          ${ADMIN_COLS.map(([k, l]) => `<th class="sortable${a.sort === k ? ' sorted' : ''}" data-action="adm-sort" data-k="${k}">${l}${a.sort === k ? (a.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}
          <th></th>
        </tr></thead>
        <tbody>
          ${rows.map(({ p, st }) => `
            <tr class="${p.status === 'concluido' && !archivedView ? 'is-done' : ''}">
              <td>
                <div class="adm-name">
                  <button class="adm-color" style="background:${p.color}" data-action="adm-edit" data-id="${p.id}" title="Editar nome, cliente e cor"></button>
                  <button class="adm-title" data-action="open-project" data-id="${p.id}" title="Abrir projeto">${U.esc(p.name)}<small>${U.esc(p.client || 'sem cliente')}</small></button>
                </div>
              </td>
              <td>
                <select class="adm-status st-${p.status}" data-bind="adm-set-status" data-id="${p.id}">
                  ${STATUS.map(([v, l]) => `<option value="${v}" ${p.status === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
              </td>
              <td class="num">${st.start ? U.fmtDate(st.start) : '—'}</td>
              <td class="num${st.end && st.end < today && p.status !== 'concluido' && st.done < st.total ? ' late' : ''}">${st.end ? U.fmtDate(st.end) : '—'}</td>
              <td>
                <div class="adm-prog"><span class="bar"><span style="width:${st.progress || 0}%;background:${p.color}"></span></span><small>${st.progress == null ? '—' : st.progress + '%'}</small></div>
              </td>
              <td class="num">${st.done}/${st.total}${st.late ? ` <span class="ov-late" title="${st.late} atrasada(s)">${st.late}</span>` : ''}</td>
              <td class="adm-next">${st.next ? `<button class="link-btn" data-action="edit-task" data-id="${st.next.id}">${st.next.type === 'entrega' ? '◆ ' : ''}${U.esc(st.next.title)}</button><small>${U.fmtDate(taskEnd(st.next))}</small>` : '<span class="muted">—</span>'}</td>
              <td class="num">${U.dur(st.hours)}</td>
              <td class="adm-actions">
                <button class="icon-btn" data-action="open-project-gantt" data-id="${p.id}" title="Abrir cronograma">▤</button>
                <button class="icon-btn" data-action="adm-edit" data-id="${p.id}" title="Editar">✎</button>
                <button class="icon-btn" data-action="adm-dup" data-id="${p.id}" title="Duplicar como modelo (briefing e tarefas, sem horas)">⧉</button>
                ${archivedView
                  ? `<button class="link-btn small" data-action="adm-unarchive" data-id="${p.id}" title="Voltar para a lista de projetos">↺ Desarquivar</button>
                     <button class="icon-btn danger" data-action="adm-del" data-id="${p.id}" title="Excluir definitivamente">🗑</button>`
                  : `<button class="icon-btn" data-action="adm-archive" data-id="${p.id}" title="Arquivar (some das listas, mas pode ser recuperado)">🗄</button>`}
              </td>
            </tr>`).join('') || `<tr><td colspan="${ADMIN_COLS.length + 1}" class="muted adm-empty">${archivedView ? 'Nenhum projeto arquivado.' : 'Nenhum projeto encontrado.'}</td></tr>`}
        </tbody>
      </table>
    </div>
    <p class="muted small">${archivedView
      ? 'Projetos arquivados não aparecem no painel, calendário, cronograma geral nem no timer. As horas continuam nos relatórios. ↺ devolve o projeto à lista · 🗑 exclui definitivamente.'
      : 'Clique no nome para abrir o projeto · na bolinha de cor para editar · nos títulos das colunas para ordenar · ⧉ duplica como modelo (briefing e tarefas, sem horas) · 🗄 arquiva.'}</p>`;
}

// ---------- Administração de tags ----------
// As tags vivem nas tarefas; "tagMeta" guarda a cor escolhida e tags criadas antes de serem usadas.
const tagMeta = () => (S.tagMeta ||= {});
const cleanTag = (raw) => String(raw || '').trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase();

function tagModal(tag) {
  const isNew = !tag;
  const current = isNew ? U.CORES[allTags().length % U.CORES.length] : tagColor(tag);
  const uses = isNew ? 0 : S.tasks.filter((t) => (t.tags || []).includes(tag)).length;
  modal({
    title: isNew ? 'Nova tag' : `Editar #${U.esc(tag)}`,
    body: `
      <label class="field"><span>Nome</span><input name="tag" value="${U.esc(tag || '')}" placeholder="ex.: urgente, cliente, revisão"></label>
      <div class="field"><span>Cor</span><div class="swatches">${U.CORES.map((c) => `<label class="sw" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === current ? 'checked' : ''}><span></span></label>`).join('')}</div></div>
      ${!isNew ? `<p class="muted small">Usada em ${uses} tarefa(s). Renomear atualiza todas. Se já existir uma tag com o novo nome, as duas são unidas.</p>` : ''}`,
    buttons: [
      ...(!isNew ? [{ label: 'Excluir tag', cls: 'danger left', action: () => deleteTag(tag) || false }] : []),
      { label: 'Cancelar' },
      { label: isNew ? 'Criar tag' : 'Salvar', cls: 'primary', action: (el) => {
        const name = cleanTag(val(el, 'tag'));
        if (!name) { $('[name=tag]', el).focus(); return false; }
        const color = $('[name=color]:checked', el)?.value || current;
        if (!isNew && name !== tag) {
          if (allTags().includes(name) && !confirm(`A tag #${name} já existe. Unir #${tag} com #${name}?`)) return false;
          renameTag(tag, name);
        } else if (isNew && allTags().includes(name)) { alert(`A tag #${name} já existe.`); return false; }
        tagMeta()[name] = { ...(tagMeta()[name] || {}), color };
        commit();
      } },
    ],
  });
}

function renameTag(from, to) {
  for (const t of S.tasks) {
    if (!(t.tags || []).includes(from)) continue;
    t.tags = [...new Set(t.tags.map((x) => (x === from ? to : x)))];
  }
  if (tagMeta()[from]) { tagMeta()[to] ||= tagMeta()[from]; delete tagMeta()[from]; }
  const f = dashFilters();
  f.tags = [...new Set(f.tags.map((x) => (x === from ? to : x)))];
  if (prefs.calTag === from) prefs.calTag = to;
  savePrefs();
}

function deleteTag(tag) {
  const uses = S.tasks.filter((t) => (t.tags || []).includes(tag)).length;
  if (!confirm(`Excluir a tag #${tag}?${uses ? `\n\nEla será removida de ${uses} tarefa(s). As tarefas não são apagadas.` : ''}`)) return false;
  for (const t of S.tasks) if (t.tags) t.tags = t.tags.filter((x) => x !== tag);
  delete tagMeta()[tag];
  const f = dashFilters();
  f.tags = f.tags.filter((x) => x !== tag);
  if (prefs.calTag === tag) prefs.calTag = null;
  savePrefs();
  commit();
  return true;
}

function renderTagsAdmin(c) {
  prefs.tagAdm ||= { q: '', sort: 'uso', open: {} };
  const a = prefs.tagAdm;
  const q = cleanTag(a.q);
  const today = U.todayKey();
  const rows = allTags()
    .filter((tg) => !q || tg.includes(q))
    .map((tg) => {
      const ts = S.tasks.filter((t) => (t.tags || []).includes(tg));
      const open = ts.filter((t) => !t.done);
      return {
        tg, ts, open,
        late: open.filter((t) => taskEnd(t) < today).length,
        projects: [...new Set(ts.map((t) => t.projectId))].map(proj).filter(Boolean),
      };
    })
    .sort((x, y) => (a.sort === 'nome' ? x.tg.localeCompare(y.tg) : y.ts.length - x.ts.length || x.tg.localeCompare(y.tg)));
  const unused = rows.filter((r) => !r.ts.length).length;

  c.innerHTML = `
    <div class="toolbar wrap">
      <input type="search" class="adm-search" data-bind="tag-q" placeholder="Buscar tag" value="${U.esc(a.q || '')}">
      <div class="seg">
        <button class="${a.sort !== 'nome' ? 'active' : ''}" data-action="tag-sort" data-v="uso">Mais usadas</button>
        <button class="${a.sort === 'nome' ? 'active' : ''}" data-action="tag-sort" data-v="nome">A–Z</button>
      </div>
      <span class="muted small">${allTags().length} tag(s)${unused ? ` · ${unused} sem uso` : ''}</span>
      <div class="spacer"></div>
      <button class="btn primary" data-action="tag-new">＋ Nova tag</button>
    </div>
    <div class="adm-table-wrap">
      <table class="adm-table tag-table">
        <thead><tr><th>Tag</th><th>Cor</th><th>Tarefas abertas</th><th>Total</th><th>Projetos</th><th></th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><button class="tchip big" style="--c:${tagColor(r.tg)}" data-action="tag-edit" data-tag="${U.esc(r.tg)}" title="Editar">#${U.esc(r.tg)}</button></td>
              <td>
                <div class="tag-colors">${U.CORES.map((col) => `<button class="tc${tagColor(r.tg) === col ? ' on' : ''}" style="--c:${col}" data-action="tag-color" data-tag="${U.esc(r.tg)}" data-color="${col}" title="Usar esta cor"></button>`).join('')}</div>
              </td>
              <td class="num">${r.open.length}${r.late ? ` <span class="ov-late" title="${r.late} atrasada(s)">${r.late}</span>` : ''}</td>
              <td class="num">${r.ts.length || '<span class="muted">sem uso</span>'}</td>
              <td><div class="tag-projs">${r.projects.slice(0, 4).map((p) => `<button class="tag" style="--c:${p.color}" data-action="open-project" data-id="${p.id}">${U.esc(p.name)}</button>`).join('')}${r.projects.length > 4 ? `<span class="muted small">+${r.projects.length - 4}</span>` : ''}</div></td>
              <td class="adm-actions">
                ${r.ts.length ? `<button class="link-btn small" data-action="tag-toggle" data-tag="${U.esc(r.tg)}">${a.open[r.tg] ? 'Ocultar' : 'Ver'} tarefas</button>
                <button class="icon-btn" data-action="tag-filter" data-tag="${U.esc(r.tg)}" title="Filtrar o painel por esta tag">⌕</button>` : ''}
                <button class="icon-btn" data-action="tag-edit" data-tag="${U.esc(r.tg)}" title="Renomear / cor">✎</button>
                <button class="icon-btn danger" data-action="tag-del" data-tag="${U.esc(r.tg)}" title="Excluir tag">🗑</button>
              </td>
            </tr>
            ${a.open[r.tg] ? `<tr class="tag-tasks"><td colspan="6">${r.ts.slice().sort((x, y) => (x.done - y.done) || taskEnd(x).localeCompare(taskEnd(y))).map((t) => taskLine(t)).join('')}</td></tr>` : ''}`).join('')
            || `<tr><td colspan="6" class="muted adm-empty">${allTags().length ? 'Nenhuma tag encontrada.' : 'Nenhuma tag ainda. Crie uma aqui ou adicione no formulário de uma tarefa.'}</td></tr>`}
        </tbody>
      </table>
    </div>
    <p class="muted small">Clique numa cor para trocar · ✎ renomeia (e une com outra tag de mesmo nome) · ⌕ abre o painel filtrado pela tag · excluir remove a tag das tarefas sem apagá-las.</p>`;
}

// ---------- Relatórios em PDF ----------
const REPORT_SECTIONS = [['resumo', 'Resumo'], ['cronograma', 'Cronograma (Gantt)'], ['tarefas', 'Lista de tarefas'], ['reunioes', 'Reuniões'], ['horas', 'Horas trabalhadas'], ['briefing', 'Briefing'], ['notas', 'Anotações']];
const REPORT_PERIODS = [['tudo', 'Todo o período'], ['semana', 'Esta semana'], ['mes', 'Este mês'], ['mespassado', 'Mês passado'], ['custom', 'Datas personalizadas…']];
function reportPrefs() {
  prefs.report ||= { period: 'tudo', from: '', to: '', landscape: false, details: false, includeDone: false,
    sections: { resumo: true, cronograma: true, tarefas: true, reunioes: true, horas: true, briefing: false, notas: false } };
  prefs.report.sections.reunioes ??= true; // seção nova (1.3.0)
  return prefs.report;
}
const fmtFull = (k) => { const d = U.fromKey(k); return `${U.pad(d.getDate())}/${U.pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
function reportRange(o) {
  const n = new Date();
  const today = U.todayKey();
  if (o.period === 'mes' || o.period === 'mespassado') {
    const d = new Date(n.getFullYear(), n.getMonth() - (o.period === 'mespassado' ? 1 : 0), 1);
    return { from: U.toKey(d), to: U.toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)), label: `${U.MESES[d.getMonth()]} de ${d.getFullYear()}` };
  }
  if (o.period === 'semana') {
    const s = U.addDays(today, -((n.getDay() + 6) % 7));
    return { from: s, to: U.addDays(s, 6), label: `semana de ${fmtFull(s)} a ${fmtFull(U.addDays(s, 6))}` };
  }
  if (o.period === 'custom') {
    const f = o.from || today;
    const t = o.to && o.to >= f ? o.to : f;
    return { from: f, to: t, label: `${fmtFull(f)} a ${fmtFull(t)}` };
  }
  return { from: null, to: null, label: 'todo o período' };
}
const overlaps = (t, r) => !r.from || (t.start <= r.to && taskEnd(t) >= r.from);
const rangeDates = (r) => (r.from ? [U.fromKey(r.from), U.fromKey(U.addDays(r.to, 1))] : [null, null]);
function taskStatusLabel(t) {
  const today = U.todayKey();
  if (t.done) return ['Concluída', 'ok'];
  if (taskEnd(t) < today) return ['Atrasada', 'late'];
  if (t.start <= today) return ['Em andamento', 'now'];
  return ['A fazer', 'todo'];
}

// Gantt estático para o PDF. Cada item: { title, start, end, type, done, progress, depth, group, color }.
function reportGantt(items, r) {
  if (!items.length) return '<p class="rep-muted">Nenhuma tarefa no período.</p>';
  let from = r.from;
  let to = r.to;
  if (!from) {
    from = items.reduce((m, t) => (t.start < m ? t.start : m), items[0].start);
    to = items.reduce((m, t) => (t.end > m ? t.end : m), items[0].end);
  }
  const total = U.diffDays(from, to) + 1;
  const pct = (k) => (U.diffDays(from, k) / total) * 100;
  let ticks = '';
  let d = U.fromKey(from);
  d = new Date(d.getFullYear(), d.getMonth(), 1);
  while (U.toKey(d) <= to) {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const left = Math.max(0, pct(U.toKey(d)));
    const right = Math.min(100, pct(U.toKey(next)));
    ticks += `<div class="rg-month" style="left:${left}%;width:${right - left}%"><span>${right - left > 7 ? `${U.MESES_CURTOS[d.getMonth()]} ${d.getFullYear()}` : ''}</span></div>`;
    d = next;
  }
  let lines = '';
  if (total <= 120) for (let i = 0; i < total; i++) { const k = U.addDays(from, i); if (U.fromKey(k).getDay() === 1) lines += `<i style="left:${pct(k)}%"></i>`; }
  const today = U.todayKey();
  if (today >= from && today <= to) lines += `<b class="rg-today" style="left:${pct(today) + 50 / total}%"></b>`;
  const rows = items.map((t) => {
    const s = t.start < from ? from : t.start;
    const e = t.end > to ? to : t.end;
    const left = pct(s);
    const w = ((U.diffDays(s, e) + 1) / total) * 100;
    const bar = t.type === 'entrega'
      ? `<span class="rg-ms${t.done ? ' done' : ''}" style="left:calc(${left + 50 / total}% - 4px)"></span>`
      : `<span class="rg-bar${t.group ? ' grp' : ''}${t.done ? ' done' : ''}" style="left:${left}%;width:${Math.max(w, 0.6)}%"><span style="width:${t.done ? 100 : t.progress || 0}%"></span></span>`;
    return `<div class="rg-row" style="--c:${t.color}">
      <div class="rg-name" style="padding-left:${(t.depth || 0) * 10}px">${t.group ? '<b>' : ''}${t.type === 'entrega' ? '◆ ' : ''}${U.esc(t.title)}${t.group ? '</b>' : ''}</div>
      <div class="rg-track">${bar}</div>
    </div>`;
  }).join('');
  return `<div class="rg">
    <div class="rg-row rg-head"><div class="rg-name"></div><div class="rg-track">${ticks}</div></div>
    <div class="rg-body"><div class="rg-lines">${lines}</div>${rows}</div>
  </div>`;
}

function reportHeader(kind, title, sub, r, color, brand) {
  void color;
  return `${brand ? brandBlock(brand) : ''}<header class="rep-head">
    <div><small>${kind}</small><h1>${U.esc(title)}</h1>${sub ? `<p>${U.esc(sub)}</p>` : ''}</div>
    <div class="rep-meta">Período: <b>${U.esc(r.label)}</b><br>Gerado em ${fmtFull(U.todayKey())}</div>
  </header>`;
}

function buildProjectReport(p, o) {
  const r = reportRange(o);
  const sec = o.sections;
  const [hFrom, hTo] = rangeDates(r);
  const today = U.todayKey();
  const all = S.tasks.filter((t) => t.projectId === p.id);
  const inPeriod = all.filter((t) => overlaps(t, r));
  const leaves = inPeriod.filter((t) => !isGroup(t));
  const done = leaves.filter((t) => t.done).length;
  const late = leaves.filter((t) => !t.done && taskEnd(t) < today).length;
  const deliveries = inPeriod.filter((t) => t.type === 'entrega');
  const entries = allEntries().filter((e) => e.projectId === p.id && msInRange(e, hFrom, hTo) > 0).sort((a, b) => a.start.localeCompare(b.start));
  const hours = entries.reduce((a, e) => a + msInRange(e, hFrom, hTo), 0);
  const byTask = {};
  for (const e of entries) byTask[entryKey(e)] = (byTask[entryKey(e)] || 0) + msInRange(e, hFrom, hTo);
  const ordered = TaskTree.ordered(inPeriod);
  const brand = o.useProfile !== false && profileFilled() ? profile() : null;
  let html = reportHeader('Relatório do projeto', p.name, p.client, r, p.color, brand);

  if (sec.resumo) {
    const st = { ativo: 'Ativo', pausado: 'Pausado', concluido: 'Concluído' }[p.status] || p.status;
    html += `<section class="rep-sec"><h2>Resumo</h2>
      <div class="rep-cards">
        <div><b>${projectProgress(p.id) ?? 0}%</b><span>progresso geral</span></div>
        <div><b>${done}/${leaves.length}</b><span>tarefas concluídas${r.from ? ' (no período)' : ''}</span></div>
        <div class="${late ? 'warn' : ''}"><b>${late}</b><span>atrasadas hoje</span></div>
        <div><b>${deliveries.length}</b><span>entregas${r.from ? ' no período' : ''}</span></div>
        <div><b>${U.dur(hours)}</b><span>${U.hoursDecimal(hours)} h trabalhadas</span></div>
      </div>
      <p class="rep-muted">Status: ${st}${p.archived ? ' (arquivado)' : ''}${deliveries.length ? ` · Entregas: ${deliveries.map((t) => `${U.esc(t.title)} (${U.fmtDate(t.start)}${t.done ? ', ok' : ''})`).join(' · ')}` : ''}</p>
    </section>`;
  }
  if (sec.cronograma) {
    const items = ordered.map(({ t, depth, has }) => ({ title: t.title, start: t.start, end: taskEnd(t), type: t.type, done: t.done, progress: t.progress, depth, group: has, color: p.color }));
    html += `<section class="rep-sec"><h2>Cronograma</h2>${reportGantt(items, r)}</section>`;
  }
  if (sec.tarefas) {
    html += `<section class="rep-sec"><h2>Tarefas e entregas</h2>${ordered.length ? `<table class="rep-table">
      <thead><tr><th>Tarefa</th><th>Início</th><th>Fim</th><th>Status</th><th>Progr.</th><th>Prior.</th><th>Tags</th><th class="r">Horas</th></tr></thead>
      <tbody>${ordered.map(({ t, depth, has }) => {
        const [lbl, cls] = taskStatusLabel(t);
        return `<tr class="${has ? 'grp' : ''}">
          <td style="padding-left:${6 + depth * 12}px">${t.type === 'entrega' ? '◆ ' : ''}${U.esc(t.title)}</td>
          <td>${U.fmtDate(t.start)}${t.timeStart ? ' ' + t.timeStart : ''}</td><td>${t.type === 'entrega' ? '—' : U.fmtDate(taskEnd(t)) + (t.timeEnd ? ' ' + t.timeEnd : '')}</td>
          <td><span class="rep-st ${cls}">${lbl}</span></td>
          <td>${t.type === 'entrega' ? '' : `${t.done ? 100 : t.progress || 0}%`}</td>
          <td>${t.priority ? PRIOS.find((x) => x[0] === t.priority)[1] : ''}</td>
          <td class="rep-tags">${(t.tags || []).map((x) => '#' + U.esc(x)).join(' ')}</td>
          <td class="r">${byTask[t.id] ? U.dur(byTask[t.id]) : ''}</td>
        </tr>`;
      }).join('')}</tbody></table>` : '<p class="rep-muted">Nenhuma tarefa no período.</p>'}</section>`;
  }
  if (sec.reunioes) {
    const meets = (S.meetings || []).filter((m) => m.projectId === p.id && (!r.from || (m.date >= r.from && m.date <= r.to))).sort(byMeetTime);
    html += `<section class="rep-sec"><h2>Reuniões</h2>${meets.length ? `<table class="rep-table">
      <thead><tr><th>Data</th><th>Horário</th><th>Assunto</th><th>Participantes</th><th>Pauta e anotações</th></tr></thead>
      <tbody>${meets.map((m) => `<tr>
        <td>${fmtFull(m.date)}</td><td>${meetTime(m)}</td>
        <td><b>${U.esc(m.title)}</b>${m.location ? `<br><span class="rep-muted">${U.esc(m.location)}</span>` : ''}${m.link ? `<br><span class="rep-muted">${U.esc(m.link)}</span>` : ''}</td>
        <td>${U.esc(m.participants || '')}</td>
        <td>${m.notes ? `<div class="md">${U.markdown(m.notes)}</div>` : ''}</td>
      </tr>`).join('')}</tbody></table>` : '<p class="rep-muted">Nenhuma reunião no período.</p>'}</section>`;
  }
  if (sec.horas) {
    const byDay = {};
    for (const e of entries) (byDay[U.toKey(new Date(e.start))] ||= []).push(e);
    const taskRows = Object.entries(byTask).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...taskRows.map((x) => x[1]));
    html += `<section class="rep-sec"><h2>Horas trabalhadas · ${U.dur(hours)} (${U.hoursDecimal(hours)} h)</h2>
      ${entries.length ? `<div class="rep-hbars">${taskRows.map(([tid, ms]) => `<div><span>${U.esc(entryKeyLabel(tid))}</span><i><em style="width:${(ms / max) * 100}%;background:${p.color}"></em></i><b>${U.dur(ms)}</b></div>`).join('')}</div>
      <table class="rep-table">
        <thead><tr><th>Data</th><th>Horário</th><th>Tarefa</th><th>Descrição</th><th class="r">Duração</th></tr></thead>
        <tbody>${Object.keys(byDay).sort().map((k) => byDay[k].map((e, i) => `<tr${i === 0 ? ' class="day-first"' : ''}>
          <td>${i === 0 ? fmtFull(k) : ''}</td><td>${U.fmtTime(e.start)}–${e.running ? 'agora' : U.fmtTime(e.end)}</td>
          <td>${U.esc(e.taskId ? task(e.taskId)?.title || '' : '')}</td><td>${U.esc(e.description || '')}</td>
          <td class="r">${U.dur(msInRange(e, hFrom, hTo))}</td></tr>`).join('')).join('')}
          <tr class="total"><td colspan="4">Total</td><td class="r">${U.dur(hours)}</td></tr>
        </tbody></table>` : '<p class="rep-muted">Nenhuma hora registrada no período.</p>'}
    </section>`;
  }
  if (sec.briefing) {
    const br = p.briefing || {};
    const filled = BRIEF_FIELDS.filter(([k]) => br[k]);
    html += `<section class="rep-sec"><h2>Briefing</h2>${filled.length
      ? filled.map(([k, l]) => `<div class="rep-brief"><h3>${l}</h3><p>${U.esc(br[k]).replace(/\n/g, '<br>')}</p></div>`).join('')
      : '<p class="rep-muted">Briefing não preenchido.</p>'}</section>`;
  }
  if (sec.notas) {
    const notes = S.notes.filter((n) => n.projectId === p.id).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt.localeCompare(a.updatedAt));
    html += `<section class="rep-sec"><h2>Anotações</h2>${notes.length
      ? notes.map((n) => `<div class="rep-note"><h3>${U.esc(n.title || 'Sem título')} <small>${new Date(n.updatedAt).toLocaleDateString('pt-BR')}</small></h3><div class="md">${U.markdown(n.body)}</div></div>`).join('')
      : '<p class="rep-muted">Sem anotações.</p>'}</section>`;
  }
  if ((p.links || []).length) {
    html += `<section class="rep-sec rep-links"><h2>Links</h2><ul>${p.links.map((l) => `<li>${linkInfo(l.url).icon} <b>${U.esc(linkLabel(l))}</b> — ${U.esc(l.url)}</li>`).join('')}</ul></section>`;
  }
  return `<div class="rep" style="${brandVars(brand)}">${html}</div>`;
}

function buildGeneralReport(o) {
  const r = reportRange(o);
  const [hFrom, hTo] = rangeDates(r);
  const today = U.todayKey();
  const projects = liveProjects()
    .filter((p) => o.includeDone || p.status !== 'concluido')
    .map((p) => {
      const ts = S.tasks.filter((t) => t.projectId === p.id && overlaps(t, r));
      const leaves = ts.filter((t) => !isGroup(t));
      const hours = allEntries().filter((e) => e.projectId === p.id).reduce((a, e) => a + msInRange(e, hFrom, hTo), 0);
      const next = S.tasks.filter((t) => t.projectId === p.id && !t.done && !isGroup(t) && taskEnd(t) >= today).sort((a, b) => taskEnd(a).localeCompare(taskEnd(b)))[0];
      const all = S.tasks.filter((t) => t.projectId === p.id);
      return {
        p, ts, leaves, hours, next,
        done: leaves.filter((t) => t.done).length,
        late: leaves.filter((t) => !t.done && taskEnd(t) < today).length,
        deliveries: ts.filter((t) => t.type === 'entrega').length,
        start: all.length ? all.reduce((m, t) => (t.start < m ? t.start : m), all[0].start) : null,
        end: all.length ? all.reduce((m, t) => (taskEnd(t) > m ? taskEnd(t) : m), taskEnd(all[0])) : null,
      };
    })
    .filter((x) => !r.from || x.ts.length || x.hours > 0)
    .sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
  const total = projects.reduce((a, x) => a + x.hours, 0);
  const status = { ativo: 'Ativo', pausado: 'Pausado', concluido: 'Concluído' };
  const brand = o.useProfile !== false && profileFilled() ? profile() : null;
  let html = reportHeader('Relatório geral', 'Todos os projetos', `${projects.length} projeto(s)`, r, brand && brand.pdf.color ? brand.color : '#5b6cff', brand);
  html += `<section class="rep-sec"><h2>Resumo</h2>
    <div class="rep-cards">
      <div><b>${projects.length}</b><span>projetos</span></div>
      <div><b>${projects.reduce((a, x) => a + x.done, 0)}/${projects.reduce((a, x) => a + x.leaves.length, 0)}</b><span>tarefas concluídas</span></div>
      <div class="${projects.some((x) => x.late) ? 'warn' : ''}"><b>${projects.reduce((a, x) => a + x.late, 0)}</b><span>atrasadas hoje</span></div>
      <div><b>${projects.reduce((a, x) => a + x.deliveries, 0)}</b><span>entregas${r.from ? ' no período' : ''}</span></div>
      <div><b>${U.dur(total)}</b><span>${U.hoursDecimal(total)} h trabalhadas</span></div>
    </div>
    <table class="rep-table">
      <thead><tr><th>Projeto</th><th>Status</th><th>Progr.</th><th>Tarefas</th><th>Atras.</th><th>Próximo prazo</th><th class="r">Horas</th></tr></thead>
      <tbody>${projects.map((x) => `<tr>
        <td><span class="rep-dot sm" style="background:${x.p.color}"></span>${U.esc(x.p.name)}${x.p.client ? `<small> · ${U.esc(x.p.client)}</small>` : ''}</td>
        <td>${status[x.p.status]}</td><td>${projectProgress(x.p.id) ?? 0}%</td><td>${x.done}/${x.leaves.length}</td>
        <td>${x.late ? `<span class="rep-st late">${x.late}</span>` : ''}</td>
        <td>${x.next ? `${U.esc(x.next.title)} · ${U.fmtDate(taskEnd(x.next))}` : '—'}</td>
        <td class="r">${U.dur(x.hours)}</td></tr>`).join('')}
        <tr class="total"><td colspan="6">Total</td><td class="r">${U.dur(total)}</td></tr>
      </tbody></table>
  </section>`;
  const bars = projects.filter((x) => x.start).map((x) => ({ title: x.p.name, start: x.start, end: x.end, type: 'tarefa', progress: projectProgress(x.p.id) || 0, done: false, color: x.p.color }));
  html += `<section class="rep-sec"><h2>Cronograma geral</h2>${reportGantt(bars, r)}</section>`;
  let out = `<div class="rep" style="${brandVars(brand)}">${html}</div>`;
  if (o.details) for (const x of projects) out += `<div class="rep-break"></div>${buildProjectReport(x.p, o)}`;
  return out;
}

function reportModal(projectId) {
  const o = reportPrefs();
  const p = projectId ? proj(projectId) : null;
  const { el } = modal({
    title: p ? `Exportar PDF — ${U.esc(p.name)}` : 'Relatório geral em PDF',
    body: `
      <div class="field-row">
        <label class="field"><span>Período</span><select name="period">${REPORT_PERIODS.map(([v, l]) => `<option value="${v}" ${o.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Orientação</span><select name="orient"><option value="p" ${!o.landscape ? 'selected' : ''}>Retrato (A4)</option><option value="l" ${o.landscape ? 'selected' : ''}>Paisagem (A4)</option></select></label>
      </div>
      <div class="field-row rep-custom">
        <label class="field"><span>De</span><input type="date" name="from" value="${o.from || U.todayKey().slice(0, 8) + '01'}"></label>
        <label class="field"><span>Até</span><input type="date" name="to" value="${o.to || U.todayKey()}"></label>
      </div>
      ${p ? '' : `<label class="check"><input type="checkbox" name="includeDone" ${o.includeDone ? 'checked' : ''}> Incluir projetos concluídos</label>
        <label class="check" style="margin-top:6px"><input type="checkbox" name="details" ${o.details ? 'checked' : ''}> Incluir os detalhes de cada projeto (um por página)</label>`}
      <div class="rep-profile">${profileFilled()
        ? `<label class="check"><input type="checkbox" name="useProfile" ${(o.useProfile ?? profile().pdf.enabled) ? 'checked' : ''}> Incluir meu perfil (${[profile().pdf.logo && profile().logo ? 'logo' : '', profile().name ? 'nome' : '', profile().pdf.contact ? 'contatos' : '', profile().pdf.color ? 'cor' : ''].filter(Boolean).join(', ')})</label> <button class="link-btn small" data-action="go-profile">Editar perfil</button>`
        : '<span class="muted small">Quer seu logo e contatos no PDF?</span> <button class="link-btn small" data-action="go-profile">Configurar perfil</button>'}</div>
      <div class="field rep-secs" style="margin-top:12px"><span>${p ? 'Incluir no relatório' : 'Seções dos detalhes de cada projeto'}</span>
        <div class="rep-sec-grid">${REPORT_SECTIONS.map(([k, l]) => `<label class="check"><input type="checkbox" name="sec-${k}" ${o.sections[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      </div>
      <p class="muted small">Com um período escolhido, entram as tarefas que acontecem nele e as horas registradas nele. O PDF abre assim que for salvo.</p>`,
    buttons: [
      { label: 'Cancelar' },
      { label: 'Gerar PDF', cls: 'primary', action: async (m) => {
        o.period = val(m, 'period');
        o.from = val(m, 'from');
        o.to = val(m, 'to');
        o.landscape = val(m, 'orient') === 'l';
        if (!p) { o.includeDone = $('[name=includeDone]', m).checked; o.details = $('[name=details]', m).checked; }
        REPORT_SECTIONS.forEach(([k]) => { o.sections[k] = $(`[name=sec-${k}]`, m).checked; });
        o.useProfile = $('[name=useProfile]', m) ? $('[name=useProfile]', m).checked : false;
        savePrefs();
        const r = reportRange(o);
        const html = p ? buildProjectReport(p, o) : buildGeneralReport(o);
        const name = `${p ? `Relatório - ${p.name}` : 'Relatório geral'} - ${r.from ? r.label.replace(/\//g, '-') : 'completo'}.pdf`;
        $('#printRoot').innerHTML = html;
        await flush();
        try { await api.savePdf(name, { landscape: o.landscape, footer: `${o.useProfile ? footerPrefix(profile()) : ''}${p ? p.name : 'Relatório geral'} · ${r.label}` }); }
        finally { $('#printRoot').innerHTML = ''; }
      } },
    ],
  });
  const sync = () => {
    $('.rep-custom', el).style.display = val(el, 'period') === 'custom' ? '' : 'none';
    if (!p) $('.rep-secs', el).style.opacity = $('[name=details]', el).checked ? '1' : '.45';
  };
  $('[name=period]', el).addEventListener('change', sync);
  if (!p) $('[name=details]', el).addEventListener('change', sync);
  sync();
}

// ---------- Perfil (profissional ou empresa) ----------
const PROFILE_DEFAULTS = { type: 'profissional', name: '', subtitle: '', site: '', email: '', whatsapp: '', address: '', color: '#5b6cff', logo: '' };
const PROFILE_PDF_DEFAULTS = { enabled: true, logo: true, contact: true, color: true };
function profile() {
  S.profile ||= {};
  for (const [k, v] of Object.entries(PROFILE_DEFAULTS)) if (S.profile[k] == null) S.profile[k] = v;
  S.profile.pdf ||= {};
  for (const [k, v] of Object.entries(PROFILE_PDF_DEFAULTS)) if (S.profile.pdf[k] == null) S.profile.pdf[k] = v;
  return S.profile;
}
const profileFilled = () => { const pr = profile(); return !!(pr.name || pr.logo); };
const siteHref = (s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);
const siteShow = (s) => s.replace(/^https?:\/\//i, '').replace(/\/$/, '');
const waDigits = (s) => { let d = String(s || '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return d; };

// Bloco com logo, nome e contatos usado no topo dos PDFs (e na prévia).
function brandBlock(pr) {
  const contact = [
    pr.site && `<a href="${U.esc(siteHref(pr.site))}">${U.esc(siteShow(pr.site))}</a>`,
    pr.email && `<a href="mailto:${U.esc(pr.email)}">${U.esc(pr.email)}</a>`,
    pr.whatsapp && `<a href="https://wa.me/${waDigits(pr.whatsapp)}">WhatsApp ${U.esc(pr.whatsapp)}</a>`,
  ].filter(Boolean).map((x) => `<div>${x}</div>`).join('');
  const logo = pr.pdf.logo && pr.logo ? `<img class="rep-logo" src="${U.esc(pr.logo)}" alt="">` : '';
  const text = pr.name || pr.subtitle ? `<div class="rep-brand-text">${pr.name ? `<b>${U.esc(pr.name)}</b>` : ''}${pr.subtitle ? `<span>${U.esc(pr.subtitle)}</span>` : ''}</div>` : '';
  const right = pr.pdf.contact && (contact || pr.address)
    ? `<div class="rep-brand-contact">${contact}${pr.address ? `<div>${U.esc(pr.address).replace(/\n+/g, ' · ')}</div>` : ''}</div>` : '';
  if (!logo && !text && !right) return '';
  return `<div class="rep-brand">${logo}${text}${right}</div>`;
}
// Variáveis de cor usadas pelo relatório (cor da marca ou neutro).
const brandVars = (pr) => (pr && pr.pdf.color ? `--brand:${pr.color};--brand-h:${pr.color}` : '--brand:#1d1d22;--brand-h:#555');
const footerPrefix = (pr) => (pr && pr.name ? `${pr.name}${pr.site ? ' · ' + siteShow(pr.site) : ''} — ` : '');

function previewHtml() {
  const pr = profile();
  const brand = pr.pdf.enabled ? pr : null;
  return `<div class="rep pv-page" style="${brandVars(brand)}">
    ${brand ? brandBlock(brand) : ''}
    <header class="rep-head">
      <div><small>Relatório do projeto</small><h1>Nome do projeto</h1><p>Cliente</p></div>
      <div class="rep-meta">Período: <b>este mês</b><br>Gerado em ${fmtFull(U.todayKey())}</div>
    </header>
    <section class="rep-sec"><h2>Resumo</h2>
      <div class="rep-cards"><div><b>45%</b><span>progresso</span></div><div><b>4/9</b><span>tarefas</span></div><div><b>12h30</b><span>trabalhadas</span></div></div>
    </section>
    <section class="rep-sec"><h2>Cronograma</h2>
      <div class="pv-bars"><i style="width:55%;margin-left:0"></i><i style="width:35%;margin-left:30%"></i><i style="width:40%;margin-left:55%"></i></div>
    </section>
    ${brand ? '' : '<p class="rep-muted">O perfil está desligado nos PDFs.</p>'}
  </div>`;
}

function renderProfile(c) {
  const pr = profile();
  const emp = pr.type === 'empresa';
  c.innerHTML = `
    <div class="profile-grid">
      <div class="card">
        <h3>Identificação</h3>
        <div class="seg prof-type">
          <button class="${!emp ? 'active' : ''}" data-action="prof-type" data-v="profissional">👤 Profissional</button>
          <button class="${emp ? 'active' : ''}" data-action="prof-type" data-v="empresa">🏢 Empresa</button>
        </div>
        <label class="field"><span>${emp ? 'Nome da empresa' : 'Seu nome profissional'}</span><input data-bind="prof" data-key="name" value="${U.esc(pr.name)}" placeholder="${emp ? 'Ex.: Estúdio Aurora Design' : 'Ex.: Ana Souza'}"></label>
        <label class="field"><span>${emp ? 'Slogan ou responsável (opcional)' : 'Especialidade (opcional)'}</span><input data-bind="prof" data-key="subtitle" value="${U.esc(pr.subtitle)}" placeholder="${emp ? 'Ex.: Branding e design digital' : 'Ex.: Designer gráfico'}"></label>

        <h3 class="mt">Contato</h3>
        <div class="field-row">
          <label class="field"><span>Site</span><input data-bind="prof" data-key="site" value="${U.esc(pr.site)}" placeholder="seusite.com.br"></label>
          <label class="field"><span>E-mail</span><input type="email" data-bind="prof" data-key="email" value="${U.esc(pr.email)}" placeholder="contato@seusite.com.br"></label>
        </div>
        <label class="field"><span>WhatsApp</span><input data-bind="prof" data-key="whatsapp" value="${U.esc(pr.whatsapp)}" placeholder="(41) 99999-0000"></label>
        <label class="field"><span>Endereço</span><textarea data-bind="prof" data-key="address" rows="2" placeholder="Rua, número, bairro — cidade/UF">${U.esc(pr.address)}</textarea></label>

        <h3 class="mt">Cor da marca</h3>
        <div class="prof-colors">
          ${U.CORES.map((col) => `<button class="tc${pr.color === col ? ' on' : ''}" style="--c:${col}" data-action="prof-color" data-color="${col}" title="${col}"></button>`).join('')}
          <label class="custom-color" title="Escolher outra cor"><input type="color" data-bind="prof-color-input" value="${pr.color}"><span>Outra cor</span></label>
          <code class="hex">${pr.color}</code>
        </div>

        <h3 class="mt">Logo</h3>
        <div class="logo-drop" id="logoDrop">
          ${pr.logo ? `<img src="${U.esc(pr.logo)}" alt="Logo">` : '<span class="muted">Arraste a imagem do logo aqui<br><small>PNG com fundo transparente fica melhor · também aceita JPG e SVG</small></span>'}
        </div>
        <div class="logo-actions">
          <label class="btn"><input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" data-bind="prof-logo" hidden>${pr.logo ? 'Trocar logo' : 'Escolher imagem…'}</label>
          ${pr.logo ? '<button class="btn danger" data-action="prof-logo-remove">Remover</button>' : ''}
        </div>
      </div>

      <div class="card">
        <h3>Nos PDFs</h3>
        <label class="check"><input type="checkbox" data-bind="prof-pdf" data-key="enabled" ${pr.pdf.enabled ? 'checked' : ''}> Usar o perfil nos PDFs (dá para desligar em cada exportação)</label>
        <div class="prof-pdf-opts${pr.pdf.enabled ? '' : ' off'}">
          <label class="check"><input type="checkbox" data-bind="prof-pdf" data-key="logo" ${pr.pdf.logo ? 'checked' : ''}> Mostrar o logo</label>
          <label class="check"><input type="checkbox" data-bind="prof-pdf" data-key="contact" ${pr.pdf.contact ? 'checked' : ''}> Mostrar site, e-mail, WhatsApp e endereço</label>
          <label class="check"><input type="checkbox" data-bind="prof-pdf" data-key="color" ${pr.pdf.color ? 'checked' : ''}> Usar a cor da marca nos títulos</label>
        </div>
        <h3 class="mt">Prévia</h3>
        <div id="profPreview" class="pv-wrap">${previewHtml()}</div>
        <p class="muted small">O perfil fica salvo junto com os seus dados (vai junto no backup e para o outro Mac).</p>
      </div>
    </div>`;

  const drop = $('#logoDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drop'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drop'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); drop.classList.remove('drop');
    const f = [...(e.dataTransfer.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) loadLogo(f);
  });
  drop.addEventListener('click', () => $('[data-bind=prof-logo]').click());
}
const refreshPreview = () => { const el = $('#profPreview'); if (el) el.innerHTML = previewHtml(); };

// Lê a imagem do logo e reduz para no máximo 600×300 (SVG é mantido como está).
function loadLogo(file) {
  if (file.size > 8 * 1024 * 1024) { alert('Imagem muito grande (máximo 8 MB).'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const url = reader.result;
    if (file.type === 'image/svg+xml') {
      if (url.length > 400 * 1024) { alert('O SVG é grande demais (máximo ~300 KB).'); return; }
      profile().logo = url; commit(); return;
    }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 600 / img.width, 300 / img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      profile().logo = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
      commit();
    };
    img.onerror = () => alert('Não consegui ler essa imagem.');
    img.src = url;
  };
  reader.readAsDataURL(file);
}

// ---------- Cronograma geral (todos os projetos) ----------
// ---------- Visão "Horas" (um dia por vez) ----------
const ZOOM_BTNS = [['horas', 'Horas'], ['dia', 'Dias'], ['semana', 'Semanas'], ['mes', 'Meses']];
let dayDateSel = null; // dia mostrado na visão Horas (volta para hoje ao abrir o app)
const dayDate = () => dayDateSel || U.todayKey();
const zoomSeg = (cur, action) => `<div class="seg">${ZOOM_BTNS.map(([z, l]) => `<button class="${cur === z ? 'active' : ''}" data-action="${action}" data-zoom="${z}">${l}</button>`).join('')}</div>`;
function dayToolbar() {
  const d = dayDate();
  const h0 = prefs.dayH0 ?? 8, h1 = prefs.dayH1 ?? 18;
  return `<div class="seg"><button data-action="day-move" data-d="-1" title="Dia anterior">‹</button><button data-action="day-today">Hoje</button><button data-action="day-move" data-d="1" title="Próximo dia">›</button></div>
    <span class="day-title${d === U.todayKey() ? ' is-today' : ''}">${U.fmtDateLong(d)}</span>
    <div class="spacer"></div>
    <span class="muted small day-range">das <select data-bind="day-h0">${Array.from({ length: 13 }, (_, i) => i).map((h) => `<option value="${h}" ${h === h0 ? 'selected' : ''}>${h}h</option>`).join('')}</select>
      às <select data-bind="day-h1">${Array.from({ length: 12 }, (_, i) => i + 13).map((h) => `<option value="${h}" ${h === h1 ? 'selected' : ''}>${h}h</option>`).join('')}</select></span>`;
}
// Tarefas (com e sem horário), reuniões e dependências de um dia, para os projetos indicados.
function dayData(projectIds, date) {
  const ids = new Set(projectIds);
  const today = U.todayKey();
  const plus1h = (t) => DayView.fromMin(Math.min(1440, DayView.toMin(t) + 60));
  const items = [], allDay = [];
  const tasks = S.tasks.filter((t) => ids.has(t.projectId) && !isGroup(t) && t.start <= date && taskEnd(t) >= date);
  for (const t of tasks) {
    const p = proj(t.projectId);
    const base = { key: `t:${t.id}`, kind: 'task', id: t.id, title: t.title, isMs: t.type === 'entrega', color: p.color, project: p.name, done: !!t.done };
    if (t.timeStart) items.push({ ...base, start: t.timeStart, end: base.isMs ? null : (t.timeEnd > t.timeStart ? t.timeEnd : plus1h(t.timeStart)), late: !t.done && taskEnd(t) < today });
    else allDay.push(base);
  }
  for (const m of S.meetings || []) {
    if (!ids.has(m.projectId) || m.date !== date) continue;
    const p = proj(m.projectId);
    items.push({ key: `m:${m.id}`, kind: 'meeting', id: m.id, title: m.title, start: m.start, end: m.end > m.start ? m.end : plus1h(m.start), color: p.color, project: p.name, done: meetEnd(m).getTime() < Date.now() });
  }
  items.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const timed = new Set(items.filter((i) => i.kind === 'task').map((i) => i.id));
  const links = [];
  for (const t of tasks) {
    if (!timed.has(t.id)) continue;
    for (const d of t.deps || []) {
      if (!timed.has(d)) continue;
      const p = task(d);
      const pEnd = p.type === 'entrega' ? p.timeStart : (p.timeEnd || p.timeStart);
      // No mesmo dia, a seguinte não pode começar antes de a anterior terminar.
      const bad = taskEnd(p) === date && t.start === date && t.timeStart < pEnd;
      links.push({ from: `t:${d}`, to: `t:${t.id}`, bad });
    }
  }
  return { items, allDay, links };
}
function setItemTime(it, patch) {
  if (it.kind === 'meeting') {
    const m = meeting(it.id);
    if (!m || !patch) return;
    m.start = patch.start; m.end = patch.end;
    syncMeetingEntries();
    commit();
    return;
  }
  const t = task(it.id);
  if (!t) return;
  if (!patch) { delete t.timeStart; delete t.timeEnd; } else {
    t.timeStart = patch.start;
    if (t.type === 'entrega') delete t.timeEnd; else t.timeEnd = patch.end;
  }
  commit();
}
function renderDayView(host, projectIds, showProject) {
  host.classList.add('dv-host');
  const { items, allDay, links } = dayData(projectIds, dayDate());
  DayView.render(host, {
    date: dayDate(), items, allDay, links, showProject,
    hours: [prefs.dayH0 ?? 8, Math.max((prefs.dayH0 ?? 8) + 1, prefs.dayH1 ?? 18)],
    onEdit: (it) => (it.kind === 'meeting' ? meetingModal(meeting(it.id)) : taskModal(task(it.id))),
    onTime: setItemTime,
  });
}
const DAY_HELP = 'Arraste as barras para mudar o horário (de 15 em 15 min) · puxe as bordas para mudar a duração · arraste da faixa ☀ Dia todo para dar um horário, e de volta para tirar · clique para editar';

function renderTimeline(c) {
  c.className = 'fill';
  prefs.ovZoom ||= 'semana';
  prefs.ovExpanded ||= {};
  const show = prefs.ovShow || 'ativos';
  const projects = liveProjects()
    .filter((p) => show === 'todos' || (show === 'ativos' ? p.status === 'ativo' : p.status !== 'concluido'))
    .map((p) => ({ p, start: S.tasks.filter((t) => t.projectId === p.id).reduce((m, t) => (t.start < m ? t.start : m), '9999') }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.p.name.localeCompare(b.p.name))
    .map((x) => x.p);
  const ids = new Set(projects.map((p) => p.id));
  const tasks = S.tasks.filter((t) => ids.has(t.projectId));
  const anyOpen = projects.some((p) => prefs.ovExpanded[p.id]);
  const showSeg = `<div class="seg">
        ${[['ativos', 'Ativos'], ['abertos', 'Ativos e pausados'], ['todos', 'Todos']].map(([v, l]) => `<button class="${show === v ? 'active' : ''}" data-action="ov-show" data-v="${v}">${l}</button>`).join('')}
      </div>`;
  if (prefs.ovZoom === 'horas') {
    c.innerHTML = `
      <div class="toolbar wrap">${showSeg}${dayToolbar()}${zoomSeg(prefs.ovZoom, 'ov-zoom')}</div>
      <div id="ovHost" class="gantt-host"></div>
      <p class="muted small gantt-help">${DAY_HELP}</p>`;
    renderDayView($('#ovHost'), [...ids], true);
    return;
  }
  c.innerHTML = `
    <div class="toolbar">
      <div class="seg">
        ${[['ativos', 'Ativos'], ['abertos', 'Ativos e pausados'], ['todos', 'Todos']].map(([v, l]) => `<button class="${show === v ? 'active' : ''}" data-action="ov-show" data-v="${v}">${l}</button>`).join('')}
      </div>
      <button class="btn" data-action="${anyOpen ? 'ov-collapse-all' : 'ov-expand-all'}">${anyOpen ? 'Recolher tudo' : 'Expandir tudo'}</button>
      <div class="spacer"></div>
      <span class="muted small hide-narrow">Clique num projeto para abrir o cronograma dele · ◆ = entrega</span>
      ${zoomSeg(prefs.ovZoom, 'ov-zoom')}
      <button class="btn" data-action="ov-today">Hoje</button>
    </div>
    <div id="ovHost" class="gantt-host"></div>`;
  const host = $('#ovHost');
  if (!projects.length) {
    host.innerHTML = '<div class="empty-hero small"><p>Nenhum projeto para mostrar com esse filtro.</p></div>';
    return;
  }
  Gantt.renderOverview(host, {
    projects, tasks, zoom: prefs.ovZoom, expanded: prefs.ovExpanded,
    projectInfo: (p) => ({ progress: projectProgress(p.id), isGroup }),
  });
}

// ---------- Calendário ----------
function renderCalendar(c) {
  const monthKey = prefs.calMonth || U.todayKey().slice(0, 8) + '01';
  const m = U.fromKey(monthKey);
  if (prefs.calProject && (!proj(prefs.calProject) || proj(prefs.calProject).archived)) prefs.calProject = null;
  const filter = prefs.calProject || '';
  const today = U.todayKey();
  const items = S.tasks
    .filter((t) => (!filter || t.projectId === filter) && (prefs.calShowDone || !t.done) && proj(t.projectId) && !proj(t.projectId).archived && !isGroup(t) && (!prefs.calTag || (t.tags || []).includes(prefs.calTag)))
    .map((t) => {
      const p = proj(t.projectId);
      const title = t.timeStart && t.start === taskEnd(t) ? `${t.timeStart} ${t.title}` : t.title;
      return { id: t.id, title, start: t.start, end: taskEnd(t), type: t.type, done: t.done, late: !t.done && taskEnd(t) < today, color: p.color, project: p.name };
    });
  if (!prefs.calTag) {
    for (const m of S.meetings || []) {
      const p = proj(m.projectId);
      if (!p || p.archived || (filter && m.projectId !== filter)) continue;
      const past = meetEnd(m).getTime() < Date.now();
      if (past && !prefs.calShowDone) continue;
      items.push({ id: m.id, title: `${m.start} ${m.title}`, start: m.date, end: m.date, type: 'reuniao', action: 'edit-meeting', done: past, color: p.color, project: p.name, time: meetTime(m) });
    }
  }
  const hoursByDay = {};
  for (const e of allEntries()) {
    if (filter && e.projectId !== filter) continue;
    const k = U.toKey(new Date(e.start));
    hoursByDay[k] = (hoursByDay[k] || 0) + entryMs(e);
  }
  c.innerHTML = `
    <div class="toolbar">
      <div class="seg">
        <button data-action="cal-move" data-d="-1" title="Mês anterior">‹</button>
        <button data-action="cal-today">Hoje</button>
        <button data-action="cal-move" data-d="1" title="Próximo mês">›</button>
      </div>
      <h2 class="cal-title">${U.MESES[m.getMonth()]} ${m.getFullYear()}</h2>
      <div class="spacer"></div>
      <label class="check"><input type="checkbox" data-bind="cal-done" ${prefs.calShowDone ? 'checked' : ''}> Mostrar concluídas</label>
      ${allTags().length ? `<select data-bind="cal-tag"><option value="">Todas as tags</option>${allTags().map((tg) => `<option value="${U.esc(tg)}" ${prefs.calTag === tg ? 'selected' : ''}>#${U.esc(tg)}</option>`).join('')}</select>` : ''}
      <select data-bind="cal-project">
        <option value="">Todos os projetos</option>
        ${liveProjects().map((p) => `<option value="${p.id}" ${p.id === filter ? 'selected' : ''}>${U.esc(p.name)}</option>`).join('')}
      </select>
      <button class="btn" data-action="new-meeting" ${S.projects.length ? '' : 'disabled'}>＋ Reunião</button>
      <button class="btn primary" data-action="new-task" data-type="tarefa" ${S.projects.length ? '' : 'disabled'}>＋ Novo</button>
    </div>
    <div id="calHost"></div>
    <p class="muted small">Clique em um dia para criar uma tarefa ou entrega. ◆ = entrega. ◷ = reunião. ⏱ = horas registradas no dia.</p>`;
  Calendar.render($('#calHost'), { monthKey, items, hoursByDay });
}

// ---------- Projeto ----------
const TABS = [['gantt', 'Cronograma'], ['meetings', 'Reuniões'], ['notes', 'Anotações'], ['briefing', 'Briefing'], ['hours', 'Horas']];
function renderProject(c) {
  const p = proj(view.projectId);
  const tab = view.tab || prefs.tabs[p.id] || 'gantt';
  view.tab = tab;
  const prog = projectProgress(p.id);
  const head = `<div class="tabs-row">
      <div class="tabs">${TABS.map(([id, l]) => `<button class="tab${tab === id ? ' active' : ''}" data-action="tab" data-tab="${id}">${l}</button>`).join('')}</div>
      <div class="spacer"></div>
      <span class="muted small">${prog == null ? '' : `${prog}% concluído · `}${U.dur(projectHours(p.id))} registradas</span>
      <button class="btn" data-action="report-project" data-id="${p.id}" title="Gerar relatório do projeto em PDF">⤓ Exportar PDF</button>
    </div>${projectLinksBar(p)}`;
  if (tab === 'gantt') { c.className = 'fill'; c.innerHTML = head + '<div id="tabBody" class="tab-body fill"></div>'; return renderGanttTab(p, $('#tabBody')); }
  c.innerHTML = head + '<div id="tabBody" class="tab-body"></div>';
  const b = $('#tabBody');
  if (tab === 'notes') { c.className = 'fill'; b.classList.add('fill'); return renderNotes(p, b); }
  if (tab === 'briefing') return renderBriefing(p, b);
  if (tab === 'meetings') return renderMeetings(p, b);
  if (tab === 'hours') return renderHours(b, p.id);
}

function renderGanttTab(p, b) {
  const tasks = S.tasks.filter((t) => t.projectId === p.id);
  if (prefs.zoom === 'horas') {
    b.innerHTML = `
      <div class="toolbar wrap">
        <button class="btn primary" data-action="new-task" data-type="tarefa">＋ Tarefa</button>
        <button class="btn" data-action="new-meeting" data-project="${p.id}">＋ Reunião</button>
        ${dayToolbar()}${zoomSeg(prefs.zoom, 'gantt-zoom')}
      </div>
      <div id="ganttHost" class="gantt-host"></div>
      <p class="muted small gantt-help">${DAY_HELP}</p>`;
    renderDayView($('#ganttHost'), [p.id], false);
    return;
  }
  b.innerHTML = `
    <div class="toolbar">
      <button class="btn primary" data-action="new-task" data-type="tarefa">＋ Tarefa</button>
      <button class="btn" data-action="new-task" data-type="entrega">◆ Entrega</button>
      <div class="spacer"></div>
      ${tasks.some((t) => t.parentId) ? `<div class="seg">
        <button data-action="gantt-expand-all" title="Expandir todos os grupos">Expandir tudo</button>
        <button data-action="gantt-collapse-all" title="Recolher todos os grupos">Recolher tudo</button>
      </div>` : ''}
      <label class="check small" title="Quando uma tarefa atrasa, as que dependem dela são empurradas para frente"><input type="checkbox" data-bind="gantt-auto" ${prefs.autoSchedule !== false ? 'checked' : ''}> Empurrar dependentes</label>
      ${zoomSeg(prefs.zoom, 'gantt-zoom')}
      <button class="btn" data-action="gantt-today">Hoje</button>
    </div>
    <div id="ganttHost" class="gantt-host"></div>
    <p class="muted small gantt-help">Arraste as barras para mudar datas · puxe as bordas para mudar a duração · arraste a bolinha ● da ponta até outra tarefa para criar dependência · clique numa seta para removê-la · ＋ na linha cria subtarefa</p>`;
  const host = $('#ganttHost');
  if (!tasks.length) {
    host.innerHTML = `<div class="empty-hero small">
      <h2>Monte o cronograma</h2>
      <p>Adicione tarefas (com início e fim) e entregas (marcos com data única). Elas aparecem aqui no Gantt e no Calendário.</p>
      <div><button class="btn primary" data-action="new-task" data-type="tarefa">＋ Primeira tarefa</button>
      <button class="btn" data-action="new-task" data-type="entrega">◆ Entrega</button></div></div>`;
    return;
  }
  Gantt.render(host, {
    projectId: p.id, color: p.color, tasks, zoom: prefs.zoom, collapsed: prefs.collapsed,
    onEdit: (t) => taskModal(t),
    onChange: (t, patch) => { TaskTree.move(S.tasks, t, patch.start, patch.end); commit(); },
    onLink: (fromId, toId) => {
      const problem = TaskTree.linkProblem(S.tasks, fromId, toId);
      if (problem) { alert(problem); return; }
      const t = task(toId);
      t.deps = [...(t.deps || []), fromId];
      commit();
    },
  });
}

// ---------- Anotações ----------
function renderNotes(p, b) {
  const q = (prefs.noteSearch || '').toLowerCase();
  const notes = S.notes.filter((n) => n.projectId === p.id)
    .sort((a, b2) => (b2.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b2.updatedAt.localeCompare(a.updatedAt));
  const shown = notes.filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
  let sel = notes.find((n) => n.id === prefs.notes[p.id]) || shown[0];
  const mode = prefs.noteMode || 'edit';
  b.innerHTML = `
    <div class="notes">
      <div class="notes-list">
        <div class="nl-top">
          <input type="search" placeholder="Buscar anotações" data-bind="note-search" value="${U.esc(prefs.noteSearch || '')}">
          <button class="btn primary" data-action="new-note" title="Nova anotação">＋</button>
        </div>
        <div class="nl-items">
          ${shown.map((n) => `<button class="nl-item${sel && n.id === sel.id ? ' active' : ''}" data-action="open-note" data-id="${n.id}">
            <span class="nl-title">${n.pinned ? '📌 ' : ''}${U.esc(n.title || 'Sem título')}</span>
            <span class="nl-meta">${new Date(n.updatedAt).toLocaleDateString('pt-BR')} · ${U.esc((n.body || '').replace(/\s+/g, ' ').slice(0, 60))}</span>
          </button>`).join('') || `<p class="muted small pad">${notes.length ? 'Nada encontrado.' : 'Nenhuma anotação ainda.'}</p>`}
        </div>
      </div>
      <div class="notes-editor">
        ${sel ? `
          <div class="ne-top">
            <input class="ne-title" data-bind="note-title" data-id="${sel.id}" value="${U.esc(sel.title)}" placeholder="Título">
            <div class="seg">
              <button class="${mode === 'edit' ? 'active' : ''}" data-action="note-mode" data-mode="edit">Editar</button>
              <button class="${mode === 'view' ? 'active' : ''}" data-action="note-mode" data-mode="view">Visualizar</button>
            </div>
            <button class="icon-btn" data-action="pin-note" data-id="${sel.id}" title="${sel.pinned ? 'Desafixar' : 'Fixar no topo'}">${sel.pinned ? '📌' : '📍'}</button>
            <button class="icon-btn danger" data-action="delete-note" data-id="${sel.id}" title="Excluir">🗑</button>
          </div>
          ${mode === 'edit'
            ? `<textarea class="ne-body" data-bind="note-body" data-id="${sel.id}" placeholder="Escreva aqui…&#10;&#10;Dicas: # Título  ·  - lista  ·  - [ ] checklist  ·  **negrito**  ·  *itálico*">${U.esc(sel.body)}</textarea>`
            : `<div class="ne-view md" data-id="${sel.id}">${U.markdown(sel.body) || '<p class="muted">Vazia.</p>'}</div>`}
          <div class="ne-foot muted small">Salvo automaticamente · editado em ${new Date(sel.updatedAt).toLocaleString('pt-BR')}</div>
        ` : `<div class="empty-hero small"><h2>Anotações do projeto</h2><p>Reuniões, ideias, checklists, links…</p><button class="btn primary" data-action="new-note">＋ Nova anotação</button></div>`}
      </div>
    </div>`;
}

// ---------- Briefing ----------
const BRIEF_FIELDS = [
  ['cliente', 'Cliente e contato', 'input', 'Nome, e-mail, telefone'],
  ['resumo', 'Resumo do projeto', 'textarea', 'Em poucas linhas: o que é e por que existe'],
  ['objetivos', 'Objetivos', 'textarea', 'O que precisa ser alcançado? Como medir o sucesso?'],
  ['publico', 'Público-alvo', 'textarea', 'Para quem é? Perfil, necessidades'],
  ['entregaveis', 'Entregáveis', 'textarea', 'Lista do que será entregue'],
  ['prazos', 'Prazos e marcos', 'textarea', 'Datas importantes, reuniões, aprovações'],
  ['orcamento', 'Orçamento', 'input', 'Valor, forma de pagamento'],
  ['tom', 'Tom, estilo e identidade', 'textarea', 'Linguagem, cores, referências de marca'],
  ['referencias', 'Referências e inspirações', 'textarea', 'Links, concorrentes, exemplos'],
  ['restricoes', 'Restrições e observações', 'textarea', 'O que evitar, limitações técnicas, requisitos'],
  ['aprovacao', 'Responsável pela aprovação', 'input', 'Quem aprova as entregas'],
];
function meetingCard(m) {
  const d = U.fromKey(m.date);
  const past = meetEnd(m).getTime() < Date.now();
  const first = (m.notes || '').split('\n').map((x) => x.replace(/^[#>*\-\s\[\]x]+/i, '').trim()).find(Boolean);
  const meta = [`${U.DIAS[d.getDay()]}, ${meetTime(m)}`, m.location, m.participants].filter(Boolean).map(U.esc).join(' · ');
  return `<div class="meet-card${past ? ' past' : ''}${m.date === U.todayKey() ? ' today' : ''}">
    <div class="meet-date"><b>${d.getDate()}</b><small>${U.MESES_CURTOS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}</small></div>
    <button class="meet-main" data-action="edit-meeting" data-id="${m.id}">
      <span class="meet-title">${U.esc(m.title)}</span>
      <span class="meet-meta">${meta}${m.logHours ? ' · <span title="As horas entram no projeto quando a reunião termina">⏱ horas lançadas</span>' : ''}</span>
      ${first ? `<span class="meet-notes">${U.esc(first)}</span>` : ''}
    </button>
    ${m.link ? `<button class="btn" data-action="meeting-join" data-id="${m.id}" title="${U.esc(m.link)}">${linkInfo(m.link).icon} Entrar</button>` : ''}
  </div>`;
}
function renderMeetings(p, b) {
  const all = (S.meetings || []).filter((m) => m.projectId === p.id);
  const now = Date.now();
  const next = all.filter((m) => meetEnd(m).getTime() >= now).sort(byMeetTime);
  const past = all.filter((m) => meetEnd(m).getTime() < now).sort((a, b2) => byMeetTime(b2, a));
  b.innerHTML = `
    <div class="toolbar">
      <span class="muted small">${all.length ? `${next.length} próxima(s) · ${past.length} anterior(es)` : ''}</span>
      <div class="spacer"></div>
      <button class="btn primary" data-action="new-meeting" data-project="${p.id}">＋ Nova reunião</button>
    </div>
    ${!all.length ? `<div class="empty-hero small"><div class="hero-icon">◷</div><h2>Nenhuma reunião ainda</h2>
      <p>Registre reuniões com horário, assunto, link da chamada, participantes e pauta. Elas aparecem também no calendário e no painel, com lembrete antes de começar.</p>
      <button class="btn primary" data-action="new-meeting" data-project="${p.id}">＋ Nova reunião</button></div>` : ''}
    ${next.length ? `<div class="sub-h">Próximas</div><div class="meet-list">${next.map(meetingCard).join('')}</div>` : ''}
    ${past.length ? `<div class="sub-h" style="margin-top:18px">Anteriores</div><div class="meet-list">${past.map(meetingCard).join('')}</div>` : ''}`;
}

function renderBriefing(p, b) {
  const br = p.briefing || {};
  b.innerHTML = `
    <div class="toolbar">
      <span class="muted small" id="briefSaved">Preenchimento salvo automaticamente.</span>
      <div class="spacer"></div>
      <button class="btn" data-action="brief-copy">Copiar como texto</button>
      <button class="btn primary" data-action="brief-pdf">Exportar PDF</button>
    </div>
    <div class="brief-grid">
      ${BRIEF_FIELDS.map(([k, label, type, ph]) => `
        <label class="brief-field${type === 'textarea' ? '' : ' short'}">
          <span>${label}</span>
          ${type === 'textarea'
            ? `<textarea data-bind="brief" data-key="${k}" placeholder="${ph}" rows="3">${U.esc(br[k] || '')}</textarea>`
            : `<input data-bind="brief" data-key="${k}" placeholder="${ph}" value="${U.esc(br[k] || '')}">`}
        </label>`).join('')}
    </div>`;
  $$('textarea[data-bind="brief"]', b).forEach(autoGrow);
}
function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.max(70, el.scrollHeight + 2) + 'px'; }
function briefingText(p) {
  const br = p.briefing || {};
  return `BRIEFING — ${p.name}\n${'='.repeat(30)}\n\n` + BRIEF_FIELDS.filter(([k]) => br[k]).map(([k, l]) => `${l.toUpperCase()}\n${br[k]}\n`).join('\n');
}

// ---------- Horas ----------
const PERIODS = [['hoje', 'Hoje'], ['semana', 'Esta semana'], ['semanapassada', 'Semana passada'], ['mes', 'Este mês'], ['mespassado', 'Mês passado'], ['custom', 'Período…'], ['tudo', 'Tudo']];
function filteredEntries(projectId) {
  const [from, to] = periodRange(prefs.hPeriod || 'semana');
  const pf = projectId || (prefs.hProject && proj(prefs.hProject) ? prefs.hProject : null);
  return {
    from, to, pf,
    list: allEntries().filter((e) => (!pf || e.projectId === pf) && msInRange(e, from, to) > 0).sort((a, b) => b.start.localeCompare(a.start)),
  };
}
// Agrupamento das horas: por tarefa; as que vieram de reuniões ficam juntas em "Reuniões".
const entryKey = (e) => (e.meetingId && !e.taskId ? '#reunioes' : e.taskId || '');
const entryKeyLabel = (k) => (k === '#reunioes' ? 'Reuniões' : k ? task(k)?.title || '(tarefa excluída)' : 'Sem tarefa');

function renderHours(c, projectId) {
  const period = prefs.hPeriod || 'semana';
  const { from, to, pf, list } = filteredEntries(projectId);
  const total = list.reduce((a, e) => a + msInRange(e, from, to), 0);
  const byProject = {};
  for (const e of list) byProject[e.projectId] = (byProject[e.projectId] || 0) + msInRange(e, from, to);
  const byTask = {};
  if (projectId) for (const e of list) byTask[entryKey(e)] = (byTask[entryKey(e)] || 0) + msInRange(e, from, to);
  const breakdown = projectId
    ? Object.entries(byTask).map(([tid, ms]) => ({ label: entryKeyLabel(tid), color: proj(projectId).color, ms }))
    : Object.entries(byProject).map(([pid, ms]) => ({ label: proj(pid)?.name || '(projeto excluído)', color: proj(pid)?.color || '#999', ms }));
  breakdown.sort((a, b) => b.ms - a.ms);
  const max = Math.max(1, ...breakdown.map((x) => x.ms));

  const byDay = {};
  for (const e of list) (byDay[U.toKey(new Date(e.start))] ||= []).push(e);

  c.innerHTML = `
    <div class="toolbar wrap">
      <div class="seg">${PERIODS.map(([id, l]) => `<button class="${period === id ? 'active' : ''}" data-action="h-period" data-p="${id}">${l}</button>`).join('')}</div>
      ${period === 'custom' ? `<input type="date" data-bind="h-from" value="${prefs.hFrom || ''}"> até <input type="date" data-bind="h-to" value="${prefs.hTo || ''}">` : ''}
      ${!projectId ? `<select data-bind="h-project"><option value="">Todos os projetos</option>${S.projects.map((p) => `<option value="${p.id}" ${p.id === pf ? 'selected' : ''}>${U.esc(p.name)}</option>`).join('')}</select>` : ''}
      <div class="spacer"></div>
      <button class="btn" data-action="new-entry" ${S.projects.length ? '' : 'disabled'}>＋ Lançar manualmente</button>
      <button class="btn" data-action="export-csv" ${list.length ? '' : 'disabled'}>Exportar CSV</button>
    </div>
    <div class="hours-top">
      <div class="stat big"><span class="stat-v">${U.dur(total)}</span><span class="stat-l">${U.hoursDecimal(total)} h no período</span></div>
      <div class="card flex1">
        <h3>${projectId ? 'Por tarefa' : 'Por projeto'}</h3>
        ${breakdown.length ? breakdown.map((x) => `<div class="hbar-row"><span class="hb-name">${U.esc(x.label)}</span>
          <span class="hb-bar"><span style="width:${(x.ms / max) * 100}%;background:${x.color}"></span></span>
          <span class="hb-v">${U.dur(x.ms)}</span></div>`).join('') : '<p class="muted">Sem registros no período.</p>'}
      </div>
    </div>
    <div class="entries">
      ${Object.keys(byDay).sort().reverse().map((k) => {
        const es = byDay[k];
        const dayTotal = es.reduce((a, e) => a + msInRange(e, from, to), 0);
        return `<div class="day-group">
          <div class="dg-head"><span>${U.fmtDateLong(k)}</span><span>${U.dur(dayTotal)}</span></div>
          ${es.map((e) => {
            const p = proj(e.projectId);
            const t = e.taskId ? task(e.taskId) : null;
            return `<div class="entry${e.running ? ' running' : ''}">
              <span class="en-time">${U.fmtTime(e.start)} – ${e.running ? 'agora' : U.fmtTime(e.end)}</span>
              ${!projectId && p ? `<span class="tag" style="--c:${p.color}">${U.esc(p.name)}</span>` : ''}
              <span class="en-desc">${t ? `<b>${U.esc(t.title)}</b> ` : ''}${U.esc(e.description || '')}${!t && !e.description ? '<span class="muted">sem descrição</span>' : ''}</span>
              <span class="en-dur">${U.dur(entryMs(e))}</span>
              ${e.running ? '<span class="rec-dot"></span>' : `<button class="icon-btn" data-action="edit-entry" data-id="${e.id}" title="Editar">✎</button>
              <button class="icon-btn danger" data-action="delete-entry" data-id="${e.id}" title="Excluir">🗑</button>`}
            </div>`;
          }).join('')}
        </div>`;
      }).join('') || `<div class="empty-hero small"><p>Nenhum registro de horas neste período.<br>Escolha o projeto lá em cima e clique em <b>Rec</b> para começar.</p></div>`}
    </div>`;
}

// ---------- Modais ----------
let closeCurrentModal = null;
function closeModal() { if (closeCurrentModal) closeCurrentModal(); }
function modal({ title, body, buttons, wide, onOpen }) {
  closeModal();
  const root = $('#modalRoot');
  root.innerHTML = `<div class="backdrop"><div class="modal${wide ? ' wide' : ''}" role="dialog">
      <h2>${title}</h2><div class="modal-body">${body}</div>
      <div class="modal-actions">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}</div>
    </div></div>`;
  const el = $('.modal', root);
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey, true); closeCurrentModal = null; };
  closeCurrentModal = close;
  let busy = false;
  const run = async (b) => {
    if (busy) return; // evita rodar duas vezes (ex.: duas janelas de salvar PDF)
    busy = true;
    try { const r = await b.action?.(el); if (r !== false) close(); } finally { busy = false; }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON' && !e.isComposing && !((e.target.classList.contains('tag-entry') || e.target.classList.contains('le-url')) && e.target.value.trim())) {
      const primary = buttons.find((b) => (b.cls || '').includes('primary'));
      if (primary) { e.preventDefault(); run(primary); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  $('.backdrop', root).addEventListener('mousedown', (e) => { if (e.target.classList.contains('backdrop')) close(); });
  $$('.modal-actions button', el).forEach((btn) => btn.addEventListener('click', () => run(buttons[+btn.dataset.i])));
  onOpen?.(el);
  const first = $('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select', el);
  if (first) setTimeout(() => first.focus(), 30);
  return { el, close };
}
const val = (el, name) => $(`[name="${name}"]`, el)?.value?.trim() ?? '';

function projectModal(p) {
  const isNew = !p;
  p ||= { name: '', client: '', color: U.CORES[S.projects.length % U.CORES.length], status: 'ativo' };
  modal({
    title: isNew ? 'Novo projeto' : 'Editar projeto',
    body: `
      <label class="field"><span>Nome do projeto</span><input name="name" value="${U.esc(p.name)}" placeholder="Ex.: Site institucional"></label>
      <label class="field"><span>Cliente</span><input name="client" value="${U.esc(p.client || '')}" placeholder="Opcional"></label>
      <div class="field"><span>Cor</span><div class="swatches">${U.CORES.map((c) => `<label class="sw" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === p.color ? 'checked' : ''}><span></span></label>`).join('')}</div></div>
      <label class="field"><span>Status</span><select name="status">
        ${[['ativo', 'Ativo'], ['pausado', 'Pausado'], ['concluido', 'Concluído']].map(([v, l]) => `<option value="${v}" ${p.status === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>`,
    buttons: [
      ...(!isNew ? [{ label: p.archived ? 'Excluir definitivamente' : 'Arquivar projeto', cls: (p.archived ? 'danger' : '') + ' left', action: async () => {
        if (p.archived) { if (!(await deleteProject(p))) return false; } else await archiveProject(p);
      } }] : []),
      { label: 'Cancelar' },
      { label: isNew ? 'Criar projeto' : 'Salvar', cls: 'primary', action: (el) => {
        const name = val(el, 'name');
        if (!name) { $('[name=name]', el).focus(); return false; }
        const data = { name, client: val(el, 'client'), color: $('[name=color]:checked', el)?.value || p.color, status: val(el, 'status') };
        if (isNew) {
          const np = { id: U.uid(), createdAt: new Date().toISOString(), briefing: {}, ...data };
          S.projects.push(np);
          view = { name: 'project', projectId: np.id, tab: 'gantt' };
          prefs.view = view; savePrefs();
        } else Object.assign(p, data);
        commit();
      } },
    ],
  });
}

function taskModal(t, defaults = {}) {
  const isNew = !t;
  const today = U.todayKey();
  if (isNew) {
    const pid = defaults.projectId || (view.name === 'project' ? view.projectId : prefs.calProject) || activeProjects()[0]?.id || S.projects[0]?.id;
    if (!pid) return projectModal();
    const parent = defaults.parentId ? task(defaults.parentId) : null;
    const start = parent ? parent.start : defaults.date || today;
    const end = parent ? taskEnd(parent) : defaults.date ? start : U.addDays(start, 4);
    t = { projectId: parent ? parent.projectId : pid, parentId: parent ? parent.id : null, deps: [], type: defaults.type || 'tarefa', title: '', start, end: defaults.type === 'entrega' ? start : end, progress: 0, done: false, notes: '' };
  }
  const tags = [...(t.tags || [])];
  const links = (t.links || []).map((l) => ({ ...l }));
  const group = !isNew && isGroup(t);
  const kids = group ? TaskTree.descendants(S.tasks, t.id) : [];
  // Opções válidas de tarefa-mãe e de dependências dentro de um projeto.
  const parentOptions = (pid) => {
    const bad = new Set(isNew ? [] : [t.id, ...kids.map((k) => k.id)]);
    return `<option value="">Nenhuma (tarefa principal)</option>` + TaskTree.ordered(S.tasks.filter((x) => x.projectId === pid))
      .filter(({ t: x }) => x.type !== 'entrega' && !bad.has(x.id))
      .map(({ t: x, depth }) => `<option value="${x.id}" ${x.id === t.parentId && pid === t.projectId ? 'selected' : ''}>${'\u2003'.repeat(depth)}${depth ? '↳ ' : ''}${U.esc(x.title)}</option>`).join('');
  };
  const depOptions = (pid) => {
    const list = TaskTree.ordered(S.tasks.filter((x) => x.projectId === pid))
      .filter(({ t: x }) => isNew || (x.id !== t.id && !TaskTree.linkProblem(S.tasks, x.id, t.id)) || (t.deps || []).includes(x.id));
    if (!list.length) return '<span class="muted small">Nenhuma outra tarefa neste projeto.</span>';
    return list.map(({ t: x, depth }) => `<label class="check" style="padding-left:${depth * 14}px"><input type="checkbox" name="dep" value="${x.id}" ${(t.deps || []).includes(x.id) && pid === t.projectId ? 'checked' : ''}>
      ${x.type === 'entrega' ? '◆ ' : ''}${U.esc(x.title)} <span class="muted small">${x.type === 'entrega' ? U.fmtDate(x.start) : `${U.fmtDate(x.start)} – ${U.fmtDate(taskEnd(x))}`}</span></label>`).join('');
  };
  const spent = S.timeEntries.filter((e) => e.taskId === t.id).reduce((a, e) => a + entryMs(e), 0);
  const { el } = modal({
    title: isNew ? (t.type === 'entrega' ? 'Nova entrega' : 'Nova tarefa') : 'Editar',
    body: `
      <div class="field-row">
        <label class="field"><span>Projeto</span><select name="projectId">${S.projects.filter((x) => !x.archived || x.id === t.projectId).map((x) => `<option value="${x.id}" ${x.id === t.projectId ? 'selected' : ''}>${U.esc(x.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Tipo</span><select name="type" ${group ? 'disabled' : ''}>
          <option value="tarefa" ${t.type !== 'entrega' ? 'selected' : ''}>Tarefa (período)</option>
          <option value="entrega" ${t.type === 'entrega' ? 'selected' : ''}>Entrega / marco (uma data)</option>
        </select></label>
      </div>
      <label class="field"><span>Título</span><input name="title" value="${U.esc(t.title)}" placeholder="${t.type === 'entrega' ? 'Ex.: Entrega do layout final' : 'Ex.: Criar wireframes'}"></label>
      <div class="field-row">
        <label class="field"><span>Prioridade</span><select name="priority">
          <option value="">Sem prioridade</option>
          ${PRIOS.map(([v, l]) => `<option value="${v}" ${t.priority === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
        <label class="field"><span>Hoje</span><label class="check focus-check"><input type="checkbox" name="focus" ${isFocus(t) ? 'checked' : ''}> ☀ No foco de hoje</label></label>
      </div>
      <div class="field"><span>Tags</span>
        <div class="tag-input"><span class="chips"></span><input class="tag-entry" placeholder="Digite e tecle Enter (ex.: urgente, cliente, revisão)"></div>
        <div class="tag-sugs"></div>
      </div>
      <label class="field"><span>Faz parte de (tarefa-mãe)</span><select name="parentId">${parentOptions(t.projectId)}</select></label>
      ${group ? `<div class="derived-note">Esta tarefa é um grupo com ${kids.length} subtarefa(s): datas e progresso são calculados a partir delas. Mova o grupo inteiro arrastando a barra no Gantt.</div>` : ''}
      <div class="field-row">
        <label class="field"><span class="lbl-start">${t.type === 'entrega' ? 'Data' : 'Início'}</span><input type="date" name="start" value="${t.start}" ${group ? 'disabled' : ''}></label>
        <label class="field only-task"><span>Fim</span><input type="date" name="end" value="${taskEnd(t)}" ${group ? 'disabled' : ''}></label>
      </div>
      ${group ? '' : `<div class="field-row">
        <label class="field"><span>Horário <small class="muted">(opcional, para organizar o dia)</small></span><input type="time" name="timeStart" value="${t.timeStart || ''}"></label>
        <label class="field only-task"><span>Até</span><input type="time" name="timeEnd" value="${t.timeEnd || ''}"></label>
      </div>`}
      <label class="field only-task"><span>Progresso: <b class="prog-v">${t.progress || 0}%</b></span><input type="range" name="progress" min="0" max="100" step="5" value="${t.progress || 0}" ${group ? 'disabled' : ''}></label>
      <label class="check"><input type="checkbox" name="done" ${t.done ? 'checked' : ''}> Concluída${group ? ' (marca todas as subtarefas)' : ''}</label>
      <div class="field" style="margin-top:12px"><span>Depende de <small class="muted">(pode começar no mesmo dia em que ela termina)</small></span><div class="deps-list">${depOptions(t.projectId)}</div></div>
      <div class="field"><span>Links (pasta do Drive, arquivos, referências)</span><div class="links-editor"></div></div>
      <label class="field"><span>Observações</span><textarea name="notes" rows="3">${U.esc(t.notes || '')}</textarea></label>
      ${!isNew ? `<p class="muted small">${spent ? `⏱ ${U.dur(spent)} registradas nesta tarefa.` : ''} <button class="link-btn" data-action="record-task" data-id="${t.id}">▶ Gravar horas nesta tarefa</button></p>` : ''}`,
    buttons: [
      ...(!isNew ? [{ label: 'Excluir', cls: 'danger left', action: () => {
        if (!confirm(group ? `Excluir o grupo "${t.title}" e suas ${kids.length} subtarefa(s)?` : `Excluir "${t.title}"?`)) return false;
        const gone = new Set([t.id, ...kids.map((k) => k.id)]);
        S.tasks = S.tasks.filter((x) => !gone.has(x.id));
        S.tasks.forEach((x) => { if (x.deps) x.deps = x.deps.filter((d) => !gone.has(d)); });
        S.timeEntries.forEach((e) => { if (gone.has(e.taskId)) e.taskId = null; });
        commit();
      } }] : []),
      { label: 'Cancelar' },
      { label: 'Salvar', cls: 'primary', action: (el2) => {
        const title = val(el2, 'title');
        if (!title) { $('[name=title]', el2).focus(); return false; }
        const type = group ? 'tarefa' : val(el2, 'type');
        const start = val(el2, 'start') || today;
        let end = type === 'entrega' ? start : (val(el2, 'end') || start);
        if (end < start) end = start;
        const done = $('[name=done]', el2).checked;
        const projectId = val(el2, 'projectId');
        const deps = $$('[name=dep]:checked', el2).map((c) => c.value);
        addTag($('.tag-entry', el2).value);
        if ($('.le-url', el2).value.trim()) { alert('Tecle Enter ou clique em Adicionar para incluir o link digitado.'); return false; }
        const focusOn = $('[name=focus]', el2).checked;
        const data = { projectId, parentId: val(el2, 'parentId') || null, deps, type, title, notes: val(el2, 'notes'), priority: val(el2, 'priority') || null, tags: tags.slice(), links: links.slice(), focusDate: focusOn ? today : (t.focusDate === today ? null : t.focusDate || null) };
        if (!group) Object.assign(data, { start, end, progress: +val(el2, 'progress') || 0, done });
        if (!group) {
          // Horário: em tarefas de vários dias, vale para cada dia.
          const ts = val(el2, 'timeStart');
          let te = type === 'entrega' ? '' : val(el2, 'timeEnd');
          if (ts && type !== 'entrega' && (!te || te <= ts)) te = DayView.fromMin(Math.min(1439, DayView.toMin(ts) + 60));
          data.timeStart = ts || undefined;
          data.timeEnd = ts && te ? te : undefined;
        }
        if (done && !group) { if (!t.done) data.prevProgress = +val(el2, 'progress') || 0; data.progress = 100; }
        if (isNew) S.tasks.push({ id: U.uid(), createdAt: new Date().toISOString(), ...data });
        else {
          if (projectId !== t.projectId) {
            // Mudou de projeto: leva as subtarefas e desfaz ligações com o projeto antigo.
            const moving = new Set([t.id, ...kids.map((k) => k.id)]);
            kids.forEach((k) => { k.projectId = projectId; k.deps = (k.deps || []).filter((d) => moving.has(d)); });
            S.tasks.forEach((x) => { if (!moving.has(x.id) && x.deps) x.deps = x.deps.filter((d) => !moving.has(d)); });
          }
          const wasDone = t.done;
          Object.assign(t, data);
          if (group && done !== wasDone) kids.forEach((k) => { k.done = done; if (done) k.progress = 100; });
        }
        commit();
      } },
    ],
  });
  const sync = () => {
    const ms = val(el, 'type') === 'entrega';
    $$('.only-task', el).forEach((x) => { x.style.display = ms ? 'none' : ''; });
    $('.lbl-start', el).textContent = ms ? 'Data' : 'Início';
  };
  $('[name=type]', el).addEventListener('change', sync);
  // Campo de tags com sugestões das já usadas.
  const entry = $('.tag-entry', el);
  const drawTags = () => {
    $('.tag-input .chips', el).innerHTML = tags.map((tg, i) => `<span class="tchip on" style="--c:${tagColor(tg)}">#${U.esc(tg)}<button type="button" data-i="${i}" title="Remover">×</button></span>`).join('');
    const sugs = allTags().filter((tg) => !tags.includes(tg) && (!entry.value || tg.toLowerCase().includes(entry.value.toLowerCase())));
    $('.tag-sugs', el).innerHTML = sugs.slice(0, 14).map((tg) => `<button type="button" class="tchip" style="--c:${tagColor(tg)}" data-tag="${U.esc(tg)}">#${U.esc(tg)}</button>`).join('');
  };
  function addTag(raw) {
    for (const piece of String(raw || '').split(',')) {
      const tg = piece.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
      if (tg && !tags.includes(tg)) tags.push(tg);
    }
    entry.value = '';
    drawTags();
  }
  entry.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && entry.value.trim()) { e.preventDefault(); addTag(entry.value); }
    else if (e.key === 'Backspace' && !entry.value && tags.length) { tags.pop(); drawTags(); }
  });
  entry.addEventListener('input', drawTags);
  $('.tag-input', el).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) { tags.splice(+b.dataset.i, 1); drawTags(); } else entry.focus();
  });
  $('.tag-sugs', el).addEventListener('click', (e) => { const b = e.target.closest('button[data-tag]'); if (b) addTag(b.dataset.tag); });
  mountLinksEditor($('.links-editor', el), links);
  drawTags();
  $('[name=projectId]', el).addEventListener('change', (ev) => {
    $('[name=parentId]', el).innerHTML = parentOptions(ev.target.value);
    $('.deps-list', el).innerHTML = depOptions(ev.target.value);
  });
  $('[name=progress]', el).addEventListener('input', (e) => { $('.prog-v', el).textContent = e.target.value + '%'; });
  $('[name=start]', el).addEventListener('change', (e) => { const endI = $('[name=end]', el); if (endI.value < e.target.value) endI.value = e.target.value; });
  const tsI = $('[name=timeStart]', el), teI = $('[name=timeEnd]', el);
  if (tsI) tsI.addEventListener('change', () => { if (tsI.value && (!teI.value || teI.value <= tsI.value)) teI.value = DayView.fromMin(Math.min(1439, DayView.toMin(tsI.value) + 60)); });
  sync();
}

const REMINDERS = [[0, 'Sem lembrete'], [5, '5 min antes'], [10, '10 min antes'], [15, '15 min antes'], [30, '30 min antes'], [60, '1 hora antes']];
function meetingModal(m, defaults = {}) {
  const isNew = !m;
  if (isNew) {
    const nowD = new Date();
    const h = Math.min(23, nowD.getHours() + 1);
    const pid = defaults.projectId || (view.name === 'project' ? view.projectId : prefs.calProject) || activeProjects()[0]?.id || S.projects[0]?.id;
    m = { projectId: pid, title: '', date: defaults.date || U.todayKey(), start: `${U.pad(h)}:00`, end: `${U.pad(Math.min(23, h + 1))}:00`,
      link: '', location: '', participants: '', notes: '', remind: 10, logHours: true };
  }
  const { el } = modal({
    title: isNew ? 'Nova reunião' : 'Editar reunião',
    wide: true,
    body: `
      <div class="field-row">
        <label class="field flex1"><span>Assunto</span><input name="title" value="${U.esc(m.title)}" placeholder="Ex.: Alinhamento do layout"></label>
        <label class="field"><span>Projeto</span><select name="projectId">${S.projects.filter((p) => !p.archived || p.id === m.projectId).map((p) => `<option value="${p.id}" ${p.id === m.projectId ? 'selected' : ''}>${U.esc(p.name)}</option>`).join('')}</select></label>
      </div>
      <div class="field-row three">
        <label class="field"><span>Data</span><input type="date" name="date" value="${m.date}"></label>
        <label class="field"><span>Início</span><input type="time" name="start" value="${m.start}"></label>
        <label class="field"><span>Fim</span><input type="time" name="end" value="${m.end || ''}"></label>
      </div>
      <div class="field-row">
        <label class="field flex1"><span>Link da chamada <small class="muted">(Meet, Zoom, Teams…)</small></span><input name="link" value="${U.esc(m.link || '')}" placeholder="https://meet.google.com/…"></label>
        <label class="field flex1"><span>Local <small class="muted">(opcional)</small></span><input name="location" value="${U.esc(m.location || '')}" placeholder="Ex.: escritório do cliente"></label>
      </div>
      <label class="field"><span>Participantes</span><input name="participants" value="${U.esc(m.participants || '')}" placeholder="Ex.: Ana (cliente), Bruno"></label>
      <label class="field"><span>Pauta e anotações <small class="muted">(aceita listas com "- " e "- [ ]")</small></span><textarea name="notes" rows="6" placeholder="O que tratar, decisões, próximos passos…">${U.esc(m.notes || '')}</textarea></label>
      <div class="field-row meet-opts">
        <label class="field"><span>Lembrete</span><select name="remind">${REMINDERS.map(([v, l]) => `<option value="${v}" ${Number(m.remind ?? 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="logHours" ${m.logHours ? 'checked' : ''}> Lançar as horas da reunião no projeto (quando ela terminar)</label>
      </div>`,
    buttons: [
      ...(!isNew ? [{ label: 'Excluir', cls: 'danger left', action: () => {
        if (!confirm(`Excluir a reunião "${m.title}"?${m.entryId ? '\n\nAs horas lançadas por ela também saem.' : ''}`)) return false;
        if (m.entryId) S.timeEntries = S.timeEntries.filter((x) => x.id !== m.entryId);
        S.meetings = S.meetings.filter((x) => x.id !== m.id);
        commit();
      } }] : []),
      ...(!isNew && m.link ? [{ label: 'Entrar ↗', action: () => { openLink(m.link); return false; } }] : []),
      { label: 'Cancelar' },
      { label: isNew ? 'Criar reunião' : 'Salvar', cls: 'primary', action: (el2) => {
        const title = val(el2, 'title');
        if (!title) { $('[name=title]', el2).focus(); return false; }
        const date = val(el2, 'date'), start = val(el2, 'start');
        if (!date || !start) { $(date ? '[name=start]' : '[name=date]', el2).focus(); return false; }
        const data = {
          projectId: val(el2, 'projectId'), title, date, start, end: val(el2, 'end'),
          link: val(el2, 'link'), location: val(el2, 'location'), participants: val(el2, 'participants'),
          notes: $('[name=notes]', el2).value, remind: Number(val(el2, 'remind')) || 0, logHours: $('[name=logHours]', el2).checked,
        };
        if (isNew) { S.meetings ||= []; S.meetings.push({ id: U.uid(), ...data }); } else Object.assign(m, data);
        syncMeetingEntries();
        commit();
      } },
    ],
  });
  // Fim acompanha o início (mantém a duração) enquanto o usuário não mexer no fim.
  let endTouched = !isNew;
  const toMin = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
  const dur = toMin(m.end || m.start) - toMin(m.start) || 60;
  $('[name=end]', el).addEventListener('input', () => { endTouched = true; });
  $('[name=start]', el).addEventListener('input', (ev) => {
    if (endTouched || !ev.target.value) return;
    const t = (toMin(ev.target.value) + dur) % 1440;
    $('[name=end]', el).value = `${U.pad(Math.floor(t / 60))}:${U.pad(t % 60)}`;
  });
}

function entryModal(e) {
  const isNew = !e;
  const now = new Date();
  if (isNew) {
    const pid = (view.name === 'project' ? view.projectId : prefs.hProject) || activeProjects()[0]?.id;
    const s = new Date(now.getTime() - 3600000);
    e = { projectId: pid, taskId: null, description: '', start: s.toISOString(), end: now.toISOString() };
  }
  const taskOptions = (pid, sel) => `<option value="">Sem tarefa</option>` + S.tasks.filter((t) => t.projectId === pid).map((t) => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${U.esc(t.title)}</option>`).join('');
  const { el } = modal({
    title: isNew ? 'Lançar horas' : 'Editar registro',
    body: `
      <div class="field-row">
        <label class="field"><span>Projeto</span><select name="projectId">${S.projects.filter((p) => !p.archived || p.id === e.projectId).map((p) => `<option value="${p.id}" ${p.id === e.projectId ? 'selected' : ''}>${U.esc(p.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Tarefa</span><select name="taskId">${taskOptions(e.projectId, e.taskId)}</select></label>
      </div>
      <label class="field"><span>Descrição</span><input name="description" value="${U.esc(e.description || '')}"></label>
      <div class="field-row three">
        <label class="field"><span>Data</span><input type="date" name="date" value="${U.toKey(new Date(e.start))}"></label>
        <label class="field"><span>Início</span><input type="time" name="from" value="${U.fmtTime(e.start)}"></label>
        <label class="field"><span>Fim</span><input type="time" name="to" value="${U.fmtTime(e.end)}"></label>
      </div>
      <p class="muted small dur-preview"></p>`,
    buttons: [
      { label: 'Cancelar' },
      { label: 'Salvar', cls: 'primary', action: (el2) => {
        const r = readRange(el2);
        if (!r) return false;
        const data = { projectId: val(el2, 'projectId'), taskId: val(el2, 'taskId') || null, description: val(el2, 'description'), start: r.s.toISOString(), end: r.e.toISOString() };
        if (isNew) S.timeEntries.push({ id: U.uid(), ...data });
        else Object.assign(e, data);
        commit();
      } },
    ],
  });
  function readRange(m) {
    const d = val(m, 'date'), f = val(m, 'from'), t = val(m, 'to');
    if (!d || !f || !t) return null;
    const s = new Date(`${d}T${f}:00`);
    const en = new Date(`${d}T${t}:00`);
    if (en <= s) en.setDate(en.getDate() + 1); // passou da meia-noite
    return { s, e: en };
  }
  const upd = () => { const r = readRange(el); $('.dur-preview', el).textContent = r ? `Duração: ${U.dur(r.e - r.s)}` : ''; };
  $$('[name=date],[name=from],[name=to]', el).forEach((i) => i.addEventListener('input', upd));
  $('[name=projectId]', el).addEventListener('change', (ev) => { $('[name=taskId]', el).innerHTML = taskOptions(ev.target.value, null); });
  upd();
}

async function settingsModal() {
  const i = await api.dataInfo();
  const where = i.external ? 'pendrive ou HD externo' : i.custom ? 'pasta escolhida' : 'pasta padrão deste Mac';
  const last = i.lastUpdateCheck ? new Date(i.lastUpdateCheck).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  modal({
    title: 'Ajustes',
    wide: true,
    body: `
      <section class="set-sec">
        <h3>Dados e backup</h3>
        <p>A base aberta (<b>${U.esc(i.base)}</b>) fica neste arquivo:</p>
        <p class="path">${U.esc(i.file)}</p>
        <div class="settings-actions">
          <button class="btn" data-action="data-reveal">Mostrar no Finder</button>
          <button class="btn" data-action="data-export">Exportar backup…</button>
          <button class="btn" data-action="data-import">Importar backup…</button>
        </div>
        <p class="muted small">Exportar e importar valem para a base aberta. O app também guarda uma cópia diária de cada base na subpasta <b>backups</b>.</p>
      </section>
      <section class="set-sec">
        <h3>Bases de dados</h3>
        <div class="settings-actions set-row">
          <span>Aberta: <b>${U.esc(i.base)}</b> · ${i.bases} ${i.bases === 1 ? 'base' : 'bases'}</span>
          <button class="btn" data-action="bases-open">Gerenciar bases…</button>
        </div>
      </section>
      <section class="set-sec">
        <h3>Pasta de dados</h3>
        <p class="muted">Todas as bases e os backups ficam numa pasta. Ela pode ser uma pasta sincronizada (iCloud Drive, Dropbox, Google Drive), para usar em mais de um Mac, ou um pendrive ou HD externo.</p>
        <p class="path">${U.esc(i.dir)}</p>
        <p class="small set-where">${U.esc(where)}${i.available ? '' : ' · <b class="danger-text">inacessível agora: conecte o disco</b>'}</p>
        <div class="settings-actions">
          <button class="btn primary" data-action="data-dir">Mover para outra pasta…</button>
          ${i.custom ? '<button class="btn" data-action="data-dir-default">Voltar para a pasta padrão</button>' : ''}
        </div>
        <p class="muted small">Ao mover, as bases e os backups são copiados para a pasta nova, e a anterior não é apagada. Com pendrive ou HD externo, conecte o disco antes de abrir o app; se ele for desconectado com o app aberto, as alterações ficam guardadas e são salvas quando ele voltar. Evite usar o app em dois Macs ao mesmo tempo.</p>
      </section>
      <section class="set-sec">
        <h3>Atualizações</h3>
        <p>Versão instalada: <b>${U.esc(i.version)}</b>${last ? ` <span class="muted small">· última verificação: ${last}</span>` : ''}</p>
        <label class="check"><input type="checkbox" data-bind="auto-update" ${i.autoUpdate ? 'checked' : ''}> Procurar atualizações automaticamente (ao abrir, quando a internet volta e a cada 6 horas)</label>
        <div class="settings-actions" style="margin-top:10px">
          <button class="btn" data-action="update-check">Verificar agora</button>
          <button class="btn" data-action="update-notes">Ver novidades</button>
        </div>
      </section>`,
    buttons: [{ label: 'Fechar', cls: 'primary' }],
  });
}

// Aviso na barra lateral quando a pasta de dados não está acessível (ex.: HD externo desconectado).
function renderDataBanner(st) {
  const el = $('#dataBanner');
  if (!el) return;
  el.innerHTML = st && !st.ok
    ? `<button class="data-banner" data-action="open-settings" title="Abrir ajustes"><span>⚠︎</span><div><b>Alterações não salvas</b><small>A pasta de dados não está acessível. Reconecte o disco: o app salva sozinho quando ela voltar.</small></div></button>`
    : '';
}
api.onDataStatus(renderDataBanner);
api.dataInfo().then((i) => renderDataBanner({ ok: !i.saveFailed }));
api.onSettingsOpen(() => settingsModal());

// ---------- Bases de dados ----------
async function basesModal() {
  const { bases } = await api.listBases();
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  modal({
    title: 'Bases de dados',
    wide: true,
    body: `
      <p class="muted small" style="margin-top:-6px">Cada base tem projetos, tarefas, horas, tags e perfil próprios. Use, por exemplo, uma base de testes e outra para o trabalho de verdade.</p>
      <div class="base-list">${bases.map((b) => `
        <div class="base-row${b.current ? ' current' : ''}">
          <div class="base-info">
            <b>${U.esc(b.name)}</b>
            <span class="muted small">${b.missing ? 'arquivo ainda não encontrado (sincronizando?)' : `${plural(b.projects, 'projeto', 'projetos')} · ${b.hours}h registradas`}${b.main ? ' · arquivo original' : ''}</span>
          </div>
          <div class="base-acts">
            ${b.current ? '<span class="base-cur">Aberta</span>' : `<button class="btn" data-action="base-open" data-id="${b.id}" ${b.missing ? 'disabled' : ''}>Abrir</button>`}
            <button class="icon-btn" data-action="base-rename" data-id="${b.id}" title="Renomear">✎</button>
            <button class="icon-btn" data-action="base-dup" data-id="${b.id}" title="Duplicar" ${b.missing ? 'disabled' : ''}>⧉</button>
            ${b.main || b.current ? '<span class="base-gap"></span>' : `<button class="icon-btn danger" data-action="base-delete" data-id="${b.id}" title="Excluir (vai para o Lixo)">🗑</button>`}
          </div>
        </div>`).join('')}
      </div>
      <p class="muted small">Ao trocar de base com o timer ligado, ele é pausado e as horas ficam na base em que foram gravadas. Também dá para trocar pelo ícone na barra de menus.</p>`,
    buttons: [
      { label: '＋ Nova base…', cls: 'left', action: () => { newBaseModal(); return false; } },
      { label: 'Fechar', cls: 'primary' },
    ],
  });
}

function newBaseModal() {
  modal({
    title: 'Nova base de dados',
    body: `
      <label class="field"><span>Nome</span><input name="name" placeholder="Ex.: Meus projetos"></label>
      <label class="check"><input type="checkbox" name="profile" ${S.profile ? '' : 'disabled'}> Copiar o perfil (logo, contatos e cor) da base “${U.esc(BASE.name)}”</label>
      <p class="muted small">A base nova começa vazia e já abre em seguida. A base atual continua guardada.</p>`,
    buttons: [
      { label: 'Cancelar', action: () => { basesModal(); return false; } },
      { label: 'Criar e abrir', cls: 'primary', action: async (el) => {
        const name = val(el, 'name');
        if (!name) { $('[name=name]', el).focus(); return false; }
        await flush();
        const id = await api.createBase({ name, withProfile: $('[name=profile]', el).checked });
        if (!id) return false;
        await api.switchBase(id);
      } },
    ],
  });
}

function renameBaseModal(b) {
  modal({
    title: 'Renomear base',
    body: `<label class="field"><span>Nome</span><input name="name" value="${U.esc(b.name)}"></label>`,
    buttons: [
      { label: 'Cancelar', action: () => { basesModal(); return false; } },
      { label: 'Salvar', cls: 'primary', action: async (el) => {
        const name = val(el, 'name');
        if (!name) { $('[name=name]', el).focus(); return false; }
        await api.renameBase(b.id, name);
        basesModal();
        return false;
      } },
    ],
  });
}

// A base aberta mudou (troca pela barra de menus, base nova, outra pasta de dados): mostra a base nova no Painel.
api.onBaseChanged(({ state, base }) => {
  clearTimeout(saveT); saveT = null;
  const changedBase = !BASE || BASE.id !== base.id;
  BASE = base;
  S = state;
  prepareState();
  closeModal();
  if (changedBase) { view = { name: 'dashboard' }; prefs.view = view; savePrefs(); }
  render(true);
});
api.onBaseRenamed((base) => { BASE = base; renderBaseSwitch(); });
api.onBasesOpen(() => basesModal());

// ---------- Atualizações ----------
let updateInfo = null;
function renderUpdateBanner() {
  const el = $('#updateBanner');
  if (!el) return;
  el.innerHTML = updateInfo
    ? `<button class="update-banner" data-action="update-open" title="Ver novidades e baixar"><span>⬆</span><div><b>Nova versão ${U.esc(updateInfo.version)}</b><small>Clique para ver o que mudou</small></div></button>`
    : '';
}
function updateModal() {
  if (!updateInfo) return;
  const info = updateInfo;
  const manualSteps = `
      <div class="update-steps">
        <b>Como instalar</b>
        <ol>
          <li>Clique em <b>Baixar</b>: o instalador (.dmg) vai para a pasta Downloads.</li>
          <li>Feche o Organizador (menu do ícone na barra → Sair).</li>
          <li>Abra o .dmg e arraste o app para <b>Aplicativos</b>, escolhendo <b>Substituir</b>.</li>
          <li>Abra o app. Se o Mac disser que não pôde verificá-lo, clique em OK e vá em <b>Ajustes do Sistema → Privacidade e Segurança → Abrir Mesmo Assim</b>.</li>
        </ol>
        <p class="muted small">Seus projetos, horas e configurações ficam guardados fora do app e continuam lá depois da atualização.</p>
      </div>`;
  const autoBox = `
      <div class="update-steps" id="updBox">
        <p>Ao clicar em <b>Atualizar e reiniciar</b>, o app baixa a versão nova (${Math.round((info.zip?.size || 0) / 1048576)} MB), confere o arquivo, fecha e abre de novo já atualizado. Leva cerca de um minuto.</p>
        <div class="upd-progress" hidden><div class="upd-bar"><span></span></div><small></small></div>
        <p class="upd-error" hidden></p>
        <p class="muted small">Seus projetos, horas e configurações ficam fora do app e não são tocados. Se o timer estiver ligado, ele é pausado e as horas são salvas.</p>
      </div>`;
  modal({
    title: `Nova versão ${U.esc(info.version)} disponível`,
    wide: true,
    body: `
      <p class="muted small" style="margin-top:-6px">Você está na versão ${U.esc(info.current)}${info.date ? ` · publicada em ${new Date(info.date).toLocaleDateString('pt-BR')}` : ''}</p>
      <div class="update-notes md">${U.markdown(info.notes) || '<p class="muted">Sem descrição.</p>'}</div>
      ${info.auto ? autoBox : manualSteps}`,
    buttons: info.auto
      ? [
        { label: 'Baixar instalador', cls: 'left', action: () => { api.downloadUpdate(); } },
        { label: 'Depois' },
        { label: 'Atualizar e reiniciar', cls: 'primary', action: async (el) => {
          const btns = $$('.modal-actions button', el);
          btns.forEach((b) => { b.disabled = true; });
          $('.upd-error', el).hidden = true;
          $('.upd-progress', el).hidden = false;
          updProgress({ phase: 'download', pct: 0 });
          await flush();
          const r = await api.installUpdate();
          if (!r.ok) {
            btns.forEach((b) => { b.disabled = false; });
            $('.upd-progress', el).hidden = true;
            const err = $('.upd-error', el);
            err.hidden = false;
            err.textContent = `Não consegui atualizar: ${r.error} Tente de novo ou use "Baixar instalador".`;
          }
          return false;
        } },
      ]
      : [
        { label: 'Depois' },
        { label: 'Baixar', cls: 'primary', action: () => { api.downloadUpdate(); } },
      ],
  });
}
function updProgress({ phase, pct }) {
  const box = $('#updBox .upd-progress');
  if (!box) return;
  const label = { download: `Baixando… ${pct}%`, verify: 'Conferindo o arquivo…', restart: 'Reiniciando com a versão nova…', error: '' }[phase] ?? '';
  $('span', box).style.width = `${phase === 'download' ? pct : 100}%`;
  $('small', box).textContent = label;
}
api.onUpdateProgress(updProgress);
// A internet voltou: se ainda não encontrou a versão nova, procura agora.
window.addEventListener('online', () => api.updateOnline());
api.onUpdate((info) => { updateInfo = info; renderUpdateBanner(); });
api.onUpdateOpen(() => updateModal());
api.getUpdate().then((info) => { updateInfo = info; renderUpdateBanner(); });

// ---------- Ações (cliques) ----------
async function timerOp(fn) {
  await flush();
  S = await fn();
  render();
}

const ACTIONS = {
  nav: (el) => go({ name: el.dataset.view }),
  'open-project': (el) => go({ name: 'project', projectId: el.dataset.id, tab: prefs.tabs[el.dataset.id] || 'gantt' }),
  tab: (el) => go({ ...view, tab: el.dataset.tab }),
  'new-project': () => projectModal(),
  'edit-project': () => projectModal(proj(view.projectId)),
  'toggle-archived': () => { prefs.showArchived = !prefs.showArchived; savePrefs(); renderSidebar(); },
  'open-settings': () => settingsModal(),
  'bases-open': () => basesModal(),
  'base-open': async (el) => { el.disabled = true; await flush(); if (!(await api.switchBase(el.dataset.id))) { el.disabled = false; basesModal(); } },
  'base-rename': async (el) => { const b = (await api.listBases()).bases.find((x) => x.id === el.dataset.id); if (b) renameBaseModal(b); },
  'base-dup': async (el) => {
    const b = (await api.listBases()).bases.find((x) => x.id === el.dataset.id);
    if (!b) return;
    await flush();
    await api.createBase({ name: `${b.name} (cópia)`, copyFrom: b.id });
    basesModal();
  },
  'base-delete': async (el) => { if (await api.deleteBase(el.dataset.id)) basesModal(); },
  'update-open': () => updateModal(),
  'update-check': () => { closeModal(); api.checkUpdate(); },
  'update-notes': () => api.releaseNotes(),
  theme: async (el) => { markTheme(await api.setTheme(el.dataset.theme)); },

  'timer-start': () => {
    const box = $('#timerBox');
    timerOp(() => api.timerStart({ projectId: $('[data-bind=timer-project]', box).value, taskId: $('[data-bind=timer-task]', box).value || null, description: $('[data-bind=timer-desc]', box).value }));
  },
  'timer-pause': () => timerOp(() => api.timerPause()),
  'record-task': (el) => {
    const t = task(el.dataset.id);
    closeModal();
    timerOp(() => api.timerStart({ projectId: t.projectId, taskId: t.id, description: S.timer.projectId === t.projectId && S.timer.taskId === t.id ? S.timer.description : '' }));
  },

  'new-task': (el) => taskModal(null, { type: el.dataset.type }),
  'toggle-focus': (el) => {
    const t = task(el.dataset.id);
    t.focusDate = isFocus(t) ? null : U.todayKey();
    commit();
  },
  'dash-tag': (el) => {
    const f = dashFilters();
    const tg = el.dataset.tag;
    f.tags = f.tags.includes(tg) ? f.tags.filter((x) => x !== tg) : [...f.tags, tg];
    savePrefs();
    if (view.name !== 'dashboard') go({ name: 'dashboard' }); else renderContent();
  },
  'dash-prio': (el) => { dashFilters().prio = el.dataset.p; savePrefs(); renderContent(); },
  'dash-range': (el) => { dashFilters().range = el.dataset.r === 'all' ? 'all' : +el.dataset.r; savePrefs(); renderContent(); },
  'dash-clear': () => { Object.assign(dashFilters(), { tags: [], project: '', prio: '' }); savePrefs(); renderContent(); },
  'new-subtask': (el) => {
    prefs.collapsed[el.dataset.id] = false; savePrefs();
    taskModal(null, { type: 'tarefa', parentId: el.dataset.id });
  },
  'gantt-collapse': (el) => { prefs.collapsed[el.dataset.id] = !prefs.collapsed[el.dataset.id]; savePrefs(); renderContent(); },
  'gantt-expand-all': () => {
    S.tasks.filter((t) => t.projectId === view.projectId).forEach((t) => { delete prefs.collapsed[t.id]; });
    savePrefs(); renderContent();
  },
  'gantt-collapse-all': () => {
    S.tasks.filter((t) => t.projectId === view.projectId && isGroup(t)).forEach((t) => { prefs.collapsed[t.id] = true; });
    savePrefs(); renderContent();
  },
  'remove-dep': (el) => {
    const from = task(el.dataset.from);
    const to = task(el.dataset.to);
    if (!from || !to || !confirm(`Remover a dependência?\n\n"${from.title}" → "${to.title}"`)) return;
    to.deps = (to.deps || []).filter((d) => d !== from.id);
    commit();
  },
  'edit-task': (el) => { const t = task(el.dataset.id); if (t) taskModal(t); },
  'toggle-done': (el) => {
    const t = task(el.dataset.id);
    if (!t) return;
    const targets = isGroup(t) ? TaskTree.descendants(S.tasks, t.id).filter((x) => !isGroup(x)) : [t];
    for (const x of targets) {
      x.done = el.checked;
      if (x.done) { x.prevProgress = x.progress; x.progress = 100; } else x.progress = x.prevProgress ?? 0;
    }
    commit();
  },
  'gantt-zoom': (el) => { prefs.zoom = el.dataset.zoom; savePrefs(); renderContent(); },
  'gantt-today': () => Gantt.scrollToToday($('#ganttHost'), view.projectId, prefs.zoom),
  'day-move': (el) => { dayDateSel = U.addDays(dayDate(), +el.dataset.d); renderContent(); },
  'day-today': () => { dayDateSel = null; renderContent(); },
  'adm-status': (el) => { prefs.adm.status = el.dataset.v; savePrefs(); renderContent(); },
  'adm-sort': (el) => {
    const k = el.dataset.k;
    prefs.adm.dir = prefs.adm.sort === k ? -prefs.adm.dir : 1;
    prefs.adm.sort = k; savePrefs(); renderContent();
  },
  'adm-edit': (el) => projectModal(proj(el.dataset.id)),
  'adm-dup': (el) => {
    const p = proj(el.dataset.id);
    if (!confirm(`Duplicar "${p.name}"?\n\nA cópia leva o briefing e todas as tarefas (com grupos e dependências), zeradas. Anotações e horas não são copiadas.`)) return;
    duplicateProject(p);
  },
  'open-link': (el) => openLink(el.dataset.url),
  'open-task-link': (el) => { const t = task(el.dataset.id); if (t.links.length === 1) openLink(t.links[0].url); else taskModal(t); },
  'go-profile': () => { closeModal(); go({ name: 'profile' }); },
  'prof-type': (el) => { profile().type = el.dataset.v; commit(); },
  'prof-color': (el) => { profile().color = el.dataset.color; commit(); },
  'prof-logo-remove': () => { if (confirm('Remover o logo?')) { profile().logo = ''; commit(); } },
  'project-links': (el) => projectLinksModal(proj(el.dataset.id)),
  'report-project': (el) => reportModal(el.dataset.id),
  'report-general': () => reportModal(null),
  'adm-del': (el) => deleteProject(proj(el.dataset.id)),
  'adm-archive': (el) => archiveProject(proj(el.dataset.id)),
  'adm-unarchive': (el) => unarchiveProject(proj(el.dataset.id)),
  'tag-new': () => tagModal(),
  'tag-edit': (el) => tagModal(el.dataset.tag),
  'tag-del': (el) => deleteTag(el.dataset.tag),
  'tag-color': (el) => { tagMeta()[el.dataset.tag] = { ...(tagMeta()[el.dataset.tag] || {}), color: el.dataset.color }; commit(); },
  'tag-sort': (el) => { prefs.tagAdm.sort = el.dataset.v; savePrefs(); renderContent(); },
  'tag-toggle': (el) => { prefs.tagAdm.open[el.dataset.tag] = !prefs.tagAdm.open[el.dataset.tag]; savePrefs(); renderContent(); },
  'tag-filter': (el) => { Object.assign(dashFilters(), { tags: [el.dataset.tag], project: '', prio: '' }); savePrefs(); go({ name: 'dashboard' }); },
  'open-project-gantt': (el) => go({ name: 'project', projectId: el.dataset.id, tab: 'gantt' }),
  'ov-toggle': (el) => { prefs.ovExpanded[el.dataset.id] = !prefs.ovExpanded[el.dataset.id]; savePrefs(); renderContent(); },
  'ov-expand-all': () => { S.projects.forEach((p) => { prefs.ovExpanded[p.id] = true; }); savePrefs(); renderContent(); },
  'ov-collapse-all': () => { prefs.ovExpanded = {}; savePrefs(); renderContent(); },
  'ov-show': (el) => { prefs.ovShow = el.dataset.v; savePrefs(); renderContent(); },
  'ov-zoom': (el) => { prefs.ovZoom = el.dataset.zoom; savePrefs(); renderContent(); },
  'ov-today': () => Gantt.scrollToToday($('#ovHost'), $('#ovHost').dataset.memId, prefs.ovZoom),

  'cal-move': (el) => {
    const m = U.fromKey(prefs.calMonth || U.todayKey().slice(0, 8) + '01');
    m.setMonth(m.getMonth() + +el.dataset.d);
    prefs.calMonth = U.toKey(m); savePrefs(); renderContent();
  },
  'cal-today': () => { prefs.calMonth = null; savePrefs(); renderContent(); },
  'cal-day': (el) => taskModal(null, { date: el.dataset.date, type: 'tarefa', projectId: prefs.calProject || null }),

  'new-note': () => {
    const n = { id: U.uid(), projectId: view.projectId, title: 'Nova anotação', body: '', pinned: false, updatedAt: new Date().toISOString() };
    S.notes.push(n);
    prefs.notes[view.projectId] = n.id; prefs.noteMode = 'edit'; prefs.noteSearch = ''; savePrefs();
    commit();
    const ti = $('.ne-title'); if (ti) { ti.focus(); ti.select(); }
  },
  'open-note': (el) => { prefs.notes[view.projectId] = el.dataset.id; savePrefs(); renderContent(); },
  'note-mode': (el) => { prefs.noteMode = el.dataset.mode; savePrefs(); renderContent(); if (prefs.noteMode === 'edit') $('.ne-body')?.focus(); },
  'pin-note': (el) => { const n = S.notes.find((x) => x.id === el.dataset.id); n.pinned = !n.pinned; commit(); },
  'delete-note': (el) => {
    const n = S.notes.find((x) => x.id === el.dataset.id);
    if (!confirm(`Excluir a anotação "${n.title || 'Sem título'}"?`)) return;
    S.notes = S.notes.filter((x) => x.id !== n.id);
    commit();
  },

  'brief-copy': async (el) => {
    await navigator.clipboard.writeText(briefingText(proj(view.projectId)));
    el.textContent = 'Copiado ✓'; setTimeout(() => { el.textContent = 'Copiar como texto'; }, 1500);
  },
  'brief-pdf': async () => {
    const p = proj(view.projectId);
    const br = p.briefing || {};
    const brand = profile().pdf.enabled && profileFilled() ? profile() : null;
    $('#printRoot').innerHTML = `<div class="print-doc rep" style="${brandVars(brand)}">${brand ? brandBlock(brand) : ''}
      <div class="print-head"><div><small>BRIEFING</small><h1>${U.esc(p.name)}</h1>${p.client ? `<p>${U.esc(p.client)}</p>` : ''}</div></div>
      ${BRIEF_FIELDS.filter(([k]) => br[k]).map(([k, l]) => `<section><h2>${l}</h2><p>${U.esc(br[k]).replace(/\n/g, '<br>')}</p></section>`).join('') || '<p>Briefing vazio.</p>'}
      <footer>Gerado em ${new Date().toLocaleDateString('pt-BR')}</footer></div>`;
    await flush();
    await api.savePdf(`Briefing - ${p.name}.pdf`, { footer: `${brand ? footerPrefix(brand) : ''}Briefing — ${p.name}` });
    $('#printRoot').innerHTML = '';
  },

  'h-period': (el) => { prefs.hPeriod = el.dataset.p; savePrefs(); renderContent(); },
  'new-entry': () => entryModal(),
  'new-meeting': (el) => meetingModal(null, { projectId: el.dataset.project || null, date: el.dataset.date || null }),
  'edit-meeting': (el) => { const m = meeting(el.dataset.id); if (m) meetingModal(m); },
  'meeting-join': (el) => { const m = meeting(el.dataset.id); if (m && m.link) openLink(m.link); },
  'edit-entry': (el) => entryModal(S.timeEntries.find((e) => e.id === el.dataset.id)),
  'delete-entry': (el) => {
    const e = S.timeEntries.find((x) => x.id === el.dataset.id);
    if (!confirm(`Excluir este registro de ${U.dur(entryMs(e))}?`)) return;
    S.timeEntries = S.timeEntries.filter((x) => x.id !== e.id);
    commit();
  },
  'export-csv': async () => {
    const projectId = view.name === 'project' ? view.projectId : null;
    const { from, to, list } = filteredEntries(projectId);
    const rows = [['Data', 'Início', 'Fim', 'Duração', 'Horas (decimal)', 'Projeto', 'Cliente', 'Tarefa', 'Descrição']];
    for (const e of list.slice().reverse()) {
      const p = proj(e.projectId);
      const ms = msInRange(e, from, to);
      rows.push([new Date(e.start).toLocaleDateString('pt-BR'), U.fmtTime(e.start), U.fmtTime(e.end), U.clock(ms).slice(0, 5), U.hoursDecimal(ms), p?.name || '', p?.client || '', e.taskId ? task(e.taskId)?.title || '' : '', e.description || '']);
    }
    const total = list.reduce((a, e) => a + msInRange(e, from, to), 0);
    rows.push(['', '', 'Total', U.clock(total).slice(0, 5), U.hoursDecimal(total)]);
    const name = projectId ? proj(projectId).name : 'todos';
    await api.saveText(U.toCsv(rows), `horas - ${name} - ${U.todayKey()}.csv`, 'csv');
  },

  'data-reveal': () => api.revealData(),
  'data-export': async () => { await flush(); api.exportData(); },
  'data-import': async () => { await flush(); if (await api.importData()) closeModal(); },
  'data-dir': async () => { await flush(); if (await api.chooseDataDir()) settingsModal(); },
  'data-dir-default': async () => { await flush(); if (await api.chooseDataDir(true)) settingsModal(); },
};

document.addEventListener('click', (e) => {
  // Checkboxes de checklist na visualização de anotações.
  const cb = e.target.closest('.ne-view input[type=checkbox][data-line]');
  if (cb) {
    const n = S.notes.find((x) => x.id === cb.closest('.ne-view').dataset.id);
    const lines = n.body.split('\n');
    const i = +cb.dataset.line;
    lines[i] = cb.checked ? lines[i].replace(/\[ \]/, '[x]') : lines[i].replace(/\[[xX]\]/, '[ ]');
    n.body = lines.join('\n'); n.updatedAt = new Date().toISOString();
    commit();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el, e);
});

// ---------- Campos (digitação) ----------
const timerDescUpdate = U.debounce((v) => api.timerUpdate({ description: v }).then((s) => { S.timer = s.timer; }), 400);
const refreshNoteList = U.debounce(() => {
  const n = S.notes.find((x) => x.id === prefs.notes[view.projectId]);
  const item = n && $(`.nl-item[data-id="${n.id}"]`);
  if (item) {
    $('.nl-title', item).textContent = (n.pinned ? '📌 ' : '') + (n.title || 'Sem título');
    $('.nl-meta', item).textContent = `${new Date(n.updatedAt).toLocaleDateString('pt-BR')} · ${(n.body || '').replace(/\s+/g, ' ').slice(0, 60)}`;
  }
}, 300);

const BINDS = {
  'day-h0': (el) => { prefs.dayH0 = +el.value; savePrefs(); renderContent(); },
  'day-h1': (el) => { prefs.dayH1 = +el.value; savePrefs(); renderContent(); },
  'auto-update': (el) => api.setSettings({ autoUpdate: el.checked }),
  'timer-project': async (el) => { el.blur(); await flush(); S = await api.timerUpdate({ projectId: el.value, taskId: null }); renderTimer(true); renderSidebar(); },
  'timer-task': async (el) => { await flush(); S = await api.timerUpdate({ projectId: $('#timerBox [data-bind=timer-project]').value, taskId: el.value || null }); },
  'timer-desc': (el) => { S.timer.description = el.value; timerDescUpdate(el.value); },
  'dash-project': (el) => { dashFilters().project = el.value; savePrefs(); renderContent(); },
  'adm-set-status': (el) => { proj(el.dataset.id).status = el.value; commit(); },
  'cal-tag': (el) => { prefs.calTag = el.value || null; savePrefs(); renderContent(); },
  'gantt-auto': (el) => { prefs.autoSchedule = el.checked; savePrefs(); commit(); },
  'cal-project': (el) => { prefs.calProject = el.value || null; savePrefs(); renderContent(); },
  'cal-done': (el) => { prefs.calShowDone = el.checked; savePrefs(); renderContent(); },
  'h-project': (el) => { prefs.hProject = el.value || null; savePrefs(); renderContent(); },
  'h-from': (el) => { prefs.hFrom = el.value; savePrefs(); renderContent(); },
  'h-to': (el) => { prefs.hTo = el.value; savePrefs(); renderContent(); },
  'tag-q': (el) => {
    prefs.tagAdm.q = el.value; savePrefs(); renderContent();
    const s = $('[data-bind=tag-q]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  },
  prof: (el) => { profile()[el.dataset.key] = el.value.trim(); save(); refreshPreview(); },
  'prof-color-input': (el) => { profile().color = el.value; save(); refreshPreview(); $('.prof-colors .hex').textContent = el.value; $$('.prof-colors .tc').forEach((b) => b.classList.remove('on')); },
  'prof-pdf': (el) => { profile().pdf[el.dataset.key] = el.checked; commit(); },
  'prof-logo': (el) => { const f = el.files && el.files[0]; if (f) loadLogo(f); el.value = ''; },
  'adm-q': (el) => {
    prefs.adm.q = el.value; savePrefs(); renderContent();
    const s = $('[data-bind=adm-q]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  },
  'note-search': (el) => {
    prefs.noteSearch = el.value; savePrefs(); renderContent();
    const s = $('[data-bind=note-search]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  },
  'note-title': (el) => { const n = S.notes.find((x) => x.id === el.dataset.id); n.title = el.value; n.updatedAt = new Date().toISOString(); save(); refreshNoteList(); },
  'note-body': (el) => { const n = S.notes.find((x) => x.id === el.dataset.id); n.body = el.value; n.updatedAt = new Date().toISOString(); save(); refreshNoteList(); },
  brief: (el) => {
    const p = proj(view.projectId);
    p.briefing ||= {};
    p.briefing[el.dataset.key] = el.value;
    save();
    if (el.tagName === 'TEXTAREA') autoGrow(el);
    const s = $('#briefSaved'); if (s) s.textContent = 'Salvo ✓';
  },
};
const INPUT_BINDS = new Set(['timer-desc', 'note-title', 'note-body', 'brief', 'note-search', 'adm-q', 'tag-q', 'prof', 'prof-color-input']);
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-bind]');
  if (el && INPUT_BINDS.has(el.dataset.bind)) BINDS[el.dataset.bind](el, e);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-bind]');
  if (el && !INPUT_BINDS.has(el.dataset.bind)) BINDS[el.dataset.bind]?.(el, e);
});

// Atalhos: ⌘N nova tarefa, ⌘⇧N novo projeto, ⌘. liga/pausa o timer.
document.addEventListener('keydown', (e) => {
  if ($('#modalRoot').children.length) return;
  if (e.metaKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    if (e.shiftKey || !S.projects.length) projectModal(); else taskModal(null, { type: 'tarefa' });
  }
  if (e.metaKey && e.key === '.') {
    e.preventDefault();
    if (S.timer.running) ACTIONS['timer-pause'](); else if (activeProjects().length) ACTIONS['timer-start']();
  }
  // Tab dentro das anotações insere espaços.
  if (e.key === 'Tab' && e.target.classList?.contains('ne-body')) {
    e.preventDefault();
    document.execCommand('insertText', false, '  ');
  }
});

// ---------- Inicialização ----------
api.onState((s) => {
  if (saveT) {
    // Há alterações locais ainda não enviadas: mantém-nas e aceita o timer/horas vindos da barra de menus.
    S.timer = s.timer;
    S.timeEntries = s.timeEntries;
    flush();
  } else S = s;
  prepareState();
  const typing = document.activeElement && document.activeElement.matches('.ne-body, .ne-title, [data-bind=brief], [data-bind=timer-desc]');
  if (typing) { renderTimer(); renderSidebar(); } else render();
});

// O app pediu para salvar agora (vai fechar, exportar ou trocar de pasta).
api.onFlush(async () => { if (saveT) await flush(); api.flushed(); });

setInterval(() => {
  if (S && new Date().getSeconds() === 30 && syncMeetingEntries()) { save(); if (!$('#modalRoot').children.length) renderContent(); }
  updateClock();
  // Atualiza durações "ao vivo" nas telas de horas e painel a cada minuto.
  if (S?.timer.running && new Date().getSeconds() === 0 && ['hours', 'dashboard'].includes(view.name)) {
    if (!$('#modalRoot').children.length && !document.activeElement?.matches('input, textarea, select')) render();
  }
}, 1000);

window.addEventListener('beforeunload', () => { if (saveT) api.setState(S, BASE?.id); });

function markTheme(theme) {
  $$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === theme));
}

(async () => {
  api.getTheme().then(markTheme);
  BASE = await api.currentBase();
  S = await api.getState();
  prepareState();
  render(true);
})();

// Soltar arquivos/links fora de um editor de links não deve trocar a página.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
