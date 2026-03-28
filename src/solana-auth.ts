import { getCurrentAdapter, runWithTransaction } from '@better-auth/core/context'
import type { DBAdapter, DBTransactionAdapter } from '@better-auth/core/db/adapter'
import { isAddress, isSignature } from '@solana/kit'
import type { BetterAuthPlugin, Session, User } from 'better-auth'
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { mergeSchema } from 'better-auth/db'
import { z } from 'zod'
import { SIWS_ERROR_CODES } from './error-codes.ts'
import type {
  SIWSGetNonceFn,
  SIWSLinkResponse,
  SIWSNonceResponse,
  SIWSOptions,
  SIWSProfileLookupFn,
  SIWSVerifyResponse,
} from './shared.ts'
import { deserializeSIWSChallenge, parseSIWSMessage, serializeSIWSChallenge } from './siws.ts'
import {
  createSIWSWallet,
  findSIWSWalletByAddress,
  findSIWSWalletByAddressAndCluster,
  findSIWSWalletByUserId,
  solanaWalletSchema,
} from './solana-storage.ts'
import { generateNonce, type VerifySolanaSignatureFn, verifySolanaSignature } from './verify-signature.ts'

const defaultCluster = 'mainnet'
const defaultNonceExpirationMs = 15 * 60 * 1000

declare module '@better-auth/core' {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    siws: {
      creator: typeof siws
    }
  }
}

type SIWSStoredSession = Session & Record<string, unknown>
type SIWSStoredUser = User & Record<string, unknown>
type SIWSAdapter = Pick<DBAdapter, 'create' | 'findOne'>
type SIWSTransactionAdapter = Pick<DBTransactionAdapter, 'create' | 'findOne'>

interface SIWSInternalAdapter {
  createAccount(data: {
    accountId: string
    createdAt: Date
    providerId: string
    updatedAt: Date
    userId: string
  }): Promise<unknown>
  createSession(userId: string): Promise<SIWSStoredSession | null>
  createUser(user: { email: string; image?: string; name: string }): Promise<SIWSStoredUser>
  createVerificationValue(data: { expiresAt: Date; identifier: string; value: string }): Promise<unknown>
  deleteVerificationByIdentifier(identifier: string): Promise<void>
  findAccountByProviderId(accountId: string, providerId: string): Promise<unknown | null>
  findUserById(userId: string): Promise<SIWSStoredUser | null>
  findVerificationValue(identifier: string): Promise<{
    expiresAt: Date | string
    id: string
    value: string
  } | null>
}

interface SIWSContext {
  adapter: DBAdapter
  baseURL?: string
  internalAdapter: SIWSInternalAdapter
}

function buildSIWSUserResponse(args: { cluster: string; userId: string; walletAddress: string }) {
  return {
    cluster: args.cluster,
    id: args.userId,
    walletAddress: args.walletAddress,
  }
}

function buildAccountId(args: { cluster: string; walletAddress: string }) {
  return `${args.walletAddress}:${args.cluster}`
}

function assertChallengeMatchesMessage(args: {
  challenge: SIWSNonceResponse
  message: ReturnType<typeof parseSIWSMessage>
  walletAddress: string
}) {
  const { challenge, message, walletAddress } = args

  if (
    message.address !== walletAddress ||
    message.chainId !== challenge.cluster ||
    message.domain !== challenge.domain ||
    message.expirationTime !== challenge.expirationTime ||
    message.issuedAt !== challenge.issuedAt ||
    message.nonce !== challenge.nonce ||
    message.uri !== challenge.uri
  ) {
    throw new APIError('UNAUTHORIZED', {
      message: 'Message does not match the issued challenge.',
    })
  }
}

function buildChallenge(args: {
  baseURL?: string
  cluster: string
  domain: string
  expiresAt: Date
  issuedAt: Date
  nonce: string
}): SIWSNonceResponse {
  const { baseURL, cluster, domain, expiresAt, issuedAt, nonce } = args
  const uri = typeof baseURL === 'string' ? baseURL : `https://${domain}`

  return {
    cluster,
    domain,
    expirationTime: expiresAt.toISOString(),
    issuedAt: issuedAt.toISOString(),
    nonce,
    uri,
  }
}

