import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { assertReleaseFragment } from './fragment-contract.mjs'
import { artifactKey, fixedDownloadKey, statusKey } from './storage-layout.mjs'
import { createR2Client } from './client.mjs'
import { fetchWithRetry } from '../shared/http.mjs'
import { parseReleaseTag } from '../tag.mjs'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const tagIndex = args.indexOf('--tag')
const releaseTag = tagIndex >= 0 ? args[tagIndex + 1] || '' : ''
try {
  parseReleaseTag(releaseTag, 'windows')
} catch {
  throw new Error('usage: node scripts/release/r2/finalize-windows.mjs --tag <windows-v1.2.3>')
}

const { aws, bucket, publicBaseUrl, listKeys, deleteKeys } = await createR2Client(ROOT)
const workDirectory = await mkdtemp(path.join(os.tmpdir(), `ncurator-windows-${releaseTag}-`))

try {
  const fragmentPath = path.join(workDirectory, 'windows-x64.json')
  await aws([
    's3',
    'cp',
    `s3://${bucket}/${statusKey(releaseTag, 'windows-x64')}`,
    fragmentPath,
    '--no-progress'
  ])
  const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'))
  assertReleaseFragment(fragment, { tag: releaseTag, platform: 'windows-x64' })
  for (const file of fragment.files) {
    const key = artifactKey(fragment, file.name)
    const remote = JSON.parse(
      (await aws(['s3api', 'head-object', '--bucket', bucket, '--key', key, '--output', 'json']))
        .stdout
    )
    if (Number(remote.ContentLength) !== file.size || remote.Metadata?.sha512 !== file.sha512) {
      throw new Error(`R2 object does not match release fragment: ${key}`)
    }
  }

  const metadataInput = path.join(workDirectory, 'metadata-input')
  const metadataOutput = path.join(workDirectory, 'metadata-output')
  await mkdir(metadataInput, { recursive: true })
  await writeFile(path.join(metadataInput, 'latest.yml'), fragment.metadata, 'utf8')
  const { execFile } = await import('node:child_process')
  await new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [
      path.join(ROOT, 'scripts', 'release', 'r2', 'metadata.mjs'),
      metadataInput,
      metadataOutput,
      releaseTag
    ])
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`metadata preparation exited with ${code}`))
    )
  })
  await aws([
    's3',
    'cp',
    path.join(metadataOutput, 'latest.yml'),
    `s3://${bucket}/updates/latest/latest.yml`,
    '--content-type',
    'application/yaml',
    '--cache-control',
    'no-store',
    '--no-progress'
  ])

  const installer = fragment.files.find((file) => file.role === 'installer')
  const sourceKey = artifactKey(fragment, installer.name)
  const downloadKey = fixedDownloadKey(fragment.platform)
  const downloadName = `Ncurator-${fragment.version}-windows-x64.exe`
  await aws([
    's3api',
    'copy-object',
    '--bucket',
    bucket,
    '--copy-source',
    `${bucket}/${sourceKey}`,
    '--key',
    downloadKey,
    '--content-type',
    'application/octet-stream',
    '--cache-control',
    'no-store',
    '--content-disposition',
    `attachment; filename="${downloadName}"`,
    '--metadata-directive',
    'REPLACE',
    '--metadata',
    `sha512=${installer.sha512}`
  ])

  const manifest = {
    schemaVersion: 2,
    platform: 'windows',
    version: fragment.version,
    tag: fragment.tag,
    publishedAt: new Date().toISOString(),
    downloads: {
      x64: {
        name: downloadName,
        url: `${publicBaseUrl}/${downloadKey}`,
        size: installer.size,
        sha512: installer.sha512
      }
    }
  }
  const manifestPath = path.join(workDirectory, 'latest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await aws([
    's3',
    'cp',
    manifestPath,
    `s3://${bucket}/releases/latest/windows.json`,
    '--content-type',
    'application/json',
    '--cache-control',
    'no-store',
    '--no-progress'
  ])

  const [metadataResponse, downloadResponse, manifestResponse] = await Promise.all([
    fetchWithRetry(`${publicBaseUrl}/updates/latest/latest.yml?check=${Date.now()}`, {
      cache: 'no-store'
    }),
    fetchWithRetry(`${publicBaseUrl}/${downloadKey}?check=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store'
    }),
    fetchWithRetry(`${publicBaseUrl}/releases/latest/windows.json?check=${Date.now()}`, {
      cache: 'no-store'
    })
  ])
  if (
    !metadataResponse.ok ||
    !(await metadataResponse.text()).includes(`version: ${fragment.version}`)
  ) {
    throw new Error('public Windows update metadata verification failed')
  }
  if (
    !downloadResponse.ok ||
    Number(downloadResponse.headers.get('content-length')) !== installer.size ||
    !String(downloadResponse.headers.get('content-disposition') || '').includes(
      `filename="${downloadName}"`
    )
  ) {
    throw new Error('public fixed Windows download verification failed')
  }
  const publicManifest = manifestResponse.ok ? await manifestResponse.json() : undefined
  if (
    publicManifest?.version !== fragment.version ||
    publicManifest?.downloads?.x64?.name !== downloadName ||
    publicManifest?.downloads?.x64?.url !== `${publicBaseUrl}/${downloadKey}`
  ) {
    throw new Error('public Windows release manifest verification failed')
  }

  const removable = (await listKeys('artifacts/windows/')).filter(
    (key) => !key.startsWith(`artifacts/windows/${releaseTag}/`)
  )
  removable.push(
    ...(await listKeys('release-status/windows/')).filter(
      (key) => key !== statusKey(releaseTag, 'windows-x64')
    )
  )
  removable.push(
    ...(await listKeys('artifacts/v')).filter((key) => /\/Ncurator-windows-[^/]+$/u.test(key))
  )
  removable.push(
    ...(await listKeys('release-status/v')).filter((key) => key.endsWith('/windows-x64.json'))
  )
  await deleteKeys(removable)
  process.stdout.write(
    `[release] Windows ${releaseTag} is live at ${publicBaseUrl}/${downloadKey}\n`
  )
} finally {
  await rm(workDirectory, { recursive: true, force: true })
}
