import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createReleaseBundle } from '../../../../scripts/release/artifact-bundle.mjs'
import {
  assertCandidatePublishable,
  materializeReleaseCandidate,
  readReleaseCandidate,
  recordCandidateE2E
} from '../../../../scripts/release/candidate.mjs'

const tempRoots: string[] = []
const previousCandidateRoot = process.env.NCURATOR_RELEASE_CANDIDATE_ROOT

afterEach(async () => {
  if (previousCandidateRoot === undefined) delete process.env.NCURATOR_RELEASE_CANDIDATE_ROOT
  else process.env.NCURATOR_RELEASE_CANDIDATE_ROOT = previousCandidateRoot
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

const createBundle = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-candidate-test-'))
  const candidates = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-candidates-'))
  tempRoots.push(root, candidates)
  process.env.NCURATOR_RELEASE_CANDIDATE_ROOT = candidates
  const assets = [
    { name: 'Ncurator-windows-x64.exe', role: 'installer', content: 'installer' },
    { name: 'Ncurator-windows-x64.exe.blockmap', role: 'update', content: 'blockmap' }
  ]
  for (const asset of assets) await fs.writeFile(path.join(root, asset.name), asset.content)
  const files = assets.map((asset) => ({
    name: asset.name,
    role: asset.role,
    size: Buffer.byteLength(asset.content),
    sha512: createHash('sha512').update(asset.content).digest('base64')
  }))
  const fragment = {
    schemaVersion: 2,
    tag: 'v0.1.21',
    version: '0.1.21',
    platform: 'windows-x64',
    createdAt: new Date().toISOString(),
    files,
    metadata: 'version: 0.1.21\n',
    audit: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      platform: 'win32',
      arch: 'x64',
      applications: [{ root: 'win-unpacked', totalBytes: 10, archiveBytes: 5, archiveFileCount: 1 }]
    }
  }
  const fragmentPath = path.join(root, 'windows-x64.json')
  const bundlePath = path.join(root, 'release-bundle-windows-x64.json')
  await fs.writeFile(fragmentPath, JSON.stringify(fragment))
  await createReleaseBundle({
    fragmentPath,
    outputPath: bundlePath,
    commit: '0123456789012345678901234567890123456789'
  })
  return bundlePath
}

describe('retained release candidate', () => {
  it('requires a ready state before publishing', async () => {
    const bundlePath = await createBundle()
    await materializeReleaseCandidate({ bundlePath })
    await expect(
      assertCandidatePublishable({
        tag: 'v0.1.21',
        platform: 'windows-x64',
        commit: '0123456789012345678901234567890123456789'
      })
    ).rejects.toThrow('is prepared')

    await recordCandidateE2E({ tag: 'v0.1.21', platform: 'windows-x64', status: 'skipped' })
    await expect(
      assertCandidatePublishable({
        tag: 'v0.1.21',
        platform: 'windows-x64',
        commit: '0123456789012345678901234567890123456789'
      })
    ).resolves.toBeDefined()
  })

  it('marks a failed regression as rejected and preserves the same bundle', async () => {
    const bundlePath = await createBundle()
    const prepared = await materializeReleaseCandidate({ bundlePath })
    await recordCandidateE2E({ tag: 'v0.1.21', platform: 'windows-x64', status: 'failed' })
    const rejected = await readReleaseCandidate({ tag: 'v0.1.21', platform: 'windows-x64' })
    expect(rejected.state.status).toBe('rejected')
    expect(rejected.bundlePath).toBe(prepared.bundlePath)
  })
})
