# React Native And Expo

## Install

Start with the package defaults:

```bash
npm install @solana/kit better-auth better-auth-solana@latest
```

Add Expo-specific dependencies only when the app actually uses Expo, for example `@better-auth/expo` and `expo-secure-store`.

## Server Requirements

Expo clients need the backend to accept native origins and native session handling.

Use this server pattern:

```ts
import { expo } from '@better-auth/expo'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { siws } from 'better-auth-solana'

export const auth = betterAuth({
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
    },
  },
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema,
  }),
  plugins: [
    expo(),
    siws({
      anonymous: true,
      domain: new URL(env.BETTER_AUTH_URL).hostname,
      emailDomainName: env.SOLANA_EMAIL_DOMAIN,
    }),
  ],
  trustedOrigins: [
    ...env.CORS_ORIGINS,
    ...(env.NODE_ENV === 'development'
      ? [
          'exp://',
          'exp://**',
          'http://localhost:8081',
          'my-app-scheme://**', // Replace with your actual app scheme
        ]
      : []),
  ],
})
```

Keep the actual scheme and origin list aligned with the app config.

## Auth Client Setup

Use `expoClient()` together with `siwsClient()` and persist auth state in `SecureStore`.

```ts
import { expoClient } from '@better-auth/expo/client'
import { createAuthClient } from 'better-auth/react'
import { siwsClient } from 'better-auth-solana/client'
import * as SecureStore from 'expo-secure-store'

export const authClient = createAuthClient({
  baseURL: serverUrl,
  plugins: [
    expoClient({
      scheme: 'my-app-scheme', // Replace with your actual app scheme
      storage: SecureStore,
      storagePrefix: 'my-app-scheme', // Replace with your actual app scheme or another stable prefix
    }),
    siwsClient(),
  ],
})
```

## Sign-In Flow

Follow this sequence:

1. Connect or read the active wallet account.
2. Call `authClient.siws.nonce({ walletAddress })`.
3. Build the SIWS payload with `createSIWSInput(...)`.
4. Ask the wallet to sign the SIWS payload.
5. Convert the signed message and signature into the string formats expected by `authClient.siws.verify(...)`.
6. Call `authClient.siws.verify(...)`.
7. Refresh session state and invalidate cached auth queries.

Use this client pattern as the baseline:

```ts
import { getBase58Decoder, getBase64Encoder, getUtf8Decoder } from '@solana/kit'
import { createSIWSInput } from 'better-auth-solana/client'

const nonceResult = await authClient.siws.nonce({
  walletAddress: address,
})

if (!nonceResult.data) {
  throw new Error(nonceResult.error?.message || 'Failed to get nonce')
}

const result = await signIn(
  createSIWSInput({
    address,
    challenge: nonceResult.data,
    statement: 'Sign in to My App',
  }),
)

const signatureBase64 = getUtf8Decoder().decode(result.signature)
const signedMessageBase64 = getUtf8Decoder().decode(result.signedMessage)
const signatureBase58 = getBase58Decoder().decode(getBase64Encoder().encode(signatureBase64))
const messageUtf8 = getUtf8Decoder().decode(getBase64Encoder().encode(signedMessageBase64))

const verifyResult = await authClient.siws.verify({
  message: messageUtf8,
  signature: signatureBase58,
  walletAddress: address,
})
```

Use the exact conversion pattern above when the wallet adapter returns the same encoded payload shape as that example. If the app already has a wallet library that returns UTF-8 message strings and base58 signatures directly, pass those values through without inventing extra conversions.

## Linking Versus Verifying

- Use `link` only after the user already has a Better Auth session and wants to attach another wallet to the same user.
- Use `verify` for SIWS sign-in that should create or resume the Better Auth session.

## Session Notes

- Call `authClient.getSession()` after verify when the screen needs immediate session state.
- Invalidate auth-dependent queries after verify or link so the UI reflects the new session or wallet state.

## Example Hook

Use this anonymized hook shape when the task asks for a complete Expo sign-in helper:

```ts
import { getBase58Decoder, getBase64Encoder, getUtf8Decoder } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { createSIWSInput } from 'better-auth-solana/client'
import { useState } from 'react'
import { Alert } from 'react-native'

import { authClient } from '@/lib/auth-client'

export function useWalletSignIn() {
  const { account, connect, signIn } = useMobileWallet()
  const [isLoading, setIsLoading] = useState(false)

  async function handleSignIn() {
    setIsLoading(true)

    try {
      const activeAccount = account || (await connect())
      const address = activeAccount.address
      const nonceResult = await authClient.siws.nonce({
        walletAddress: address,
      })

      if (!nonceResult.data) {
        throw new Error(nonceResult.error?.message || 'Failed to get nonce')
      }

      const signed = await signIn(
        createSIWSInput({
          address,
          challenge: nonceResult.data,
          statement: 'Sign in to Example App',
        }),
      )

      const signatureBase64 = getUtf8Decoder().decode(signed.signature)
      const signedMessageBase64 = getUtf8Decoder().decode(signed.signedMessage)
      const signatureBase58 = getBase58Decoder().decode(getBase64Encoder().encode(signatureBase64))
      const messageUtf8 = getUtf8Decoder().decode(getBase64Encoder().encode(signedMessageBase64))

      const verifyResult = await authClient.siws.verify({
        message: messageUtf8,
        signature: signatureBase58,
        walletAddress: address,
      })

      if (!verifyResult.data) {
        throw new Error(verifyResult.error?.message || 'Verification failed')
      }

      await authClient.getSession()
    } catch (error) {
      Alert.alert('Sign In Failed', error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  return {
    handleSignIn,
    isLoading,
  }
}
```
