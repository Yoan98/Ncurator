/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from './release-environment.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
await loadReleaseEnvironment(ROOT)
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const releaseTag = valueAfter('--tag') || ''
const waitTimeoutMs = Number(valueAfter('--wait-timeout-ms') || 60 * 60 * 1000)
const keepOld = args.includes('--keep-old')

if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error('usage: node scripts/finalize-r2-release.mjs --tag <v1.2.3> [--keep-old]')
}

for (const name of [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'R2_ACCOUNT_ID',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL'
]) {
  if (!String(process.env[name] || '').trim())
    throw new Error(`missing environment variable: ${name}`)
}

const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
const bucket = String(process.env.R2_BUCKET_NAME).replace(/^\/+|\/+$/gu, '')
const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL).replace(/\/$/u, '')
const localAws = path.join(os.homedir(), '.ncurator', 'release-tools', 'awscli', 'bin', 'aws')
const awsExecutable =
  String(process.env.NCURATOR_AWS_CLI || '').trim() || (existsSync(localAws) ? localAws : 'aws')
if (publicBaseUrl !== 'https://download.ncurator.com') {
  throw new Error(`unexpected R2 public URL: ${publicBaseUrl}`)
}

const aws = async (awsArgs, options = {}) =>
  execFileAsync(awsExecutable, [...awsArgs, '--endpoint-url', endpoint, '--region', 'auto'], {
    maxBuffer: 20 * 1024 * 1024,
    ...options
  })

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const workDirectory = await mkdtemp(path.join(os.tmpdir(), `ncurator-release-${releaseTag}-`))

const downloadFragment = async (platform) => {
  const target = path.join(workDirectory, `${platform}.json`)
  const key = `release-status/${releaseTag}/${platform}.json`
  const deadline = Date.now() + waitTimeoutMs
  while (Date.now() < deadline) {
    try {
      await aws(['s3', 'cp', `s3://${bucket}/${key}`, target, '--no-progress'])
      return JSON.parse(await readFile(target, 'utf8'))
    } catch {
      process.stdout.write(`[release] waiting for ${platform}\n`)
      await delay(15_000)
    }
  }
  throw new Error(`timed out waiting for ${key}`)
}

const verifyFragment = async (fragment, expectedPlatform) => {
  if (
    fragment.schemaVersion !== 1 ||
    fragment.tag !== releaseTag ||
    fragment.platform !== expectedPlatform
  ) {
    throw new Error(`invalid ${expectedPlatform} release fragment`)
  }
  for (const file of fragment.files) {
    const key = `artifacts/${releaseTag}/${file.name}`
    const { stdout } = await aws([
      's3api',
      'head-object',
      '--bucket',
      bucket,
      '--key',
      key,
      '--output',
      'json'
    ])
    const remote = JSON.parse(stdout)
    if (Number(remote.ContentLength) !== file.size || remote.Metadata?.sha512 !== file.sha512) {
      throw new Error(`R2 object does not match release fragment: ${key}`)
    }
  }
}

const uploadLatestFile = async (source, key, contentType) => {
  await aws([
    's3',
    'cp',
    source,
    `s3://${bucket}/${key}`,
    '--content-type',
    contentType,
    '--cache-control',
    'no-store',
    '--no-progress'
  ])
}

const listKeys = async (prefix) => {
  const keys = []
  let continuationToken
  do {
    const command = [
      's3api',
      'list-objects-v2',
      '--bucket',
      bucket,
      '--prefix',
      prefix,
      '--output',
      'json'
    ]
    if (continuationToken) command.push('--continuation-token', continuationToken)
    const { stdout } = await aws(command)
    const page = JSON.parse(stdout)
    keys.push(...(page.Contents || []).map((entry) => entry.Key))
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (continuationToken)
  return keys
}

const cleanupOldObjects = async () => {
  const removable = []
  for (const prefix of [
    'artifacts/',
    'release-status/',
    'updates/v',
    'releases/v',
    'releases/latest/',
    '/artifacts/',
    '/release-status/'
  ]) {
    for (const key of await listKeys(prefix)) {
      if (key.startsWith(`artifacts/${releaseTag}/`)) continue
      if (key.startsWith(`release-status/${releaseTag}/`)) continue
      removable.push(key)
    }
  }
  for (const key of removable) {
    await aws(['s3api', 'delete-object', '--bucket', bucket, '--key', key])
    process.stdout.write(`[release] removed old R2 object ${key}\n`)
  }
}

const createGithubRelease = async (manifest) => {
  const token = String(process.env.NCURATOR_RELEASE_TOKEN || '').trim()
  if (!token) {
    process.stdout.write(
      '[release] NCURATOR_RELEASE_TOKEN is not set; skipped GitHub Release notes\n'
    )
    return
  }
  const repository = String(process.env.RELEASE_REPOSITORY || 'Yoan98/Ncurator')
  const installerLines = [
    ['Apple 芯片 Mac', manifest.downloads.macArm64],
    ['Intel Mac', manifest.downloads.macX64],
    ['Windows 64 位', manifest.downloads.windowsX64]
  ]
    .map(([label, file]) => `- [${label}](${file.url}) — sha512: \`${file.sha512}\``)
    .join('\n')
  const body = `所有安装包均由 Cloudflare R2 提供下载。\n\n${installerLines}\n`
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  }
  const releaseUrl = `https://api.github.com/repos/${repository}/releases/tags/${releaseTag}`
  const existing = await fetch(releaseUrl, { headers })
  if (existing.status !== 404 && !existing.ok) {
    throw new Error(
      `GitHub Release lookup failed: HTTP ${existing.status} ${await existing.text()}`
    )
  }
  const payload = {
    tag_name: releaseTag,
    name: `Ncurator ${releaseTag}`,
    body,
    draft: false,
    prerelease: false
  }
  const response =
    existing.status === 404
      ? await fetch(`https://api.github.com/repos/${repository}/releases`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        })
      : await fetch((await existing.json()).url, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(payload)
        })
  if (!response.ok) {
    throw new Error(
      `GitHub Release update failed: HTTP ${response.status} ${await response.text()}`
    )
  }
}

