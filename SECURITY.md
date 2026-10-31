# Security Policy

## Scope

SEMALAM has three immutable contracts (`Orders`, `Scrimmage`, `Results`), a Next.js app, a settler script and a replay CLI.
The contracts hold no prize pool and have no owner withdrawal. The most useful reports concern:

- a way to make `semalam replay` print MATCH for a result that differs from a fresh run;
- a way to post, or re-post, a result the contracts should refuse;
- a way to drain the relay wallet faster than the documented per-night bound;
- a way to read a sealed order before the drand round that opens it.

## Reporting

Please use GitHub's private vulnerability reporting (Security tab → "Report a vulnerability"). Do not open a public issue
for a vulnerability. You will get an answer within 72 hours.

## Not in scope

Public data (orders after the close, the house set, result hashes) and the stated residual risk that a Sybil can fill the
1,000-account admission cap with own-wallet commits.
