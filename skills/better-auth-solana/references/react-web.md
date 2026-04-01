# React Web

## Install

Default to:

```bash
npm install @solana/kit better-auth better-auth-solana@latest
```

Add the app's existing wallet library on top of that. The reference apps use `@wallet-ui/react`, but the Better Auth side only requires a wallet sign-in function that can sign the SIWS payload.

If the app uses `@wallet-ui/react`, prefer its re-exported `getWalletFeature(...)` and `getWalletAccountFeature(...)` helpers instead of adding a separate `@wallet-standard/ui` dependency.

## Auth Client Setup

Use `better-auth/react` with `siwsClient()`:

```ts
import { createAuthClient } from 'better-auth/react'
import { siwsClient } from 'better-auth-solana/client'

export const authClient = createAuthClient({
  baseURL: env.VITE_API_URL,
  plugins: [siwsClient()],
})
```

If the app already uses other Better Auth client plugins, keep them and add `siwsClient()` alongside them.

## Sign-In Flow

Use this flow for browser-wallet SIWS:

1. Call `authClient.siws.nonce({ walletAddress })`.
2. Build the SIWS input with `createSIWSInput({ address, challenge, statement })`.
3. Ask the wallet to sign the SIWS input.
4. Convert the signed message to a UTF-8 string.
5. Convert the signature bytes to a base58 string when the wallet library returns raw bytes.
6. Call `authClient.siws.verify(...)`.
7. Refresh the page state or invalidate auth-dependent queries.

If the app uses `@wallet-ui/react`, keep these rules in mind:

- `UiWallet.features` is an array of feature names such as `["solana:signIn", "solana:signMessage"]`.
- `UiWalletAccount.features` is also an array of feature names.
- Do not call `wallet.features["solana:signIn"]` or use `solanaSignInFeature in wallet.features`.
- Detect support with `.includes(...)`.
- Resolve the underlying Wallet Standard feature object through the helpers re-exported by `@wallet-ui/react`.

Use this pattern as the baseline:

```ts
import { getBase58Decoder } from '@solana/kit'
import { createSIWSInput } from 'better-auth-solana/client'

const nonce = await authClient.siws.nonce({
  walletAddress: address,
})

if (!nonce.data) {
  throw new Error(nonce.error?.message || 'Failed to fetch nonce')
}

const signed = await signIn(
  createSIWSInput({
    address,
    challenge: nonce.data,
    statement: 'Sign in to My App',
  }),
)

const message = new TextDecoder().decode(signed.signedMessage)
const signature = getBase58Decoder().decode(signed.signature)

const verifyResult = await authClient.siws.verify({
  message,
  signature,
  walletAddress: address,
})
```

If the wallet library only exposes a raw `signMessage` flow, build the SIWS string first:

```ts
import { createSIWSMessage } from 'better-auth-solana/client'

const message = createSIWSMessage({
  address,
  challenge: nonce.data,
  statement: 'Sign in to My App',
})

const signed = await signMessage(new TextEncoder().encode(message))
```

Use this pattern when the app uses `@wallet-ui/react` and needs direct access to `solana:signIn` or `solana:signMessage`:

```ts
import { getBase58Decoder } from '@solana/kit'
import {
  getWalletAccountFeature,
  getWalletFeature,
  SolanaSignIn,
  SolanaSignMessage,
  type SolanaSignInFeature,
  type SolanaSignMessageFeature,
  type UiWallet,
  type UiWalletAccount,
} from '@wallet-ui/react'
import { createSIWSInput, createSIWSMessage } from 'better-auth-solana/client'

function getSolanaSignInFeature(wallet: UiWallet | undefined) {
  if (!wallet?.features.includes(SolanaSignIn)) {
    return null
  }

  return getWalletFeature(wallet, SolanaSignIn) as SolanaSignInFeature[typeof SolanaSignIn]
}

function getSolanaSignMessageFeature(account: UiWalletAccount | undefined) {
  if (!account?.features.includes(SolanaSignMessage)) {
    return null
  }

  return getWalletAccountFeature(
    account,
    SolanaSignMessage,
  ) as SolanaSignMessageFeature[typeof SolanaSignMessage]
}

const signInFeature = getSolanaSignInFeature(wallet)
const signMessageFeature = getSolanaSignMessageFeature(account)
const siwsArgs = {
  address,
  challenge: nonce.data,
  statement: 'Sign in to My App',
}
const siwsInput = createSIWSInput(siwsArgs)
const siwsMessage = createSIWSMessage(siwsArgs)

let signed

if (signInFeature) {
  const [signInResult] = await signInFeature.signIn(siwsInput)
  signed = signInResult
} else if (signMessageFeature && account) {
  const [signMessageResult] = await signMessageFeature.signMessage({
    account,
    message: new TextEncoder().encode(siwsMessage),
  })
  signed = signMessageResult
}

if (!signed) {
  throw new Error('Wallet did not return a SIWS payload')
}

const message = new TextDecoder().decode(signed.signedMessage)
const signature = getBase58Decoder().decode(signed.signature)
```

In that setup, `solana:signIn` support is detected at the wallet level and `solana:signMessage` fallback support is detected at the account level.

## Link Flow

Use `authClient.siws.link(...)` only when the user already has a Better Auth session and wants to attach a wallet to that existing user record.

Use the same nonce and wallet-signing sequence, then call:

```ts
const linkResult = await authClient.siws.link({
  message,
  signature,
  walletAddress: address,
})
```

`link` preserves the existing Better Auth session. `verify` establishes or refreshes the session for SIWS sign-in.

## UI Refresh Notes

- Call `authClient.getSession()` after verify when the page needs the new session immediately.
- Invalidate auth or profile queries after verify or link so linked wallets and session state redraw without a reload.

## Example Helper

Use this anonymized helper shape when the task asks for a reusable browser-wallet action:

```ts
import type { SolanaSignInInput, SolanaSignInOutput } from '@wallet-ui/react'
import { getBase58Decoder } from '@solana/kit'
import { createSIWSInput, type SIWSNonceResponse } from 'better-auth-solana/client'

import { authClient } from '@/lib/auth-client'

type SIWSAction = 'link' | 'verify'

export async function handleWalletAuth(args: {
  action: SIWSAction
  address: string
  refresh?: () => Promise<void>
  signIn: (input: SolanaSignInInput) => Promise<SolanaSignInOutput>
  statement: string
}) {
  const nonce = await fetchNonce(args.address)
  const signed = await args.signIn(
    createSIWSInput({
      address: args.address,
      challenge: nonce,
      statement: args.statement,
    }),
  )

  const message = new TextDecoder().decode(signed.signedMessage)
  const signature = getBase58Decoder().decode(signed.signature)
  const result =
    args.action === 'link'
      ? await authClient.siws.link({
          message,
          signature,
          walletAddress: args.address,
        })
      : await authClient.siws.verify({
          message,
          signature,
          walletAddress: args.address,
        })

  if (!result.data) {
    throw new Error(result.error?.message || 'SIWS request failed')
  }

  await args.refresh?.()

  return result.data
}

async function fetchNonce(address: string): Promise<SIWSNonceResponse> {
  const result = await authClient.siws.nonce({
    walletAddress: address,
  })

  if (!result.data) {
    throw new Error(result.error?.message || 'Failed to fetch nonce')
  }

  return result.data
}
```
