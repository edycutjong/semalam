# Contributing

```bash
pnpm install
pnpm -r --if-present typecheck
pnpm -r --if-present test
cd contracts && forge test
```

- Any change to simulator rules changes the golden hashes in `fixtures/golden/` and the `SIM_VERSION` pin; say so in the PR.
- New test files are added to the package's explicit test list in its `package.json` (Windows has no glob expansion).
- Run `gitleaks detect` before pushing. Credentials never go in the tree.
- Commits are small with a real message.
