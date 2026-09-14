import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { assertReleaseFragment, resolveReleaseAssetPath } from './fragment-contract.mjs'
import { fetchWithRetry } from '../shared/http.mjs'
import { artifactKey, fragmentKey } from './storage-layout.mjs'
import { createReleaseStorageClient } from '../storage/client.mjs'

const [inputDirectory = '', fragmentPath = ''] = process.argv.slice(2)

if (!inputDirectory || !fragmentPath) {
  throw new Error('usage: node scripts/release/r2/upload-fragment.mjs <input-dir> <fragment-json>')
}

const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'))
assertReleaseFragment(fragment)

const { aws, bucket, publicBaseUrl, label } = await createReleaseStorageClient()

const contentType = (name) => {
  if (name.endsWith('.json')) return 'application/json'
  if (name.endsWith('.yml')) return 'application/yaml'
  return 'application/octet-stream'
}

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
  const source = await resolveReleaseAssetPath(inputDirectory, file)
  const key = artifactKey(fragment, file.name)
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
      '--metadata',
      `sha512=${file.sha512}`,
      '--no-progress'
    ])
  }

  const remote = await readRemoteObject(key)
  if (!remote) throw new Error(`${label} object disappeared after upload: ${key}`)
  if (Number(remote.ContentLength) !== file.size || remote.Metadata?.sha512 !== file.sha512) {
    throw new Error(`${label} verification failed: ${key}`)
  }

  const publicResponse = await fetchWithRetry(`${publicBaseUrl}/${key}`, {
    method: 'HEAD',
    cache: 'no-store'
  })
  if (!publicResponse.ok || Number(publicResponse.headers.get('content-length')) !== file.size) {
    throw new Error(`public ${label} verification failed: ${key}`)
  }
}

const uploadedFragmentKey = fragmentKey(fragment.tag, fragment.platform)
await aws([
  's3',
  'cp',
  fragmentPath,
  `s3://${bucket}/${uploadedFragmentKey}`,
  '--content-type',
  'application/json',
  '--cache-control',
  'no-store',
  '--no-progress'
])

process.stdout.write(
  `[release] uploaded ${fragment.platform} to ${publicBaseUrl}/${artifactKey(fragment, '')}\n`
)
