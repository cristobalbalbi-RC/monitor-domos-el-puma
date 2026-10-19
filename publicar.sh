#!/usr/bin/env bash
# Crea el repositorio en GitHub, activa GitHub Pages y ejecuta la primera revisión.
# Requiere GitHub CLI (https://cli.github.com) con sesión iniciada: gh auth login
set -euo pipefail
REPO="cristobalbalbi-RC/monitor-domos-el-puma"
cd "$(dirname "$0")"

command -v gh >/dev/null || { echo "Falta GitHub CLI. Instálalo con: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || gh auth login

if [ ! -d .git ]; then
  git init -q -b main
  git add -A
  git commit -q -m "Monitor diario de los domos del Sendero El Puma"
fi

echo "1/3 Creando el repositorio ${REPO}..."
gh repo create "${REPO}" --public --source=. --remote=origin \
  --description "Revisión diaria del clima en los domos del Sendero El Puma (Yerba Loca)" --push

echo "2/3 Activando GitHub Pages..."
gh api -X POST "repos/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PUT "repos/${REPO}/pages" -f build_type=workflow >/dev/null

echo "3/3 Ejecutando la primera revisión..."
sleep 5
gh workflow run revision.yml -R "${REPO}"
sleep 8
gh run watch -R "${REPO}" "$(gh run list -R "${REPO}" -w revision.yml -L 1 --json databaseId -q '.[0].databaseId')" || true

echo
echo "Listo. Panel: https://cristobalbalbi-rc.github.io/monitor-domos-el-puma/"
echo "Para recibir los avisos por correo: abre https://github.com/${REPO} y presiona Watch → All activity."
