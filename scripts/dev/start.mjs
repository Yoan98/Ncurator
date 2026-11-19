import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [mode, ...options] = process.argv.slice(2)
if (
  !['production', 'local'].includes(mode) ||
  options.length > 1 ||
  (options.length === 1 && options[0] !== '--no-sidecar')
) {
  throw new Error('Use pnpm run dev or pnpm run dev:test')
}
const root = fileURLToPath(new URL('../../', import.meta.url))
const env = {
  ...process.env,
  NCURATOR_SERVICE_ENV: mode,
  ...(mode === 'local' && { NCURATOR_DISTRIBUTION: 'domestic' })
}
const exec = { cwd: root, env, stdio: 'inherit' }
const preparation = [
  ['scripts/build/native/better-sqlite3.mjs', 'ensure', 'electron'],
  ['scripts/build/native/node-pty.mjs', 'ensure', 'electron'],
  ...(options.length ? [] : [['scripts/build/sidecar/ensure.mjs']])
]
for (const args of preparation) {
  const result = spawnSync(process.execPath, args, exec)
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const require = createRequire(import.meta.url)
const vite = path.join(
  path.dirname(require.resolve('electron-vite/package.json')),
  'bin/electron-vite.js'
)
const child = spawn(process.execPath, [vite, 'dev'], exec)
child.on('error', (err) => {
  console.error(err.message)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
