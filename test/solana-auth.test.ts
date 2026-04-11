import { expect, test } from 'bun:test'
import { generateKeyPairSigner, getBase58Decoder } from '@solana/kit'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { createAuthClient } from 'better-auth/client'
import { convertSetCookieToCookie } from 'better-auth/test'
import { createSIWSMessage, siwsClient } from '../src/client.ts'
import { SIWS_ERROR_CODES } from '../src/error-codes.ts'
import { siws } from '../src/index.ts'
import type { SIWSGetNonceFn, SIWSProfileLookupFn } from '../src/shared.ts'
import { formatSIWSMessage, serializeSIWSChallenge } from '../src/siws.ts'
import { linkSIWSWallet } from '../src/solana-auth.ts'
import { generateNonce, type VerifySolanaSignatureFn } from '../src/verify-signature.ts'

interface AccountRow {
  accountId: string
  providerId: string
  userId: string
}

interface SIWSTestClient {
  getSession(): Promise<{ data?: { user: { id: string } } | null }>
  signUp: {
    email(args: { email: string; name: string; password: string }): Promise<{
      data?: Record<string, unknown> | null
    }>
  }
  signIn: {
    email(args: { email: string; password: string }): Promise<{
      data?: Record<string, unknown> | null
    }>
  }
  signOut(): Promise<{
    data?: Record<string, unknown> | null
  }>
  siws: {
    link(args: { message: string; signature: string; walletAddress: string }): Promise<{
      data?: {
        success: true
        user: {
          id: string
          walletAddress: string
        }
      } | null
    }>
    nonce(args: { walletAddress: string }): Promise<{
      data?: {
        domain: string
        expirationTime: string
        issuedAt: string
        nonce: string
        uri: string
      } | null
    }>
    verify(args: { email?: string; message: string; signature: string; walletAddress: string }): Promise<{
      data?: {
        success: true
        token: string
        user: {
          id: string
          walletAddress: string
        }
      } | null
    }>
  }
}

interface MemoryDB {
  [model: string]: Record<string, unknown>[]
}

interface SolanaWalletRow {
  address: string
  isPrimary: boolean
  userId: string
}

interface UserRow {
  email: string
  id: string
  image: string
  name: string
}

interface VerificationRow {
  expiresAt: Date
  identifier: string
}

function createCookieJarFetch(handler: (request: Request) => Promise<Response>) {
  const cookieJar = new Headers()

  return async (input: Request | URL | string, init?: RequestInit) => {
    const request =
      input instanceof Request ? input : new Request(typeof input === 'string' ? input : input.toString(), init)
    const requestHeaders = new Headers(cookieJar)
    const extraHeaders = new Headers(request.headers)

    extraHeaders.forEach((value, key) => {
      requestHeaders.set(key, value)
    })

    const response = await handler(
      new Request(request.url, {
        body: request.body,
        duplex: 'half',
        headers: requestHeaders,
        method: request.method,
      }),
    )
    const responseHeaders = new Headers()
    const currentCookies = cookieJar.get('cookie')

    if (currentCookies) {
      responseHeaders.set('cookie', currentCookies)
    }

    response.headers.forEach((value, key) => {
      responseHeaders.append(key, value)
    })

    convertSetCookieToCookie(responseHeaders)

    const cookie = responseHeaders.get('cookie')

    if (cookie) {
      cookieJar.set('cookie', cookie)
    }

    return response
  }
}

function createHarnessClient(handler: (request: Request) => Promise<Response>) {
  const customFetchImpl = createCookieJarFetch(handler)
  const authClient = createAuthClient({
    baseURL: 'https://example.com/api/auth',
    fetchOptions: {
      customFetchImpl,
    },
    plugins: [siwsClient()],
  }) as unknown as SIWSTestClient

  return {
    authClient,
    customFetchImpl,
  }
}

