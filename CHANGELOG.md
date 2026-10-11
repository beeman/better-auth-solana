# better-auth-solana

## 1.1.0

### Minor Changes

- 252b6ed: Support consumers upgrading to @solana/kit 8 by updating the peer requirement from ^6.8.0 to ^8.4.0.

### Patch Changes

- 252b6ed: Fix valid Solana sign-ins returning HTTP 500 on Better Auth 1.7 by looking up accounts through the public database adapter.

## 1.0.0

### Major Changes

- 00a2b89: Release the initial standalone `better-auth-solana` package as `1.0.0`.

  This ships the Better Auth Solana plugin with root, `/client`, and `/schema` entrypoints, the `siws` plugin
  namespace, a two-step nonce/verify wallet sign-in flow, native Better Auth session and account creation, and the
  built-in `solanaWallet` schema.

  The published package is ESM-only, matching Better Auth's ESM-only support.

### Minor Changes

- d66e0c4: Add `createSIWSMessage(...)` and `formatSIWSMessage(...)` to `better-auth-solana/client`.

  These helpers expose the package's canonical SIWS message formatter for raw `signMessage` flows while keeping
  `createSIWSInput(...)` unchanged for wallet libraries that accept structured SIWS input.

### Patch Changes

- 3d2509f: Enforce a unique wallet address constraint in the exported `solanaWalletSchema`.
- 4640009: Avoid leaving behind partial SIWS user, wallet, and account records when `/siws/verify` fails before session creation.
- 32f711a: Build the package with TypeScript 6 and verify compatibility with both TypeScript 5 and 6 in CI.

  Require `@solana/kit` `^6.8.0` as the minimum supported Solana Kit version because that line carries the upstream TypeScript compatibility needed for dual support.

- 6ae82d1: Ship the packaged README reference docs and verify README relative links against the npm packlist in CI.
