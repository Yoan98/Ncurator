import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { resolveReleaseAssetPath } from './r2/fragment-contract.mjs'
import { assertLivePublishAllowed } from './storage/config.mjs'
import { parseReleaseTag } from './tag.mjs'
import { fetchWithRetry } from './shared/http.mjs'

export const GITHUB_RELEASE_REPOSITORY = 'Yoan98/Ncurator'
const REPOSITORY_PATH = `repos/${GITHUB_RELEASE_REPOSITORY}`
const REPOSITORY_URL = `https://github.com/${GITHUB_RELEASE_REPOSITORY}`
const execFileAsync = promisify(execFile)
const sha256 = (content) => createHash('sha256').update(content).digest('hex')

export const createGitHubReleasePublisher = ({
  root = process.cwd(),
  execute = execFileAsync,
  fetchImpl = fetchWithRetry
} = {}) => {
  const gh = async (args) => {
    try {
      return await execute('gh', args, {
        cwd: root,
        timeout: 20 * 60_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: '1' }
      })
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(
          'GitHub CLI is missing; install gh and run gh auth login --hostname github.com'
        )
      }
      throw error
    }
  }
  const api = async (endpoint) =>
    JSON.parse((await gh(['api', '--hostname', 'github.com', '--method', 'GET', endpoint])).stdout)
  const releaseArgs = (tag) => [tag, '--repo', `github.com/${GITHUB_RELEASE_REPOSITORY}`]

  const readRelease = async (tag) => {
    try {
      // CLI resolves draft releases too; REST's /releases/tags endpoint only finds published ones.
      const { databaseId } = JSON.parse(
        (await gh(['release', 'view', ...releaseArgs(tag), '--json', 'databaseId'])).stdout
      )
      return await api(`${REPOSITORY_PATH}/releases/${databaseId}`)
    } catch (error) {
      if (/^release not found\s*$/mu.test(String(error.stderr || error.message))) return undefined
      throw error
    }
  }

  const verifySource = async (bundle) => {
    const repository = await api(REPOSITORY_PATH)
    if (repository.private || !repository.permissions?.push) {
      throw new Error(
        `GitHub publication requires write access to public ${GITHUB_RELEASE_REPOSITORY}`
      )
    }
    const reference = await api(`${REPOSITORY_PATH}/git/ref/tags/${bundle.tag}`)
    if (reference.object?.type !== 'tag') {
      throw new Error(`GitHub ${bundle.tag} must be an annotated tag`)
    }
    const tag = await api(`${REPOSITORY_PATH}/git/tags/${reference.object.sha}`)
    if (tag.object?.type !== 'commit' || tag.object.sha !== bundle.commit) {
      throw new Error(`GitHub ${bundle.tag} does not match candidate commit ${bundle.commit}`)
    }
    return tag.message.trim()
  }

  const verifyAssets = async (release, files) => {
    if (!release || release.prerelease || release.assets.length !== files.length) {
      throw new Error('GitHub Release must contain only the installer and SHA256SUMS')
    }
    for (const file of files) {
      const asset = release.assets.find((entry) => entry.name === file.name)
      if (!asset || asset.state !== 'uploaded' || asset.size !== file.size) {
        throw new Error(`GitHub Release asset is missing or incomplete: ${file.name}`)
      }
      if (asset.digest) {
        if (asset.digest !== `sha256:${file.sha256}`) {
          throw new Error(`GitHub Release asset hash differs: ${file.name}`)
        }
      } else {
        // Older GitHub assets may have no digest. Verify their bytes before reusing them.
        const directory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-github-verify-'))
        try {
          await gh([
            'release',
            'download',
            ...releaseArgs(release.tag_name),
            '--pattern',
            file.name,
            '--dir',
            directory
          ])
          const content = await readFile(path.join(directory, file.name))
          if (content.length !== file.size || sha256(content) !== file.sha256) {
            throw new Error(`GitHub Release asset hash differs: ${file.name}`)
          }
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      }
    }
  }

  return {
    async prepare(candidate) {
      assertLivePublishAllowed()
      if (!['ready', 'published'].includes(candidate.state.status)) {
        throw new Error('GitHub publication requires a tested release candidate')
      }
      const { bundle, directory } = candidate.verified
      const annotation = await verifySource(bundle)
      const installer = bundle.files.find((file) => file.role === 'installer')
      const staging = path.join(candidate.directory, 'github')
      await mkdir(staging, { recursive: true })
      const installerPath = await resolveReleaseAssetPath(directory, installer)
      const uploadPath =
        path.basename(installerPath) === installer.name
          ? installerPath
          : path.join(staging, installer.name)
      if (uploadPath !== installerPath) await copyFile(installerPath, uploadPath)
      const sums = `${installer.sha256}  ${installer.name}\n`
      const sumsPath = path.join(staging, 'SHA256SUMS')
      await writeFile(sumsPath, sums, 'utf8')
      const files = [
        { ...installer, path: uploadPath },
        { name: 'SHA256SUMS', path: sumsPath, size: Buffer.byteLength(sums), sha256: sha256(sums) }
      ]
      const { family, version } = parseReleaseTag(bundle.tag)
      const platform = family === 'windows' ? 'Windows x64' : 'macOS arm64'
      const notesPath = path.join(staging, 'release-notes.md')
      await writeFile(
        notesPath,
        [
          annotation,
          '',
          `平台：${platform}。下载下方的 ${family === 'windows' ? 'EXE' : 'DMG'} 安装包。`,
          '安装包与官网下载版本一致；SHA256SUMS 提供 SHA-256 校验值。',
          '',
          `[对应源码](${REPOSITORY_URL}/tree/${bundle.tag}) · [官网更新日志](https://www.guanzhangai.cn/zh/changelog)`,
          ''
        ].join('\n'),
        'utf8'
      )

      let release = await readRelease(bundle.tag)
      if (!release) {
        await gh([
          'release',
          'create',
          ...releaseArgs(bundle.tag),
          '--verify-tag',
          '--draft',
          '--latest=false',
          '--title',
          `馆长 ${version} · ${platform}`,
          '--notes-file',
          notesPath
        ])
        release = await readRelease(bundle.tag)
      }
      if (!release) throw new Error(`GitHub Release draft is missing: ${bundle.tag}`)
      if (release.draft) {
        const expectedNames = new Set(files.map((file) => file.name))
        if (release.prerelease || release.assets.some((asset) => !expectedNames.has(asset.name))) {
          throw new Error('GitHub draft contains unexpected assets or is marked prerelease')
        }
        for (const file of files) {
          const existing = release.assets.find((asset) => asset.name === file.name)
          if (existing?.state === 'starter') {
            await gh(['release', 'delete-asset', ...releaseArgs(bundle.tag), file.name, '--yes'])
          } else if (existing) {
            continue
          }
          await gh(['release', 'upload', ...releaseArgs(bundle.tag), file.path])
        }
        release = await readRelease(bundle.tag)
      }
      await verifyAssets(release, files)
      process.stdout.write(`[release] GitHub assets verified for ${bundle.tag}\n`)
      return { bundle, files, releaseId: release.id }
    },

    async publish(prepared) {
      assertLivePublishAllowed()
      const { bundle, files, releaseId } = prepared
      await verifySource(bundle)
      let release = await readRelease(bundle.tag)
      if (release?.id !== releaseId) throw new Error('GitHub Release changed during publication')
      await verifyAssets(release, files)
      if (release.draft) {
        await gh(['release', 'edit', ...releaseArgs(bundle.tag), '--draft=false', '--latest=false'])
        release = await readRelease(bundle.tag)
      }
      if (!release || release.draft) throw new Error('GitHub Release is not public')
      await verifyAssets(release, files)
      // Anonymous downloads verify that users can fetch the same bytes, independently of CLI auth.
      for (const file of files) {
        const asset = release.assets.find((entry) => entry.name === file.name)
        const response = await fetchImpl(asset.browser_download_url, {
          cache: 'no-store',
          signal: AbortSignal.timeout(20 * 60_000)
        })
        if (!response.ok || !response.body) {
          throw new Error(`GitHub public download failed: ${file.name} (HTTP ${response.status})`)
        }
        const hash = createHash('sha256')
        let size = 0
        for await (const chunk of response.body) {
          size += chunk.length
          hash.update(chunk)
        }
        if (size !== file.size || hash.digest('hex') !== file.sha256) {
          throw new Error(`GitHub public download hash differs: ${file.name}`)
        }
      }
      process.stdout.write(`[release] GitHub ${bundle.tag} is public: ${release.html_url}\n`)
    },

    async deleteDraft(tag) {
      const release = await readRelease(tag)
      if (!release) return
      if (!release.draft) throw new Error(`GitHub ${tag} is published; refuse to abort`)
      await gh(['release', 'delete', ...releaseArgs(tag), '--yes'])
    }
  }
}
