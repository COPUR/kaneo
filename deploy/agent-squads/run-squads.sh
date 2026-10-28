#!/usr/bin/env bash
# Runs the tribe on its own: one headless Claude Code agent per squad and the
# CI/CD agent, each in the background with its own log.
#
#   ./run-squads.sh [start] [NAV CON ...]   start all squads, or only these
#   ./run-squads.sh stop                    stop every agent now
#   ./run-squads.sh status                  who is running
#   ./run-squads.sh logs [CON|CICD]         follow the logs
#
# Caps (in .env or the environment): SQUAD_MAX_CARDS, SQUAD_RUN_BUDGET_USD,
# SQUAD_TOTAL_BUDGET_USD, SQUAD_RUN_TIMEOUT_MIN, CICD_MAX_MERGES.
set -euo pipefail

cd "$(dirname "$0")"
run_dir=.runner
all_squads=(NAV CON ROA TEL PLT INV PAY SEC)

pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

start_one() {
  local name="$1" script="$2"
  shift 2
  if pid_alive "$run_dir/$name.pid"; then
    echo "$name already running (pid $(cat "$run_dir/$name.pid"))"
    return
  fi
  nohup node "$script" "$@" >>"$run_dir/logs/$name.log" 2>&1 &
  echo $! >"$run_dir/$name.pid"
  echo "$name started (pid $!, log $run_dir/logs/$name.log)"
}

preflight() {
  for tool in node git gh claude; do
    command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }
  done
  gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login" >&2; exit 1; }
  [ -f .generated/agents.json ] || { echo "Run ./setup.sh first" >&2; exit 1; }
  node --input-type=module -e '
    import { loadEnv, waitForApi } from "./lib.mjs";
    loadEnv(".env");
    await waitForApi({ timeoutMs: 20000 });
  ' || { echo "Kaneo is not answering; start it with docker compose up -d" >&2; exit 1; }
}

cmd="${1:-start}"
case "$cmd" in
  start | NAV | CON | ROA | TEL | PLT | INV | PAY | SEC)
    [ "$cmd" = start ] && shift || true
    preflight
    mkdir -p "$run_dir/logs"
    rm -f "$run_dir/STOP"
    # bash 3.2 (macOS) treats an empty array as unset under set -u.
    if [ $# -eq 0 ]; then squads=("${all_squads[@]}"); else squads=("$@"); fi
    start_one CICD runner/cicd.mjs
    for squad in "${squads[@]}"; do
      start_one "$squad" runner/squad.mjs "$squad"
    done
    echo
    echo "Follow:  ./run-squads.sh logs"
    echo "Stop:    ./run-squads.sh stop"
    ;;
  stop)
    mkdir -p "$run_dir"
    touch "$run_dir/STOP"
    for pid_file in "$run_dir"/*.pid; do
      [ -e "$pid_file" ] || continue
      name="$(basename "$pid_file" .pid)"
      if pid_alive "$pid_file"; then
        kill "$(cat "$pid_file")" && echo "$name stopped"
      fi
      rm -f "$pid_file"
    done
    ;;
  status)
    for pid_file in "$run_dir"/*.pid; do
      [ -e "$pid_file" ] || { echo "nothing running"; break; }
      name="$(basename "$pid_file" .pid)"
      if pid_alive "$pid_file"; then
        echo "$name running   $(tail -n 1 "$run_dir/logs/$name.log" 2>/dev/null)"
      else
        echo "$name stopped   $(tail -n 1 "$run_dir/logs/$name.log" 2>/dev/null)"
      fi
    done
    ;;
  logs)
    if [ -n "${2:-}" ]; then
      tail -n 50 -f "$run_dir/logs/$2.log"
    else
      tail -n 5 -f "$run_dir"/logs/*.log
    fi
    ;;
  *)
    sed -n '2,11p' "$0"
    exit 2
    ;;
esac
