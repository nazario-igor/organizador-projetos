// Teste visual: abre o app com dados de exemplo, navega pelas telas e salva prints.
// Uso: SMOKE_OUT=/pasta electron scripts/smoke.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const out = process.env.SMOKE_OUT || path.join(os.tmpdir(), 'organizador-smoke');
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'organizador-test-'));
process.env.ORGANIZADOR_USER_DATA = userData;

// Dados de exemplo
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
const at = (n, h, m) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };
const seed = {
  version: 1,
  projects: [
    { id: 'p1', name: 'Site Padaria Aurora', client: 'Padaria Aurora', color: '#5b6cff', status: 'ativo', briefing: { cliente: 'Ana Souza — ana@aurora.com', resumo: 'Novo site institucional com cardápio e encomendas.', objetivos: 'Aumentar encomendas online em 30%.', entregaveis: '- Layout\n- Site responsivo\n- Treinamento' } },
    { id: 'p2', name: 'Identidade Visual Café Lume', client: 'Café Lume', color: '#f76b15', status: 'ativo', briefing: {} },
    { id: 'p3', name: 'Relatório Anual', client: 'ONG Raiz', color: '#30a46c', status: 'pausado', briefing: {} },
  ],
  tasks: [
    { id: 't1', projectId: 'p1', type: 'tarefa', title: 'Briefing e pesquisa', start: day(-10), end: day(-6), progress: 100, done: true, tags: ['cliente'] },
    { id: 'g1', projectId: 'p1', type: 'tarefa', title: 'Design', start: day(-5), end: day(12), progress: 0, done: false },
    { id: 't2', projectId: 'p1', parentId: 'g1', type: 'tarefa', title: 'Wireframes', start: day(-5), end: day(1), progress: 60, done: false, deps: ['t1'], priority: 'alta', tags: ['design', 'urgente'], focusDate: day(0) },
    { id: 't3', projectId: 'p1', parentId: 'g1', type: 'tarefa', title: 'Layout das páginas', start: day(2), end: day(12), progress: 0, done: false, deps: ['t2'], priority: 'media', tags: ['design'] },
    { id: 't4', projectId: 'p1', type: 'entrega', title: 'Apresentação do layout', start: day(13), end: day(13), progress: 0, done: false, deps: ['t3'], tags: ['cliente'] },
    { id: 'g2', projectId: 'p1', type: 'tarefa', title: 'Desenvolvimento', start: day(14), end: day(30), progress: 0, done: false },
    { id: 't5', projectId: 'p1', parentId: 'g2', type: 'tarefa', title: 'Front-end', start: day(14), end: day(24), progress: 0, done: false, deps: ['t4'], tags: ['dev'] },
    { id: 't9', projectId: 'p1', parentId: 'g2', type: 'tarefa', title: 'Integração de encomendas', start: day(20), end: day(30), progress: 0, done: false, deps: ['t5'], priority: 'baixa', tags: ['dev'] },
    { id: 't6', projectId: 'p2', type: 'tarefa', title: 'Moodboard', start: day(-3), end: day(-1), progress: 40, done: false, priority: 'alta', tags: ['design'] },
    { id: 't7', projectId: 'p2', type: 'entrega', title: 'Logo final', start: day(5), end: day(5), progress: 0, done: false, tags: ['cliente'], focusDate: day(0) },
    { id: 't8', projectId: 'p3', type: 'tarefa', title: 'Diagramação', start: day(0), end: day(8), progress: 10, done: false, priority: 'media' },
  ],
  notes: [
    { id: 'n1', projectId: 'p1', title: 'Reunião de kickoff', body: '# Kickoff\n\nCliente quer **tons quentes**.\n\n- [x] Enviar proposta\n- [ ] Pedir fotos dos produtos\n- [ ] Definir domínio\n\nRef: https://example.com', pinned: true, updatedAt: new Date().toISOString() },
    { id: 'n2', projectId: 'p1', title: 'Ideias de seções', body: '- Cardápio\n- Encomendas\n- Sobre nós', pinned: false, updatedAt: new Date(Date.now() - 86400000).toISOString() },
  ],
  timeEntries: [
    { id: 'e1', projectId: 'p1', taskId: 't2', description: 'Wireframe home', start: at(0, 9, 0), end: at(0, 11, 30) },
    { id: 'e2', projectId: 'p2', taskId: 't6', description: 'Pesquisa de referências', start: at(-1, 14, 0), end: at(-1, 16, 15) },
    { id: 'e3', projectId: 'p1', taskId: null, description: 'Reunião com cliente', start: at(-2, 10, 0), end: at(-2, 11, 0) },
  ],
  timer: { running: false, projectId: 'p1', taskId: null, description: '', startedAt: null },
};
fs.writeFileSync(path.join(userData, 'organizador-dados.json'), JSON.stringify(seed));

