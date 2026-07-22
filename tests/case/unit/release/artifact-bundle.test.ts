import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createReleaseBundle,
  verifyReleaseBundle
} from '../../../../scripts/release/artifact-bundle.mjs'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

const createFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-release-bundle-'))
  tempRoots.push(root)
  await fs.writeFile(path.join(root, 'Ncurator-windows-x64.exe'), 'installer')
  await fs.writeFile(path.join(root, 'Ncurator-windows-x64.exe.blockmap'), 'blockmap')
  await fs.writeFile(path.join(root, 'latest.yml'), 'version: 0.1.21\n')
  await fs.writeFile(
    path.join(root, 'package-audit.json'),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      platform: 'win32',
      arch: 'x64',
      applications: [{ root: 'win-unpacked', totalBytes: 10, archiveBytes: 5, archiveFileCount: 1 }]
    })
  )
  const fragment = {
    schemaVersion: 2,
    tag: 'v0.1.21',
    version: '0.1.21',
    platform: 'windows-x64',
    createdAt: new Date().toISOString(),
    files: [
      { name: 'Ncurator-windows-x64.exe', role: 'installer', size: 9, sha512: '' },
      { name: 'Ncurator-windows-x64.exe.blockmap', role: 'update', size: 8, sha512: '' }
    ],
    metadata: 'version: 0.1.21\n',
    audit: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      platform: 'win32',
      arch: 'x64',
      applications: [{ root: 'win-unpacked', totalBytes: 10, archiveBytes: 5, archiveFileCount: 1 }]
    }
  }
  const { createHash } = await import('node:crypto')
  for (const file of fragment.files) {
    file.sha512 = createHash('sha512')
      .update(await fs.readFile(path.join(root, file.name)))
      .digest('base64')
  }
  await fs.writeFile(path.join(root, 'windows-x64.json'), JSON.stringify(fragment))
  return root
}

describe('release artifact bundle', () => {
  it('binds the fragment and verifies the original files', async () => {
    const root = await createFixture()
    const bundlePath = path.join(root, 'release-bundle-windows-x64.json')
    await createReleaseBundle({
      fragmentPath: path.join(root, 'windows-x64.json'),
      outputPath: bundlePath,
      commit: '0123456789012345678901234567890123456789'
    })
    await expect(
      verifyReleaseBundle(bundlePath, { tag: 'v0.1.21', platform: 'windows-x64' })
    ).resolves.toBeDefined()
  })

  it('rejects a package changed after bundle creation', async () => {
    const root = await createFixture()
    const bundlePath = path.join(root, 'release-bundle-windows-x64.json')
    await createReleaseBundle({
      fragmentPath: path.join(root, 'windows-x64.json'),
      outputPath: bundlePath,
      commit: '0123456789012345678901234567890123456789'
    })
    await fs.appendFile(path.join(root, 'Ncurator-windows-x64.exe'), 'changed')
    await expect(verifyReleaseBundle(bundlePath)).rejects.toThrow('release asset size changed')
  })
})
