#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${1:-}"
FAILED_SHA="${2:-}"
RUNTIME="${3:-}"

fail() {
  echo "[rollback] $*" >&2
  exit 1
}

[[ "$APP_DIR" == /* && "$APP_DIR" != "/" ]] || fail "APP_DIR must be an absolute non-root path"
[[ "$FAILED_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "FAILED_SHA must be a full commit SHA"
[[ -d "$APP_DIR/.git" ]] || fail "APP_DIR is not a Git repository"
[[ "$RUNTIME" == "pm2" || "$RUNTIME" == "passenger" ]] || fail "RUNTIME must be pm2 or passenger"
command -v flock >/dev/null 2>&1 || fail "flock is required to serialize production deployments"

APP_DIR="$(cd "$APP_DIR" && pwd -P)"
cd "$APP_DIR"
exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || fail "another deployment is already running"

CURRENT_SHA="$(git rev-parse HEAD)"
ROLLBACK_FILE="$APP_DIR/.deployments/${FAILED_SHA}.previous"
if [[ "$CURRENT_SHA" != "$FAILED_SHA" || ! -f "$ROLLBACK_FILE" ]]; then
  echo "[rollback] $FAILED_SHA was not activated; keeping $CURRENT_SHA"
  echo "ROLLBACK_SHA=$CURRENT_SHA"
  exit 0
fi

PREVIOUS_SHA="$(tr -d '\r\n' < "$ROLLBACK_FILE")"
[[ "$PREVIOUS_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "invalid previous revision"
[[ "$(git cat-file -t "$PREVIOUS_SHA")" == "commit" ]] || fail "previous SHA is not a commit"

[[ -f .env.store2 ]] || fail ".env.store2 is required by the two-store launcher"
DEPLOY_REVISION="$FAILED_SHA" ENV_FILE=.env node scripts/backup-production.js \
  || echo "[rollback] warning: could not create an additional store 1 backup" >&2
DEPLOY_REVISION="$FAILED_SHA" ENV_FILE=.env.store2 node scripts/backup-production.js \
  || echo "[rollback] warning: could not create an additional store 2 backup" >&2

echo "[rollback] Restoring $PREVIOUS_SHA"
git reset --hard "$PREVIOUS_SHA"
npm ci --omit=dev --no-audit --no-fund
ENV_FILE=.env node src/deploy-commands.js
ENV_FILE=.env.store2 node src/deploy-commands.js
printf '%s\n' "$PREVIOUS_SHA" > REVISION

if [[ "$RUNTIME" == "pm2" ]]; then
  command -v pm2 >/dev/null 2>&1 || fail "PM2 is required by BOT_RUNTIME=pm2"
  pm2 describe cenar-store-launcher >/dev/null 2>&1 \
    || fail "PM2 process cenar-store-launcher does not exist for the deploy user"
  DEPLOY_REVISION="$PREVIOUS_SHA" pm2 reload ecosystem.config.cjs \
    --only cenar-store-launcher --update-env
else
  mkdir -p tmp
  printf '%s\n' "$PREVIOUS_SHA" > tmp/restart.txt
fi

rm -f -- "$ROLLBACK_FILE"
echo "[rollback] Restored $PREVIOUS_SHA"
echo "ROLLBACK_SHA=$PREVIOUS_SHA"
