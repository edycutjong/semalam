#!/bin/bash
# Determinism across runtimes: replays the three golden rounds with the bundled CLI on every Node binary and Docker
# platform available here, and writes evidence/determinism-matrix.json. Windows is covered by CI only (ci.yml matrix).
# usage: bash scripts/sim/platform-matrix.sh   (from build/; needs packages/cli/dist/semalam.mjs)
set -u
cd "$(dirname "$0")/../.."
CLI=packages/cli/dist/semalam.mjs
[ -f "$CLI" ] || (cd packages/cli && node build.mjs)
rows=()
row() { # $1 = label, rest = command
  local label=$1; shift
  local out; out=$("$@" replay --fixture golden 2>&1); local code=$?
  local hashes; hashes=$(printf '%s\n' "$out" | grep -oE 'resultHash  0x[0-9a-f]{64}' | awk '{print $2}' | paste -sd, -)
  local n; n=$(printf '%s\n' "$out" | grep -c '✓ MATCH')
  rows+=("{\"runtime\":\"$label\",\"exit\":$code,\"match\":$n,\"hashes\":\"$hashes\"}")
  echo "$label exit=$code match=$n/3"
}
for b in ~/.nvm/versions/node/v2[0-9]*/bin/node; do
  [ -x "$b" ] && row "$(uname -s)-$(uname -m) node $("$b" --version)" "$b" "$CLI"
done
if docker info >/dev/null 2>&1; then
  for img in node:20-slim node:22-slim; do for plat in linux/arm64 linux/amd64; do
    row "$plat $img" docker run --rm --platform "$plat" -v "$PWD":/w:ro -w /w "$img" node "$CLI"
  done; done
fi
expect=$(node -e 'const fs=require("fs");console.log(["round-a","round-b","round-c"].map(n=>JSON.parse(fs.readFileSync(`fixtures/golden/${n}.json`,"utf8")).expect.resultHash).join(","))')
printf '{"at":"%s","what":"semalam replay --fixture golden (3 golden rounds: real quicknet beacons + real tlock blobs) on each runtime","expect":"%s","rows":[%s]}\n' \
  "$(date -u +%FT%TZ)" "$expect" "$(IFS=,; echo "${rows[*]}")" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);j.allMatch=j.rows.every(r=>r.exit===0&&r.match===3&&r.hashes===j.expect);console.log(JSON.stringify(j,null,2))})' > evidence/determinism-matrix.json
grep -E '"allMatch"' evidence/determinism-matrix.json
