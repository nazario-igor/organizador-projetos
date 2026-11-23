# Organizador de Projetos

App para Mac, em português, para organizar projetos e contar horas trabalhadas. Tem janela própria e
fica também como ícone na barra de menus (perto do relógio), com o contador de horas sempre à mão.

**[Baixar a última versão](https://github.com/nazario-igor/organizador-projetos/releases/latest)** · funciona em Macs Intel e Apple Silicon

## O que ele faz

- **Painel** — o dia de hoje: horas trabalhadas, tarefas atrasadas, próximas entregas e a lista **☀ Foco de hoje**, com filtros por tag, projeto e prioridade.
- **Cronograma (Gantt)** por projeto — tarefas, entregas (marcos), **subtarefas** em grupos recolhíveis e **dependências** com setas. Arraste as barras para mudar datas; quando uma tarefa atrasa, as que dependem dela são empurradas.
- **Cronograma geral** — todos os projetos numa linha do tempo só.
- **Calendário** — o mês com tarefas, entregas e as horas registradas em cada dia.
- **Horas** — botão **Rec / Pausar** na barra superior e no ícone da barra de menus. Dá para lançar ou editar horas à mão e exportar em CSV.
- **Anotações** e **briefing** por projeto (Markdown simples nas anotações; briefing em formulário).
- **Links** em projetos e tarefas: pastas do Drive, Docs, Figma ou pastas do próprio Mac.
- **Tags**, prioridades e uma tela para administrar tags; tela de **Projetos** com status, duplicar como modelo e **arquivar**.
- **Relatórios em PDF** — por projeto ou geral, por período, com o seu **perfil** (logo, nome, contatos e cor da marca).
- Tema **claro, escuro ou automático** e **aviso de atualização** quando sai versão nova.

## Instalar

1. Baixe o arquivo `.dmg` da [última versão](https://github.com/nazario-igor/organizador-projetos/releases/latest) (em *Assets*).
2. Abra o `.dmg` e arraste o **Organizador de Projetos** para a pasta **Aplicativos**.
3. Abra o app. Como ele não tem a assinatura paga da Apple, o Mac vai avisar que não pôde verificá-lo — clique em **OK**
   (ou **Concluído**), vá em **Ajustes do Sistema → Privacidade e Segurança**, role até o aviso sobre o Organizador de
   Projetos e clique em **Abrir Mesmo Assim**. Isso só é preciso na primeira vez.

Fechar a janela não encerra o app: ele continua no ícone da barra de menus. Para sair, use **Sair** nesse menu ou ⌘Q.

Atalhos: ⌘N nova tarefa · ⌘⇧N novo projeto · ⌘. Rec/Pausar.

## Atualizar

O app procura versão nova ao abrir, a cada 6 horas e quando a internet volta. Quando encontra, avisa com uma
notificação, um destaque na barra lateral e no menu do ícone, mostrando o que mudou. Clique em **Atualizar e
reiniciar**: o app baixa a versão nova, confere o arquivo (código SHA-256 publicado pelo GitHub), fecha, se substitui
e abre de novo. Também dá para verificar pelo menu **Organizador de Projetos → Verificar atualizações…**

Se o app não puder se atualizar sozinho (por exemplo, aberto direto do `.dmg`), o aviso oferece o instalador para
baixar e substituir à mão. Versões anteriores à 1.2.0 também precisam dessa instalação manual uma última vez.

Seus dados ficam guardados fora do app e continuam lá depois da atualização.

## Seus dados

Os dados ficam em arquivos JSON na pasta de dados (veja **Dados e backup** na barra lateral), e o app guarda
sozinho uma cópia por dia na subpasta `backups`. Por lá também dá para exportar e importar backups.

**Bases de dados:** dá para ter mais de uma base (por exemplo, uma de testes e outra de trabalho), cada uma com
projetos, horas, tags e perfil próprios. Troque pelo seletor no topo da barra lateral ou pelo ícone na barra de menus.
A primeira base é o arquivo `organizador-dados.json`; as outras ficam em `organizador-dados-<id>.json`, e a lista com
os nomes em `organizador-bases.json`.

**Usar em dois Macs:** em **Dados e backup → Escolher pasta de dados**, escolha uma pasta sincronizada (iCloud Drive,
Dropbox, Google Drive) nos dois Macs. Todas as bases vão junto. Evite usar o app nos dois ao mesmo tempo.

Quando o Mac entra em repouso, o timer pausa sozinho para não contar horas com o computador fechado.

## Rodar a partir do código

Precisa do [Node.js](https://nodejs.org) (versão LTS).

```
git clone https://github.com/nazario-igor/organizador-projetos.git
cd organizador-projetos
npm install
npm start
```

A interface não usa frameworks: é HTML, CSS e JavaScript puros.

- `main.js` — processo principal: janela, ícone da barra de menus, timer, arquivo de dados, PDFs e atualizações
- `preload.js` — ponte segura entre a interface e o sistema
- `src/` — interface: `app.js` (telas), `gantt.js`, `calendar.js`, `tasks.js` (subtarefas e dependências), `util.js`, `styles.css`
- `scripts/` — utilitários (abaixo)

Comandos úteis:

- `npx electron scripts/smoke.js` — teste visual: abre o app com dados de exemplo numa pasta separada, passa pelas telas e salva prints
- `node scripts/demo-data.js` — coloca projetos fictícios no app (feche o app antes); `--remover` tira só eles
- `node scripts/demo-data.js --perfil` — preenche o perfil com uma empresa fictícia; `--remover-perfil` limpa
- `npm run icons` — recria os ícones a partir de `assets/*.svg`
- `npm run dist` — gera o instalador `.dmg` em `dist/`

Os dados de demonstração têm ids começando com `demo-`, não mexem nos seus projetos, e o script faz uma cópia do
arquivo de dados antes de alterar. O atalho `Abrir Organizador.command` abre o app a partir do código com dois cliques.

### Publicar uma versão nova

Precisa do [GitHub CLI](https://cli.github.com) (`gh`) logado numa conta com acesso ao repositório definido em
`package.json → updates.repo`.

1. Aumente a versão: `npm version patch --no-git-tag-version` (ou `minor` para novidades maiores)
2. Escreva o que mudou em `NOVIDADES.md`, numa seção `## x.y.z` — esse texto aparece no aviso de atualização
3. Salve e envie o código: `git add -A && git commit -m "Versão x.y.z" && git push`
4. Rode `npm run release` — confere se o código está enviado, gera o `.dmg` (Intel + Apple Silicon) e publica a
   versão no GitHub, marcada no commit enviado

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
e mantendo os avisos de direitos autorais e de licença.
