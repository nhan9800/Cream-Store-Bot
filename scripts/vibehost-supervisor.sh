#!/usr/bin/env bash

set -uo pipefail

APP_ROOT="${VIBEHOST_APP_ROOT:-/home/container}"
GIT_REMOTE="${VIBEHOST_GIT_REMOTE:-origin}"
GIT_BRANCH="${VIBEHOST_GIT_BRANCH:-bot-production}"
POLL_SECONDS="${VIBEHOST_UPDATE_INTERVAL_SECONDS:-60}"
RESTART_DELAY_SECONDS="${VIBEHOST_RESTART_DELAY_SECONDS:-5}"
STATE_DIR="${APP_ROOT}/.vibehost"
INSTALLED_REVISION_FILE="${STATE_DIR}/installed-revision"
FAILED_REVISION_FILE="${STATE_DIR}/failed-revision"
REVISION_FILE="${APP_ROOT}/REVISION"
BOT_PID=""
TARGET_SHA=""
STOPPING=false

export NODE_ENV="${NODE_ENV:-production}"
export GIT_TERMINAL_PROMPT=0

log() {
  printf '[vibehost-supervisor] %s\n' "$*"
}

fail() {
  log "ERROR: $*"
  return 1
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

read_marker() {
  local marker_file="$1"
  if [[ -f "$marker_file" ]]; then
    tr -d '[:space:]' < "$marker_file"
  fi
}

write_marker() {
  local marker_file="$1"
  local value="$2"
  printf '%s\n' "$value" > "$marker_file"
}

backup_databases() {
  local revision="$1"

  if [[ ! -f scripts/backup-production.js ]]; then
    fail "scripts/backup-production.js is missing; refusing to update"
    return 1
  fi

  log "Creating verified Store 1 backup before source update"
  if ! ENV_FILE=.env DEPLOY_REVISION="$revision" node scripts/backup-production.js; then
    fail "Store 1 backup failed; keeping the current source"
    return 1
  fi

  if [[ ! -f .env.store2 ]]; then
    fail ".env.store2 is missing; refusing to update a two-store production server"
    return 1
  fi

  log "Creating verified Store 2 backup before source update"
  if ! ENV_FILE=.env.store2 DEPLOY_REVISION="$revision" node scripts/backup-production.js; then
    fail "Store 2 backup failed; keeping the current source"
    return 1
  fi
}

validate_environment() {
  log "Validating Store 1 environment"
  ENV_FILE=.env npm run check:env || return 1

  log "Validating Store 2 environment"
  ENV_FILE=.env.store2 npm run check:env || return 1
}

install_dependencies() {
  npm ci --omit=dev --no-audit --no-fund
}

rollback_source() {
  local previous_sha="$1"

  log "Rolling source back to ${previous_sha}"
  git reset --hard "$previous_sha" || return 1
  install_dependencies || return 1
  write_marker "$INSTALLED_REVISION_FILE" "$previous_sha"
  write_marker "$REVISION_FILE" "$previous_sha"
}

install_revision() {
  local target_sha="$1"
  local current_sha
  local installed_sha
  local failed_sha

  current_sha="$(git rev-parse HEAD 2>/dev/null)" || return 1
  installed_sha="$(read_marker "$INSTALLED_REVISION_FILE")"
  failed_sha="$(read_marker "$FAILED_REVISION_FILE")"

  if [[ "$target_sha" == "$failed_sha" ]]; then
    log "Revision ${target_sha} previously failed installation; waiting for a newer revision"
    return 0
  fi

  if [[ "$target_sha" == "$current_sha" && "$installed_sha" == "$target_sha" ]]; then
    return 0
  fi

  # The panel may pull the target revision before the supervisor starts. In that
  # first-run case the source is already at target, but the database still needs
  # a verified backup before dependencies and runtime validation can proceed.
  # Do not install here: package.json still belongs to current_sha when target_sha
  # is newer. Installing before git reset leaves new runtime packages missing.
  if [[ "$target_sha" != "$current_sha" || -z "$installed_sha" ]]; then
    if ! backup_databases "$current_sha"; then
      write_marker "$FAILED_REVISION_FILE" "$target_sha"
      return 1
    fi
  fi

  log "Installing verified revision ${target_sha}"
  local install_failed=false
  if ! git reset --hard "$target_sha"; then
    install_failed=true
  elif ! install_dependencies; then
    install_failed=true
  elif ! validate_environment; then
    install_failed=true
  fi

  if [[ "$install_failed" == true ]]; then
    log "Revision ${target_sha} failed installation"

    if [[ "$target_sha" != "$current_sha" ]]; then
      write_marker "$FAILED_REVISION_FILE" "$target_sha"
      rollback_source "$current_sha" \
        || fail "Automatic rollback to ${current_sha} failed; manual recovery is required"
    fi
    return 1
  fi

  write_marker "$INSTALLED_REVISION_FILE" "$target_sha"
  write_marker "$REVISION_FILE" "$target_sha"
  rm -f "$FAILED_REVISION_FILE"
  log "Revision ${target_sha} is ready"
}

refresh_target() {
  if ! git fetch --quiet --prune "$GIT_REMOTE" "$GIT_BRANCH"; then
    log "Cannot reach ${GIT_REMOTE}/${GIT_BRANCH}; keeping the current bot online"
    return 1
  fi

  TARGET_SHA="$(git rev-parse "${GIT_REMOTE}/${GIT_BRANCH}" 2>/dev/null)" || {
    fail "Cannot resolve ${GIT_REMOTE}/${GIT_BRANCH}"
    return 1
  }
}

stop_bot() {
  if [[ -n "$BOT_PID" ]] && kill -0 "$BOT_PID" 2>/dev/null; then
    log "Stopping bot process ${BOT_PID}"
    kill -TERM "$BOT_PID" 2>/dev/null || true
    wait "$BOT_PID" 2>/dev/null || true
  fi
  BOT_PID=""
}

shutdown_supervisor() {
  STOPPING=true
  log "Shutdown requested"
  stop_bot
  exit 0
}

trap shutdown_supervisor SIGINT SIGTERM

if ! is_positive_integer "$POLL_SECONDS"; then
  fail "VIBEHOST_UPDATE_INTERVAL_SECONDS must be a positive integer"
  exit 1
fi

if ! is_positive_integer "$RESTART_DELAY_SECONDS"; then
  fail "VIBEHOST_RESTART_DELAY_SECONDS must be a positive integer"
  exit 1
fi

if [[ "$APP_ROOT" != /* || "$APP_ROOT" == "/" ]]; then
  fail "VIBEHOST_APP_ROOT must be an absolute application directory and cannot be /"
  exit 1
fi

mkdir -p "$STATE_DIR"
cd "$APP_ROOT" || exit 1

git config --global --add safe.directory "$APP_ROOT" >/dev/null 2>&1 || true

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "${APP_ROOT} is not a Git clone. Bootstrap it from the bot repository first"
  exit 1
fi

if ! git remote get-url "$GIT_REMOTE" >/dev/null 2>&1; then
  fail "Git remote ${GIT_REMOTE} is missing"
  exit 1
fi

if [[ -f "$FAILED_REVISION_FILE" ]]; then
  log "Clearing the previous failure marker for one supervised retry"
  rm -f "$FAILED_REVISION_FILE"
fi

log "Watching ${GIT_REMOTE}/${GIT_BRANCH} every ${POLL_SECONDS}s"

while [[ "$STOPPING" == false ]]; do
  if refresh_target; then
    install_revision "$TARGET_SHA" || true
  fi

  CURRENT_READY_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
  INSTALLED_READY_SHA="$(read_marker "$INSTALLED_REVISION_FILE")"
  if [[ -z "$CURRENT_READY_SHA" || "$CURRENT_READY_SHA" != "$INSTALLED_READY_SHA" ]]; then
    log "No validated revision is ready; retrying in ${POLL_SECONDS}s"
    sleep "$POLL_SECONDS" &
    WAIT_PID=$!
    wait "$WAIT_PID" 2>/dev/null || true
    continue
  fi

  log "Starting bot from revision ${CURRENT_READY_SHA}"
  node src/index.js &
  BOT_PID=$!
  UPDATE_REQUESTED=false

  while kill -0 "$BOT_PID" 2>/dev/null; do
    sleep "$POLL_SECONDS" &
    WAIT_PID=$!
    wait "$WAIT_PID" 2>/dev/null || true

    if [[ "$STOPPING" == true ]]; then
      break
    fi

    if refresh_target; then
      CURRENT_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
      FAILED_SHA="$(read_marker "$FAILED_REVISION_FILE")"
      if [[ "$TARGET_SHA" != "$CURRENT_SHA" && "$TARGET_SHA" != "$FAILED_SHA" ]]; then
        log "New verified revision detected: ${TARGET_SHA}"
        UPDATE_REQUESTED=true
        stop_bot
        break
      fi
    fi
  done

  if [[ "$STOPPING" == true ]]; then
    break
  fi

  if [[ "$UPDATE_REQUESTED" == false && -n "$BOT_PID" ]]; then
    wait "$BOT_PID" 2>/dev/null || true
    BOT_PID=""
    log "Bot exited; restarting after ${RESTART_DELAY_SECONDS}s"
  fi

  sleep "$RESTART_DELAY_SECONDS" &
  WAIT_PID=$!
  wait "$WAIT_PID" 2>/dev/null || true
done

stop_bot
