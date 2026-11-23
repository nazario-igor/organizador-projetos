# Organizador de Projetos

App para Mac com janela própria e ícone na barra de menus:

- **Cronograma (Gantt)** — tarefas com início/fim e entregas (marcos). Arraste as barras para mudar as datas e puxe as bordas para mudar a duração. Zoom por dias, semanas ou meses.
- **Calendário** — mês com todas as tarefas e entregas de todos os projetos (ou filtrado por projeto) e as horas registradas em cada dia.
- **Anotações** — por projeto, com busca, fixar no topo e Markdown simples (`# título`, `- lista`, `- [ ] checklist`, `**negrito**`).
- **Briefing** — formulário estruturado por projeto, exporta em PDF ou copia como texto.
- **Horas** — botão **Rec / Pausar** na barra superior e no ícone da barra de menus. Cada trecho gravado vira um registro. Dá para lançar ou editar horas à mão e exportar em CSV.

## Como abrir (por enquanto)

Dê dois cliques em **Abrir Organizador.command**, ou no Terminal:

```
npm start
```

Fechar a janela não encerra o app: ele continua no ícone da barra de menus (lá em cima, perto do relógio). Para sair, use **Sair** nesse menu ou ⌘Q.

Atalhos: ⌘N nova tarefa · ⌘⇧N novo projeto · ⌘. Rec/Pausar.

## Dados

Tudo fica em um arquivo `organizador-dados.json` (veja **Dados e backup** na barra lateral). O app guarda uma cópia por dia na subpasta `backups`. Quando o Mac entra em repouso, o timer pausa sozinho.

Para usar em dois Macs, escolha uma pasta do iCloud Drive como pasta de dados nos dois.

## Instalar e atualizar

As versões ficam em https://github.com/nazario-igor/organizador-projetos/releases

**Instalar:** baixe o `.dmg` da última versão, abra e arraste o app para **Aplicativos**.
Na primeira vez, clique com o botão direito no app → **Abrir** (o app não tem assinatura paga da Apple).

**Atualizar:** o app avisa sozinho quando há versão nova (notificação, aviso na barra lateral e no
menu do ícone). É só baixar e substituir o app em Aplicativos — os dados ficam guardados à parte.

### Publicar uma versão nova

1. Aumente a versão: `npm version patch --no-git-tag-version` (ou `minor` para novidades maiores)
2. Escreva o que mudou em `NOVIDADES.md`, numa seção `## x.y.z`
3. Rode `npm run release` — gera o `.dmg` (Intel + Apple Silicon) e publica no GitHub

O GitHub CLI fica em `~/.local/bin/gh` (logado na conta nazario-igor).

## Desenvolvimento

- `main.js` — janela, ícone da barra de menus, timer e arquivo de dados
- `preload.js` — ponte segura entre a janela e o sistema
- `src/` — interface (`app.js`, `gantt.js`, `calendar.js`, `styles.css`)
- `npm run icons` — recria os ícones a partir de `assets/*.svg`
- `npx electron scripts/smoke.js` — teste visual com dados de exemplo (não mexe nos seus dados)

## Dados de demonstração

Para testar com projetos e tarefas fictícios (feche o app antes):

```
node scripts/demo-data.js            # adiciona
node scripts/demo-data.js --remover  # remove só os dados de demonstração
```

Os dados de demonstração têm ids começando com `demo-` e não mexem nos seus projetos. O script faz uma cópia do arquivo antes de alterar.

## Rodar a partir do código

Precisa do [Node.js](https://nodejs.org) (versão LTS).

```
git clone https://github.com/nazario-igor/organizador-projetos.git
cd organizador-projetos
npm install
npm start
```

- `npx electron scripts/smoke.js` — abre o app com dados de exemplo (numa pasta separada), navega pelas telas e salva prints
- `node scripts/demo-data.js` — coloca projetos fictícios no app instalado (com o app fechado)
- `npm run dist` — gera o instalador `.dmg` em `dist/`

O app não usa frameworks na interface: é HTML, CSS e JavaScript puros em `src/`. O processo principal
(`main.js`) cuida da janela, do ícone na barra de menus, do timer, dos arquivos e das atualizações.

## Quer continuar o projeto? Faça um fork

Este é um projeto pessoal, que evolui no meu ritmo e conforme as minhas necessidades.
Por isso **não acompanho *issues* nem *pull requests*** — não é falta de interesse, só não consigo dar a atenção que eles merecem.

Se o app te serviu e você quer mudar, corrigir ou levar ele para outro caminho, **o fork é muito bem-vindo**:
copie o repositório, adapte do seu jeito e siga com a sua versão. A licença (abaixo) garante esse direito.

Duas dicas para a sua versão não se misturar com esta:

- Em `package.json`, troque `updates.repo` pelo seu repositório — senão o seu app vai avisar sobre as minhas versões.
- Se for distribuir, troque também `build.appId` e `productName` — apps com o mesmo nome no Mac dividem a mesma pasta de dados.

## Licença

[GNU GPL v3.0 ou posterior](LICENSE). Você pode usar, estudar, modificar e distribuir este programa,
inclusive versões modificadas, desde que elas também sejam distribuídas sob a GPL, com o código-fonte aberto
e mantendo os créditos.