async function createHarness(options?: {
  anonymous?: boolean
  emailDomainName?: string
  getNonce?: SIWSGetNonceFn
  nonceExpirationMs?: number
  profileLookup?: SIWSProfileLookupFn
  uri?: string
  verifySignature?: VerifySolanaSignatureFn
}) {
  const db: MemoryDB = {
    account: [],
    session: [],
    solanaWallet: [],
    user: [],
    verification: [],
  }
  const auth = betterAuth({
    baseURL: 'https://example.com',
    database: memoryAdapter(db),
    emailAndPassword: {
      enabled: true,
    },
    plugins: [
      siws({
        anonymous: options?.anonymous,
        domain: 'example.com',
        emailDomainName: options?.emailDomainName,
        getNonce: options?.getNonce,
        nonceExpirationMs: options?.nonceExpirationMs,
        profileLookup: options?.profileLookup,
        uri: options?.uri,
        verifySignature: options?.verifySignature,
      }),
    ],
    rateLimit: {
      enabled: false,
    },
    secret: 'better-auth-secret-that-is-long-enough-for-validation-test',
  })
  const client = createHarnessClient(auth.handler)

  return {
    auth,
    authClient: client.authClient,
    createClient: () => createHarnessClient(auth.handler),
    customFetchImpl: client.customFetchImpl,
    db,
  }
}

function getRows<T>(db: MemoryDB, model: string) {
  return (db[model] ?? []) as T[]
}

function createMessage(args: {
  address: string
  challenge: {
    domain: string
    expirationTime: string
    issuedAt: string
    nonce: string
    uri: string
  }
  statement?: string
}) {
  return createSIWSMessage({
    address: args.address,
    challenge: args.challenge,
    statement: args.statement ?? 'Sign in to Example',
  })
}

async function signMessage(args: {
  address: string
  message: string
  signer: Awaited<ReturnType<typeof generateKeyPairSigner>>
}) {
  const signedMessages = await args.signer.signMessages([
    {
      content: new TextEncoder().encode(args.message),
      signatures: {},
    },
  ])
  const signedOutput = signedMessages[0] as Record<string, Record<number, number> | Uint8Array>
  const rawSignature = signedOutput[args.address]

  if (!rawSignature) {
    throw new Error('Missing signed message output')
  }

  return getBase58Decoder().decode(
    rawSignature instanceof Uint8Array ? rawSignature : Uint8Array.from(Object.values(rawSignature)),
  )
}

async function signIn(args: {
  authClient: SIWSTestClient
  email?: string
  signer?: Awaited<ReturnType<typeof generateKeyPairSigner>>
}) {
  const signer = args.signer ?? (await generateKeyPairSigner())
  const address = signer.address
  const nonceResult = await args.authClient.siws.nonce({
    walletAddress: address,
  })

  if (!nonceResult.data) {
    throw new Error('Expected SIWS nonce response')
  }

  const message = createMessage({
    address,
    challenge: nonceResult.data,
  })
  const signature = await signMessage({
    address,
    message,
    signer,
  })
  const verifyResult = await args.authClient.siws.verify({
    email: args.email,
    message,
    signature,
    walletAddress: address,
  })

  if (!verifyResult.data) {
    throw new Error('Expected SIWS verify response')
  }

  return {
    address,
    verifyResult: verifyResult.data,
  }
}

async function createSignedInEmailUser(args: {
  authClient: SIWSTestClient
  email?: string
  name?: string
  password?: string
}) {
  const email = args.email ?? 'alice@example.com'
  const name = args.name ?? 'Alice'
  const password = args.password ?? 'password1234'

  await args.authClient.signUp.email({
    email,
    name,
    password,
  })
  const session = await args.authClient.getSession()

  if (!session.data?.user.id) {
    await args.authClient.signIn.email({
      email,
      password,
    })
  }

  return {
    email,
    name,
    password,
  }
}

