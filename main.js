// Processo principal: janela, ícone na barra de menus, armazenamento e timer.
const {
  app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, shell,
  Notification, powerMonitor, nativeTheme,
} = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_FILENAME = 'organizador-dados.json';
let config = { dataDir: null, theme: 'system' };
let state = null;
let win = null;
let tray = null;
let lastWriteMtime = 0;
let saveTimer = null;
let trayTick = null;
let isQuitting = false;
let muteBroadcast = false; // ações vindas da própria janela já recebem o estado na resposta

// Permite rodar com uma pasta de dados separada (usado nos testes).
if (process.env.ORGANIZADOR_USER_DATA) app.setPath('userData', process.env.ORGANIZADOR_USER_DATA);

// ---------- Utilidades ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function hm(ms) {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}h${pad(m % 60)}`;
}

// ---------- Configuração e dados ----------
const configPath = () => path.join(app.getPath('userData'), 'config.json');
const dataDir = () => config.dataDir || app.getPath('userData');
const dataFile = () => path.join(dataDir(), DATA_FILENAME);

function defaultState() {
  return {
    version: 1,
    projects: [],
    tasks: [],
    notes: [],
    timeEntries: [],
    timer: { running: false, projectId: null, taskId: null, description: '', startedAt: null },
  };
}

function normalize(s) {
  const d = defaultState();
  s = Object.assign(d, s && typeof s === 'object' ? s : {});
  for (const k of ['projects', 'tasks', 'notes', 'timeEntries']) if (!Array.isArray(s[k])) s[k] = [];
  s.timer = Object.assign(defaultState().timer, s.timer || {});
  return s;
}

function loadConfig() {
  try { config = { ...config, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }; } catch { /* primeira execução */ }
  if (config.dataDir && !fs.existsSync(config.dataDir)) config.dataDir = null;
}
function saveConfig() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

function loadState() {
  try {
    state = normalize(JSON.parse(fs.readFileSync(dataFile(), 'utf8')));
    lastWriteMtime = fs.statSync(dataFile()).mtimeMs;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Arquivo ilegível: guarda uma cópia antes de seguir com dados vazios.
      try { fs.copyFileSync(dataFile(), dataFile() + `.ilegivel-${Date.now()}.json`); } catch { /* ignora */ }
    }
    state = defaultState();
  }
}

function writeNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const f = dataFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, f);
  lastWriteMtime = fs.statSync(f).mtimeMs;
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 400);
}

