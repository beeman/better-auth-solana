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

- `POST /siws/nonce`
- `POST /siws/verify`

`POST /siws/nonce` accepts `{ walletAddress, cluster? }` and stores a cluster-bound challenge in Better Auth verification storage under `siws:<walletAddress>:<cluster>`.

`POST /siws/verify` accepts `{ walletAddress, message, signature, cluster?, email? }`, verifies the signed SIWS payload, creates or reuses the Better Auth user, persists a `solanaWallet` row, persists an `account` row with `providerId: "siws"`, and establishes the Better Auth session with native session cookies.

## Client

`better-auth-solana/client` exports `siwsClient()` for Better Auth client inference and `createSIWSInput(...)` for building the wallet sign-in payload.

```ts
import { createAuthClient } from 'better-auth/client'
import { createSIWSInput, siwsClient } from 'better-auth-solana/client'

const authClient = createAuthClient({
  plugins: [siwsClient()],
})

const nonceResult = await authClient.siws.nonce({
  cluster: 'mainnet',
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
  cluster: 'mainnet',
  message: signed.message,
  signature: signed.signature,
  walletAddress: address,
})

const session = await authClient.getSession()
```

The server validates the signed message against the issued `domain`, `uri`, `chainId`, `nonce`, `issuedAt`, and `expirationTime`. The `statement` remains client-controlled.

## Default Schema

```ts
import { solanaWalletSchema } from 'better-auth-solana/schema'
```

The default `solanaWallet` model contains:

- `address`
- `cluster`
- `createdAt`
- `userId`

The plugin stores one wallet row per `address + cluster`, but reuses the same Better Auth user when the same address signs in on another cluster.

## Options

`siws()` accepts:

- `anonymous` default `true`
- `domain` required
- `emailDomainName` optional
- `nonceExpirationMs` default `900000`
- `schema` optional Better Auth schema field overrides for `solanaWallet`

When `anonymous` is `false`, `email` is required on `/siws/verify`.

When `emailDomainName` is omitted, generated fallback emails use the Better Auth base URL host.

## Notes

- The account id format is `<walletAddress>:<cluster>`.
- The account provider id is `siws`.
- The client surface is `authClient.siws.nonce(...)` and `authClient.siws.verify(...)`.
- The package name is `better-auth-solana`; the plugin namespace is `siws`.

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
