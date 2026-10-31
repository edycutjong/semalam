# semalam

Replay any SEMALAM night from public data and check it against the hash posted on chain.

Until the package is on npm, run it from the repo: `pnpm install && pnpm --filter semalam build`, then
`node packages/cli/dist/semalam.mjs <command>` in place of `npx semalam`.

```bash
npx semalam replay --fixture golden          # offline: three golden rounds shipped in this package
npx semalam replay 1 --chain 46630           # Robinhood Chain testnet
npx semalam replay <round> --agent 0x…       # your agent's night as ASCII + the turn that decided it
npx semalam season <s>                       # season points and the crown-eligible champion
npx semalam house                            # the 30 house agents and HOUSE_SET_HASH
```

What `replay` does, in order:

1. Reads `SIM_VERSION`, `HOUSE_SET_HASH` and `GENESIS` from `Results`. It refuses (exit 2) unless they equal this package's
   simulator version and `house-set.json`.
2. Stops with exit 4 ("waiting") unless the finalized chain is past the round's close, so no late commit can be missed.
   It reads everything from ONE RPC endpoint per run (the first that answers with the right chain id).
3. Fetches every `Orders.Committed` event of the round (paged `eth_getLogs`, ordered RPC failover, `--rpc` to override).
4. Fetches drand quicknet beacon `seedRound(round)` — the first round at or after close + 300 s — and verifies its BLS
   signature against the pinned quicknet key. Any other round, or a bad signature, is refused (exit 2).
5. Admits the first 1,000 accounts by first commit, takes each one's latest commit, timelock-decrypts it with that
   beacon, and checks `keccak256(policy) == policyHash`. Void commits are listed with their reason.
6. Runs the simulator (plain code, no LLM: 30 house agents + every valid player × 300 turns) and prints
   `resultHash` next to `Results.post` — `✓ MATCH` (exit 0) or `✗ MISMATCH` (exit 1).

Exit codes: `0` match · `1` mismatch · `2` refused · `3` network · `4` waiting (chain not final past close, beacon not
published, or round not posted / post not final yet — in the last case the computed hash is printed) · `64` usage ·
`70` internal error.

MIT licensed.