try {
  const [windows, macArm64, macX64] = await Promise.all([
    downloadFragment('windows-x64'),
    downloadFragment('macos-arm64'),
    downloadFragment('macos-x64')
  ])
  await Promise.all([
    verifyFragment(windows, 'windows-x64'),
    verifyFragment(macArm64, 'macos-arm64'),
    verifyFragment(macX64, 'macos-x64')
  ])
  if (!macArm64.signature || macArm64.signature !== macX64.signature) {
    throw new Error('macOS arm64 and x64 release signatures do not match')
  }

  const metadataInput = path.join(workDirectory, 'metadata-input')
  const metadataOutput = path.join(workDirectory, 'metadata-output')
  await mkdir(path.join(metadataInput, 'windows'), { recursive: true })
  await mkdir(path.join(metadataInput, 'mac-arm64'), { recursive: true })
  await mkdir(path.join(metadataInput, 'mac-x64'), { recursive: true })
  await writeFile(path.join(metadataInput, 'windows', 'latest.yml'), windows.metadata, 'utf8')
  await writeFile(
    path.join(metadataInput, 'mac-arm64', 'latest-mac.yml'),
    macArm64.metadata,
    'utf8'
  )
  await writeFile(path.join(metadataInput, 'mac-x64', 'latest-mac.yml'), macX64.metadata, 'utf8')
  await execFileAsync(process.execPath, [
    path.join(ROOT, 'scripts', 'merge-latest-mac-yml.mjs'),
    metadataInput
  ])
  await writeFile(
    path.join(metadataInput, 'latest.yml'),
    await readFile(path.join(metadataInput, 'windows', 'latest.yml'), 'utf8'),
    'utf8'
  )
  await execFileAsync(process.execPath, [
    path.join(ROOT, 'scripts', 'prepare-r2-update-metadata.mjs'),
    metadataInput,
    metadataOutput,
    releaseTag
  ])

  const installer = (fragment) => fragment.files.find((file) => file.role === 'installer')
  const toDownload = (fragment) => {
    const file = installer(fragment)
    if (!file) throw new Error(`missing installer in ${fragment.platform} fragment`)
    return {
      name: file.name,
      url: `${publicBaseUrl}/artifacts/${releaseTag}/${file.name}`,
      size: file.size,
      sha512: file.sha512
    }
  }
  const manifest = {
    schemaVersion: 1,
    version: releaseTag.slice(1),
    tag: releaseTag,
    publishedAt: new Date().toISOString(),
    downloads: {
      macArm64: toDownload(macArm64),
      macX64: toDownload(macX64),
      windowsX64: toDownload(windows)
    }
  }
  const manifestPath = path.join(workDirectory, 'latest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  await createGithubRelease(manifest)
  await uploadLatestFile(
    path.join(metadataOutput, 'latest.yml'),
    'updates/latest/latest.yml',
    'application/yaml'
  )
  await uploadLatestFile(
    path.join(metadataOutput, 'latest-mac.yml'),
    'updates/latest/latest-mac.yml',
    'application/yaml'
  )
  await uploadLatestFile(manifestPath, 'releases/latest.json', 'application/json')

  const [windowsMetadata, macMetadata, publicManifest] = await Promise.all([
    fetch(`${publicBaseUrl}/updates/latest/latest.yml?release=${Date.now()}`).then((response) => {
      if (!response.ok) throw new Error(`latest.yml public verification failed: ${response.status}`)
      return response.text()
    }),
    fetch(`${publicBaseUrl}/updates/latest/latest-mac.yml?release=${Date.now()}`).then(
      (response) => {
        if (!response.ok)
          throw new Error(`latest-mac.yml public verification failed: ${response.status}`)
        return response.text()
      }
    ),
    fetch(`${publicBaseUrl}/releases/latest.json?release=${Date.now()}`).then((response) => {
      if (!response.ok)
        throw new Error(`latest.json public verification failed: ${response.status}`)
      return response.json()
    })
  ])
  if (
    !windowsMetadata.includes(`version: ${releaseTag.slice(1)}`) ||
    !macMetadata.includes(`version: ${releaseTag.slice(1)}`) ||
    publicManifest.tag !== releaseTag
  ) {
    throw new Error('latest R2 metadata does not match the release tag')
  }

  if (!keepOld) await cleanupOldObjects()
  process.stdout.write(`[release] ${releaseTag} is live on Cloudflare R2\n`)
} finally {
  await rm(workDirectory, { recursive: true, force: true })
}
