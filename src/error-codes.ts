type ErrorCode<K extends string = string> = {
  readonly code: K
  message: string
  toString: () => K
}

function defineErrorCodes<const T extends Record<string, string>>(
  codes: T,
): {
  [K in keyof T & string]: ErrorCode<K>
} {
  return Object.fromEntries(
    Object.entries(codes).map(([key, value]) => [
      key,
      {
        code: key,
        message: value,
        toString: () => key,
      },
    ]),
  ) as {
    [K in keyof T & string]: ErrorCode<K>
  }
}

export const SIWS_ERROR_CODES = defineErrorCodes({
  EMAIL_REQUIRED: 'Email is required when anonymous is disabled.',
  FAILED_TO_CREATE_SESSION: 'Failed to create session.',
  INVALID_CHALLENGE: 'Stored SIWS challenge is invalid.',
  INVALID_OR_EXPIRED_NONCE: 'Invalid or expired nonce. Please request a new nonce.',
  INVALID_SIGNATURE: 'Invalid signature.',
  MESSAGE_MISMATCH: 'Message does not match the issued challenge.',
  USER_NOT_FOUND_FOR_WALLET: 'User not found for wallet.',
  WALLET_ALREADY_LINKED_TO_ANOTHER_USER: 'Wallet is already linked to another user.',
})
