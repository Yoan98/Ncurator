import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createGitHubReleasePublisher } from '../../../../scripts/release/github.mjs'
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
  await fs.writeFile(path.join(root, '馆长-0.1.21-Windows-x64.exe'), 'installer')
  await fs.writeFile(path.join(root, '馆长-0.1.21-Windows-x64.exe.blockmap'), 'blockmap')
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
    schemaVersion: 3,
    tag: 'windows-v0.1.21',
    version: '0.1.21',
    platform: 'windows-x64',
    createdAt: new Date().toISOString(),
    files: [
      {
        name: '馆长-0.1.21-Windows-x64.exe',
        storageName: 'Ncurator-windows-x64.exe',
        role: 'installer',
        size: 9,
        sha512: ''
      },
      {
        name: '馆长-0.1.21-Windows-x64.exe.blockmap',
        storageName: 'Ncurator-windows-x64.exe.blockmap',
        role: 'update',
        size: 8,
        sha512: ''
      }
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
      verifyReleaseBundle(bundlePath, { tag: 'windows-v0.1.21', platform: 'windows-x64' })
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
    await fs.appendFile(path.join(root, '馆长-0.1.21-Windows-x64.exe'), 'changed')
    await expect(verifyReleaseBundle(bundlePath)).rejects.toThrow('release asset size changed')
  })
})

type GitHubAsset = {
  name: string
  state: string
  size: number
  digest: string
  browser_download_url: string
}
type GitHubRelease = {
  id: number
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: GitHubAsset[]
  html_url: string
}

const githubHarness = () => {
  const state = {
    commit: '0123456789012345678901234567890123456789',
    release: undefined as GitHubRelease | undefined,
    failUpload: '',
    failPublication: false,
    writes: [] as string[],
    bytes: new Map<string, Buffer>()
  }
  const execute = async (command: string, args: string[]) => {
    expect(command).toBe('gh')
    if (args[0] === 'release' && args[1] === 'view') {
      if (!state.release)
        throw Object.assign(new Error('not found'), { stderr: 'release not found' })
      return { stdout: JSON.stringify({ databaseId: state.release.id }) }
    }
    if (args[0] === 'api') {
      const endpoint = args.at(-1)
      if (endpoint === 'repos/Yoan98/Ncurator') {
        return { stdout: JSON.stringify({ private: false, permissions: { push: true } }) }
      }
      if (endpoint?.includes('/git/ref/')) {
        return { stdout: JSON.stringify({ object: { type: 'tag', sha: 'annotated-tag' } }) }
      }
      if (endpoint?.includes('/git/tags/')) {
        return {
          stdout: JSON.stringify({
            object: { type: 'commit', sha: state.commit },
            message: '修复文件读取'
          })
        }
      }
      if (!state.release) throw Object.assign(new Error('not found'), { stderr: '(HTTP 404)' })
      return { stdout: JSON.stringify(state.release) }
    }
    state.writes.push(args[1])
    if (args[1] === 'create') {
      expect(args).toContain('--verify-tag')
      expect(args).toContain('--draft')
      state.release = {
        id: 7,
        tag_name: args[2],
        draft: true,
        prerelease: false,
        assets: [],
        html_url: `https://github.com/Yoan98/Ncurator/releases/tag/${args[2]}`
      }
    } else if (args[1] === 'upload') {
      expect(args).not.toContain('--clobber')
      const filePath = args.at(-1)!
      const name = path.basename(filePath)
      if (state.failUpload === name) throw new Error('upload interrupted')
      const content = await fs.readFile(filePath)
      const url = `https://github.com/Yoan98/Ncurator/releases/download/${args[2]}/${encodeURIComponent(name)}`
      state.bytes.set(url, content)
      state.release!.assets.push({
        name,
        size: content.length,
        state: 'uploaded',
        digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
        browser_download_url: url
      })
    } else if (args[1] === 'edit') {
      if (state.failPublication) throw new Error('publication interrupted')
      state.release!.draft = false
    } else if (args[1] === 'delete') {
      state.release = undefined
    } else {
      throw new Error(`unexpected command: ${args.join(' ')}`)
    }
    return { stdout: '' }
  }
  const publisher = createGitHubReleasePublisher({
    execute,
    fetchImpl: async (url: string) => {
      const content = state.bytes.get(url)
      return new Response(content ? new Uint8Array(content) : null, { status: content ? 200 : 404 })
    }
  })
  return { state, publisher }
}