function buildVerificationIdentifier(args: { cluster: string; walletAddress: string }) {
  const { cluster, walletAddress } = args

  return `siws:${walletAddress}:${cluster}`
}

function getFallbackEmailDomainName(args: { baseURL?: string; emailDomainName?: string }) {
  if (args.emailDomainName) {
    return args.emailDomainName
  }

  if (!args.baseURL) {
    return 'localhost'
  }

  try {
    return new URL(args.baseURL).host
  } catch {
    return 'localhost'
  }
}

async function ensureSIWSAccount(args: {
  cluster: string
  context: SIWSContext
  userId: string
  walletAddress: string
}) {
  const accountId = buildAccountId({
    cluster: args.cluster,
    walletAddress: args.walletAddress,
  })
  const existingAccount = await args.context.internalAdapter.findAccountByProviderId(accountId, 'siws')

  if (existingAccount) {
    return
  }

  await args.context.internalAdapter.createAccount({
    accountId,
    createdAt: new Date(),
    providerId: 'siws',
    updatedAt: new Date(),
    userId: args.userId,
  })
}

function ensureWalletCanBeLinkedToUser(args: { userId: string; wallet: { userId: string } }) {
  if (args.wallet.userId === args.userId) {
    return
  }

  throw APIError.from('CONFLICT', SIWS_ERROR_CODES.WALLET_ALREADY_LINKED_TO_ANOTHER_USER)
}

async function getIsPrimaryWalletForUser(args: { adapter: SIWSAdapter | SIWSTransactionAdapter; userId: string }) {
  const existingUserWallet = await findSIWSWalletByUserId({
    adapter: args.adapter,
    userId: args.userId,
  })

  return !existingUserWallet
}

async function validateSIWSRequest(args: {
  cluster: string
  context: SIWSContext
  message: string
  signature: string
  verifySignature?: VerifySolanaSignatureFn
  walletAddress: string
}) {
  const { cluster, context, message, signature, verifySignature = verifySolanaSignature, walletAddress } = args
  const identifier = buildVerificationIdentifier({ cluster, walletAddress })
  const nonceRecord = await context.internalAdapter.findVerificationValue(identifier)

  if (!nonceRecord) {
    throw APIError.from('UNAUTHORIZED', SIWS_ERROR_CODES.INVALID_OR_EXPIRED_NONCE)
  }

  if (new Date(nonceRecord.expiresAt) < new Date()) {
    await context.internalAdapter.deleteVerificationByIdentifier(identifier)
    throw APIError.from('UNAUTHORIZED', SIWS_ERROR_CODES.INVALID_OR_EXPIRED_NONCE)
  }

  let challenge: SIWSNonceResponse

  try {
    challenge = deserializeSIWSChallenge(nonceRecord.value)
  } catch {
    await context.internalAdapter.deleteVerificationByIdentifier(identifier)
    throw APIError.from('INTERNAL_SERVER_ERROR', SIWS_ERROR_CODES.INVALID_CHALLENGE)
  }

  let parsedMessage: ReturnType<typeof parseSIWSMessage>

  try {
    parsedMessage = parseSIWSMessage(message)
  } catch {
    throw APIError.from('UNAUTHORIZED', SIWS_ERROR_CODES.MESSAGE_MISMATCH)
  }

  try {
    assertChallengeMatchesMessage({
      challenge,
      message: parsedMessage,
      walletAddress,
    })
  } catch {
    throw APIError.from('UNAUTHORIZED', SIWS_ERROR_CODES.MESSAGE_MISMATCH)
  }

  const isValidSignature = await verifySignature({
    address: walletAddress,
    message,
    signature,
  })

  if (!isValidSignature) {
    throw APIError.from('UNAUTHORIZED', SIWS_ERROR_CODES.INVALID_SIGNATURE)
  }

  await context.internalAdapter.deleteVerificationByIdentifier(identifier)
}

