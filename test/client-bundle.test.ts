import { expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const DIST_DIRECTORY_URL = new URL('../dist/', import.meta.url)
const FORBIDDEN_IMPORT_SPECIFIERS = ['@better-auth/core', 'better-auth', 'zod']

async function collectClientArtifactNames(entryName: string) {
  const visited = new Set<string>()

  async function visit(fileName: string) {
    if (visited.has(fileName)) {
      return
    }

    visited.add(fileName)

    const artifactPath = fileURLToPath(new URL(fileName, DIST_DIRECTORY_URL))
    const artifactContents = await Bun.file(artifactPath).text()
    const importSpecifiers = [
      ...artifactContents.matchAll(/from ['"](\.\/[^'"]+\.(?:cjs|mjs))['"]/g),
      ...artifactContents.matchAll(/require\(['"](\.\/[^'"]+\.(?:cjs|mjs))['"]\)/g),
    ]

    for (const match of importSpecifiers) {
      const importSpecifier = match[1]

      if (!importSpecifier) {
        continue
      }

      await visit(importSpecifier.slice(2))
    }
  }

  await visit(entryName)

  return Array.from(visited).sort()
}

test('builds a published client bundle without server-only runtime imports', async () => {
  await Bun.$`bun run build`

  const esmModule = await import(new URL('../dist/client.mjs', import.meta.url).href)
  const require = createRequire(import.meta.url)
  const cjsModule = require(fileURLToPath(new URL('../dist/client.cjs', import.meta.url)))
  const cjsArtifactNames = await collectClientArtifactNames('client.cjs')
  const esmArtifactNames = await collectClientArtifactNames('client.mjs')

  expect(cjsArtifactNames).toContain('client.cjs')
  expect(typeof esmModule.createSIWSInput).toBe('function')
  expect(typeof esmModule.createSIWSMessage).toBe('function')
  expect(typeof esmModule.formatSIWSMessage).toBe('function')
  expect(typeof esmModule.siwsClient).toBe('function')
  expect(esmModule.SIWS_ERROR_CODES.INVALID_SIGNATURE.code).toBe('INVALID_SIGNATURE')

  expect(typeof cjsModule.createSIWSInput).toBe('function')
  expect(typeof cjsModule.createSIWSMessage).toBe('function')
  expect(typeof cjsModule.formatSIWSMessage).toBe('function')
  expect(typeof cjsModule.siwsClient).toBe('function')
  expect(cjsModule.SIWS_ERROR_CODES.INVALID_SIGNATURE.code).toBe('INVALID_SIGNATURE')

  for (const artifactName of [...cjsArtifactNames, ...esmArtifactNames]) {
    const artifactContents = await Bun.file(fileURLToPath(new URL(artifactName, DIST_DIRECTORY_URL))).text()

    for (const forbiddenImportSpecifier of FORBIDDEN_IMPORT_SPECIFIERS) {
      expect(artifactContents).not.toContain(`"${forbiddenImportSpecifier}"`)
      expect(artifactContents).not.toContain(`'${forbiddenImportSpecifier}'`)
    }
  }
})
