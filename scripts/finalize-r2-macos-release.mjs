import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from './release-environment.mjs'
import { assertReleaseFragment } from './release-fragment-contract.mjs'
import { fetchWithRetry } from './release-http.mjs'
import { resolveAwsExecutable } from './windows-release-common.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
await loadReleaseEnvironment(ROOT)
const args = process.argv.slice(2)
const tagIndex = args.indexOf('--tag')
const releaseTag = tagIndex >= 0 ? args[tagIndex + 1] || '' : ''

if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
  throw new Error('usage: node scripts/finalize-r2-macos-release.mjs --tag <v1.2.3>')
}

for (const name of [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'R2_ACCOUNT_ID',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL'
]) {
  if (!String(process.env[name] || '').trim()) {
    throw new Error(`missing environment variable: ${name}`)
  }
}

const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL).replace(/\/$/u, '')
if (publicBaseUrl !== 'https://download.ncurator.com') {
  throw new Error(`unexpected R2 public URL: ${publicBaseUrl}`)
}
const awsExecutable = await resolveAwsExecutable()
if (!awsExecutable) throw new Error('AWS CLI is required')
const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
const bucket = String(process.env.R2_BUCKET_NAME).replace(/^\/+|\/+$/gu, '')
const workDirectory = await mkdtemp(path.join(os.tmpdir(), `ncurator-macos-${releaseTag}-`))

const aws = (awsArgs) =>
  execFileAsync(awsExecutable, [...awsArgs, '--endpoint-url', endpoint, '--region', 'auto'], {
    maxBuffer: 20 * 1024 * 1024
  })

const downloadAndVerifyFragment = async (platform) => {
  const target = path.join(workDirectory, `${platform}.json`)
  await aws([
    's3',
    'cp',
    `s3://${bucket}/release-status/${releaseTag}/${platform}.json`,
    target,
    '--no-progress'
  ])
  const fragment = JSON.parse(await readFile(target, 'utf8'))
  assertReleaseFragment(fragment, {
    tag: releaseTag,
    platform,
    label: `${platform} release fragment`
  })
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
  return fragment
}

try {
  const [arm64, x64] = await Promise.all([
    downloadAndVerifyFragment('macos-arm64'),
    downloadAndVerifyFragment('macos-x64')
  ])
  if (!arm64.signature || arm64.signature !== x64.signature) {
    throw new Error('macOS arm64 and x64 release signatures do not match')
  }

  const metadataInput = path.join(workDirectory, 'metadata-input')
  const metadataOutput = path.join(workDirectory, 'metadata-output')
  await mkdir(path.join(metadataInput, 'mac-arm64'), { recursive: true })
  await mkdir(path.join(metadataInput, 'mac-x64'), { recursive: true })
  await writeFile(path.join(metadataInput, 'mac-arm64', 'latest-mac.yml'), arm64.metadata, 'utf8')
  await writeFile(path.join(metadataInput, 'mac-x64', 'latest-mac.yml'), x64.metadata, 'utf8')
  await execFileAsync(process.execPath, [
    path.join(ROOT, 'scripts', 'merge-latest-mac-yml.mjs'),
    metadataInput
  ])
  await execFileAsync(process.execPath, [
    path.join(ROOT, 'scripts', 'prepare-r2-update-metadata.mjs'),
    metadataInput,
    metadataOutput,
    releaseTag
  ])

  const metadataPath = path.join(metadataOutput, 'latest-mac.yml')
  await aws([
    's3',
    'cp',
    metadataPath,
    `s3://${bucket}/updates/latest/latest-mac.yml`,
    '--content-type',
    'application/yaml',
    '--cache-control',
    'no-store',
    '--no-progress'
  ])

  const response = await fetchWithRetry(
    `${publicBaseUrl}/updates/latest/latest-mac.yml?release=${Date.now()}`,
    { cache: 'no-store' }
  )
  if (!response.ok) throw new Error(`latest-mac.yml verification failed: ${response.status}`)
  const publicMetadata = await response.text()
  if (
    !publicMetadata.includes(`version: ${releaseTag.slice(1)}`) ||
    !publicMetadata.includes(`artifacts/${releaseTag}/Ncurator-mac-arm64.zip`) ||
    !publicMetadata.includes(`artifacts/${releaseTag}/Ncurator-mac-x64.zip`)
  ) {
    throw new Error('public latest-mac.yml does not match the Mac release')
  }
  process.stdout.write(
    `[release] ${releaseTag} is live on the macOS update channel; Windows metadata was not changed\n`
  )
} finally {
  await rm(workDirectory, { recursive: true, force: true })
}
