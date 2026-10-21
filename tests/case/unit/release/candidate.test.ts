import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createReleaseBundle } from '../../../../scripts/release/artifact-bundle.mjs'
import {
  assertCandidatePublishable,
  cleanupSupersededReleaseCandidates,
  materializeReleaseCandidate,
  markCandidatePublished,
  readReleaseCandidate,
  recordCandidateE2E,
  resolveCandidateDirectory
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

const createBundle = async ({
  version = '0.1.21',
  candidateRoot,
  distribution = 'domestic',
  sharedAppHash = 'a'.repeat(64)
}: {
  version?: string
  candidateRoot?: string
  distribution?: 'domestic' | 'international'
  sharedAppHash?: string
} = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-candidate-test-'))
  const candidates =
    candidateRoot || (await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-candidates-')))
  tempRoots.push(root)
  if (!candidateRoot) tempRoots.push(candidates)
  process.env.NCURATOR_RELEASE_CANDIDATE_ROOT = candidates
  const name = distribution === 'international' ? 'NCurator' : '馆长'
  const assets = [
    {
      name: `${name}-${version}-Windows-x64.exe`,
      storageName: 'Ncurator-windows-x64.exe',
      role: 'installer',
      content: 'installer'
    },
    {
      name: `${name}-${version}-Windows-x64.exe.blockmap`,
      storageName: 'Ncurator-windows-x64.exe.blockmap',
      role: 'update',
      content: 'blockmap'
    }
  ]
  for (const asset of assets) await fs.writeFile(path.join(root, asset.name), asset.content)
  const files = assets.map((asset) => ({
    name: asset.name,
    storageName: asset.storageName,
    role: asset.role,
    size: Buffer.byteLength(asset.content),
    sha512: createHash('sha512').update(asset.content).digest('base64')
  }))
  const fragment = {
    schemaVersion: 3,
    tag: `windows-v${version}`,
    version,
    platform: 'windows-x64',
    distribution,
    sharedAppHash,
    createdAt: new Date().toISOString(),
    files,
    metadata: `version: ${version}\n`,
    audit: {
      distribution,
      sharedAppHash,
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
        tag: 'windows-v0.1.21',
        platform: 'windows-x64',
        commit: '0123456789012345678901234567890123456789'
      })
    ).rejects.toThrow('is prepared')

    await recordCandidateE2E({
      tag: 'windows-v0.1.21',
      platform: 'windows-x64',
      status: 'passed',
      selection: { mode: 'selected', domain: 'workbench' }
    })
    await expect(
      assertCandidatePublishable({
        tag: 'windows-v0.1.21',
        platform: 'windows-x64',
        commit: '0123456789012345678901234567890123456789'
      })
    ).resolves.toBeDefined()

    const ready = await readReleaseCandidate({
      tag: 'windows-v0.1.21',
      platform: 'windows-x64'
    })
    expect(ready.state.e2e).toMatchObject({
      status: 'passed',
      selection: { mode: 'selected', domain: 'workbench' }
    })
  })

  it('marks a failed regression as rejected and preserves the same bundle', async () => {
    const bundlePath = await createBundle()
    const prepared = await materializeReleaseCandidate({ bundlePath })
    await recordCandidateE2E({
      tag: 'windows-v0.1.21',
      platform: 'windows-x64',
      status: 'failed'
    })
    const rejected = await readReleaseCandidate({
      tag: 'windows-v0.1.21',
      platform: 'windows-x64'
    })
    expect(rejected.state.status).toBe('rejected')
    expect(rejected.bundlePath).toBe(prepared.bundlePath)
  })

  it('permits verified published candidates only for an explicit publish retry', async () => {
    await materializeReleaseCandidate({ bundlePath: await createBundle() })
    await recordCandidateE2E({ tag: 'windows-v0.1.21', platform: 'windows-x64', status: 'passed' })
    await markCandidatePublished({ tag: 'windows-v0.1.21', platform: 'windows-x64' })
    const request = {
      tag: 'windows-v0.1.21',
      platform: 'windows-x64',
      commit: '0123456789012345678901234567890123456789'
    }
    await expect(assertCandidatePublishable(request)).rejects.toThrow('is published')
    await expect(
      assertCandidatePublishable({ ...request, allowPublished: true })
    ).resolves.toBeDefined()
  })

  it('allows an explicitly justified E2E skip to become publishable', async () => {
    const bundlePath = await createBundle()
    await materializeReleaseCandidate({ bundlePath })

    await expect(
      recordCandidateE2E({
        tag: 'windows-v0.1.21',
        platform: 'windows-x64',
        status: 'skipped'
      })
    ).rejects.toThrow('requires a reason')

    await recordCandidateE2E({
      tag: 'windows-v0.1.21',
      platform: 'windows-x64',
      status: 'skipped',
      reason: 'compatibility artifact is published without package E2E',
      selection: { mode: 'disabled-by-default' }
    })

    const candidate = await assertCandidatePublishable({
      tag: 'windows-v0.1.21',
      platform: 'windows-x64',
      commit: '0123456789012345678901234567890123456789'
    })
    expect(candidate.state.e2e).toMatchObject({
      status: 'skipped',
      reason: 'compatibility artifact is published without package E2E',
      selection: { mode: 'disabled-by-default' }
    })
  })

  it('keeps the current and newer candidates while removing superseded versions', async () => {
    const candidateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-candidates-'))
    tempRoots.push(candidateRoot)
    for (const version of ['0.1.20', '0.1.21', '0.1.22']) {
      await materializeReleaseCandidate({
        bundlePath: await createBundle({ version, candidateRoot })
      })
    }

    await expect(
      cleanupSupersededReleaseCandidates({
        tag: 'windows-v0.1.21',
        platforms: ['windows-x64']
      })
    ).resolves.toEqual([path.dirname(resolveCandidateDirectory('windows-v0.1.20', 'windows-x64'))])
    await expect(
      fs.access(resolveCandidateDirectory('windows-v0.1.20', 'windows-x64'))
    ).rejects.toThrow()
    await expect(
      readReleaseCandidate({ tag: 'windows-v0.1.21', platform: 'windows-x64' })
    ).resolves.toBeDefined()
    await expect(
      readReleaseCandidate({ tag: 'windows-v0.1.22', platform: 'windows-x64' })
    ).resolves.toBeDefined()
  })
})

describe('international publication inherits domestic regression', () => {
  it('requires a passed matching domestic candidate and does not claim independent E2E', async () => {
    const candidateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-paired-'))
    tempRoots.push(candidateRoot)
    for (const distribution of ['domestic', 'international'] as const) {
      await materializeReleaseCandidate({
        bundlePath: await createBundle({ candidateRoot, distribution })
      })
    }
    const request = {
      tag: 'windows-v0.1.21',
      platform: 'windows-x64',
      distribution: 'international',
      commit: '0123456789012345678901234567890123456789'
    }
    await expect(assertCandidatePublishable(request)).rejects.toThrow('is prepared')
    await recordCandidateE2E({ tag: request.tag, platform: request.platform, status: 'passed' })
    const international = await assertCandidatePublishable(request)
    expect(international.state.e2e).toMatchObject({
      status: 'skipped',
      sharedAppHash: 'a'.repeat(64)
    })
    expect(international.state.e2e.domesticBundleSha256).toMatch(/^[a-f0-9]{64}$/)
    await materializeReleaseCandidate({
      bundlePath: await createBundle({
        candidateRoot,
        distribution: 'international',
        sharedAppHash: 'b'.repeat(64)
      })
    })
    await expect(assertCandidatePublishable(request)).rejects.toThrow('resources do not match')
  })
})
