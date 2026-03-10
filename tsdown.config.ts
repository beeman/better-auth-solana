import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    client: 'src/client.ts',
    index: 'src/index.ts',
    schema: 'src/schema.ts',
  },
  format: ['esm', 'cjs'],
  // These transitive modules are intentionally bundled via @solana/kit and
  // @better-auth/core. Keep the allowlist explicit so CI still catches any
  // newly bundled dependencies.
  inlineOnly: ['@solana/addresses', '@solana/keys', '@solana/nominal-types', 'better-call'],
  sourcemap: true,
})
