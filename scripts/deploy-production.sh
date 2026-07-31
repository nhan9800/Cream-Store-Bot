#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_SHA="${1:-}"
APP_DIR="${2:-}"
RUNTIME="${3:-}"

fail() {
  echo "[deploy] $*" >&2
  exit 1
}

[[ "$TARGET_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "TARGET_SHA must be a full 40-character commit SHA"
[[ "$APP_DIR" == /* && "$APP_DIR" != "/" ]] || fail "APP_DIR must be an absolute non-root path"
[[ -d "$APP_DIR/.git" && -f "$APP_DIR/package-lock.json" ]] || fail "APP_DIR is not the Cenar bot repository"
[[ "$RUNTIME" == "pm2" || "$RUNTIME" == "passenger" ]] || fail "RUNTIME must be pm2 or passenger"
command -v flock >/dev/null 2>&1 || fail "flock is required to serialize production deployments"

APP_DIR="$(cd "$APP_DIR" && pwd -P)"
cd "$APP_DIR"

exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || fail "another deployment is already running"

PREVIOUS_SHA="$(git rev-parse HEAD)"
[[ "$PREVIOUS_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "current revision is invalid"
mkdir -p "$APP_DIR/.deployments"
ROLLBACK_FILE="$APP_DIR/.deployments/${TARGET_SHA}.previous"
printf '%s\n' "$PREVIOUS_SHA" > "$ROLLBACK_FILE"

echo "[deploy] Fetching target commit $TARGET_SHA"
git fetch --prune origin main
[[ "$(git cat-file -t "$TARGET_SHA")" == "commit" ]] || fail "target SHA is not a commit"
git merge-base --is-ancestor "$TARGET_SHA" origin/main \
  || fail "target commit is not reachable from origin/main"

git reset --hard "$TARGET_SHA"
npm ci --omit=dev --no-audit --no-fund
[[ -f .env.store2 ]] || fail ".env.store2 is required by the two-store launcher"
ENV_FILE=.env node scripts/check-env.js
ENV_FILE=.env.store2 node scripts/check-env.js
DEPLOY_REVISION="$TARGET_SHA" ENV_FILE=.env node scripts/backup-production.js
DEPLOY_REVISION="$TARGET_SHA" ENV_FILE=.env.store2 node scripts/backup-production.js
ENV_FILE=.env node src/deploy-commands.js
ENV_FILE=.env.store2 node src/deploy-commands.js
printf '%s\n' "$TARGET_SHA" > REVISION

if [[ "$RUNTIME" == "pm2" ]]; then
  command -v pm2 >/dev/null 2>&1 || fail "PM2 is required by BOT_RUNTIME=pm2"
  pm2 describe cenar-store-launcher >/dev/null 2>&1 \
    || fail "PM2 process cenar-store-launcher does not exist for the deploy user"
  echo "[deploy] Reloading PM2 process cenar-store-launcher"
  DEPLOY_REVISION="$TARGET_SHA" pm2 reload ecosystem.config.cjs \
    --only cenar-store-launcher --update-env
else
  echo "[deploy] Triggering Passenger-compatible restart"
  mkdir -p tmp
  printf '%s\n' "$TARGET_SHA" > tmp/restart.txt
fi

echo "[deploy] Activated $TARGET_SHA (previous: $PREVIOUS_SHA)"
