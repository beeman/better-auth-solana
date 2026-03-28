import type { BetterAuthClientPlugin } from 'better-auth/client'
import { SIWS_ERROR_CODES } from './error-codes.ts'
import type { SIWSLinkResponse, SIWSNonceResponse, SIWSVerifyResponse } from './shared.ts'

type SIWSServerPlugin = ReturnType<typeof import('./solana-auth.ts')['siws']>

export interface CreateSIWSInputOptions {
  address: string
  challenge: SIWSNonceResponse
  statement?: string
}

export interface SIWSInput {
  address: string
  domain: string
  expirationTime: string
  issuedAt: string
  nonce: string
  statement?: string
  uri: string
  version: '1'
}

function normalizeDateString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value
}

export function createSIWSInput({ address, challenge, statement }: CreateSIWSInputOptions): SIWSInput {
  return {
    address,
    domain: challenge.domain,
    expirationTime: normalizeDateString(challenge.expirationTime),
    issuedAt: normalizeDateString(challenge.issuedAt),
    nonce: challenge.nonce,
    statement,
    uri: challenge.uri,
    version: '1',
  }
}

export function siwsClient() {
  return {
    $ERROR_CODES: SIWS_ERROR_CODES,
    $InferServerPlugin: {} as SIWSServerPlugin,
    atomListeners: [
      {
        matcher: (path: string): path is '/siws/verify' => path === '/siws/verify',
        signal: '$sessionSignal',
      },
    ],
    id: 'siws',
  } satisfies BetterAuthClientPlugin
}

export { SIWS_ERROR_CODES }
export type { SIWSLinkResponse, SIWSNonceResponse, SIWSVerifyResponse }
