#!/bin/sh
set -eu
umask 077

KOREAI_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$KOREAI_SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 22.17 이상을 설치한 뒤 다시 실행하세요.' >&2
  exit 1
fi

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 17)) { console.error("Node.js 22.17 이상이 필요합니다."); process.exit(1); }'

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'npm을 설치한 뒤 다시 실행하세요.' >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  printf '%s\n' '의존성이 없습니다. 프로젝트 폴더에서 npm ci를 먼저 실행하세요.' >&2
  exit 1
fi

if [ ! -f dist/server.js ] || [ ! -f web-dist/index.html ]; then
  printf '%s\n' '빌드가 없습니다. 프로젝트 폴더에서 npm run build를 먼저 실행하세요.' >&2
  exit 1
fi

exec node dist/server.js "$@"
