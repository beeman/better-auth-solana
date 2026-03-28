import { z } from 'zod'
import type { SIWSNonceResponse } from './shared.ts'

export interface ParsedSIWSMessage {
  address: string
  domain: string
  expirationTime: string
  issuedAt: string
  nonce: string
  statement?: string
  uri: string
  version: string
}

const fieldSchema = z.object({
  'Expiration Time': z.string().min(1),
  'Issued At': z.string().min(1),
  Nonce: z.string().min(1),
  URI: z.string().min(1),
  Version: z.string().min(1),
})

export function formatSIWSMessage(input: {
  address: string
  domain: string
  expirationTime: string
  issuedAt: string
  nonce: string
  statement?: string
  uri: string
  version?: string
}) {
  const lines = [`${input.domain} wants you to sign in with your Solana account:`, input.address, '']

  if (input.statement) {
    lines.push(input.statement, '')
  }

  lines.push(
    `URI: ${input.uri}`,
    `Version: ${input.version ?? '1'}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expirationTime}`,
  )

  return lines.join('\n')
}

export function parseSIWSMessage(message: string): ParsedSIWSMessage {
  const normalizedMessage = message.replaceAll('\r\n', '\n')
  const lines = normalizedMessage.split('\n')
  const firstLine = lines[0]?.trim()

  if (!firstLine) {
    throw new Error('Missing SIWS header')
  }

  const headerMatch = firstLine.match(/^(?<domain>.+) wants you to sign in with your Solana account:$/)

  if (!headerMatch?.groups?.domain) {
    throw new Error('Invalid SIWS header')
  }

  const address = lines[1]?.trim()

  if (!address) {
    throw new Error('Missing SIWS address')
  }

  const remainingLines = lines.slice(2)
  const fieldStartIndex = remainingLines.findIndex((line) => /^[A-Za-z ]+: /.test(line))

  if (fieldStartIndex === -1) {
    throw new Error('Missing SIWS fields')
  }

  const statementLines = remainingLines.slice(0, fieldStartIndex).join('\n').trim()
  const statement = statementLines.length > 0 ? statementLines : undefined
  const fields = Object.create(null) as Record<string, string>

  for (const line of remainingLines.slice(fieldStartIndex)) {
    if (line === 'Resources:') {
      break
    }

    if (line.trim().length === 0 || line.startsWith('- ')) {
      continue
    }

    const separatorIndex = line.indexOf(': ')

    if (separatorIndex === -1) {
      throw new Error(`Invalid SIWS field line: ${line}`)
    }

    const field = line.slice(0, separatorIndex)
    const value = line.slice(separatorIndex + 2)
    fields[field] = value
  }

  const parsedFields = fieldSchema.parse(fields)

  return {
    address,
    domain: headerMatch.groups.domain,
    expirationTime: parsedFields['Expiration Time'],
    issuedAt: parsedFields['Issued At'],
    nonce: parsedFields.Nonce,
    statement,
    uri: parsedFields.URI,
    version: parsedFields.Version,
  }
}

export function serializeSIWSChallenge(challenge: SIWSNonceResponse) {
  return JSON.stringify(challenge)
}

export function deserializeSIWSChallenge(serializedChallenge: string): SIWSNonceResponse {
  const challenge = JSON.parse(serializedChallenge)

  return z
    .object({
      domain: z.string().min(1),
      expirationTime: z.string().datetime(),
      issuedAt: z.string().datetime(),
      nonce: z.string().min(1),
      uri: z.string().min(1),
    })
    .parse(challenge)
}
