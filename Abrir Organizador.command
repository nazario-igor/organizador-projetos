#!/bin/zsh
# Abre o Organizador de Projetos em modo de desenvolvimento (duplo clique no Finder).
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$PATH"
nohup npx electron . >/dev/null 2>&1 &
sleep 2
osascript -e 'tell application "Terminal" to close (every window whose name contains "Abrir Organizador")' >/dev/null 2>&1 &
exit 0
