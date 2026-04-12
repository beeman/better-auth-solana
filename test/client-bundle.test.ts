import { expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
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

  const distArtifactNames = (await readdir(fileURLToPath(DIST_DIRECTORY_URL))).sort()
  const esmModule = await import(new URL('../dist/client.mjs', import.meta.url).href)
  const esmArtifactNames = await collectClientArtifactNames('client.mjs')

  expect(distArtifactNames.some((artifactName) => artifactName.endsWith('.cjs'))).toBe(false)
  expect(distArtifactNames.some((artifactName) => artifactName.endsWith('.d.cts'))).toBe(false)
  expect(esmArtifactNames).toContain('client.mjs')
  expect(typeof esmModule.createSIWSInput).toBe('function')
  expect(typeof esmModule.createSIWSMessage).toBe('function')
  expect(typeof esmModule.formatSIWSMessage).toBe('function')
  expect(typeof esmModule.siwsClient).toBe('function')
  expect(esmModule.SIWS_ERROR_CODES.INVALID_SIGNATURE.code).toBe('INVALID_SIGNATURE')

  for (const artifactName of esmArtifactNames) {
    const artifactContents = await Bun.file(fileURLToPath(new URL(artifactName, DIST_DIRECTORY_URL))).text()

    for (const forbiddenImportSpecifier of FORBIDDEN_IMPORT_SPECIFIERS) {
      expect(artifactContents).not.toContain(`"${forbiddenImportSpecifier}"`)
      expect(artifactContents).not.toContain(`'${forbiddenImportSpecifier}'`)
    }
  }
})
