#!/bin/bash
# Keeps the production checkout on the latest origin/main. Run by launchd every few minutes.
# Defers while players are connected, builds before restarting, and rolls back if the new build does not answer.
# Limit: no test run on the host; pushes to main go live. Add `pnpm test` here if that becomes too risky.
main() {
  set -u
  export PATH=/opt/homebrew/bin:/usr/bin:/bin
  local dir port label cur new
  dir="${EB_PROD_DIR:-$HOME/Projects/battlegrounds_game/.worktrees/prod}"
  port="${EB_PORT:-2567}"
  label="gui/$(id -u)/com.elementalbattlegrounds.server"
  log() { echo "$(date '+%F %T') $*"; }
  cd "$dir" || exit 1
  git fetch -q origin main || { log "fetch failed"; exit 0; }
  cur=$(git rev-parse HEAD); new=$(git rev-parse origin/main)
  [ "$cur" = "$new" ] && exit 0
  if lsof -nP -iTCP:"$port" -sTCP:ESTABLISHED >/dev/null 2>&1; then log "players connected, deferring $new"; exit 0; fi
  log "updating $cur -> $new"
  git checkout -q --detach "$new" || { log "checkout failed"; exit 1; }
  if ! { pnpm install --frozen-lockfile --offline >/dev/null 2>&1 && pnpm build >/dev/null 2>&1; }; then
    log "build failed, staying on $cur"; git checkout -q --detach "$cur"; pnpm build >/dev/null 2>&1; exit 1
  fi
  launchctl kickstart -k "$label"
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    sleep 5
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "127.0.0.1:$port/")" = 200 ]; then log "live on $new"; exit 0; fi
  done
  log "new build did not answer, rolling back to $cur"
  git checkout -q --detach "$cur"; pnpm build >/dev/null 2>&1; launchctl kickstart -k "$label"
  exit 1
}
main "$@"; exit $?
