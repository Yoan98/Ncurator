import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from '../shared/environment.mjs'
import { assertLivePublishAllowed, resolveReleaseStorageConfig } from './config.mjs'

const execFileAsync = promisify(execFile)

export const createAwsCliRuntime = async (config) => {
  const env = { ...process.env, ...config.credentials }
  if (config.addressingStyle === 'virtual') {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-aws-'))
    const configPath = path.join(directory, 'config')
    await writeFile(
      configPath,
      `[default]\nregion = ${config.region}\ns3 =\n    addressing_style = virtual\n`
    )
    env.AWS_CONFIG_FILE = configPath
    env.AWS_DEFAULT_REGION = config.region
  }
  return {
    env,
    extraArgs: ['--endpoint-url', config.endpoint, '--region', config.region]
  }
}

export const createReleaseStorageClient = async (root = process.cwd()) => {
  await loadReleaseEnvironment(root)
  assertLivePublishAllowed()
  const config = resolveReleaseStorageConfig()
  const runtime = await createAwsCliRuntime(config)
  const localAws = path.join(os.homedir(), '.ncurator', 'release-tools', 'awscli', 'bin', 'aws')
  const windowsAws = process.env.ProgramFiles
    ? path.join(process.env.ProgramFiles, 'Amazon', 'AWSCLIV2', 'aws.exe')
    : ''
  const awsExecutable =
    String(process.env.NCURATOR_AWS_CLI || '').trim() ||
    (existsSync(localAws) ? localAws : existsSync(windowsAws) ? windowsAws : 'aws')
  const aws = (args) =>
    execFileAsync(awsExecutable, [...args, ...runtime.extraArgs], {
      env: runtime.env,
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
