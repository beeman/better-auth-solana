import {
  assertIsAddress,
  assertIsSignature,
  getBase58Encoder,
  getPublicKeyFromAddress,
  signatureBytes,
  verifySignature,
} from '@solana/kit'

export type VerifySolanaSignatureFn = (args: {
  address: string
  message: string
  signature: string
}) => Promise<boolean>

export function generateNonce(length = 16) {
  const randomBytes = new Uint8Array(Math.ceil(length / 2))
  crypto.getRandomValues(randomBytes)

  return Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}

export const verifySolanaSignature: VerifySolanaSignatureFn = async ({ address, message, signature }) => {
  assertIsAddress(address)
  assertIsSignature(signature)

  try {
    const key = await getPublicKeyFromAddress(address)

    return await verifySignature(
      key,
      signatureBytes(getBase58Encoder().encode(signature)),
      new TextEncoder().encode(message),
    )
  } catch {
    return false
  }
}
