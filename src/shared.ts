import type { BetterAuthPlugin, InferOptionSchema } from 'better-auth'

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
  nonceExpirationMs?: number
  schema?: InferOptionSchema<typeof import('./solana-storage.ts').solanaWalletSchema>
}

export type SIWSPlugin = (options: SIWSOptions) => BetterAuthPlugin

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
  userId: string
}
