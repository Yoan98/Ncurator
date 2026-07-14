/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
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
  throw new Error('usage: node scripts/upload-r2-release-fragment.mjs <input-dir> <fragment-json>')
}

const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'))
if (fragment.schemaVersion !== 1 || !/^v\d+\.\d+\.\d+$/u.test(fragment.tag)) {
  throw new Error('invalid release fragment')
}

const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
const bucket = process.env.R2_BUCKET_NAME
const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL).replace(/\/$/u, '')

const aws = async (args) =>
  execFileAsync('aws', [...args, '--endpoint-url', endpoint, '--region', 'auto'], {
    maxBuffer: 10 * 1024 * 1024
  })

const contentType = (name) => {
  if (name.endsWith('.json')) return 'application/json'
  if (name.endsWith('.yml')) return 'application/yaml'
  return 'application/octet-stream'
}

for (const file of fragment.files) {
  const source = path.join(inputDirectory, file.name)
  const key = `artifacts/${fragment.tag}/${file.name}`
  const downloadName = file.name.replace('Ncurator-', `Ncurator-${fragment.version}-`)
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
    `attachment; filename=${downloadName}`,
    '--metadata',
    `sha512=${file.sha512}`,
    '--no-progress'
  ])

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
    throw new Error(`R2 verification failed: ${key}`)
  }

  const publicResponse = await fetch(`${publicBaseUrl}/${key}`, { method: 'HEAD' })
  if (!publicResponse.ok || Number(publicResponse.headers.get('content-length')) !== file.size) {
    throw new Error(`public R2 verification failed: ${key}`)
  }
}

const statusKey = `release-status/${fragment.tag}/${fragment.platform}.json`
await aws([
  's3',
  'cp',
  fragmentPath,
  `s3://${bucket}/${statusKey}`,
  '--content-type',
  'application/json',
  '--cache-control',
  'no-store',
  '--no-progress'
])

process.stdout.write(
  `[release] uploaded ${fragment.platform} to ${publicBaseUrl}/artifacts/${fragment.tag}/\n`
)
