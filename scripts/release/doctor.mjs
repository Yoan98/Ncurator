import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from './shared/environment.mjs'
import { inspectLocalWindowsRelease } from './shared/windows.mjs'
import { createAwsCliRuntime } from './storage/client.mjs'
import { resolveReleaseStorageConfig } from './storage/config.mjs'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
await loadReleaseEnvironment(ROOT)

const inspection = await inspectLocalWindowsRelease(ROOT)
if (!inspection.ready) {
  process.stdout.write('Local Windows release: unavailable\n')
  for (const issue of inspection.issues) process.stdout.write(`- ${issue}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('Local Windows release: ready\n')
  process.stdout.write(`- Node ${process.versions.node} (${process.arch})\n`)
  process.stdout.write(
    `- Python ${inspection.python.version} (${inspection.python.architecture})\n`
  )
  process.stdout.write('- pnpm configured version: ready\n')
  process.stdout.write('- AWS CLI: ready\n')

  const storage = resolveReleaseStorageConfig()
  const runtime = await createAwsCliRuntime(storage)
  await execFileAsync(
    inspection.awsExecutable,
    [
      's3api',
      'list-objects-v2',
      '--bucket',
      storage.bucket,
      '--max-keys',
      '1',
      '--output',
      'json',
      ...runtime.extraArgs
    ],
    { env: runtime.env, maxBuffer: 10 * 1024 * 1024 }
  ).catch((error) => {
    throw new Error(
      `${storage.label} access check failed: ${String(error?.stderr || error?.message || error)}`
    )
  })
  process.stdout.write(`- ${storage.label} access: ready\n`)
}
