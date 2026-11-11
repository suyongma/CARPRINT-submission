#!/bin/sh
# 소스만 전달받은 개발자를 위한 로컬 서버/DB 초기화. 기존 DB를 삭제하지 않는다.
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root/backend"
command -v node >/dev/null
command -v npm >/dev/null
command -v docker >/dev/null
npm ci
node scripts/bootstrap-local.mjs
docker compose --env-file .env up -d --wait
npm run migrate
npm run seed
npm run demo:contexts
npm run seed:experience
printf '%s\n' 'Local CARPRINT ready. Start the API with: cd backend && npm run dev'