const githubCandidate = async () => {
  const directory = await createFixture()
  const bundlePath = path.join(directory, 'release-bundle-windows-x64.json')
  await createReleaseBundle({
    fragmentPath: path.join(directory, 'windows-x64.json'),
    outputPath: bundlePath,
    commit: '0123456789012345678901234567890123456789'
  })
  return { directory, state: { status: 'ready' }, verified: await verifyReleaseBundle(bundlePath) }
}

describe('GitHub release publication', () => {
  const previousConfirmation = process.env.NCURATOR_ALLOW_LIVE_PUBLISH
  beforeEach(() => {
    process.env.NCURATOR_ALLOW_LIVE_PUBLISH = 'publish-to-production'
  })
  afterEach(() => {
    if (previousConfirmation === undefined) delete process.env.NCURATOR_ALLOW_LIVE_PUBLISH
    else process.env.NCURATOR_ALLOW_LIVE_PUBLISH = previousConfirmation
  })

  it('uploads only the tested installer and checksum, then publishes verified public bytes', async () => {
    const { state, publisher } = githubHarness()
    const prepared = await publisher.prepare(await githubCandidate())
    expect(state.release?.draft).toBe(true)
    expect(state.release?.assets.map((asset) => asset.name)).toEqual([
      '馆长-0.1.21-Windows-x64.exe',
      'SHA256SUMS'
    ])
    await publisher.publish(prepared)
    expect(state.release?.draft).toBe(false)
    const writes = [...state.writes]
    await publisher.publish(await publisher.prepare(await githubCandidate()))
    expect(state.writes).toEqual(writes)
  })

  it('stops before any write if source identity or the live gate is invalid', async () => {
    const { state, publisher } = githubHarness()
    state.commit = 'f'.repeat(40)
    await expect(publisher.prepare(await githubCandidate())).rejects.toThrow('does not match')
    expect(state.writes).toEqual([])
    delete process.env.NCURATOR_ALLOW_LIVE_PUBLISH
    await expect(publisher.prepare(await githubCandidate())).rejects.toThrow(
      'live publish is locked'
    )
    expect(state.writes).toEqual([])
  })

  it('resumes an interrupted upload without overwriting the existing installer', async () => {
    const { state, publisher } = githubHarness()
    const candidate = await githubCandidate()
    state.failUpload = 'SHA256SUMS'
    await expect(publisher.prepare(candidate)).rejects.toThrow('upload interrupted')
    expect(state.release?.assets).toHaveLength(1)
    state.failUpload = ''
    await publisher.publish(await publisher.prepare(candidate))
    expect(state.release?.assets).toHaveLength(2)
    expect(state.writes.filter((write) => write === 'create')).toHaveLength(1)
  })

  it('resumes publication after the website stage without creating a second release', async () => {
    const { state, publisher } = githubHarness()
    const candidate = await githubCandidate()
    const prepared = await publisher.prepare(candidate)
    state.failPublication = true
    await expect(publisher.publish(prepared)).rejects.toThrow('publication interrupted')
    state.failPublication = false
    await publisher.publish(await publisher.prepare(candidate))
    expect(state.release?.draft).toBe(false)
    expect(state.writes.filter((write) => write === 'upload')).toHaveLength(2)
  })

  it('refuses mismatched existing assets and detects corrupt public downloads', async () => {
    const { state, publisher } = githubHarness()
    const candidate = await githubCandidate()
    const prepared = await publisher.prepare(candidate)
    state.release!.assets[0].digest = `sha256:${'f'.repeat(64)}`
    await expect(publisher.prepare(candidate)).rejects.toThrow('asset hash differs')
    state.release!.assets[0].digest = `sha256:${candidate.verified.bundle.files[0].sha256}`
    state.bytes.set(state.release!.assets[0].browser_download_url, Buffer.from('corrupted'))
    await expect(publisher.publish(prepared)).rejects.toThrow('public download hash differs')
  })

  it('deletes unpublished drafts on abort and protects published releases', async () => {
    const { publisher } = githubHarness()
    const candidate = await githubCandidate()
    await publisher.prepare(candidate)
    await publisher.deleteDraft(candidate.verified.bundle.tag)
    await publisher.publish(await publisher.prepare(candidate))
    await expect(publisher.deleteDraft(candidate.verified.bundle.tag)).rejects.toThrow(
      'refuse to abort'
    )
  })
})
