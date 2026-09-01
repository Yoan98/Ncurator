import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from '../shared/environment.mjs'
import { assertLivePublishAllowed, resolveReleaseStorageConfig } from './config.mjs'

const execFileAsync = promisify(execFile)

export const createReleaseStorageClient = async (root = process.cwd()) => {
  await loadReleaseEnvironment(root)
  assertLivePublishAllowed()
  const config = resolveReleaseStorageConfig()
  const localAws = path.join(os.homedir(), '.ncurator', 'release-tools', 'awscli', 'bin', 'aws')
  const windowsAws = process.env.ProgramFiles
    ? path.join(process.env.ProgramFiles, 'Amazon', 'AWSCLIV2', 'aws.exe')
    : ''
  const awsExecutable =
    String(process.env.NCURATOR_AWS_CLI || '').trim() ||
    (existsSync(localAws) ? localAws : existsSync(windowsAws) ? windowsAws : 'aws')
  const aws = (args) =>
    execFileAsync(
      awsExecutable,
      [...args, '--endpoint-url', config.endpoint, '--region', config.region],
      {
        env: { ...process.env, ...config.credentials },
        maxBuffer: 20 * 1024 * 1024
      }
    )

  const listKeys = async (prefix) => {
    const keys = []
    let continuationToken
    do {
      const args = [
        's3api',
        'list-objects-v2',
        '--bucket',
        config.bucket,
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
      await aws(['s3api', 'delete-object', '--bucket', config.bucket, '--key', key])
      process.stdout.write(`[release] removed old ${config.label} object ${key}\n`)
    }
  }

  return {
    ...config,
    aws,
    awsExecutable,
    listKeys,
    deleteKeys
  }
}
