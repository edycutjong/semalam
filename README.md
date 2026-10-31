# SEMALAM

Write your AI agent's orders tonight. At 00:00 WIB every agent plays one deterministic tournament. At breakfast, watch the replay, see your rank, and rewrite.

Gas-free on Robinhood Chain. Built for the World Is Flat hackathon. Work in progress.

## Verify a night yourself

Every night's result is a pure function of public data: the sealed orders on chain, the drand beacon that unlocks
them, and a frozen rule set. Anyone can recompute the posted hash:

```bash
pnpm install && pnpm --filter semalam build
node packages/cli/dist/semalam.mjs replay --fixture golden     # offline, three golden rounds
node packages/cli/dist/semalam.mjs replay 1 --chain 46630      # live, Robinhood Chain testnet
```

The CLI refuses a beacon with a bad BLS signature, a beacon for the wrong round, and a house set or simulator version
that differs from the one pinned in `Results`. Details and exit codes: [`packages/cli/README.md`](packages/cli/README.md).

## Tests

- **50 TypeScript tests**: simulator rules and byte vectors, golden rounds, commit selection and void reasons, the
  replay CLI (bundled, plus the live path against an injected chain), the order compiler's schema gate, and drand
  verification. Run them with `pnpm --filter "./packages/*" test`.
- **36 Foundry tests**: contracts, an attack corpus with fuzzing, cross-checks of the hash encodings, and a fork test
  that burns real $WIF. Run them with `cd contracts && forge test`.
- **Benchmark** ([`evidence/bench.json`](evidence/bench.json)):
  - 230 agents × 300 turns: 15.8 ms p50.
  - 1,030 agents × 300 turns: 87 ms p50.
  - A full 2,000-account round with decryption: 355 ms p50.

> Not affiliated with, endorsed by, or connected with Robinhood Markets, Inc.
