// Adiciona (ou remove) projetos e tarefas fictícios para testar o app.
// Os dados de demonstração têm ids começando com "demo-" e não mexem nos seus dados.
//
// Uso (com o app fechado):
//   node scripts/demo-data.js            → adiciona os dados de demonstração
//   node scripts/demo-data.js --remover  → remove só os dados de demonstração (e o perfil fictício)
//   node scripts/demo-data.js --perfil   → preenche só o perfil com uma empresa fictícia
//   node scripts/demo-data.js --remover-perfil → limpa só o perfil fictício
//   node scripts/demo-data.js --arquivo /caminho/organizador-dados.json
const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const remove = args.includes('--remover');
const fileArg = args.indexOf('--arquivo');
let file = fileArg >= 0 ? args[fileArg + 1] : null;
if (!file) {
  const appDir = path.join(os.homedir(), 'Library', 'Application Support', 'Organizador de Projetos');
  let dir = appDir;
  try { dir = JSON.parse(fs.readFileSync(path.join(appDir, 'config.json'), 'utf8')).dataDir || appDir; } catch { /* padrão */ }
  file = path.join(dir, 'organizador-dados.json');
}

let state = { version: 1, projects: [], tasks: [], notes: [], timeEntries: [], timer: { running: false, projectId: null, taskId: null, description: '', startedAt: null } };
if (fs.existsSync(file)) {
  state = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.copyFileSync(file, file.replace(/\.json$/, `.antes-demo-${Date.now()}.json`));
}
// ---------- Perfil fictício (--perfil preenche, --remover-perfil limpa) ----------
// Só mexe no perfil: projetos e tarefas ficam como estão.
if (args.includes('--perfil') || args.includes('--remover-perfil')) {
  if (args.includes('--remover-perfil')) {
    if (state.profile && state.profile.demo) delete state.profile;
    fs.writeFileSync(file, JSON.stringify(state, null, 1));
    console.log('Perfil de demonstração removido.');
    process.exit(0);
  }
  if (state.profile && state.profile.name && !state.profile.demo) {
    console.log('Você já tem um perfil preenchido; nada foi alterado.');
    process.exit(0);
  }
  const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 80">
    <rect x="4" y="8" width="64" height="64" rx="16" fill="#12a594"/>
    <path d="M22 58 L36 22 L50 58 M27.5 45 H44.5" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="82" y="40" font-family="Helvetica, Arial, sans-serif" font-size="27" font-weight="700" fill="#1d1d22">atelier</text>
    <text x="83" y="66" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="400" fill="#12a594" letter-spacing="4">NORTE</text>
  </svg>`;
  state.profile = {
    demo: true,
    type: 'empresa',
    name: 'Atelier Norte Design',
    subtitle: 'Identidade visual, sites e conteúdo',
    site: 'ateliernorte.com.br',
    email: 'contato@ateliernorte.com.br',
    whatsapp: '(41) 98765-4321',
    address: 'Rua Exemplo, 100 — Sala 12, Centro\nCuritiba/PR',
    color: '#12a594',
    logo: 'data:image/svg+xml;base64,' + Buffer.from(logoSvg).toString('base64'),
    pdf: { enabled: true, logo: true, contact: true, color: true },
  };
  fs.writeFileSync(file, JSON.stringify(state, null, 1));
  console.log('Perfil de demonstração preenchido: Atelier Norte Design.');
  process.exit(0);
}

const isDemo = (x) => String(x.id).startsWith('demo-');
for (const k of ['projects', 'tasks', 'notes', 'timeEntries']) state[k] = (state[k] || []).filter((x) => !isDemo(x));
if (state.timer && String(state.timer.projectId || '').startsWith('demo-')) state.timer = { running: false, projectId: null, taskId: null, description: '', startedAt: null };

if (remove) {
  if (state.profile && state.profile.demo) delete state.profile;
  fs.writeFileSync(file, JSON.stringify(state, null, 1));
  console.log('Dados de demonstração removidos de', file);
  process.exit(0);
}

// ---------- Datas relativas a hoje ----------
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date(); today.setHours(0, 0, 0, 0);
const day = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return key(d); };
const TODAY = day(0);
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n); return key(x); };

// ---------- Projetos ----------
const P = (id, name, client, color, status, briefing = {}) => ({ id: `demo-${id}`, name, client, color, status, briefing, createdAt: new Date().toISOString() });
const projects = [
  P('lume', 'Rebranding Café Lume', 'Café Lume', '#f76b15', 'ativo', {
    cliente: 'Marina Costa (sócia) — marina@cafelume.com.br — (41) 99999-0000',
    resumo: 'Renovar a identidade visual da cafeteria para a abertura da segunda unidade, mantendo o clima acolhedor e artesanal.',
    objetivos: 'Modernizar a marca sem perder os clientes atuais.\nCriar um sistema visual que funcione em embalagens, cardápio e redes sociais.',
    publico: 'Jovens adultos (25–40), trabalham perto do centro, valorizam café especial e ambiente para trabalhar.',
    entregaveis: '- Logo e variações\n- Paleta e tipografia\n- Manual de marca (PDF)\n- Embalagens: copo, saco de café, sacola\n- Cardápio impresso e digital',
    prazos: 'Apresentação de conceito em 2 semanas. Inauguração da nova unidade no início de janeiro.',
    orcamento: 'R$ 18.000 — 40% na assinatura, 60% na entrega',
    tom: 'Acolhedor, artesanal, um pouco divertido. Nada de visual "corporativo".',
    referencias: 'Cafeterias de bairro de Lisboa, embalagens kraft, tipografia manuscrita.',
    restricoes: 'Manter o laranja que os clientes reconhecem. Impressão das embalagens em no máximo 2 cores.',
    aprovacao: 'Marina e Paulo (sócios)',
  }),
  P('aurora', 'Site Padaria Aurora', 'Padaria Aurora', '#5b6cff', 'ativo', {
    cliente: 'Ana Souza — ana@padariaaurora.com.br',
    resumo: 'Site institucional com cardápio e encomendas de bolos e salgados online.',
    objetivos: 'Aumentar encomendas online em 30% em 6 meses.\nReduzir pedidos feitos por telefone.',
    publico: 'Famílias do bairro, empresas que encomendam coffee breaks.',
    entregaveis: '- Layout das páginas (home, cardápio, encomendas, sobre)\n- Site responsivo\n- Integração com WhatsApp e pagamento\n- Treinamento da equipe',
    prazos: 'Lançamento antes do Natal (encomendas de panetone).',
    orcamento: 'R$ 12.500',
    aprovacao: 'Ana Souza',
  }),
  P('verde', 'Campanha de Natal — Loja Verde', 'Loja Verde Plantas', '#30a46c', 'ativo', {
    cliente: 'Rafael — marketing@lojaverde.com.br',
    resumo: 'Campanha de fim de ano para redes sociais e loja física: plantas como presente de Natal.',
    objetivos: 'Vender 300 kits presente até 24/12.',
    entregaveis: '- 12 posts + 6 stories\n- 2 vídeos curtos\n- Cartaz para a vitrine\n- Cartão de presente',
    prazos: 'Campanha no ar de 1 a 24 de dezembro.',
    orcamento: 'R$ 6.800',
  }),
  P('ponto', 'Consultoria Ateliê Ponto Fino', 'Ateliê Ponto Fino', '#d6409f', 'ativo', {
    cliente: 'Dona Lúcia — ateliê de costura sob medida',
    resumo: 'Acompanhamento de gestão: precificação, organização de pedidos e presença digital.',
    objetivos: 'Definir preço de venda com margem real.\nOrganizar a agenda de provas e entregas.\nCriar perfil comercial no Instagram.',
    prazos: '4 encontros quinzenais.',
  }),
  P('raiz', 'Relatório Anual ONG Raiz', 'ONG Raiz', '#12a594', 'pausado', {
    resumo: 'Diagramação do relatório anual de atividades (40 páginas). Aguardando textos e fotos da ONG.',
  }),
  P('rio', 'Documentário Rio Abaixo — legendas', 'Produtora Margem', '#6e6e80', 'concluido', {
    resumo: 'Legendagem PT-BR e closed caption do documentário de 52 minutos.',
  }),
];

// ---------- Tarefas ----------
// T(id, projeto, título, início, duração em dias, extras). Com deps, o início é ajustado para depois delas.
const tasks = [];
const byId = {};
function T(id, p, title, start, days, extra = {}) {
  const t = { id: `demo-${id}`, projectId: `demo-${p}`, type: 'tarefa', title, start, end: addDays(start, Math.max(0, days - 1)), progress: 0, done: false, notes: '', tags: [], deps: [], parentId: null, priority: null, focusDate: null, createdAt: new Date().toISOString(), ...extra };
  if (extra.parent) { t.parentId = `demo-${extra.parent}`; delete t.parent; }
  t.deps = (extra.deps || []).map((d) => `demo-${d}`);
  for (const d of t.deps) {
    const dep = byId[d];
    if (!dep) continue;
    const earliest = dep.type === 'entrega' ? dep.start : addDays(dep.end, 1);
    if (t.start < earliest) { const len = days - 1; t.start = earliest; t.end = addDays(earliest, Math.max(0, len)); }
  }
  if (t.type === 'entrega') t.end = t.start;
  if (t.done) t.progress = 100;
  tasks.push(t);
  byId[t.id] = t;
  return t;
}
const G = (id, p, title, extra = {}) => T(id, p, title, TODAY, 1, extra); // grupo: datas calculadas pelo app
const E = (id, p, title, date, extra = {}) => T(id, p, title, date, 1, { type: 'entrega', ...extra });

// Rebranding Café Lume
G('l-pesq', 'lume', 'Pesquisa e diagnóstico');
T('l-kick', 'lume', 'Reunião de kickoff', day(-16), 1, { parent: 'l-pesq', done: true, tags: ['reunião', 'cliente'] });
T('l-conc', 'lume', 'Análise de concorrentes', day(-15), 4, { parent: 'l-pesq', done: true, deps: ['l-kick'], tags: ['pesquisa'] });
T('l-entr', 'lume', 'Entrevistas com clientes', day(-14), 5, { parent: 'l-pesq', done: true, deps: ['l-kick'], tags: ['pesquisa', 'cliente'] });
G('l-cria', 'lume', 'Criação da identidade');
T('l-mood', 'lume', 'Moodboard e direção criativa', day(-8), 3, { parent: 'l-cria', done: true, deps: ['l-conc', 'l-entr'], tags: ['design'] });
T('l-logo', 'lume', 'Esboços do logo', day(-5), 5, { parent: 'l-cria', progress: 70, deps: ['l-mood'], tags: ['design'], priority: 'alta', focusDate: TODAY });
T('l-pal', 'lume', 'Paleta e tipografia', day(-1), 4, { parent: 'l-cria', progress: 20, deps: ['l-mood'], tags: ['design'], priority: 'media' });
E('l-apres', 'lume', 'Apresentação do conceito', day(5), { deps: ['l-logo', 'l-pal'], tags: ['cliente', 'reunião'], priority: 'alta' });
G('l-apl', 'lume', 'Aplicações');
T('l-emb', 'lume', 'Embalagens (copo, saco, sacola)', day(6), 8, { parent: 'l-apl', deps: ['l-apres'], tags: ['design', 'impressão'] });
T('l-card', 'lume', 'Cardápio impresso e digital', day(8), 6, { parent: 'l-apl', deps: ['l-apres'], tags: ['design'] });
T('l-man', 'lume', 'Manual de marca', day(10), 7, { parent: 'l-apl', deps: ['l-emb'], tags: ['design', 'revisão'] });
E('l-fim', 'lume', 'Entrega final da marca', day(24), { deps: ['l-man', 'l-card'], tags: ['cliente'], priority: 'alta' });

// Site Padaria Aurora
G('a-plan', 'aurora', 'Planejamento');
T('a-brief', 'aurora', 'Briefing e mapa do site', day(-20), 3, { parent: 'a-plan', done: true, tags: ['cliente'] });
T('a-cont', 'aurora', 'Levantar textos e fotos dos produtos', day(-17), 6, { parent: 'a-plan', done: true, deps: ['a-brief'], tags: ['conteúdo'] });
G('a-des', 'aurora', 'Design');
T('a-wire', 'aurora', 'Wireframes', day(-10), 5, { parent: 'a-des', done: true, deps: ['a-brief'], tags: ['design', 'ux'] });
T('a-lay', 'aurora', 'Layout das páginas', day(-5), 7, { parent: 'a-des', progress: 60, deps: ['a-wire'], tags: ['design'], priority: 'alta', focusDate: TODAY });
E('a-aprov', 'aurora', 'Aprovação do layout', day(2), { deps: ['a-lay'], tags: ['cliente'] });
G('a-dev', 'aurora', 'Desenvolvimento');
T('a-front', 'aurora', 'Front-end responsivo', day(3), 8, { parent: 'a-dev', deps: ['a-aprov'], tags: ['dev'] });
T('a-enc', 'aurora', 'Encomendas + WhatsApp + pagamento', day(6), 7, { parent: 'a-dev', deps: ['a-aprov'], tags: ['dev'], priority: 'media' });
T('a-test', 'aurora', 'Testes no celular', day(13), 3, { parent: 'a-dev', deps: ['a-front', 'a-enc'], tags: ['dev', 'revisão'] });
E('a-lanc', 'aurora', 'Site no ar', day(17), { deps: ['a-test'], tags: ['cliente'], priority: 'alta' });
T('a-trein', 'aurora', 'Treinamento da equipe', day(18), 1, { deps: ['a-lanc'], tags: ['cliente', 'reunião'] });

// Campanha de Natal — Loja Verde
T('v-plan', 'verde', 'Calendário de posts', day(-6), 2, { done: true, tags: ['conteúdo'] });
T('v-foto', 'verde', 'Sessão de fotos dos kits', day(-3), 2, { progress: 50, tags: ['conteúdo', 'foto'], priority: 'alta' }); // atrasada
T('v-posts', 'verde', 'Criar 12 posts e 6 stories', day(0), 6, { deps: [], tags: ['design', 'conteúdo', 'urgente'], priority: 'alta', focusDate: TODAY });
T('v-video', 'verde', 'Editar 2 vídeos curtos', day(2), 4, { deps: ['v-foto'], tags: ['vídeo'], priority: 'media' });
T('v-vitr', 'verde', 'Cartaz da vitrine e cartão de presente', day(1), 3, { tags: ['design', 'impressão'], priority: 'baixa' });
E('v-noar', 'verde', 'Campanha no ar', day(8), { deps: ['v-posts', 'v-video'], tags: ['cliente', 'urgente'], priority: 'alta' });
T('v-rel', 'verde', 'Relatório de resultados', day(33), 2, { deps: ['v-noar'], tags: ['relatório'] });

// Consultoria Ateliê Ponto Fino
E('p-enc1', 'ponto', '1º encontro — diagnóstico', day(-12), { done: true, tags: ['reunião', 'cliente'] });
T('p-prec', 'ponto', 'Planilha de precificação', day(-10), 6, { done: true, deps: ['p-enc1'], tags: ['financeiro'] });
E('p-enc2', 'ponto', '2º encontro — preços e margem', day(1), { tags: ['reunião', 'cliente'], priority: 'media' });
T('p-agenda', 'ponto', 'Organizar agenda de provas', day(2), 5, { deps: ['p-enc2'], tags: ['processos'] });
E('p-enc3', 'ponto', '3º encontro — presença digital', day(15), { deps: ['p-agenda'], tags: ['reunião', 'cliente'] });
T('p-insta', 'ponto', 'Montar perfil comercial no Instagram', day(16), 6, { deps: ['p-enc3'], tags: ['conteúdo'], priority: 'baixa' });
E('p-enc4', 'ponto', '4º encontro — fechamento', day(29), { deps: ['p-insta'], tags: ['reunião', 'cliente'] });

// Relatório Anual ONG Raiz (pausado)
T('r-grid', 'raiz', 'Grid e estilos do relatório', day(-25), 4, { done: true, tags: ['design'] });
T('r-diag', 'raiz', 'Diagramação das 40 páginas', day(-2), 10, { progress: 15, deps: ['r-grid'], tags: ['design'], priority: 'baixa', notes: 'Pausado: aguardando textos e fotos da ONG.' });
E('r-entrega', 'raiz', 'Entrega para a gráfica', day(20), { deps: ['r-diag'], tags: ['impressão'] });

// Documentário (concluído)
T('d-leg', 'rio', 'Legendagem PT-BR', day(-40), 8, { done: true, tags: ['legenda'] });
T('d-cc', 'rio', 'Closed caption (LSE)', day(-31), 6, { done: true, deps: ['d-leg'], tags: ['legenda', 'revisão'] });
E('d-ent', 'rio', 'Entrega dos arquivos .srt', day(-24), { done: true, deps: ['d-cc'], tags: ['cliente'] });

// ---------- Anotações ----------
const now = Date.now();
const N = (id, p, title, body, hoursAgo, pinned = false) => ({ id: `demo-${id}`, projectId: `demo-${p}`, title, body, pinned, updatedAt: new Date(now - hoursAgo * 3600000).toISOString() });
const notes = [
  N('n1', 'lume', 'Kickoff com Marina e Paulo', '# Kickoff\n\nQuerem manter o **laranja** — os clientes associam à marca.\n\n## Combinado\n- [x] Enviar proposta assinada\n- [x] Agendar entrevistas com clientes\n- [ ] Pedir fotos da nova unidade\n- [ ] Confirmar fornecedor de embalagens\n\nReferência que eles amaram: https://example.com/cafe-lisboa', 300, true),
  N('n2', 'lume', 'Insights das entrevistas', '- Clientes chamam o café de "aconchegante"\n- Muita gente trabalha de notebook lá → pedir **tomadas** no layout da nova loja\n- O logo atual é difícil de ler no copo\n- Gostam do *cheiro de pão* — explorar texturas quentes', 120),
  N('n3', 'aurora', 'Páginas do site', '## Estrutura\n1. Home\n2. Cardápio (com filtro: doces, salgados, pães)\n3. Encomendas\n4. Sobre a padaria\n\n- [x] Wireframes aprovados\n- [ ] Fotos dos bolos em fundo claro\n- [ ] Texto da página Sobre', 30, true),
  N('n4', 'verde', 'Ideias de posts', '- Planta certa para cada signo 🌱\n- "Presente que cresce"\n- Bastidores da montagem dos kits\n- Cuidados com a planta depois do Natal\n\n- [ ] Validar frases com o Rafael', 8),
  N('n5', 'ponto', 'Diagnóstico do ateliê', '## Situação atual\n- Preço definido "no olho"\n- Agenda em caderno de papel\n- Cliente chega por indicação\n\n## Próximos passos\n- [x] Levantar custos fixos\n- [x] Tempo médio por peça\n- [ ] Calcular margem por tipo de peça', 200),
];

// ---------- Horas registradas (últimas 3 semanas, dias úteis) ----------
let seed = 7;
const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
const timeEntries = [];
const workable = (t, k) => t.type !== 'entrega' && t.start <= k && t.end >= addDays(k, -2) && (!t.done || t.end >= addDays(k, -1));
for (let n = -20; n <= 0; n++) {
  const k = day(n);
  const dow = new Date(today.getTime() + n * 86400000).getDay();
  if (dow === 0 || dow === 6) continue;
  const candidates = tasks.filter((t) => !['demo-raiz', 'demo-rio'].includes(t.projectId) && workable(t, k) && !tasks.some((x) => x.parentId === t.id));
  if (!candidates.length) continue;
  let hour = 9;
  const blocks = n === 0 ? 2 : 2 + Math.floor(rand() * 3);
  for (let b = 0; b < blocks && hour < 18; b++) {
    const t = candidates[Math.floor(rand() * candidates.length)];
    const mins = [45, 60, 90, 120, 150][Math.floor(rand() * 5)];
    const [y, m, d] = k.split('-').map(Number);
    const s = new Date(y, m - 1, d, hour, [0, 15, 30][Math.floor(rand() * 3)]);
    const e = new Date(s.getTime() + mins * 60000);
    if (n === 0 && e > new Date()) break;
    timeEntries.push({ id: `demo-e${timeEntries.length}`, projectId: t.projectId, taskId: t.id, description: ['', 'ajustes', 'revisão com cliente', 'produção', 'pesquisa de referências'][Math.floor(rand() * 5)], start: s.toISOString(), end: e.toISOString() });
    hour = e.getHours() + (e.getMinutes() > 30 ? 1 : 0) + (rand() > 0.6 ? 1 : 0);
    if (hour >= 12 && hour < 13) hour = 13;
  }
}

state.projects.push(...projects);
state.tasks.push(...tasks);
state.notes.push(...notes);
state.timeEntries.push(...timeEntries);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(state, null, 1));
console.log(`Adicionados: ${projects.length} projetos, ${tasks.length} tarefas, ${notes.length} anotações, ${timeEntries.length} registros de horas.`);
console.log('Arquivo:', file);