export async function issueSIWSChallenge(args: {
  cluster: string
  context: SIWSContext
  domain: string
  getNonce?: SIWSGetNonceFn
  nonceExpirationMs: number
  walletAddress: string
}): Promise<SIWSNonceResponse> {
  const { cluster, context, domain, getNonce, nonceExpirationMs, walletAddress } = args
  const identifier = buildVerificationIdentifier({ cluster, walletAddress })
  const existingChallenge = await context.internalAdapter.findVerificationValue(identifier)

  if (existingChallenge) {
    await context.internalAdapter.deleteVerificationByIdentifier(identifier)
  }

  const expiresAt = new Date(Date.now() + nonceExpirationMs)
  const issuedAt = new Date()
  const nonce = getNonce ? await getNonce() : generateNonce()
  const challenge = buildChallenge({
    baseURL: context.baseURL,
    cluster,
    domain,
    expiresAt,
    issuedAt,
    nonce,
  })

  await context.internalAdapter.createVerificationValue({
    expiresAt,
    identifier,
    value: serializeSIWSChallenge(challenge),
  })

  return challenge
}

export async function verifySIWSMessage(args: {
  anonymous: boolean
  cluster: string
  context: SIWSContext
  email?: string
  emailDomainName?: string
  message: string
  profileLookup?: SIWSProfileLookupFn
  signature: string
  verifySignature?: VerifySolanaSignatureFn
  walletAddress: string
}): Promise<SIWSVerifyResponse & { _session: SIWSStoredSession; _user: SIWSStoredUser }> {
  const {
    anonymous,
    cluster,
    context,
    email,
    emailDomainName,
    message,
    profileLookup,
    signature,
    verifySignature = verifySolanaSignature,
    walletAddress,
  } = args

  if (!anonymous && !email) {
    throw APIError.from('BAD_REQUEST', SIWS_ERROR_CODES.EMAIL_REQUIRED)
  }
  await validateSIWSRequest({
    cluster,
    context,
    message,
    signature,
    verifySignature,
    walletAddress,
  })

  const existingWallet = await findSIWSWalletByAddressAndCluster({
    adapter: context.adapter,
    address: walletAddress,
    cluster,
  })
  const anyWallet = existingWallet
    ? existingWallet
    : await findSIWSWalletByAddress({
        adapter: context.adapter,
        address: walletAddress,
      })
  let user: SIWSStoredUser | null = null

  if (existingWallet) {
    user = await context.internalAdapter.findUserById(existingWallet.userId)

    if (!user) {
      throw APIError.from('INTERNAL_SERVER_ERROR', SIWS_ERROR_CODES.USER_NOT_FOUND_FOR_WALLET)
    }
  } else if (anyWallet) {
    user = await context.internalAdapter.findUserById(anyWallet.userId)

    if (!user) {
      throw APIError.from('INTERNAL_SERVER_ERROR', SIWS_ERROR_CODES.USER_NOT_FOUND_FOR_WALLET)
    }

    await createSIWSWallet({
      adapter: context.adapter,
      address: walletAddress,
      cluster,
      isPrimary: false,
      userId: user.id,
    })
  } else {
    const resolvedEmailDomainName = getFallbackEmailDomainName({
      baseURL: context.baseURL,
      emailDomainName,
    })
    const profile =
      (await profileLookup?.({
        cluster,
        walletAddress,
      })) ?? null
    user = await context.internalAdapter.createUser({
      email: !anonymous && email ? email : `${walletAddress}@${resolvedEmailDomainName}`,
      image: profile?.avatar ?? '',
      name: profile?.name ?? walletAddress,
    })

    await createSIWSWallet({
      adapter: context.adapter,
      address: walletAddress,
      cluster,
      isPrimary: true,
      userId: user.id,
    })
  }

  await ensureSIWSAccount({
    cluster,
    context,
    userId: user.id,
    walletAddress,
  })

  const session = await context.internalAdapter.createSession(user.id)

  if (!session) {
    throw APIError.from('INTERNAL_SERVER_ERROR', SIWS_ERROR_CODES.FAILED_TO_CREATE_SESSION)
  }

  return {
    _session: session,
    _user: user,
    success: true,
    token: session.token,
    user: buildSIWSUserResponse({
      cluster,
      userId: user.id,
      walletAddress,
    }),
  }
}

