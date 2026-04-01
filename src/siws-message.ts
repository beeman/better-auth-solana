export interface FormatSIWSMessageInput {
  address: string
  domain: string
  expirationTime: string
  issuedAt: string
  nonce: string
  statement?: string
  uri: string
  version?: string
}

export function formatSIWSMessage(input: FormatSIWSMessageInput) {
  const lines = [`${input.domain} wants you to sign in with your Solana account:`, input.address, '']

  if (input.statement) {
    lines.push(input.statement, '')
  }

  lines.push(
    `URI: ${input.uri}`,
    `Version: ${input.version || '1'}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expirationTime}`,
  )

  return lines.join('\n')
}
