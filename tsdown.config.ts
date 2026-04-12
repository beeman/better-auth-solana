import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  // These transitive modules are intentionally bundled via @solana/kit and
  // Better Auth public exports. Keep the allowlist explicit so CI still catches any
  // newly bundled dependencies.
  deps: {
    onlyBundle: ['@solana/addresses', '@solana/keys', '@solana/nominal-types', 'better-call'],
  },
  dts: true,
  entry: {
    client: 'src/client.ts',
    index: 'src/index.ts',
    schema: 'src/schema.ts',
  },
  format: ['esm'],
  sourcemap: true,
})
