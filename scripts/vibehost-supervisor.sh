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
SUPERVISOR_EXCLUSIVE=false

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

process_is_running() {
  local pid="$1"
  local state=""

  kill -0 "$pid" 2>/dev/null || return 1
  if [[ -r "/proc/${pid}/stat" ]]; then
    state="$(awk '{ print $3 }' "/proc/${pid}/stat" 2>/dev/null || true)"
    [[ "$state" == "Z" || "$state" == "X" ]] && return 1
  fi
  return 0
}

reclaim_orphaned_launcher() {
  local lock_file="${STATE_DIR}/launcher.lock"
  local launcher_pid=""
  local launcher_command=""
  local attempt=0

  [[ "$SUPERVISOR_EXCLUSIVE" == true && -f "$lock_file" ]] || return 0

  launcher_pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$lock_file" | head -n 1)"
  if [[ ! "$launcher_pid" =~ ^[1-9][0-9]*$ ]]; then
    log "Removing malformed launcher lock left by an earlier run"
    rm -f "$lock_file"
    return 0
  fi

  if ! process_is_running "$launcher_pid"; then
    log "Removing stale launcher lock for inactive PID ${launcher_pid}"
    rm -f "$lock_file"
    return 0
  fi

  if [[ -r "/proc/${launcher_pid}/cmdline" ]]; then
    launcher_command="$(tr '\000' ' ' < "/proc/${launcher_pid}/cmdline" 2>/dev/null || true)"
  fi
  if [[ "$launcher_command" != *node*src/index.js* ]]; then
    fail "Launcher lock points to active PID ${launcher_pid}, but its command is not the Cenar launcher; refusing to signal it"
    return 1
  fi

  # Holding supervisor.lock proves that no managed supervisor owns this Node
  # launcher anymore. Stop the orphan before starting a replacement so the
  # public/internal ports and Discord sessions cannot overlap.
  log "Stopping orphaned Cenar launcher PID ${launcher_pid}"
  kill -TERM "$launcher_pid" 2>/dev/null || true
  for attempt in {1..32}; do
    process_is_running "$launcher_pid" || break
    sleep 0.25
  done

  if process_is_running "$launcher_pid"; then
    log "Orphaned launcher PID ${launcher_pid} ignored SIGTERM; sending SIGKILL"
    kill -KILL "$launcher_pid" 2>/dev/null || true
    for attempt in {1..8}; do
      process_is_running "$launcher_pid" || break
      sleep 0.25
    done
  fi

  if process_is_running "$launcher_pid"; then
    fail "Orphaned launcher PID ${launcher_pid} is still active; refusing duplicate startup"
    return 1
  fi

  rm -f "$lock_file"
  log "Orphaned launcher cleanup completed"
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

# VibeHost can overlap startup commands during a panel restart. Keep a
# supervisor-level advisory lock where util-linux flock is available; the Node
# launcher also owns an atomic PID lock as a portable second layer.
if command -v flock >/dev/null 2>&1; then
  SUPERVISOR_LOCK_FILE="${STATE_DIR}/supervisor.lock"
  exec 9>"$SUPERVISOR_LOCK_FILE"
  if ! flock -n 9; then
    log "Another VibeHost supervisor is already active; duplicate startup stopped"
    exit 0
  fi
  SUPERVISOR_EXCLUSIVE=true
fi

cd "$APP_ROOT" || exit 1

if ! reclaim_orphaned_launcher; then
  exit 1
fi

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
    BOT_EXIT_CODE=0
    wait "$BOT_PID" 2>/dev/null || BOT_EXIT_CODE=$?
    BOT_PID=""
    if [[ "$BOT_EXIT_CODE" -eq 75 ]]; then
      log "Launcher lock is owned by another active supervisor; stopping this duplicate supervisor"
      exit 0
    fi
    log "Bot exited; restarting after ${RESTART_DELAY_SECONDS}s"
  fi

  sleep "$RESTART_DELAY_SECONDS" &
  WAIT_PID=$!
  wait "$WAIT_PID" 2>/dev/null || true
done

stop_bot
