import { expect, test } from 'bun:test'
import { createSIWSInput, createSIWSMessage, formatSIWSMessage, SIWS_ERROR_CODES, siwsClient } from '../src/client.ts'
import { siws } from '../src/index.ts'
import { solanaWalletSchema } from '../src/schema.ts'
import { parseSIWSMessage } from '../src/siws.ts'

test('exports the siws server, client, and schema entrypoints', () => {
  expect(typeof createSIWSMessage).toBe('function')
  expect(typeof formatSIWSMessage).toBe('function')
  expect(typeof siws).toBe('function')
  expect(typeof siwsClient).toBe('function')
  expect(SIWS_ERROR_CODES.INVALID_SIGNATURE.code).toBe('INVALID_SIGNATURE')
  expect(SIWS_ERROR_CODES.INVALID_SIGNATURE.toString()).toBe('INVALID_SIGNATURE')
  expect(SIWS_ERROR_CODES.WALLET_ALREADY_LINKED_TO_ANOTHER_USER.code).toBe('WALLET_ALREADY_LINKED_TO_ANOTHER_USER')
  expect(siwsClient()).toMatchObject({
    $ERROR_CODES: SIWS_ERROR_CODES,
    id: 'siws',
  })
  expect(solanaWalletSchema).toEqual({
    solanaWallet: {
      fields: {
        address: {
          required: true,
          type: 'string',
          unique: true,
        },
        createdAt: {
          required: true,
          type: 'date',
        },
        isPrimary: {
          defaultValue: false,
          type: 'boolean',
        },
        userId: {
          index: true,
          references: {
            field: 'id',
            model: 'user',
          },
          required: true,
          type: 'string',
        },
      },
    },
  })
})

test('default schema enforces unique wallet addresses', () => {
  expect(solanaWalletSchema.solanaWallet.fields.address).toEqual({
    required: true,
    type: 'string',
    unique: true,
  })
})

test('creates and parses SIWS message input from the issued challenge', () => {
  const args = {
    address: 'wallet-address',
    challenge: {
      domain: 'example.com',
      expirationTime: '2026-03-11T00:15:00.000Z',
      issuedAt: '2026-03-11T00:00:00.000Z',
      nonce: 'nonce-123',
      uri: 'https://example.com/api/auth',
    },
    statement: 'Sign in to Example',
  }
  const signInInput = createSIWSInput(args)
  const message = createSIWSMessage(args)

  expect(signInInput).toEqual({
    address: 'wallet-address',
    domain: 'example.com',
    expirationTime: '2026-03-11T00:15:00.000Z',
    issuedAt: '2026-03-11T00:00:00.000Z',
    nonce: 'nonce-123',
    statement: 'Sign in to Example',
    uri: 'https://example.com/api/auth',
    version: '1',
  })
  expect(message).toBe(formatSIWSMessage(signInInput))
  expect(parseSIWSMessage(message)).toEqual({
    address: 'wallet-address',
    domain: 'example.com',
    expirationTime: '2026-03-11T00:15:00.000Z',
    issuedAt: '2026-03-11T00:00:00.000Z',
    nonce: 'nonce-123',
    statement: 'Sign in to Example',
    uri: 'https://example.com/api/auth',
    version: '1',
  })
})

test('creates a SIWS message without a statement', () => {
  const signInInput = createSIWSInput({
    address: 'wallet-address',
    challenge: {
      domain: 'example.com',
      expirationTime: '2026-03-11T00:15:00.000Z',
      issuedAt: '2026-03-11T00:00:00.000Z',
      nonce: 'nonce-123',
      uri: 'https://example.com/api/auth',
    },
  })
  const message = createSIWSMessage({
    address: 'wallet-address',
    challenge: {
      domain: 'example.com',
      expirationTime: '2026-03-11T00:15:00.000Z',
      issuedAt: '2026-03-11T00:00:00.000Z',
      nonce: 'nonce-123',
      uri: 'https://example.com/api/auth',
    },
  })

  expect(message).toBe(formatSIWSMessage(signInInput))
  expect(parseSIWSMessage(message)).toEqual({
    address: 'wallet-address',
    domain: 'example.com',
    expirationTime: '2026-03-11T00:15:00.000Z',
    issuedAt: '2026-03-11T00:00:00.000Z',
    nonce: 'nonce-123',
    uri: 'https://example.com/api/auth',
    version: '1',
  })
})

test('formats an empty SIWS version as the default version', () => {
  expect(
    formatSIWSMessage({
      address: 'wallet-address',
      domain: 'example.com',
      expirationTime: '2026-03-11T00:15:00.000Z',
      issuedAt: '2026-03-11T00:00:00.000Z',
      nonce: 'nonce-123',
      uri: 'https://example.com/api/auth',
      version: '',
    }),
  ).toContain('Version: 1')
})
