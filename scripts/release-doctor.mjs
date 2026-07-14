import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { loadReleaseEnvironment } from './release-environment.mjs'
import { inspectLocalWindowsRelease } from './windows-release-common.mjs'

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

  const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const bucket = String(process.env.R2_BUCKET_NAME).replace(/^\/+|\/+$/gu, '')
  await execFileAsync(
    inspection.awsExecutable,
    ['s3api', 'head-bucket', '--bucket', bucket, '--endpoint-url', endpoint, '--region', 'auto'],
    { maxBuffer: 10 * 1024 * 1024 }
  ).catch((error) => {
    throw new Error(`R2 access check failed: ${String(error?.stderr || error?.message || error)}`)
  })
  process.stdout.write('- Cloudflare R2 access: ready\n')
}

process.stdout.write(
  `GitHub Actions fallback: ${String(process.env.NCURATOR_ACTIONS_TOKEN || '').trim() ? 'configured' : 'not configured (optional for local-only releases)'}\n`
)