async function linkWallet(args: {
  authClient: SIWSTestClient
  signer?: Awaited<ReturnType<typeof generateKeyPairSigner>>
}) {
  const signer = args.signer ?? (await generateKeyPairSigner())
  const address = signer.address
  const nonceResult = await args.authClient.siws.nonce({
    walletAddress: address,
  })

  if (!nonceResult.data) {
    throw new Error('Expected SIWS nonce response')
  }

  const message = createMessage({
    address,
    challenge: nonceResult.data,
  })
  const signature = await signMessage({
    address,
    message,
    signer,
  })
  const linkResult = await args.authClient.siws.link({
    message,
    signature,
    walletAddress: address,
  })

  if (!linkResult.data) {
    throw new Error('Expected SIWS link response')
  }

  return {
    address,
    linkResult: linkResult.data,
  }
}

async function postJSON(args: {
  body: Record<string, unknown>
  customFetchImpl: (url: string, init?: RequestInit) => Promise<Response>
  path: string
}) {
  const response = await args.customFetchImpl(`https://example.com/api/auth${args.path}`, {
    body: JSON.stringify(args.body),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  return {
    data: (await response.json()) as Record<string, unknown>,
    response,
  }
}

test('generates a hex nonce with the requested length', () => {
  expect(generateNonce(17)).toMatch(/^[0-9a-f]{17}$/)
})

test('uses the configured getNonce hook for nonce issuance', async () => {
  let callCount = 0
  const customNonce = 'custom-nonce'
  const harness = await createHarness({
    getNonce: async () => {
      callCount += 1

      return customNonce
    },
  })
  const signer = await generateKeyPairSigner()
  const nonceResult = await harness.authClient.siws.nonce({
    walletAddress: signer.address,
  })

  expect(callCount).toBe(1)
  expect(nonceResult.data?.nonce).toBe(customNonce)
})

test('uses the Better Auth base URL for nonce issuance when uri is not configured', async () => {
  const harness = await createHarness()
  const signer = await generateKeyPairSigner()
  const nonceResult = await harness.authClient.siws.nonce({
    walletAddress: signer.address,
  })

  expect(nonceResult.data?.uri).toBe('https://example.com/api/auth')
})

test('uses the configured uri for nonce issuance', async () => {
  const customURI = 'https://example.com/custom-auth'
  const harness = await createHarness({
    uri: customURI,
  })
  const signer = await generateKeyPairSigner()
  const nonceResult = await harness.authClient.siws.nonce({
    walletAddress: signer.address,
  })

  expect(nonceResult.data?.uri).toBe(customURI)
})

test('falls back to the Better Auth base URL when the configured uri is empty', async () => {
  const harness = await createHarness({
    uri: '',
  })
  const signer = await generateKeyPairSigner()
  const nonceResult = await harness.authClient.siws.nonce({
    walletAddress: signer.address,
  })

  expect(nonceResult.data?.uri).toBe('https://example.com/api/auth')
})

test('uses the configured verifySignature hook for verify', async () => {
  const calls: Array<{
    address: string
    message: string
    signature: string
  }> = []
  const harness = await createHarness({
    verifySignature: async (args) => {
      calls.push(args)

      return true
    },
  })
  const signer = await generateKeyPairSigner()
  const invalidSignatureSigner = await generateKeyPairSigner()
  const nonceResult = await harness.authClient.siws.nonce({
    walletAddress: signer.address,
  })

  if (!nonceResult.data) {
    throw new Error('Expected SIWS nonce response')
  }

  const message = createMessage({
    address: signer.address,
    challenge: nonceResult.data,
  })
  const signature = await signMessage({
    address: invalidSignatureSigner.address,
    message,
    signer: invalidSignatureSigner,
  })
  const verifyResult = await harness.authClient.siws.verify({
    message,
    signature,
    walletAddress: signer.address,
  })

  expect(verifyResult.data?.success).toBe(true)
  expect(calls).toEqual([
    {
      address: signer.address,
      message,
      signature,
    },
  ])
})

test('uses the configured verifySignature hook for link', async () => {
  const calls: Array<{
    address: string
    message: string
    signature: string
  }> = []
  const harness = await createHarness({
    verifySignature: async (args) => {
      calls.push(args)

      return true
    },
  })
  const signer = await generateKeyPairSigner()
  const invalidSignatureSigner = await generateKeyPairSigner()

  await createSignedInEmailUser({
    authClient: harness.authClient,
  })

  const nonceResult = await harness.authClient.siws.nonce({
    walletAddress: signer.address,
  })

  if (!nonceResult.data) {
    throw new Error('Expected SIWS nonce response')
  }

  const message = createMessage({
    address: signer.address,
    challenge: nonceResult.data,
  })
  const signature = await signMessage({
    address: invalidSignatureSigner.address,
    message,
    signer: invalidSignatureSigner,
  })
  const linkResult = await harness.authClient.siws.link({
    message,
    signature,
    walletAddress: signer.address,
  })

  expect(linkResult.data?.success).toBe(true)
  expect(calls).toEqual([
    {
      address: signer.address,
      message,
      signature,
    },
  ])
})

test('linkSIWSWallet uses the transaction adapter for wallet writes', async () => {
  interface TransactionAdapter {
    create(args: { data: Record<string, unknown>; model: string }): Promise<Record<string, unknown>>
    findOne(args: { model: string }): Promise<null>
    transaction<R>(callback: (adapter: TransactionAdapter) => Promise<R>): Promise<R>
  }

  const signer = await generateKeyPairSigner()
  const address = signer.address
  const adapterCalls: string[] = []
  const deletedIdentifiers: string[] = []
  const now = new Date()
  const challenge = {
    domain: 'example.com',
    expirationTime: new Date(now.getTime() + 60_000).toISOString(),
    issuedAt: now.toISOString(),
    nonce: 'transaction-test-nonce',
    uri: 'https://example.com/api/auth',
  }
  const message = createMessage({
    address,
    challenge,
  })
  const transactionAdapter: TransactionAdapter = {
    create: async (args: { data: Record<string, unknown>; model: string }) => {
      adapterCalls.push(`transaction:create:${args.model}`)

      return args.data
    },
    findOne: async (args: { model: string }) => {
      adapterCalls.push(`transaction:findOne:${args.model}`)

      return null
    },
    transaction: async <R>(callback: (adapter: TransactionAdapter) => Promise<R>) => callback(transactionAdapter),
  }
  const baseAdapter = {
    create: async (args: { model: string }) => {
      adapterCalls.push(`base:create:${args.model}`)
      throw new Error('Expected transaction adapter to handle wallet creation')
    },
    findOne: async (args: { model: string }) => {
      adapterCalls.push(`base:findOne:${args.model}`)
      throw new Error('Expected transaction adapter to handle wallet reads')
    },
    transaction: async <R>(callback: (adapter: TransactionAdapter) => Promise<R>) => {
      adapterCalls.push('base:transaction')

      return callback(transactionAdapter)
    },
  }

  const result = await linkSIWSWallet({
    context: {
      adapter: baseAdapter as never,
      baseURL: 'https://example.com/api/auth',
      internalAdapter: {
        createAccount: async () => {
          throw new Error('Unexpected createAccount call')
        },
        createSession: async () => {
          throw new Error('Unexpected createSession call')
        },
        createUser: async () => {
          throw new Error('Unexpected createUser call')
        },
        createVerificationValue: async () => {
          throw new Error('Unexpected createVerificationValue call')
        },
        deleteUser: async () => {
          throw new Error('Unexpected deleteUser call')
        },
        deleteVerificationByIdentifier: async (identifier) => {
          deletedIdentifiers.push(identifier)
        },
        findAccountByProviderId: async () => null,
        findUserById: async () => null,
        findVerificationValue: async () => ({
          expiresAt: new Date(now.getTime() + 60_000),
          id: 'verification-id',
          value: serializeSIWSChallenge(challenge),
        }),
      },
    },
    message,
    signature: 'unused-signature',
    userId: 'user-1',
    verifySignature: async () => true,
    walletAddress: address,
  })

  expect(result).toEqual({
    success: true,
    user: {
      id: 'user-1',
      walletAddress: address,
    },
  })
  expect(adapterCalls).toContain('base:transaction')
  expect(adapterCalls).not.toContain('base:create:account')
  expect(adapterCalls).not.toContain('base:create:solanaWallet')
  expect(adapterCalls).not.toContain('base:findOne:account')
  expect(adapterCalls).not.toContain('base:findOne:solanaWallet')
  expect(adapterCalls.filter((value) => value === 'transaction:create:account')).toHaveLength(1)
  expect(adapterCalls.filter((value) => value === 'transaction:create:solanaWallet')).toHaveLength(1)
  expect(adapterCalls.filter((value) => value === 'transaction:findOne:account')).toHaveLength(1)
  expect(adapterCalls.filter((value) => value === 'transaction:findOne:solanaWallet')).toHaveLength(2)
  expect(deletedIdentifiers).toEqual([`siws:${address}`])
})
test('authClient.siws.nonce and verify create a native Better Auth session, wallet, and account', async () => {
  const harness = await createHarness()
  const signInResult = await signIn({
    authClient: harness.authClient,
  })
  const account = getRows<AccountRow>(harness.db, 'account').find(
    (value) => value.accountId === signInResult.address && value.providerId === 'siws',
  )
  const sessionResult = await harness.authClient.getSession()
  const user = getRows<UserRow>(harness.db, 'user').find((value) => value.id === signInResult.verifyResult.user.id)
  const wallet = getRows<SolanaWalletRow>(harness.db, 'solanaWallet').find(
    (value) => value.address === signInResult.address,
  )

  expect(signInResult.verifyResult).toEqual({
    success: true,
    token: expect.any(String),
    user: {
      id: expect.any(String),
      walletAddress: signInResult.address,
    },
  })
  expect(account).toMatchObject({
    accountId: signInResult.address,
    providerId: 'siws',
    userId: signInResult.verifyResult.user.id,
  })
  expect(sessionResult.data?.user.id).toBe(signInResult.verifyResult.user.id)
  expect(user).toMatchObject({
    email: `${signInResult.address.toLowerCase()}@example.com`,
    id: signInResult.verifyResult.user.id,
    name: signInResult.address,
  })
  expect(wallet).toMatchObject({
    address: signInResult.address,
    isPrimary: true,
    userId: signInResult.verifyResult.user.id,
  })
})

test('re-signing the same address reuses the same user and does not duplicate wallet or account rows', async () => {
  const harness = await createHarness()
  const signer = await generateKeyPairSigner()
  const firstResult = await signIn({
    authClient: harness.authClient,
    signer,
  })
  const secondResult = await signIn({
    authClient: harness.authClient,
    signer,
  })
  const accounts = getRows<AccountRow>(harness.db, 'account').filter(
    (value) => value.providerId === 'siws' && value.userId === firstResult.verifyResult.user.id,
  )
  const wallets = getRows<SolanaWalletRow>(harness.db, 'solanaWallet').filter(
    (value) => value.userId === firstResult.verifyResult.user.id,
  )

  expect(secondResult.verifyResult.user.id).toBe(firstResult.verifyResult.user.id)
  expect(accounts).toHaveLength(1)
  expect(wallets).toHaveLength(1)
})

test('authClient.siws.link links a wallet to the current authenticated user without replacing the session', async () => {
  const harness = await createHarness()

  await createSignedInEmailUser({
    authClient: harness.authClient,
  })

  const sessionBeforeLink = await harness.authClient.getSession()
  const linkedUserId = sessionBeforeLink.data?.user.id

  if (!linkedUserId) {
    throw new Error('Expected authenticated session before linking a wallet')
  }

  const linkResult = await linkWallet({
    authClient: harness.authClient,
  })
  const accounts = getRows<AccountRow>(harness.db, 'account').filter((value) => value.providerId === 'siws')
  const sessionAfterLink = await harness.authClient.getSession()
  const sessions = getRows<Record<string, unknown>>(harness.db, 'session')
  const wallets = getRows<SolanaWalletRow>(harness.db, 'solanaWallet')

  expect(linkResult.linkResult).toEqual({
    success: true,
    user: {
      id: linkedUserId,
      walletAddress: linkResult.address,
    },
  })
  expect(accounts).toEqual([
    expect.objectContaining({
      accountId: linkResult.address,
      providerId: 'siws',
      userId: linkedUserId,
    }),
  ])
  expect(sessionAfterLink.data?.user.id).toBe(linkedUserId)
  expect(sessions).toHaveLength(1)
  expect(wallets).toEqual([
    expect.objectContaining({
      address: linkResult.address,
      isPrimary: true,
      userId: linkedUserId,
    }),
  ])
})

test('re-linking the same address for the current user is a no-op', async () => {
  const harness = await createHarness()
  const signer = await generateKeyPairSigner()

  await createSignedInEmailUser({
    authClient: harness.authClient,
  })

  const firstLink = await linkWallet({
    authClient: harness.authClient,
    signer,
  })
  const secondLink = await linkWallet({
    authClient: harness.authClient,
    signer,
  })
  const accounts = getRows<AccountRow>(harness.db, 'account').filter((value) => value.providerId === 'siws')
  const wallets = getRows<SolanaWalletRow>(harness.db, 'solanaWallet')

  expect(secondLink.linkResult.user.id).toBe(firstLink.linkResult.user.id)
  expect(accounts).toHaveLength(1)
  expect(wallets).toHaveLength(1)
})

test('linking rejects wallets that already belong to another user', async () => {
  const harness = await createHarness()
  const secondClient = harness.createClient()
  const signer = await generateKeyPairSigner()

  await signIn({
    authClient: harness.authClient,
    signer,
  })

  await createSignedInEmailUser({
    authClient: secondClient.authClient,
    email: 'bob@example.com',
    name: 'Bob',
  })

  const nonceResult = await secondClient.authClient.siws.nonce({
    walletAddress: signer.address,
  })

  if (!nonceResult.data) {
    throw new Error('Expected SIWS nonce response')
  }

  const message = createMessage({
    address: signer.address,
    challenge: nonceResult.data,
  })
  const signature = await signMessage({
    address: signer.address,
    message,
    signer,
  })
  const { data, response } = await postJSON({
    body: {
      message,
      signature,
      walletAddress: signer.address,
    },
    customFetchImpl: secondClient.customFetchImpl,
    path: '/siws/link',
  })

  expect(response.status).toBe(409)
  expect(data.code).toBe(SIWS_ERROR_CODES.WALLET_ALREADY_LINKED_TO_ANOTHER_USER.code)
})

test('returns a stable error code when email is missing and anonymous mode is disabled', async () => {
  const harness = await createHarness({
    anonymous: false,
  })
  const signer = await generateKeyPairSigner()
  const nonceResult = await harness.authClient.siws.nonce({
    walletAddress: signer.address,
  })

  if (!nonceResult.data) {
    throw new Error('Expected SIWS nonce response')
  }

  const message = createMessage({
    address: signer.address,
    challenge: nonceResult.data,
  })
  const signature = await signMessage({
    address: signer.address,
    message,
    signer,
  })
  const { data, response } = await postJSON({
    body: {
      message,
      signature,
      walletAddress: signer.address,
    },
    customFetchImpl: harness.customFetchImpl,
    path: '/siws/verify',
  })

  expect(response.status).toBe(400)
  expect(data.code).toBe(SIWS_ERROR_CODES.EMAIL_REQUIRED.code)
})

test('returns a stable error code when the nonce is invalid or expired', async () => {
  const harness = await createHarness()
  const signer = await generateKeyPairSigner()
  const invalidNonceMessage = formatSIWSMessage({
    address: signer.address,
    domain: 'example.com',
    expirationTime: '2026-03-11T00:15:00.000Z',
    issuedAt: '2026-03-11T00:00:00.000Z',
    nonce: 'missing-nonce',
    statement: 'Sign in to Example',
    uri: 'https://example.com/api/auth',
    version: '1',
  })
  const invalidNonceSignature = await signMessage({
    address: signer.address,
    message: invalidNonceMessage,
    signer,
  })
  const invalidNonceResult = await postJSON({
    body: {
      message: invalidNonceMessage,
      signature: invalidNonceSignature,
      walletAddress: signer.address,
    },
    customFetchImpl: harness.customFetchImpl,
    path: '/siws/verify',
  })
  const nonceResult = await harness.authClient.siws.nonce({
    walletAddress: signer.address,
  })

  if (!nonceResult.data) {
    throw new Error('Expected SIWS nonce response')
  }

  const identifier = `siws:${signer.address}`
  const message = createMessage({
    address: signer.address,
    challenge: nonceResult.data,
  })
  const signature = await signMessage({
    address: signer.address,
    message,
    signer,
  })

  const verification = getRows<VerificationRow>(harness.db, 'verification').find(
    (value) => value.identifier === identifier,
  )

  if (!verification) {
    throw new Error('Expected verification row')
  }

  verification.expiresAt = new Date(Date.now() - 1)

  const expiredNonceResult = await postJSON({
    body: {
      message,
      signature,
      walletAddress: signer.address,
    },
    customFetchImpl: harness.customFetchImpl,
    path: '/siws/verify',
  })

  expect(invalidNonceResult.response.status).toBe(401)
  expect(invalidNonceResult.data.code).toBe(SIWS_ERROR_CODES.INVALID_OR_EXPIRED_NONCE.code)
  expect(expiredNonceResult.response.status).toBe(401)
  expect(expiredNonceResult.data.code).toBe(SIWS_ERROR_CODES.INVALID_OR_EXPIRED_NONCE.code)
})

test('returns stable error codes for mismatched messages and invalid signatures', async () => {
  const harness = await createHarness()
  const signer = await generateKeyPairSigner()
  const nonceResult = await harness.authClient.siws.nonce({
    walletAddress: signer.address,
  })

  if (!nonceResult.data) {
    throw new Error('Expected SIWS nonce response')
  }

  const mismatchedMessage = createMessage({
    address: signer.address,
    challenge: {
      ...nonceResult.data,
      nonce: 'different-nonce',
    },
  })
  const mismatchedSignature = await signMessage({
    address: signer.address,
    message: mismatchedMessage,
    signer,
  })
  const mismatchedResult = await postJSON({
    body: {
      message: mismatchedMessage,
      signature: mismatchedSignature,
      walletAddress: signer.address,
    },
    customFetchImpl: harness.customFetchImpl,
    path: '/siws/verify',
  })
  const validMessage = createMessage({
    address: signer.address,
    challenge: nonceResult.data,
  })
  const invalidSignatureSigner = await generateKeyPairSigner()
  const invalidSignature = await signMessage({
    address: invalidSignatureSigner.address,
    message: validMessage,
    signer: invalidSignatureSigner,
  })
  const invalidSignatureResult = await postJSON({
    body: {
      message: validMessage,
      signature: invalidSignature,
      walletAddress: signer.address,
    },
    customFetchImpl: harness.customFetchImpl,
    path: '/siws/verify',
  })

  expect(mismatchedResult.response.status).toBe(401)
  expect(mismatchedResult.data.code).toBe(SIWS_ERROR_CODES.MESSAGE_MISMATCH.code)
  expect(invalidSignatureResult.response.status).toBe(401)
  expect(invalidSignatureResult.data.code).toBe(SIWS_ERROR_CODES.INVALID_SIGNATURE.code)
})

test('uses the Better Auth base URL host for generated fallback emails', async () => {
  const harness = await createHarness()
  const signInResult = await signIn({
    authClient: harness.authClient,
  })
  const user = getRows<UserRow>(harness.db, 'user').find((value) => value.id === signInResult.verifyResult.user.id)

  expect(user?.email).toBe(`${signInResult.address.toLowerCase()}@example.com`)
})

test('uses profileLookup only when creating a brand-new SIWS user', async () => {
  let callCount = 0
  const signer = await generateKeyPairSigner()
  const harness = await createHarness({
    profileLookup: async ({ walletAddress }) => {
      callCount += 1

      return {
        avatar: 'https://example.com/avatar.png',
        name: `Wallet ${walletAddress}`,
      }
    },
  })
  const firstResult = await signIn({
    authClient: harness.authClient,
    signer,
  })
  const secondResult = await signIn({
    authClient: harness.authClient,
    signer,
  })
  const user = getRows<UserRow>(harness.db, 'user').find((value) => value.id === firstResult.verifyResult.user.id)

  expect(callCount).toBe(1)
  expect(secondResult.verifyResult.user.id).toBe(firstResult.verifyResult.user.id)
  expect(user).toMatchObject({
    image: 'https://example.com/avatar.png',
    name: `Wallet ${signer.address}`,
  })
})

test('verify does not leave partial user, wallet, or account rows behind when session creation fails', async () => {
  expect.assertions(4)

  const harness = await createHarness()
  const authContext = await harness.auth.$context
  const originalCreateSession = authContext.internalAdapter.createSession

  try {
    authContext.internalAdapter.createSession = async () => {
      throw new Error('session creation failed')
    }

    const signer = await generateKeyPairSigner()
    const nonceResult = await harness.authClient.siws.nonce({
      walletAddress: signer.address,
    })

    if (!nonceResult.data) {
      throw new Error('Expected SIWS nonce response')
    }

    const message = createMessage({
      address: signer.address,
      challenge: nonceResult.data,
    })
    const signature = await signMessage({
      address: signer.address,
      message,
      signer,
    })
    const response = await harness.customFetchImpl('https://example.com/api/auth/siws/verify', {
      body: JSON.stringify({
        message,
        signature,
        walletAddress: signer.address,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    })

    expect(response.status).toBe(500)
    expect(getRows<AccountRow>(harness.db, 'account')).toHaveLength(0)
    expect(getRows<SolanaWalletRow>(harness.db, 'solanaWallet')).toHaveLength(0)
    expect(getRows<UserRow>(harness.db, 'user')).toHaveLength(0)
  } finally {
    authContext.internalAdapter.createSession = originalCreateSession
  }
})

test('verify keeps a recreated SIWS account when session creation fails for an existing wallet', async () => {
  expect.assertions(4)

  const harness = await createHarness()
  const signer = await generateKeyPairSigner()
  const signInResult = await signIn({
    authClient: harness.authClient,
    signer,
  })
  const authContext = await harness.auth.$context
  const originalCreateSession = authContext.internalAdapter.createSession
  const verifyClient = harness.createClient()
  const accounts = getRows<AccountRow>(harness.db, 'account')

  accounts.splice(
    0,
    accounts.length,
    ...accounts.filter(
      (value) =>
        !(
          value.accountId === signer.address &&
          value.providerId === 'siws' &&
          value.userId === signInResult.verifyResult.user.id
        ),
    ),
  )

  try {
    authContext.internalAdapter.createSession = async () => {
      throw new Error('session creation failed')
    }

    const nonceResult = await verifyClient.authClient.siws.nonce({
      walletAddress: signer.address,
    })

    if (!nonceResult.data) {
      throw new Error('Expected SIWS nonce response')
    }

    const message = createMessage({
      address: signer.address,
      challenge: nonceResult.data,
    })
    const signature = await signMessage({
      address: signer.address,
      message,
      signer,
    })
    const response = await verifyClient.customFetchImpl('https://example.com/api/auth/siws/verify', {
      body: JSON.stringify({
        message,
        signature,
        walletAddress: signer.address,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    })

    expect(response.status).toBe(500)
    expect(getRows<AccountRow>(harness.db, 'account')).toEqual([
      expect.objectContaining({
        accountId: signer.address,
        providerId: 'siws',
        userId: signInResult.verifyResult.user.id,
      }),
    ])
    expect(getRows<SolanaWalletRow>(harness.db, 'solanaWallet')).toEqual([
      expect.objectContaining({
        address: signer.address,
        userId: signInResult.verifyResult.user.id,
      }),
    ])
    expect(getRows<UserRow>(harness.db, 'user')).toEqual([
      expect.objectContaining({
        id: signInResult.verifyResult.user.id,
      }),
    ])
  } finally {
    authContext.internalAdapter.createSession = originalCreateSession
  }
})
