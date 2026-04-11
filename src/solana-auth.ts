import { isAddress, isSignature } from '@solana/kit'
import type { BetterAuthPlugin, DBAdapter, DBTransactionAdapter, Session, User } from 'better-auth'
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
  findSIWSWalletByUserId,
  solanaWalletSchema,
} from './solana-storage.ts'
import { generateNonce, type VerifySolanaSignatureFn, verifySolanaSignature } from './verify-signature.ts'

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
  deleteUser(userId: string): Promise<void>
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
  logger?: {
    debug(message: string, ...args: unknown[]): void
  }
}

function buildSIWSUserResponse(args: { userId: string; walletAddress: string }) {
  return {
    id: args.userId,
    walletAddress: args.walletAddress,
  }
}

function assertChallengeMatchesMessage(args: {
  challenge: SIWSNonceResponse
  message: ReturnType<typeof parseSIWSMessage>
  walletAddress: string
}) {
  const { challenge, message, walletAddress } = args

  if (
    message.address !== walletAddress ||
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
  domain: string
  expiresAt: Date
  issuedAt: Date
  nonce: string
  uri?: string
}): SIWSNonceResponse {
  const { baseURL, domain, expiresAt, issuedAt, nonce, uri } = args
  const resolvedURI = uri || baseURL || `https://${domain}`

  return {
    domain,
    expirationTime: expiresAt.toISOString(),
    issuedAt: issuedAt.toISOString(),
    nonce,
    uri: resolvedURI,
  }
}

function buildVerificationIdentifier(args: { walletAddress: string }) {
  return `siws:${args.walletAddress}`
}

function buildNewAccount(accountId: string, userId: string) {
  return {
    accountId,
    createdAt: new Date(),
    providerId: 'siws',
    updatedAt: new Date(),
    userId,
  }
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

async function rollbackCreatedSIWSUser(args: { context: SIWSContext; userId: string; walletAddress: string }) {
  try {
    await args.context.adapter.delete({
      model: 'solanaWallet',
      where: [
        { field: 'address', operator: 'eq', value: args.walletAddress },
        { field: 'userId', operator: 'eq', value: args.userId },
      ],
    })
  } catch (error) {
    logRollbackFailure({
      context: args.context,
      error,
      operation: 'adapter.delete(solanaWallet)',
      userId: args.userId,
      walletAddress: args.walletAddress,
    })
  }

  try {
    await args.context.internalAdapter.deleteUser(args.userId)
  } catch (error) {
    logRollbackFailure({
      context: args.context,
      error,
      operation: 'internalAdapter.deleteUser(user)',
      userId: args.userId,
      walletAddress: args.walletAddress,
    })
  }
}

function logRollbackFailure(args: {
  context: SIWSContext
  error: unknown
  operation: string
  userId: string
  walletAddress: string
}) {
  args.context.logger?.debug('[siws] rollback cleanup failed', {
    error: args.error,
    operation: args.operation,
    userId: args.userId,
    walletAddress: args.walletAddress,
  })
}

async function ensureSIWSAccount(args: { context: SIWSContext; userId: string; walletAddress: string }) {
  const accountId = args.walletAddress
  const existingAccount = await args.context.internalAdapter.findAccountByProviderId(accountId, 'siws')

  if (existingAccount) {
    return
  }
  const newAccount = buildNewAccount(accountId, args.userId)
  await args.context.internalAdapter.createAccount(newAccount)
}

async function ensureSIWSAccountWithAdapter(args: {
  adapter: SIWSAdapter | SIWSTransactionAdapter
  userId: string
  walletAddress: string
}) {
  const accountId = args.walletAddress
  const existingAccount = await args.adapter.findOne({
    model: 'account',
    where: [
      { field: 'accountId', operator: 'eq', value: accountId },
      { field: 'providerId', operator: 'eq', value: 'siws' },
    ],
  })

  if (existingAccount) {
    return
  }
  const newAccount = buildNewAccount(accountId, args.userId)
  await args.adapter.create({
    data: newAccount,
    model: 'account',
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
  context: SIWSContext
  message: string
  signature: string
  verifySignature?: VerifySolanaSignatureFn
  walletAddress: string
}) {
  const { context, message, signature, verifySignature = verifySolanaSignature, walletAddress } = args
  const identifier = buildVerificationIdentifier({ walletAddress })
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
  context: SIWSContext
  domain: string
  getNonce?: SIWSGetNonceFn
  nonceExpirationMs: number
  uri?: string
  walletAddress: string
}): Promise<SIWSNonceResponse> {
  const { context, domain, getNonce, nonceExpirationMs, uri, walletAddress } = args
  const identifier = buildVerificationIdentifier({ walletAddress })
  const existingChallenge = await context.internalAdapter.findVerificationValue(identifier)

  if (existingChallenge) {
    await context.internalAdapter.deleteVerificationByIdentifier(identifier)
  }

  const expiresAt = new Date(Date.now() + nonceExpirationMs)
  const issuedAt = new Date()
  const nonce = getNonce ? await getNonce() : generateNonce()
  const challenge = buildChallenge({
    baseURL: context.baseURL,
    domain,
    expiresAt,
    issuedAt,
    nonce,
    uri,
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
    context,
    message,
    signature,
    verifySignature,
    walletAddress,
  })

  const existingWallet = await findSIWSWalletByAddress({
    adapter: context.adapter,
    address: walletAddress,
  })
  let createdUserId: string | null = null
  let user: SIWSStoredUser | null = null

  try {
    if (existingWallet) {
      user = await context.internalAdapter.findUserById(existingWallet.userId)

      if (!user) {
        throw APIError.from('INTERNAL_SERVER_ERROR', SIWS_ERROR_CODES.USER_NOT_FOUND_FOR_WALLET)
      }
    } else {
      const resolvedEmailDomainName = getFallbackEmailDomainName({
        baseURL: context.baseURL,
        emailDomainName,
      })
      const profile =
        (await profileLookup?.({
          walletAddress,
        })) ?? null
      user = await context.internalAdapter.createUser({
        email: !anonymous && email ? email : `${walletAddress}@${resolvedEmailDomainName}`,
        image: profile?.avatar ?? '',
        name: profile?.name ?? walletAddress,
      })
      createdUserId = user.id

      await createSIWSWallet({
        adapter: context.adapter,
        address: walletAddress,
        isPrimary: true,
        userId: user.id,
      })
    }

    await ensureSIWSAccount({
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
        userId: user.id,
        walletAddress,
      }),
    }
  } catch (error) {
    if (createdUserId) {
      await rollbackCreatedSIWSUser({
        context,
        userId: createdUserId,
        walletAddress,
      })
    }
    throw error
  }
}

