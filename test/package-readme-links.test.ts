import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface NpmPackDryRunResult {
  files: Array<{
    path: string
  }>
}

const REQUIRED_PACKAGED_DOCS = [
  'skills/better-auth-solana/SKILL.md',
  'skills/better-auth-solana/references/backend.md',
  'skills/better-auth-solana/references/react-native-expo.md',
  'skills/better-auth-solana/references/react-web.md',
  'skills/better-auth-solana/references/schema.md',
] as const

function collectRelativeReadmeLinks(readmeContents: string) {
  const links = Array.from(readmeContents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g))
    .map((match) => match[1]?.trim() ?? '')
    .filter((link) => link !== '')
    .map((link) => link.split('#')[0]?.split('?')[0] ?? '')
    .filter((link) => link !== '')
    .filter((link) => !link.startsWith('/'))
    .filter((link) => !/^[a-z][a-z0-9+.-]*:/i.test(link))
    .map((link) => path.posix.normalize(link))

  return Array.from(new Set(links)).sort()
}

async function getPackedFilePaths() {
  const npmCacheDirectory = await mkdtemp(path.join(tmpdir(), 'better-auth-solana-npm-cache-'))

  try {
    const output = await Bun.$`npm --cache ${npmCacheDirectory} pack --dry-run --ignore-scripts --json`.text()
    const [result] = JSON.parse(output) as NpmPackDryRunResult[]

    return (result?.files ?? []).map((file) => file.path).sort()
  } finally {
    await rm(npmCacheDirectory, {
      force: true,
      recursive: true,
    })
  }
}

test('packs the README-linked skill and reference docs for npm consumers', async () => {
  const readmeContents = await Bun.file(fileURLToPath(new URL('../README.md', import.meta.url))).text()
  const readmeLinks = collectRelativeReadmeLinks(readmeContents)
  const packedFilePaths = await getPackedFilePaths()
  const missingPaths = readmeLinks.filter((link) => !packedFilePaths.includes(link))

  for (const requiredPackagedDoc of REQUIRED_PACKAGED_DOCS) {
    expect(readmeLinks).toContain(path.posix.normalize(requiredPackagedDoc))
  }

  expect(missingPaths).toEqual([])
})
