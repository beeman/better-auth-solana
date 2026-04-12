---
'better-auth-solana': major
---

Release the initial standalone `better-auth-solana` package as `1.0.0`.

This ships the Better Auth Solana plugin with root, `/client`, and `/schema` entrypoints, the `siws` plugin
namespace, a two-step nonce/verify wallet sign-in flow, native Better Auth session and account creation, and the
built-in `solanaWallet` schema.

The published package is ESM-only, matching Better Auth's ESM-only support.
