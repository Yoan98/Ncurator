import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN_DIR = path.join(ROOT, 'resources', 'web_crawler_sidecar', 'bin')
const EXECUTABLE_NAME = process.platform === 'win32' ? 'web_crawler_sidecar.exe' : 'web_crawler_sidecar'
const NESTED_EXECUTABLE_PATH = path.join(BIN_DIR, 'web_crawler_sidecar', EXECUTABLE_NAME)
const FLAT_EXECUTABLE_PATH = path.join(BIN_DIR, EXECUTABLE_NAME)
const BUILD_SCRIPT_PATH = path.join(ROOT, 'scripts', 'build-web-crawler-sidecar.mjs')

const hasSidecarExecutable = () =>
  fs.existsSync(NESTED_EXECUTABLE_PATH) || fs.existsSync(FLAT_EXECUTABLE_PATH)

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

  if (hasSidecarExecutable()) {
    console.log('[sidecar] web crawler sidecar is ready')
    return
  }

  console.log('[sidecar] web crawler sidecar is missing; building it now')
  runBuild()

  if (!hasSidecarExecutable()) {
    throw new Error(`web crawler sidecar build finished but no executable was found under ${BIN_DIR}`)
  }

  console.log('[sidecar] web crawler sidecar build completed')
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
