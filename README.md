# better-auth-solana

`better-auth-solana` is a Better Auth plugin for Sign in With Solana.

It uses the Better Auth plugin namespace `siws` and requires `better-auth` `^1.5.0`.

It exposes three public entrypoints:

- `better-auth-solana` for the server plugin
- `better-auth-solana/client` for client helpers
- `better-auth-solana/schema` for the default Solana wallet schema

## Install

```bash
bun add @solana/kit better-auth better-auth-solana
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

`POST /siws/link` accepts `{ walletAddress, message, signature }`, requires an authenticated Better Auth session, verifies the signed SIWS payload, persists a `solanaWallet` row when needed, persists an `account` row with `providerId: "siws"` when needed, and keeps the current session intact.

`POST /siws/nonce` accepts `{ walletAddress }` and stores a challenge in Better Auth verification storage under `siws:<walletAddress>`.

`POST /siws/verify` accepts `{ walletAddress, message, signature, email? }`, verifies the signed SIWS payload, creates or reuses the Better Auth user, persists a `solanaWallet` row, persists an `account` row with `providerId: "siws"`, and establishes the Better Auth session with native session cookies.

## Client

`better-auth-solana/client` exports `siwsClient()` for Better Auth client inference and `createSIWSInput(...)` for building the wallet sign-in payload.

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

The server validates the signed message against the issued `domain`, `uri`, `nonce`, `issuedAt`, and `expirationTime`. The `statement` remains client-controlled.

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
- Better Auth's `last-login-method` plugin currently recognizes `siwe`, not `siws`. If you use it with this plugin, add a `customResolveMethod` that maps `/siws/verify` to `siws`.
- The package name is `better-auth-solana`; the plugin namespace is `siws`.

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
