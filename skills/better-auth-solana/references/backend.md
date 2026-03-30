# Backend Setup

## Install

Default to:

```bash
npm install @solana/kit better-auth better-auth-solana@latest
```

Switch tags only when the user asks, for example `better-auth-solana@canary`.

## Canonical Server Imports

Use these entrypoints:

```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { siws } from 'better-auth-solana'
```

## Better Auth Configuration

Use `siws()` inside `plugins` and give it a real `domain`. Set `uri` when the app needs a specific SIWS URI instead of Better Auth's resolved base URL.

```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { siws } from 'better-auth-solana'
import { db } from './db'
import * as schema from './schema/auth'

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema,
  }),
  plugins: [
    siws({
      anonymous: true,
      domain: new URL(env.BETTER_AUTH_URL).hostname,
      uri: env.BETTER_AUTH_URL,
    }),
  ],
  trustedOrigins: env.CORS_ORIGINS,
})
```

Keep these behaviors aligned with the package:

- `anonymous` defaults to `true`.
- `domain` is required.
- `emailDomainName` controls fallback email generation when anonymous sign-in creates a user.
- `getNonce` overrides SIWS nonce creation.
- `nonceExpirationMs` defaults to fifteen minutes.
- `profileLookup` only runs when SIWS creates a brand-new user.
- `schema` merges with the package's `solanaWalletSchema`.
- `uri` falls back to Better Auth `baseURL`, then `https://${domain}`.
- `verifySignature` overrides signature verification.

## Example Backend Shapes

Use these anonymized shapes to choose the right Better Auth configuration:

- Browser app and API on the same origin:
  Prefer the app's existing same-origin Better Auth cookie settings. `sameSite: 'lax'` is often enough.
- Browser app and API on different origins:
  Use `sameSite: 'none'`, `secure: true`, and include the app origin in `trustedOrigins`.
- Expo app talking to a hosted API:
  Add native schemes and local dev origins to `trustedOrigins`, and pair `siws()` with `expo()`.

When the task is not tied to a specific framework, ask which of those three shapes the app uses and then apply the matching cookie and origin rules.

## Route Wiring

Expose Better Auth exactly as usual. The plugin adds SIWS endpoints under the Better Auth handler:

- `POST /siws/link`
- `POST /siws/nonce`
- `POST /siws/verify`

If the app serves Better Auth under `/api/auth/*`, these become:

- `POST /api/auth/siws/link`
- `POST /api/auth/siws/nonce`
- `POST /api/auth/siws/verify`

In Hono-style servers, keep the normal Better Auth handler wiring:

```ts
app.on(['GET', 'POST'], '/api/auth/*', (context) => auth.handler(context.req.raw))
```

## Endpoint Semantics

- `POST /siws/link` requires an authenticated Better Auth session, verifies the signed SIWS payload, creates the `solanaWallet` row when needed, creates the `account` row with `providerId: 'siws'` when needed, and preserves the current session.
- `POST /siws/nonce` accepts `walletAddress`, creates a challenge, and stores it in Better Auth verification storage under `siws:${walletAddress}`.
- `POST /siws/verify` accepts `walletAddress`, `message`, `signature`, and optional `email`, verifies the SIWS payload, creates or reuses the Better Auth user, creates the `solanaWallet` row, creates the SIWS `account` row, and sets the Better Auth session cookie.

## Cookie And Origin Notes

Adjust cookie attributes to match the deployment surface:

- Keep `trustedOrigins` aligned with every web and native client origin that will call Better Auth.
- Use `sameSite: 'lax'` for same-origin browser apps when that already matches the app's Better Auth setup.
- Use `sameSite: 'none'` and `secure: true` for cross-origin or native-app session flows.

If the task is Expo-specific, also read [react-native-expo.md](react-native-expo.md).
If the task is browser-client-specific, also read [react-web.md](react-web.md).

## Compatibility Notes

- Better Auth `last-login-method` recognizes `siwe`, not `siws`, so add `customResolveMethod` only when that plugin is already present.
- The plugin namespace is `siws`, not `solana`.
- The SIWS account id is the wallet address.
- The SIWS account provider id is `siws`.

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
