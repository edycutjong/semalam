#!/usr/bin/env bash
# Local backup runner (GitHub Actions is the primary; this is the fallback while Actions billing is blocked).
# Polls every 2 minutes, settles every closed round without a post (oldest first), then commits + pushes the artifacts
# behind the same gate as every push: gitleaks + the kitchen grep. Stops at --until <unix> (default: 4 h from now).
# usage: scripts/settle/nightly.sh [--until <unix>] [--chain 46630]   (POSTER key: ~/.config/semalam/poster.env)
set -uo pipefail
cd "$(dirname "$0")/../.."
UNTIL=$(( $(date +%s) + 14400 )); CHAIN="${SEMALAM_CHAIN:-46630}"
while [ $# -gt 0 ]; do case "$1" in --until) UNTIL="$2"; shift 2;; --chain) CHAIN="$2"; shift 2;; *) shift;; esac; done
export SEMALAM_CHAIN="$CHAIN"
while [ "$(date +%s)" -lt "$UNTIL" ]; do
  (cd scripts && npx tsx settle/settle.ts) 2>&1 | sed 's/^/[settle] /'
  if [ -n "$(git status --porcelain apps/web/data/rounds)" ]; then
    git add apps/web/data/rounds
    if gitleaks git --staged --no-banner >/dev/null 2>&1 && ! git diff --cached --name-only | grep -E 'spec|progress|predict|radar|CLAUDE|AGENTS|\.claude|\.env$|pem$'; then
      git commit -q -m "settle: round artifacts" && git pull -q --rebase --autostash && git push -q && echo "[settle] artifacts pushed"
    else echo "[settle] gate failed — artifacts staged but NOT pushed"; fi
  fi
  sleep 120
done
