#!/usr/bin/env bash
# Update the Avarpus API on the VPS: pull, install, build, (optionally) push
# the DB schema, restart. Run as the `avarpus` user:
#   ~/avarpus/deploy/vps/deploy.sh            # code update only
#   ~/avarpus/deploy/vps/deploy.sh --schema   # also apply DB schema changes
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/avarpus}"
ENV_FILE="${ENV_FILE:-/etc/avarpus/api.env}"
SERVICE="${SERVICE:-avarpus-api}"
BRANCH="${BRANCH:-main}"
APPLY_SCHEMA=0
for arg in "$@"; do
  case "$arg" in
    --schema) APPLY_SCHEMA=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$REPO_DIR"
echo "==> git pull ($BRANCH)"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"
echo "    at $(git rev-parse --short HEAD)"

echo "==> pnpm install"
pnpm install --frozen-lockfile

echo "==> build shared libraries"
pnpm run typecheck:libs

echo "==> build api-server"
pnpm --filter @workspace/api-server run build

if [ "$APPLY_SCHEMA" = "1" ]; then
  echo "==> apply DB schema"
  # drizzle-kit needs DATABASE_URL; read only that key from the env file.
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
  export DATABASE_URL
  pnpm --filter @workspace/db run push-force
fi

echo "==> restart $SERVICE"
sudo systemctl restart "$SERVICE"
sleep 2
sudo systemctl --no-pager --lines=0 status "$SERVICE" | head -5

echo "==> health check"
PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2- || true)"
curl -fsS "http://127.0.0.1:${PORT:-8080}/api/healthz" && echo
echo "Deploy complete."
