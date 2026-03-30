import { expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const DIST_DIRECTORY_URL = new URL('../dist/', import.meta.url)
const FORBIDDEN_IMPORT_SPECIFIERS = ['@better-auth/core', 'better-auth']

test('builds a published client bundle without server-only runtime imports', async () => {
  await Bun.$`bun run build`

  const esmModule = await import(new URL('../dist/client.mjs', import.meta.url).href)
  const require = createRequire(import.meta.url)
  const cjsModule = require(fileURLToPath(new URL('../dist/client.cjs', import.meta.url)))
  const distEntries = (await readdir(DIST_DIRECTORY_URL)).sort()
  const clientArtifactNames = distEntries.filter((entry) => /^(client|error-codes-.+)\.(cjs|mjs)$/.test(entry))

  expect(clientArtifactNames).toContain('client.cjs')
  expect(clientArtifactNames).toContain('client.mjs')

  expect(typeof esmModule.createSIWSInput).toBe('function')
  expect(typeof esmModule.siwsClient).toBe('function')
  expect(esmModule.SIWS_ERROR_CODES.INVALID_SIGNATURE.code).toBe('INVALID_SIGNATURE')

  expect(typeof cjsModule.createSIWSInput).toBe('function')
  expect(typeof cjsModule.siwsClient).toBe('function')
  expect(cjsModule.SIWS_ERROR_CODES.INVALID_SIGNATURE.code).toBe('INVALID_SIGNATURE')

  for (const artifactName of clientArtifactNames) {
    const artifactPath = fileURLToPath(new URL(artifactName, DIST_DIRECTORY_URL))
    const artifactContents = await Bun.file(artifactPath).text()

    for (const forbiddenImportSpecifier of FORBIDDEN_IMPORT_SPECIFIERS) {
      expect(artifactContents).not.toContain(`"${forbiddenImportSpecifier}"`)
      expect(artifactContents).not.toContain(`'${forbiddenImportSpecifier}'`)
    }
  }
})
