import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = process.cwd()
const WORKFLOW_SCRIPT = path.join(ROOT, 'scripts', 'test', 'workflow.mjs')

const result = spawnSync(
  process.execPath,
  [WORKFLOW_SCRIPT, '--showcase', ...process.argv.slice(2)],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('npm_')))
  }
)

if (result.error) {
  process.stderr.write(`[showcase] command failed to start: ${String(result.error)}\n`)
  process.exit(1)
}

process.exit(typeof result.status === 'number' ? result.status : 1)