// Uma cópia por dia na pasta "backups", mantendo as 20 mais recentes.
function dailyBackup() {
  try {
    if (!fs.existsSync(dataFile())) return;
    const dir = path.join(dataDir(), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const name = `organizador-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) fs.copyFileSync(dataFile(), target);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('organizador-')).sort();
    while (files.length > 20) fs.unlinkSync(path.join(dir, files.shift()));
  } catch { /* backup é opcional */ }
}

// Se o arquivo mudou por fora (ex.: iCloud sincronizou do outro Mac), recarrega.
function checkExternalChange() {
  if (saveTimer) return;
  try {
    const m = fs.statSync(dataFile()).mtimeMs;
    if (m > lastWriteMtime + 1) {
      loadState();
      broadcast();
      updateTray();
    }
  } catch { /* sem arquivo ainda */ }
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('state:changed', state);
}
function changed() {
  scheduleSave();
  if (!muteBroadcast) broadcast();
  updateTray();
}

// ---------- Timer ----------
function timerStart({ projectId, taskId, description } = {}) {
  if (state.timer.running) timerPause();
  const pid = projectId || state.timer.projectId;
  if (!pid || !state.projects.find((p) => p.id === pid)) return;
  state.timer = {
    running: true,
    projectId: pid,
    taskId: taskId !== undefined ? taskId : (pid === state.timer.projectId ? state.timer.taskId : null),
    description: description !== undefined ? description : (pid === state.timer.projectId ? state.timer.description : ''),
    startedAt: new Date().toISOString(),
  };
  changed();
}

function timerPause() {
  const t = state.timer;
  if (!t.running) return;
  const end = new Date();
  if (end - new Date(t.startedAt) >= 1000) {
    state.timeEntries.push({
      id: uid(), projectId: t.projectId, taskId: t.taskId || null,
      description: t.description || '', start: t.startedAt, end: end.toISOString(),
    });
  }
  state.timer = { ...t, running: false, startedAt: null };
  changed();
}

function timerUpdate(patch) {
  const allowed = ['projectId', 'taskId', 'description'];
  const t = state.timer;
  // Trocar de projeto com o timer rodando fecha o trecho atual e abre outro.
  if (t.running && patch.projectId && patch.projectId !== t.projectId) {
    timerPause();
    timerStart({ projectId: patch.projectId, taskId: patch.taskId || null, description: patch.description ?? t.description });
    return;
  }
  for (const k of allowed) if (k in patch) t[k] = patch[k];
  changed();
}


// ---------- Atualizações (consulta o GitHub Releases do repositório público de versões) ----------
const APP_PKG = require('./package.json');
const APP_VERSION = APP_PKG.version;
const UPDATE_REPO = (APP_PKG.updates || {}).repo || '';
let updateInfo = null;

// Compara versões "1.2.10" x "1.2.9".
function isNewer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

async function fetchLatestRelease() {
  // Para testes: ORGANIZADOR_UPDATE_TEST aponta para um JSON no formato da API do GitHub.
  if (process.env.ORGANIZADOR_UPDATE_TEST) return JSON.parse(fs.readFileSync(process.env.ORGANIZADOR_UPDATE_TEST, 'utf8'));
  if (!UPDATE_REPO) return null;
  const { net } = require('electron');
  const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'organizador-projetos-app' },
  });
  if (res.status === 404) return null; // ainda não há versão publicada
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  return res.json();
}

async function checkForUpdates({ manual = false } = {}) {
  try {
    const rel = await fetchLatestRelease();
    const latest = rel ? String(rel.tag_name || '').replace(/^v/i, '') : '';
    if (rel && latest && isNewer(latest, APP_VERSION)) {
      const dmg = (rel.assets || []).find((a) => /\.dmg$/i.test(a.name));
      const isNew = !updateInfo || updateInfo.version !== latest;
      updateInfo = { version: latest, current: APP_VERSION, notes: rel.body || '', name: rel.name || `Versão ${latest}`, url: dmg ? dmg.browser_download_url : rel.html_url, page: rel.html_url, date: rel.published_at };
      if (win && !win.isDestroyed()) win.webContents.send('update:available', updateInfo);
      buildTrayMenu();
      if (isNew && !manual && Notification.isSupported()) {
        const n = new Notification({ title: 'Nova versão do Organizador', body: `A versão ${latest} está disponível. Clique para ver as novidades.` });
        n.on('click', () => { showWindow(); setTimeout(() => win.webContents.send('update:open'), 400); });
        n.show();
      }
      if (manual) { showWindow(); win.webContents.send('update:open'); }
      return updateInfo;
    }
    if (manual) {
      dialog.showMessageBox(win, {
        type: 'info', message: 'Você está com a versão mais recente.',
        detail: UPDATE_REPO || process.env.ORGANIZADOR_UPDATE_TEST ? `Versão instalada: ${APP_VERSION}` : 'As atualizações ainda não foram configuradas.',
      });
    }
  } catch (e) {
    if (manual) dialog.showMessageBox(win, { type: 'warning', message: 'Não consegui verificar atualizações.', detail: `Confira a internet e tente de novo.\n(${e.message})` });
  }
  return null;
}

// ---------- Janela ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Organizador de Projetos',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1b1f' : '#f6f6f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('focus', checkExternalChange);
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
      if (process.platform === 'darwin') app.dock.hide();
    }
  });
  // Links externos abrem no navegador padrão.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
}

function showWindow() {
  if (process.platform === 'darwin') app.dock.show();
  if (!win || win.isDestroyed()) createWindow();
  else { win.show(); win.focus(); }
}

// ---------- Ícone na barra de menus ----------
function todayTotalMs() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  let total = 0;
  for (const e of state.timeEntries) {
    const s = new Date(e.start), en = new Date(e.end);
    if (en > start) total += en - Math.max(s, start);
  }
  if (state.timer.running) total += Date.now() - Math.max(new Date(state.timer.startedAt), start);
  return total;
}

function updateTray() {
  if (!tray) return;
  const t = state.timer;
  if (t.running) {
    tray.setTitle(' ' + clock(Date.now() - new Date(t.startedAt)), { fontType: 'monospacedDigit' });
    if (!trayTick) trayTick = setInterval(updateTrayTitle, 1000);
  } else {
    tray.setTitle('');
    clearInterval(trayTick);
    trayTick = null;
  }
  buildTrayMenu();
}
function updateTrayTitle() {
  if (tray && state.timer.running) {
    tray.setTitle(' ' + clock(Date.now() - new Date(state.timer.startedAt)), { fontType: 'monospacedDigit' });
  }
}

function buildTrayMenu() {
  const t = state.timer;
  const projects = state.projects.filter((p) => p.status !== 'concluido' && !p.archived);
  const current = state.projects.find((p) => p.id === t.projectId);
  const items = [];
  if (t.running) {
    items.push({ label: `● Gravando: ${current ? current.name : '—'}`, enabled: false });
    if (t.description) items.push({ label: `   ${t.description}`, enabled: false });
    items.push({ label: 'Pausar', accelerator: 'Space', click: timerPause });
  } else {
    items.push({ label: 'Timer pausado', enabled: false });
    if (current) items.push({ label: `▶ Gravar em “${current.name}”`, click: () => timerStart({ projectId: current.id }) });
  }
  items.push({
    label: 'Gravar em…',
    enabled: projects.length > 0,
    submenu: projects.length
      ? projects.map((p) => ({ label: p.name, type: 'radio', checked: t.running && p.id === t.projectId, click: () => timerStart({ projectId: p.id }) }))
      : [{ label: 'Nenhum projeto', enabled: false }],
  });
  items.push({ type: 'separator' });
  items.push({ label: `Hoje: ${hm(todayTotalMs())} registradas`, enabled: false });
  items.push({ type: 'separator' });
  if (updateInfo) {
    items.push({ label: `⬆ Nova versão ${updateInfo.version} disponível`, click: () => { showWindow(); win.webContents.send('update:open'); } });
    items.push({ type: 'separator' });
  }
  items.push({ label: 'Abrir Organizador', click: showWindow });
  items.push({
    label: 'Abrir ao iniciar o Mac',
    type: 'checkbox',
    checked: app.getLoginItemSettings().openAtLogin,
    click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked }),
  });
  items.push({ type: 'separator' });
  items.push({ label: 'Sair', click: () => { isQuitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Organizador de Projetos');
  updateTray();
}

// ---------- Ações de dados (exportar / importar / pasta) ----------
async function exportData() {
  const d = new Date();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exportar backup',
    defaultPath: `organizador-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, JSON.stringify(state, null, 1));
  return true;
}

async function importData() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Importar backup', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths[0]) return false;
  let incoming;
  try { incoming = normalize(JSON.parse(fs.readFileSync(filePaths[0], 'utf8'))); } catch {
    dialog.showErrorBox('Arquivo inválido', 'Não consegui ler esse arquivo de backup.');
    return false;
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Substituir', 'Cancelar'], defaultId: 1, cancelId: 1,
    message: 'Substituir todos os dados atuais pelos do backup?',
    detail: `${incoming.projects.length} projeto(s), ${incoming.tasks.length} tarefa(s), ${incoming.timeEntries.length} registro(s) de horas.`,
  });
  if (response !== 0) return false;
  if (state.timer.running) timerPause();
  writeNow();
  try { fs.copyFileSync(dataFile(), dataFile() + `.antes-import-${Date.now()}.json`); } catch { /* ignora */ }
  state = incoming;
  state.timer.running = false;
  changed();
  return true;
}