const errors = [];
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (ev) => {
    const level = ev.level ?? ev.params?.level;
    if (level === 'error' || level === 3) errors.push(ev.message ?? ev.params?.message);
  });
  win.webContents.on('preload-error', (_e2, p, err) => errors.push('preload: ' + err));
  win.webContents.once('did-finish-load', async () => {
    const wc = win.webContents;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const js = (code) => wc.executeJavaScript(code);
    const shot = async (name) => { await sleep(400); const img = await wc.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); };
    const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
    try {
      win.setSize(1320, 840);
      await sleep(800);
      await shot('01-painel');
      await click('[data-action=dash-tag][data-tag=design]'); await shot('01b-painel-filtro-design');
      await click('[data-action=dash-clear]');
      await click('[data-action=open-project][data-id=p1]'); await click('[data-action=tab][data-tab=gantt]'); await shot('02-gantt');
      await click('[data-action=gantt-collapse][data-id=g1]'); await shot('02b-gantt-recolhido');
      await click('[data-action=gantt-expand-all]');
      // Atrasa "Wireframes" 3 dias arrastando: dependentes devem ser empurrados.
      const before = await js('JSON.stringify(["t3","t4","t5"].map(id=>S.tasks.find(t=>t.id===id).start))');
      await js(`(() => { const t=S.tasks.find(x=>x.id==='t2'); TaskTree.move(S.tasks,t,U.addDays(t.start,3),U.addDays(t.end,3)); commit(); })()`);
      const after = await js('JSON.stringify(["t3","t4","t5"].map(id=>S.tasks.find(t=>t.id===id).start))');
      console.log('PUSH', before, '->', after);
      await shot('02c-gantt-empurrado');
      await click('[data-action=gantt-zoom][data-zoom=semana]'); await shot('03-gantt-semanas');
      await click('[data-action=gantt-zoom][data-zoom=dia]');
      await click('[data-action=edit-task][data-id=t3]'); await shot('10-modal-tarefa');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      await click('[data-action=tab][data-tab=notes]'); await shot('04-anotacoes');
      await click('[data-action=nav][data-view=calendar]'); await shot('08-calendario');
      const cyc = await js('JSON.stringify([TaskTree.linkProblem(S.tasks,"g2","t3"), TaskTree.linkProblem(S.tasks,"t1","t9")])');
      console.log('CYCLE', cyc);
      await click('[data-action=nav][data-view=dashboard]'); await shot('12-painel-final');
      await click('[data-action=theme][data-theme=light]'); await sleep(300); await shot('13-tema-claro');
      await click('[data-action=nav][data-view=calendar]'); await shot('14-calendario-claro');
      await click('[data-action=timer-start]'); await sleep(1200); await shot('14b-gravando-claro');
      await click('[data-action=theme][data-theme=dark]'); await sleep(300); await shot('14c-gravando-escuro');
      await click('[data-action=timer-pause]');
      await shot('15-tema-escuro');
      await click('[data-action=nav][data-view=timeline]'); await shot('16-cronograma-geral');
      await click('[data-action=ov-expand-all]'); await shot('17-cronograma-geral-expandido');
      await click('#projectsLink'); await shot('18-admin-projetos');
      await click('[data-action=adm-sort][data-k=hours]'); await click('[data-action=adm-sort][data-k=hours]'); await shot('18b-admin-ordenado-horas');
      await js(`window.confirm = () => true; 1`); await click('[data-action=adm-dup][data-id=p1]'); await shot('18c-admin-duplicado');
      const dup = await js('JSON.stringify((() => { const c = S.projects.find(p => p.name.endsWith("(cópia)")); const ts = S.tasks.filter(t => t.projectId === c.id); return { tasks: ts.length, groups: ts.filter(t => ts.some(x => x.parentId === t.id)).length, deps: ts.reduce((n, t) => n + (t.deps||[]).length, 0), done: ts.filter(t => t.done).length }; })())');
      console.log('DUP', dup);
      await click('[data-action=nav][data-view=tags]'); await shot('19-admin-tags');
      await click('[data-action=tag-toggle][data-tag=design]'); await shot('19b-admin-tags-tarefas');
      await js(`(() => { renameTag('dev', 'desenvolvimento'); tagMeta()['desenvolvimento'] = { color: '#e5484d' }; commit(); return 1; })()`);
      await click('[data-action=tag-new]'); await shot('19c-nova-tag');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      const tagState = await js('JSON.stringify({ tags: allTags(), devLeft: S.tasks.filter(t => (t.tags||[]).includes("dev")).length, renamed: S.tasks.filter(t => (t.tags||[]).includes("desenvolvimento")).length, color: tagColor("desenvolvimento") })');
      console.log('TAGS', tagState);
      await click('#projectsLink'); await click('[data-action=adm-status][data-v=""]');
      await click('[data-action=adm-archive][data-id=p3]'); await shot('20-projetos-apos-arquivar');
      const arch = await js('JSON.stringify({ sidebar: !!document.querySelector("#projectList [data-id=p3]"), timer: !!document.querySelector("#timerBox option[value=p3]"), archived: !!S.projects.find(p => p.id === "p3").archived })');
      console.log('ARCH', arch);
      await click('[data-action=adm-status][data-v=arquivado]'); await shot('21-arquivados');
      await click('[data-action=adm-unarchive][data-id=p3]');
      const back = await js('JSON.stringify({ archived: !!S.projects.find(p => p.id === "p3").archived, sidebar: !!document.querySelector("#projectList [data-id=p3]") })');
      console.log('UNARCH', back);
      await js(`(() => { const p = S.projects.find(x => x.id === 'p1'); p.links = [{ id: 'l1', url: 'https://drive.google.com/drive/folders/abc123', label: '' }, { id: 'l2', url: 'https://www.figma.com/design/xyz/Site-Aurora', label: 'Layout no Figma' }, { id: 'l3', url: '/Users/exemplo/Google Drive/Clientes/Padaria Aurora', label: '' }];
        const t = S.tasks.find(x => x.id === 't3'); t.links = [{ id: 'l4', url: 'https://docs.google.com/document/d/xyz/edit', label: '' }]; commit(); return 1; })()`);
      await click('[data-action=open-project][data-id=p1]'); await click('[data-action=tab][data-tab=gantt]'); await shot('22-links-projeto');
      await click('[data-action=edit-task][data-id=t3]'); await sleep(300);
      await js(`(() => { const m = document.querySelector('.modal'); m.scrollTop = m.scrollHeight; return 1; })()`); await shot('23-links-tarefa');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      await click('[data-action=project-links][data-id=p1]'); await shot('24-links-modal');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      await click('[data-action=nav][data-view=dashboard]'); await shot('25-painel-link');
      // Relatórios em PDF (gerados direto, sem a janela de salvar)
      await click('[data-action=open-project][data-id=p1]'); await click('[data-action=report-project]'); await shot('26-modal-relatorio');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      const pdfOf = async (code, file, landscape) => {
        await js(`(() => { document.getElementById('printRoot').innerHTML = ${code}; return 1; })()`);
        const prevBg = win.getBackgroundColor();
        win.setBackgroundColor('#ffffff');
        const pdf = await wc.printToPDF({ printBackground: true, pageSize: 'A4', landscape, margins: { top: 0.45, bottom: 0.6, left: 0.45, right: 0.45 } });
        win.setBackgroundColor(prevBg);
        fs.writeFileSync(path.join(out, file), pdf);
        await js(`(() => { document.getElementById('printRoot').innerHTML = ''; return 1; })()`);
      };
      const allSecs = '{ resumo: true, cronograma: true, tarefas: true, horas: true, briefing: true, notas: true }';
      await pdfOf(`buildProjectReport(proj('p1'), { period: 'tudo', sections: ${allSecs} })`, 'relatorio-projeto.pdf', false);
      await pdfOf(`buildProjectReport(proj('p1'), { period: 'mes', sections: ${allSecs} })`, 'relatorio-projeto-mes.pdf', true);
      await pdfOf(`buildGeneralReport({ period: 'tudo', details: true, includeDone: true, sections: ${allSecs} })`, 'relatorio-geral.pdf', false);
      await js(`(() => { const cv = document.createElement('canvas'); cv.width = 240; cv.height = 80; const g = cv.getContext('2d');
        g.fillStyle = '#8a3ffc'; g.beginPath(); g.arc(40, 40, 32, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.fillText('A', 28, 52);
        g.fillStyle = '#1d1d22'; g.font = 'bold 30px sans-serif'; g.fillText('aurora', 84, 52);
        Object.assign(profile(), { type: 'empresa', name: 'Estúdio Aurora Design', subtitle: 'Branding e design digital', site: 'estudioaurora.com.br', email: 'contato@estudioaurora.com.br', whatsapp: '(41) 99999-0000', address: 'Rua das Flores, 123 — Centro\\nCuritiba/PR', color: '#8a3ffc', logo: cv.toDataURL('image/png') });
        commit(); return 1; })()`);
      await click('#profileLink'); await shot('27-perfil');
      await click('[data-action=nav][data-view=projects]');
      await pdfOf(`buildProjectReport(proj('p1'), { period: 'tudo', useProfile: true, sections: ${allSecs} })`, 'relatorio-com-perfil.pdf', false);
      await click('[data-action=open-project][data-id=p1]'); await click('[data-action=report-project]'); await shot('28-modal-com-perfil');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      // Aviso de atualização com uma versão simulada (ORGANIZADOR_UPDATE_TEST)
      await js('api.checkUpdate().then(() => 1)'); await sleep(600); await shot('29-atualizacao');
      await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await shot('30-banner-atualizacao');
      const st = await js('JSON.stringify({entries:S.timeEntries.length, running:S.timer.running})');
      console.log('STATE', st);
    } catch (e) { errors.push('teste: ' + e.message); }
    console.log('ERRORS', JSON.stringify(errors));
    console.log('OUT', out);
    app.exit(0);
  });
});

require('../main.js');