export async function linkSIWSWallet(args: {
  cluster: string
  context: SIWSContext
  message: string
  signature: string
  userId: string
  verifySignature?: VerifySolanaSignatureFn
  walletAddress: string
}): Promise<SIWSLinkResponse> {
  const { cluster, context, message, signature, userId, verifySignature, walletAddress } = args

  await validateSIWSRequest({
    cluster,
    context,
    message,
    signature,
    verifySignature,
    walletAddress,
  })

  return runWithTransaction(context.adapter, async () => {
    const adapter = await getCurrentAdapter(context.adapter)
    const existingWallet = await findSIWSWalletByAddressAndCluster({
      adapter,
      address: walletAddress,
      cluster,
    })

    if (existingWallet) {
      ensureWalletCanBeLinkedToUser({
        userId,
        wallet: existingWallet,
      })
      await ensureSIWSAccount({
        cluster,
        context,
        userId,
        walletAddress,
      })

      return {
        success: true,
        user: buildSIWSUserResponse({
          cluster,
          userId,
          walletAddress,
        }),
      }
    }

    const anyWallet = await findSIWSWalletByAddress({
      adapter,
      address: walletAddress,
    })

    if (anyWallet) {
      ensureWalletCanBeLinkedToUser({
        userId,
        wallet: anyWallet,
      })
    }

    const isPrimary = await getIsPrimaryWalletForUser({
      adapter,
      userId,
    })

    await createSIWSWallet({
      adapter,
      address: walletAddress,
      cluster,
      isPrimary,
      userId,
    })
    await ensureSIWSAccount({
      cluster,
      context,
      userId,
      walletAddress,
    })

    return {
      success: true,
      user: buildSIWSUserResponse({
        cluster,
        userId,
        walletAddress,
      }),
    }
  })
}

export const siws = (options: SIWSOptions) =>
  ({
    $ERROR_CODES: SIWS_ERROR_CODES,
    endpoints: {
      link: createAuthEndpoint(
        '/siws/link',
        {
          body: z.object({
            cluster: z.string().min(1).optional().default(defaultCluster),
            message: z.string().min(1),
            signature: z.string().refine((value) => isSignature(value), {
              message: 'Invalid Solana signature',
            }),
            walletAddress: z.string().refine((value) => isAddress(value), {
              message: 'Invalid Solana address',
            }),
          }),
          method: 'POST',
          requireRequest: true,
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const response = await linkSIWSWallet({
            cluster: ctx.body.cluster,
            context: ctx.context,
            message: ctx.body.message,
            signature: ctx.body.signature,
            userId: ctx.context.session.user.id,
            verifySignature: options.verifySignature,
            walletAddress: ctx.body.walletAddress,
          })

          return ctx.json(response)
        },
      ),
      nonce: createAuthEndpoint(
        '/siws/nonce',
        {
          body: z.object({
            cluster: z.string().min(1).optional().default(defaultCluster),
            walletAddress: z.string().refine((value) => isAddress(value), {
              message: 'Invalid Solana address',
            }),
          }),
          method: 'POST',
        },
        async (ctx) => {
          const challenge = await issueSIWSChallenge({
            cluster: ctx.body.cluster,
            context: ctx.context,
            domain: options.domain,
            getNonce: options.getNonce,
            nonceExpirationMs: options.nonceExpirationMs ?? defaultNonceExpirationMs,
            walletAddress: ctx.body.walletAddress,
          })

          return ctx.json(challenge)
        },
      ),
      verify: createAuthEndpoint(
        '/siws/verify',
        {
          body: z.object({
            cluster: z.string().min(1).optional().default(defaultCluster),
            email: z.email().optional(),
            message: z.string().min(1),
            signature: z.string().refine((value) => isSignature(value), {
              message: 'Invalid Solana signature',
            }),
            walletAddress: z.string().refine((value) => isAddress(value), {
              message: 'Invalid Solana address',
            }),
          }),
          method: 'POST',
          requireRequest: true,
        },
        async (ctx) => {
          const response = await verifySIWSMessage({
            anonymous: options.anonymous ?? true,
            cluster: ctx.body.cluster,
            context: ctx.context,
            email: ctx.body.email,
            emailDomainName: options.emailDomainName,
            message: ctx.body.message,
            profileLookup: options.profileLookup,
            signature: ctx.body.signature,
            verifySignature: options.verifySignature,
            walletAddress: ctx.body.walletAddress,
          })

          await setSessionCookie(ctx, {
            session: response._session,
            user: response._user,
          })

          return ctx.json({
            success: response.success,
            token: response.token,
            user: response.user,
          })
        },
      ),
    },
    id: 'siws',
    options,
    schema: mergeSchema(structuredClone(solanaWalletSchema), options.schema),
  }) satisfies BetterAuthPlugin