export async function linkSIWSWallet(args: {
  context: SIWSContext
  message: string
  signature: string
  userId: string
  verifySignature?: VerifySolanaSignatureFn
  walletAddress: string
}): Promise<SIWSLinkResponse> {
  const { context, message, signature, userId, verifySignature, walletAddress } = args

  await validateSIWSRequest({
    context,
    message,
    signature,
    verifySignature,
    walletAddress,
  })

  return context.adapter.transaction(async (adapter) => {
    const existingWallet = await findSIWSWalletByAddress({
      adapter,
      address: walletAddress,
    })

    if (existingWallet) {
      ensureWalletCanBeLinkedToUser({
        userId,
        wallet: existingWallet,
      })
      await ensureSIWSAccountWithAdapter({
        adapter,
        userId,
        walletAddress,
      })

      return {
        success: true,
        user: buildSIWSUserResponse({
          userId,
          walletAddress,
        }),
      }
    }

    const isPrimary = await getIsPrimaryWalletForUser({
      adapter,
      userId,
    })

    await createSIWSWallet({
      adapter,
      address: walletAddress,
      isPrimary,
      userId,
    })
    await ensureSIWSAccountWithAdapter({
      adapter,
      userId,
      walletAddress,
    })

    return {
      success: true,
      user: buildSIWSUserResponse({
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
            walletAddress: z.string().refine((value) => isAddress(value), {
              message: 'Invalid Solana address',
            }),
          }),
          method: 'POST',
        },
        async (ctx) => {
          const challenge = await issueSIWSChallenge({
            context: ctx.context,
            domain: options.domain,
            getNonce: options.getNonce,
            nonceExpirationMs: options.nonceExpirationMs ?? defaultNonceExpirationMs,
            uri: options.uri,
            walletAddress: ctx.body.walletAddress,
          })

          return ctx.json(challenge)
        },
      ),
      verify: createAuthEndpoint(
        '/siws/verify',
        {
          body: z.object({
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
