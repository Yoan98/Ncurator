import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from '../shared/environment.mjs'

const execFileAsync = promisify(execFile)

export const createR2Client = async (root = process.cwd()) => {
  await loadReleaseEnvironment(root)
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
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL).replace(/\/$/u, '')
  if (publicBaseUrl !== 'https://download.ncurator.com') {
    throw new Error(`unexpected R2 public URL: ${publicBaseUrl}`)
  }
  const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const bucket = String(process.env.R2_BUCKET_NAME).replace(/^\/+|\/+$/gu, '')
  const localAws = path.join(os.homedir(), '.ncurator', 'release-tools', 'awscli', 'bin', 'aws')
  const windowsAws = process.env.ProgramFiles
    ? path.join(process.env.ProgramFiles, 'Amazon', 'AWSCLIV2', 'aws.exe')
    : ''
  const awsExecutable =
    String(process.env.NCURATOR_AWS_CLI || '').trim() ||
    (existsSync(localAws) ? localAws : existsSync(windowsAws) ? windowsAws : 'aws')
  const aws = (args) =>
    execFileAsync(awsExecutable, [...args, '--endpoint-url', endpoint, '--region', 'auto'], {
      maxBuffer: 20 * 1024 * 1024
    })

  const listKeys = async (prefix) => {
    const keys = []
    let continuationToken
    do {
      const args = [
        's3api',
        'list-objects-v2',
        '--bucket',
        bucket,
        '--prefix',
        prefix,
        '--output',
        'json'
      ]
      if (continuationToken) args.push('--continuation-token', continuationToken)
      const page = JSON.parse((await aws(args)).stdout)
      keys.push(...(page.Contents || []).map((entry) => entry.Key))
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (continuationToken)
    return keys
  }

  const deleteKeys = async (keys) => {
    for (const key of [...new Set(keys)]) {
      await aws(['s3api', 'delete-object', '--bucket', bucket, '--key', key])
      process.stdout.write(`[release] removed old R2 object ${key}\n`)
    }
  }

  return { aws, bucket, publicBaseUrl, listKeys, deleteKeys }
}
