---
'better-auth-solana': patch
---

Build the package with TypeScript 6 and verify compatibility with both TypeScript 5 and 6 in CI.

Require `@solana/kit` `^6.8.0` as the minimum supported Solana Kit version because that line carries the upstream TypeScript compatibility needed for dual support.