async function chooseDataDir() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Escolha a pasta onde os dados ficarão (ex.: iCloud Drive)',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths[0]) return false;
  const dir = filePaths[0];
  const target = path.join(dir, DATA_FILENAME);
  writeNow();
  if (fs.existsSync(target) && path.resolve(target) !== path.resolve(dataFile())) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Usar os dados dessa pasta', 'Substituir pelos dados deste Mac', 'Cancelar'],
      defaultId: 0, cancelId: 2,
      message: 'Essa pasta já tem dados do Organizador.',
      detail: 'Se você já usa o app em outro Mac com essa pasta, escolha "Usar os dados dessa pasta".',
    });
    if (response === 2) return false;
    if (response === 1) {
      fs.copyFileSync(target, target + `.substituido-${Date.now()}.json`);
      config.dataDir = dir; saveConfig(); writeNow();
    } else {
      if (state.timer.running) timerPause();
      writeNow();
      config.dataDir = dir; saveConfig(); loadState();
    }
  } else {
    config.dataDir = dir; saveConfig(); writeNow();
  }
  changed();
  return true;
}

function buildAppMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'Sobre o Organizador de Projetos' },
        { label: 'Verificar atualizações…', click: () => checkForUpdates({ manual: true }) },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar' }, { role: 'hideOthers', label: 'Ocultar outros' }, { role: 'unhide', label: 'Mostrar tudo' },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Exportar backup…', click: exportData },
        { label: 'Importar backup…', click: importData },
        { type: 'separator' },
        { label: 'Escolher pasta de dados…', click: chooseDataDir },
        { label: 'Mostrar pasta de dados no Finder', click: () => shell.showItemInFolder(dataFile()) },
        { type: 'separator' },
        { role: 'close', label: 'Fechar janela' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('state:get', () => state);
  ipcMain.handle('state:set', (_e, s) => {
    const timer = state.timer; // o timer é controlado só por aqui
    state = normalize(s);
    state.timer = timer;
    scheduleSave();
    buildTrayMenu();
    return true;
  });
  const quiet = (fn) => { muteBroadcast = true; try { fn(); } finally { muteBroadcast = false; } return state; };
  ipcMain.handle('timer:start', (_e, opts) => quiet(() => timerStart(opts)));
  ipcMain.handle('timer:pause', () => quiet(timerPause));
  ipcMain.handle('timer:update', (_e, patch) => quiet(() => timerUpdate(patch || {})));
  ipcMain.handle('app:version', () => APP_VERSION);
  ipcMain.handle('update:get', () => updateInfo);
  ipcMain.handle('update:check', () => checkForUpdates({ manual: true }));
  ipcMain.handle('update:download', () => { if (updateInfo) shell.openExternal(updateInfo.url); return !!updateInfo; });
  ipcMain.handle('theme:get', () => config.theme || 'system');
  ipcMain.handle('theme:set', (_e, theme) => {
    if (!['system', 'light', 'dark'].includes(theme)) return config.theme;
    config.theme = theme;
    nativeTheme.themeSource = theme;
    saveConfig();
    return theme;
  });
  ipcMain.handle('data:info', () => ({ file: dataFile(), custom: !!config.dataDir }));
  ipcMain.handle('data:export', exportData);
  ipcMain.handle('data:import', importData);
  ipcMain.handle('data:chooseDir', chooseDataDir);
  ipcMain.handle('data:reveal', () => shell.showItemInFolder(dataFile()));
  // Links: endereços web abrem no navegador; caminhos do Mac (ex.: Google Drive para computador) no Finder.
  ipcMain.handle('link:open', async (_e, target) => {
    const t = String(target || '').trim();
    if (/^(https?:|mailto:)/i.test(t)) { await shell.openExternal(t); return true; }
    let p = t;
    if (/^file:/i.test(p)) { try { p = decodeURIComponent(new URL(p).pathname); } catch { return false; } }
    if (p.startsWith('~/')) p = path.join(require('os').homedir(), p.slice(2));
    if (!path.isAbsolute(p) || !fs.existsSync(p)) return false;
    return (await shell.openPath(p)) === '';
  });
  ipcMain.handle('file:saveText', async (_e, { content, defaultName, ext }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, content);
    return true;
  });
  ipcMain.handle('file:savePdf', async (_e, { defaultName, landscape, footer }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: String(defaultName || 'relatorio.pdf').replace(/[/\\:]/g, '-'), filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return false;
    const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // As margens do PDF usam a cor de fundo da janela (escura no modo escuro): deixa branca durante a impressão.
    const prevBg = win.getBackgroundColor();
    win.setBackgroundColor('#ffffff');
    let pdf;
    try {
      pdf = await win.webContents.printToPDF({
        printBackground: true, pageSize: 'A4', landscape: !!landscape,
        margins: { top: 0.45, bottom: footer ? 0.6 : 0.45, left: 0.45, right: 0.45 },
        displayHeaderFooter: !!footer,
        headerTemplate: '<div></div>',
        footerTemplate: `<div style="font-size:7.5px;color:#888;width:100%;padding:0 0.45in;display:flex;justify-content:space-between;font-family:-apple-system,Helvetica,sans-serif"><span>${esc(footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      });
    } finally {
      win.setBackgroundColor(prevBg);
    }
    fs.writeFileSync(filePath, pdf);
    shell.openPath(filePath);
    return true;
  });
}

// ---------- Ciclo de vida ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    app.setName('Organizador de Projetos');
    loadConfig();
    nativeTheme.themeSource = ['light', 'dark'].includes(config.theme) ? config.theme : 'system';
    loadState();
    // Um timer que ficou "rodando" (app encerrado à força) é fechado no reinício.
    if (state.timer.running) state.timer.running = false;
    dailyBackup();
    registerIpc();
    buildAppMenu();
    createTray();
    createWindow();
    setInterval(checkExternalChange, 60 * 1000);
    // Procura versão nova 15 s depois de abrir e depois a cada 6 horas.
    setTimeout(() => checkForUpdates(), 15 * 1000);
    setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000);

    // Ao entrar em repouso, pausa o timer para não contar horas com o Mac fechado.
    powerMonitor.on('suspend', () => {
      if (state.timer.running) {
        timerPause();
        writeNow();
        if (Notification.isSupported()) {
          new Notification({ title: 'Timer pausado', body: 'O Mac entrou em repouso, então pausei o contador de horas.' }).show();
        }
      }
    });
  });

  app.on('activate', showWindow);
  app.on('before-quit', () => {
    isQuitting = true;
    if (state && state.timer.running) timerPause();
    if (state) writeNow();
  });
  app.on('window-all-closed', () => { /* continua na barra de menus */ });
}
