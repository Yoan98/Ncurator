import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from '../shared/environment.mjs'
import { assertReleaseFragment } from './fragment-contract.mjs'
import { fetchWithRetry } from '../shared/http.mjs'
import { artifactKey, statusKey } from './storage-layout.mjs'

const execFileAsync = promisify(execFile)
await loadReleaseEnvironment(process.cwd())
const [inputDirectory = '', fragmentPath = ''] = process.argv.slice(2)

const requiredEnvironment = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'R2_ACCOUNT_ID',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL'
]
for (const name of requiredEnvironment) {
  if (!String(process.env[name] || '').trim())
    throw new Error(`missing environment variable: ${name}`)
}

if (!inputDirectory || !fragmentPath) {
  throw new Error('usage: node scripts/release/r2/upload-fragment.mjs <input-dir> <fragment-json>')
}

const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'))
assertReleaseFragment(fragment)

const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
const bucket = String(process.env.R2_BUCKET_NAME).replace(/^\/+|\/+$/gu, '')
const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL).replace(/\/$/u, '')
const localAws = path.join(os.homedir(), '.ncurator', 'release-tools', 'awscli', 'bin', 'aws')
const awsExecutable =
  String(process.env.NCURATOR_AWS_CLI || '').trim() || (existsSync(localAws) ? localAws : 'aws')

const aws = async (args) =>
  execFileAsync(awsExecutable, [...args, '--endpoint-url', endpoint, '--region', 'auto'], {
    maxBuffer: 10 * 1024 * 1024
  })

const contentType = (name) => {
  if (name.endsWith('.json')) return 'application/json'
  if (name.endsWith('.yml')) return 'application/yaml'
  return 'application/octet-stream'
}

const contentDisposition = (name, fallbackName) =>
  `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(name)}`

const readRemoteObject = async (key) => {
  try {
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
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}

for (const file of fragment.files) {
  const source = path.join(inputDirectory, file.name)
  const key = artifactKey(fragment, file.storageName)
  const existing = await readRemoteObject(key)
  if (existing) {
    if (Number(existing.ContentLength) !== file.size || existing.Metadata?.sha512 !== file.sha512) {
      throw new Error(`refusing to overwrite a different release asset: ${key}`)
    }
  } else {
    await aws([
      's3',
      'cp',
      source,
      `s3://${bucket}/${key}`,
      '--cache-control',
      'public, max-age=31536000, immutable',
      '--content-type',
      contentType(file.name),
      '--content-disposition',
      contentDisposition(file.name, file.storageName),
      '--metadata',
      `sha512=${file.sha512}`,
      '--no-progress'
    ])
  }

  const remote = await readRemoteObject(key)
  if (!remote) throw new Error(`R2 object disappeared after upload: ${key}`)
  if (Number(remote.ContentLength) !== file.size || remote.Metadata?.sha512 !== file.sha512) {
    throw new Error(`R2 verification failed: ${key}`)
  }

  const publicResponse = await fetchWithRetry(`${publicBaseUrl}/${key}`, {
    method: 'HEAD',
    cache: 'no-store'
  })
  if (!publicResponse.ok || Number(publicResponse.headers.get('content-length')) !== file.size) {
    throw new Error(`public R2 verification failed: ${key}`)
  }
}

const fragmentStatusKey = statusKey(fragment.tag, fragment.platform)
await aws([
  's3',
  'cp',
  fragmentPath,
  `s3://${bucket}/${fragmentStatusKey}`,
  '--content-type',
  'application/json',
  '--cache-control',
  'no-store',
  '--no-progress'
])

process.stdout.write(
  `[release] uploaded ${fragment.platform} to ${publicBaseUrl}/${artifactKey(fragment, '')}\n`
)
