// Gera o instalador (.dmg) e publica a versão no GitHub Releases do repositório do projeto.
//
// Uso:
//   npm run release                 → gera o .dmg e publica a versão do package.json
//   npm run release -- --sem-build  → publica um .dmg já gerado em dist/
//   npm run release -- --so-build   → só gera o .dmg, sem publicar
//
// Antes de publicar:
//   1. Aumente a versão:   npm version patch --no-git-tag-version   (1.0.0 → 1.0.1)
//   2. Escreva as novidades em NOVIDADES.md, numa seção "## 1.0.1"
//   3. Salve e envie o código:   git add -A && git commit -m "Versão 1.0.1" && git push
// O script recusa publicar se houver mudanças não salvas ou não enviadas, e marca a versão no commit enviado.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const repo = (pkg.updates || {}).repo;
const args = process.argv.slice(2);
const fail = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };

// Novidades desta versão (seção "## x.y.z" do NOVIDADES.md).
function notesFor(v) {
  const file = path.join(root, 'NOVIDADES.md');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`^##\\s*v?${v.replace(/\./g, '\\.')}\\b[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

const notes = notesFor(version);
if (!args.includes('--so-build')) {
  if (!repo) fail('Configure o repositório de versões em package.json → "updates": { "repo": "usuario/organizador-projetos" }.');
  if (!notes) fail(`Escreva as novidades da versão ${version} em NOVIDADES.md (uma seção "## ${version}").`);
}

// O código precisa estar salvo e enviado ao GitHub: a versão publicada é marcada nesse commit.
let targetSha = null;
if (!args.includes('--so-build')) {
  const git = (a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\s+$/, '');
  try { git(['rev-parse', '--is-inside-work-tree']); } catch { fail('Esta pasta não é um repositório Git. Clone o projeto com git antes de publicar.'); }
  const dirty = git(['status', '--porcelain']);
  if (dirty) fail(`Há mudanças ainda não salvas no Git:\n${dirty}\n\nSalve e envie antes:  git add -A && git commit -m "Versão ${version}" && git push`);
  try { git(['fetch', '--quiet']); } catch { fail('Não consegui consultar o GitHub (git fetch). Confira a internet e tente de novo.'); }
  let upstream = '';
  try { upstream = git(['rev-parse', '@{u}']); } catch { fail('Este branch não está ligado a um branch no GitHub. Rode:  git push -u origin main'); }
  const head = git(['rev-parse', 'HEAD']);
  if (head !== upstream) {
    const ahead = git(['rev-list', '--count', '@{u}..HEAD']);
    fail(ahead !== '0' ? `Há ${ahead} commit(s) ainda não enviados ao GitHub. Rode:  git push` : 'O GitHub tem mudanças que não estão aqui. Rode:  git pull');
  }
  targetSha = head;
}

// GitHub CLI (em ~/.local/bin ou no PATH): login, repositório e versão repetida são conferidos antes de gerar o .dmg.
const ghLocal = path.join(os.homedir(), '.local', 'bin', 'gh');
const gh = fs.existsSync(ghLocal) ? ghLocal : 'gh';
const run = (a, opts = {}) => execFileSync(gh, a, { cwd: root, encoding: 'utf8', ...opts });
if (!args.includes('--so-build')) {
  try { run(['auth', 'status'], { stdio: 'pipe' }); } catch {
    fail('O GitHub CLI (gh) não está instalado ou não está logado. Rode no Terminal:  gh auth login');
  }
  try { run(['repo', 'view', repo, '--json', 'name'], { stdio: 'pipe' }); } catch {
    fail(`O repositório ${repo} não existe ou não está acessível com esta conta do GitHub.`);
  }
  let alreadyPublished = false;
  try { run(['release', 'view', `v${version}`, '--repo', repo], { stdio: 'pipe' }); alreadyPublished = true; } catch { /* ainda não existe: ótimo */ }
  if (alreadyPublished) fail(`A versão v${version} já foi publicada. Aumente a versão antes (npm version patch --no-git-tag-version).`);
}

const dmg = path.join(root, 'dist', `Organizador-de-Projetos-${version}.dmg`);
const zip = path.join(root, 'dist', `Organizador-de-Projetos-${version}.zip`); // atualização dentro do app
if (!args.includes('--sem-build')) {
  console.log(`\n▶ Gerando o instalador da versão ${version} (Intel + Apple Silicon)…\n`);
  const r = spawnSync('npx', ['electron-builder', '--mac', '--universal', '--publish', 'never'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) fail('A geração do instalador falhou (veja as mensagens acima).');
  // A cópia solta do app usada para montar o .dmg aparecia no Spotlight ao lado do app instalado.
  fs.rmSync(path.join(root, 'dist', 'mac-universal'), { recursive: true, force: true });
}
for (const f of [dmg, zip]) if (!fs.existsSync(f)) fail(`Não encontrei ${path.relative(root, f)}.`);
console.log(`\n✔ Instalador: ${path.relative(root, dmg)} (${(fs.statSync(dmg).size / 1048576).toFixed(0)} MB)`);
if (args.includes('--so-build')) process.exit(0);

const notesFile = path.join(os.tmpdir(), `organizador-notas-${version}.md`);
fs.writeFileSync(notesFile, notes);
console.log(`\n▶ Publicando v${version} em ${repo}…`);
run(['release', 'create', `v${version}`, dmg, zip, '--repo', repo, '--target', targetSha, '--title', `Versão ${version}`, '--notes-file', notesFile], { stdio: 'inherit' });
console.log(`\n✔ Pronto! Os apps instalados vão avisar sobre a versão ${version} em até 6 horas (ou em "Verificar atualizações…").\n`);
