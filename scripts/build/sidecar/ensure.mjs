import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const BUILD_SCRIPT_PATH = path.join(ROOT, 'scripts', 'build', 'sidecar', 'build.mjs')

const runBuild = () => {
  const result = spawnSync(process.execPath, [BUILD_SCRIPT_PATH], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`web crawler sidecar build exited with code ${String(result.status)}`)
  }
}

const main = () => {
  if (String(process.env.NCURATOR_SKIP_SIDECAR_ENSURE || '').trim() === '1') {
    console.log('[sidecar] skip sidecar check because NCURATOR_SKIP_SIDECAR_ENSURE=1')
    return
  }

  if (String(process.env.NCURATOR_WEB_CRAWLER_USE_PYTHON_SIDECAR || '').trim() === '1') {
    console.log('[sidecar] skip sidecar build because Python sidecar mode is enabled')
    return
  }

  // Build owns the source fingerprint, cache reuse and runtime verification.
  runBuild()
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[sidecar] ${message}\n`)
  process.stderr.write(
    '[sidecar] Run `pnpm run dev:no-sidecar` to start the app without web crawling.\n'
  )
  process.exit(1)
}
