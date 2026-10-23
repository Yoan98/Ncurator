import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPackage } from '@electron/asar'
import { describe, expect, it } from 'vitest'
import { readPackagedKnowledgeCacheIdentity } from '../../../../scripts/test/package-app.mjs'

describe('installed knowledge computation identity', () => {
  for (const platform of ['darwin', 'win32']) {
    it(`reads the actual ${platform} archive and rejects legacy or damaged identities`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'ncurator-installed-identity-'))
      try {
        const source = path.join(root, 'source')
        const resources =
          platform === 'darwin'
            ? path.join(root, 'Contents', 'Resources')
            : path.join(root, 'resources')
        await mkdir(path.join(source, 'out', 'main'), { recursive: true })
        await mkdir(resources, { recursive: true })
        await createPackage(source, path.join(resources, 'app.asar'))
        expect(readPackagedKnowledgeCacheIdentity(root, platform)).toBeNull()
        const identity = { split: 'a'.repeat(64), embedding: 'b'.repeat(64) }
        const metadata = path.join(source, 'out', 'main', 'knowledge-cache-identity.json')
        await writeFile(metadata, JSON.stringify(identity))
        await createPackage(source, path.join(resources, 'app.asar'))
        expect(readPackagedKnowledgeCacheIdentity(root, platform)).toEqual(identity)
        await writeFile(metadata, '{"split":"broken"}')
        await createPackage(source, path.join(resources, 'app.asar'))
        expect(readPackagedKnowledgeCacheIdentity(root, platform)).toBeNull()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  }
})
