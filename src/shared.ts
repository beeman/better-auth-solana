import type { BetterAuthPlugin, InferOptionSchema } from 'better-auth'
import type { VerifySolanaSignatureFn } from './verify-signature.ts'

export interface SIWSNonceResponse {
  cluster: string
  domain: string
  expirationTime: Date | string
  issuedAt: Date | string
  nonce: string
  uri: string
}

export interface SIWSOptions {
  anonymous?: boolean
  domain: string
  emailDomainName?: string
  getNonce?: SIWSGetNonceFn
  nonceExpirationMs?: number
  profileLookup?: SIWSProfileLookupFn
  schema?: InferOptionSchema<typeof import('./solana-storage.ts').solanaWalletSchema>
  verifySignature?: VerifySolanaSignatureFn
}

export type SIWSPlugin = (options: SIWSOptions) => BetterAuthPlugin

export type SIWSGetNonceFn = () => Promise<string>

export type SIWSProfileLookupFn = (args: { cluster: string; walletAddress: string }) => Promise<
  | {
      avatar?: string
      name?: string
    }
  | null
  | undefined
>

export interface SIWSLinkResponse {
  success: true
  user: {
    cluster: string
    id: string
    walletAddress: string
  }
}

export interface SIWSVerifyResponse {
  success: true
  token: string
  user: {
    cluster: string
    id: string
    walletAddress: string
  }
}

export interface SIWSWalletRecord {
  address: string
  cluster: string
  createdAt: Date | string
  isPrimary: boolean
  userId: string
}
