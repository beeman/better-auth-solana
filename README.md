# better-auth-solana

`better-auth-solana` is a Better Auth plugin for Sign in With Solana.

It uses the Better Auth plugin namespace `siws` and requires `better-auth` `^1.5.0`.

It exposes three public entrypoints:

- `better-auth-solana` for the server plugin
- `better-auth-solana/client` for client helpers
- `better-auth-solana/schema` for the default Solana wallet schema

## AI Agent Skill

If you use AI coding agents such as Codex, Claude Code, or OpenCode in a skills-enabled setup, install the companion skill with:

```bash
npx skills add beeman/better-auth-solana
```

For deeper integration guidance, see:

- [Backend](./skills/better-auth-solana/references/backend.md)
- [React Native and Expo](./skills/better-auth-solana/references/react-native-expo.md)
- [React web](./skills/better-auth-solana/references/react-web.md)
- [Schema and tables](./skills/better-auth-solana/references/schema.md)

## Install

```bash
bun add @solana/kit better-auth better-auth-solana@latest
```

## Server

```ts
import { betterAuth } from 'better-auth'
import { siws } from 'better-auth-solana'

export const auth = betterAuth({
  database: myDatabase,
  plugins: [
    siws({
      domain: 'example.com',
    }),
  ],
})
```

The plugin adds these Better Auth endpoints:

- `POST /siws/link`
- `POST /siws/nonce`
- `POST /siws/verify`

These are plugin subpaths under your Better Auth handler. If Better Auth is mounted under `/api/auth/*`, for example, `POST /siws/verify` becomes `POST /api/auth/siws/verify`.

`POST /siws/link` accepts `{ walletAddress, message, signature }`, requires an authenticated Better Auth session, verifies the signed SIWS payload, persists a `solanaWallet` row when needed, persists an `account` row with `providerId: "siws"` when needed, and keeps the current session intact.

`POST /siws/nonce` accepts `{ walletAddress }` and stores a challenge in Better Auth verification storage under `siws:<walletAddress>`.

`POST /siws/verify` accepts `{ walletAddress, message, signature, email? }`, verifies the signed SIWS payload, creates or reuses the Better Auth user, persists a `solanaWallet` row, persists an `account` row with `providerId: "siws"`, and establishes the Better Auth session with native session cookies.

For backend wiring, cookies, and origin handling, see [Backend](./skills/better-auth-solana/references/backend.md).

## Client

`better-auth-solana/client` exports `createSIWSInput(...)`, `createSIWSMessage(...)`, `formatSIWSMessage(...)`, and `siwsClient()` for Better Auth client inference.

- Use `createSIWSInput(...)` when the wallet library accepts structured SIWS input.
- Use `createSIWSMessage(...)` when the wallet library expects the raw SIWS message string.
- Use `formatSIWSMessage(...)` when you already have the SIWS fields and only need the canonical message string.

Use `authClient.siws.verify(...)` for SIWS sign-in when the wallet flow should create or resume the Better Auth session. Use `authClient.siws.link(...)` only when the user already has a Better Auth session and wants to attach another wallet.

```ts
import { createAuthClient } from 'better-auth/client'
import { createSIWSInput, siwsClient } from 'better-auth-solana/client'

const authClient = createAuthClient({
  plugins: [siwsClient()],
})

const nonceResult = await authClient.siws.nonce({
  walletAddress: address,
})

if (!nonceResult.data) {
  throw new Error('Failed to request SIWS nonce')
}

const siwsInput = createSIWSInput({
  address,
  challenge: nonceResult.data,
  statement: 'Sign in to Example',
})

const signed = await signWithYourWallet(siwsInput)

await authClient.siws.verify({
  message: signed.message,
  signature: signed.signature,
  walletAddress: address,
})

const session = await authClient.getSession()
```

For raw `signMessage` flows, build the SIWS string directly:

```ts
import { createSIWSMessage } from 'better-auth-solana/client'

const message = createSIWSMessage({
  address,
  challenge: nonceResult.data,
  statement: 'Sign in to Example',
})

const signed = await signMessage(new TextEncoder().encode(message))
```

The server validates the signed message against the issued `domain`, `uri`, `nonce`, `issuedAt`, and `expirationTime`. The `statement` remains client-controlled.

For platform-specific client guidance, see [React Native and Expo](./skills/better-auth-solana/references/react-native-expo.md) and [React web](./skills/better-auth-solana/references/react-web.md).

## Default Schema

```ts
import { solanaWalletSchema } from 'better-auth-solana/schema'
```

The default `solanaWallet` model contains:

- `address`
- `createdAt`
- `isPrimary`
- `userId`

The plugin stores one wallet row per address and one SIWS account row per wallet address.

The first Solana wallet row created for a user is marked `isPrimary: true`. Additional Solana wallet rows for that user are marked `isPrimary: false`.

SIWS also depends on Better Auth's standard `account`, `session`, `user`, and `verification` tables. The package writes `solanaWallet` directly and uses Better Auth internals for the other models.

For schema composition and table expectations, see [Schema and tables](./skills/better-auth-solana/references/schema.md).

## Options

`siws()` accepts:

- `anonymous` default `true`
- `domain` required
- `emailDomainName` optional
- `getNonce` optional async override for SIWS nonce generation
- `nonceExpirationMs` default `900000`
- `profileLookup` optional async lookup for user `name` and `image` when SIWS creates a brand-new user
- `schema` optional Better Auth schema field overrides for `solanaWallet`
- `uri` optional override for the SIWS challenge `uri`
- `verifySignature` optional async override for SIWS signature verification

When `anonymous` is `false`, `email` is required on `/siws/verify`.

When `emailDomainName` is omitted, generated fallback emails use the Better Auth base URL host.

When `profileLookup` is provided, it is only used when SIWS creates a brand-new Better Auth user. Existing users are not updated on later sign-ins or links.

When `uri` is a non-empty string, issued challenges use it verbatim. Otherwise SIWS uses Better Auth's resolved base URL and falls back to `https://${domain}` when no base URL is available.

## Notes

- The account id format is `<walletAddress>`.
- The account provider id is `siws`.
- The client surface is `authClient.siws.link(...)`, `authClient.siws.nonce(...)`, and `authClient.siws.verify(...)`.
- If your app already uses Better Auth's `last-login-method` plugin, add a `customResolveMethod` that maps `/siws/verify` to `siws`.
- The package name is `better-auth-solana`; the plugin namespace is `siws`.

The Better Auth docs currently describe default `last-login-method` detection for email and OAuth flows. Because SIWS is a custom flow, map it explicitly when you use that plugin. See Better Auth's [Last Login Method](https://canary.better-auth.com/docs/plugins/last-login-method) and [SIWE](https://better-auth.com/docs/plugins/siwe) docs for the surrounding Better Auth behavior.

Example `last-login-method` resolver:

```ts
import { lastLoginMethod } from 'better-auth/plugins'

lastLoginMethod({
  customResolveMethod(ctx) {
    if (ctx.path === '/siws/verify') {
      return 'siws'
    }

    return null
  },
})
```

## Development

```bash
bun install
bun run build
bun run check-types
bun run lint
bun run lint:fix
bun run test
bun run test:watch
```
