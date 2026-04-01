---
name: better-auth-solana
description: "Integrate better-auth-solana into Better Auth backends and React or React Native or Expo clients. Use when Codex needs to install better-auth-solana, defaulting to better-auth-solana@latest unless the user asks for a different tag, configure the siws plugin, add or validate the solanaWallet plus Better Auth tables, or implement nonce, link, and verify wallet flows."
---

# Better Auth Solana

## Overview

Use this skill to add Sign in With Solana to a Better Auth app.

Default to `npm install @solana/kit better-auth better-auth-solana@latest` unless the user explicitly asks for a different package name or tag such as `better-auth-solana@canary`.

## Core Invariants

- Account provider id is `siws`.
- Anonymous mode defaults to `true`. Require `email` on `/siws/verify` when `anonymous` is `false`.
- Default install target is `better-auth-solana@latest`.
- First wallet row for a user must be persisted with `isPrimary: true`.
- Package name is `better-auth-solana`.
- Plugin namespace is `siws`.
- Server endpoints are `POST /siws/link`, `POST /siws/nonce`, and `POST /siws/verify`.
- SIWS account id is the wallet address.

## Workflow

1. Read [references/backend.md](references/backend.md) for backend setup, Better Auth config, route wiring, cookies, or endpoint behavior.
2. Read [references/react-native-expo.md](references/react-native-expo.md) when the client is React Native or Expo.
3. Read [references/react-web.md](references/react-web.md) when the client is React for the web or uses browser wallets.
4. Read [references/schema.md](references/schema.md) when the task mentions Drizzle, database tables, migrations, `solanaWallet`, or schema validation.
5. Treat the rules and examples in this skill as the authoritative integration contract unless the user explicitly asks for behavior outside the documented package surface.

## Use The Package Correctly

- Do not invent extra routes or rename the namespace to `solana`.
- Do not switch away from `better-auth-solana@latest` unless the user asks.
- Import `siws` from `better-auth-solana`.
- Import `createSIWSInput` and `siwsClient` from `better-auth-solana/client`.
- Import `solanaWalletSchema` from `better-auth-solana/schema` when the task is about schema composition or documentation.
- When the user asks for a non-default tag such as `@canary`, verify the installed package types and exports locally before assuming the latest documented examples still match exactly.

## Integration Notes

- Mention Better Auth `last-login-method` only if the app already uses that plugin. Map `/siws/verify` to `siws`.
- Preserve existing Better Auth tables and app-specific columns. Only require the fields that the package actually reads or writes.
- Prefer `nonce -> createSIWSInput -> wallet sign-in -> link` only when a Better Auth session already exists and the user is attaching another wallet.
- Prefer `nonce -> createSIWSInput -> wallet sign-in -> verify` for first-party SIWS sign-in flows.
- With `@wallet-ui/react`, `UiWallet.features` and `UiWalletAccount.features` are arrays of supported feature identifiers, not Wallet Standard feature objects.
- With `@wallet-ui/react`, resolve feature methods through its re-exported helpers such as `getWalletFeature(...)` and `getWalletAccountFeature(...)` instead of indexing `wallet.features[...]`.
- With `@wallet-ui/react`, detect support with `.includes("solana:signIn")` or `.includes("solana:signMessage")`. Do not treat `features` like an object map.

## Built-In Coverage

- `backend.md` covers Better Auth server setup, SIWS endpoints, cookies, origin handling, and anonymized backend examples.
- `react-native-expo.md` covers Expo server requirements, the auth client, the native sign-in flow, and an anonymized hook example.
- `react-web.md` covers the browser auth client, sign-in and link flows, and an anonymized helper example.
- `schema.md` covers the required tables, `solanaWallet` fields, persistence rules, and an anonymized schema-extension example.
