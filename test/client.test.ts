import { expect, test } from 'bun:test'
import { createSIWSInput, SIWS_ERROR_CODES, siwsClient } from '../src/client.ts'
import { siws } from '../src/index.ts'
import { solanaWalletSchema } from '../src/schema.ts'
import { formatSIWSMessage, parseSIWSMessage } from '../src/siws.ts'

test('exports the siws server, client, and schema entrypoints', () => {
  expect(typeof siws).toBe('function')
  expect(typeof siwsClient).toBe('function')
  expect(SIWS_ERROR_CODES.INVALID_SIGNATURE.code).toBe('INVALID_SIGNATURE')
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
        },
        cluster: {
          required: true,
          type: 'string',
        },
        createdAt: {
          required: true,
          type: 'date',
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

test('creates and parses SIWS message input from the issued challenge', () => {
  const signInInput = createSIWSInput({
    address: 'wallet-address',
    challenge: {
      cluster: 'mainnet',
      domain: 'example.com',
      expirationTime: '2026-03-11T00:15:00.000Z',
      issuedAt: '2026-03-11T00:00:00.000Z',
      nonce: 'nonce-123',
      uri: 'https://example.com/api/auth',
    },
    statement: 'Sign in to Example',
  })
  const message = formatSIWSMessage({
    address: signInInput.address,
    chainId: signInInput.chainId,
    domain: signInInput.domain,
    expirationTime: signInInput.expirationTime,
    issuedAt: signInInput.issuedAt,
    nonce: signInInput.nonce,
    statement: signInInput.statement,
    uri: signInInput.uri,
    version: signInInput.version,
  })

  expect(signInInput).toEqual({
    address: 'wallet-address',
    chainId: 'mainnet',
    domain: 'example.com',
    expirationTime: '2026-03-11T00:15:00.000Z',
    issuedAt: '2026-03-11T00:00:00.000Z',
    nonce: 'nonce-123',
    statement: 'Sign in to Example',
    uri: 'https://example.com/api/auth',
    version: '1',
  })
  expect(parseSIWSMessage(message)).toEqual({
    address: 'wallet-address',
    chainId: 'mainnet',
    domain: 'example.com',
    expirationTime: '2026-03-11T00:15:00.000Z',
    issuedAt: '2026-03-11T00:00:00.000Z',
    nonce: 'nonce-123',
    statement: 'Sign in to Example',
    uri: 'https://example.com/api/auth',
    version: '1',
  })
})
