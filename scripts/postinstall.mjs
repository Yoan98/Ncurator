import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const electronInstall = path.join(root, 'node_modules', 'electron', 'install.js')

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

if (existsSync(electronInstall)) {
  run(process.execPath, [electronInstall])
}

if (process.env.NCURATOR_REBUILD_NATIVE === '1') {
  run(process.execPath, [
    path.join(root, 'scripts', 'prepare-better-sqlite3-native.mjs'),
    'prepare'
  ])
  run(process.execPath, [path.join(root, 'scripts', 'prepare-node-pty-native.mjs'), 'prepare'])
} else {
  console.log('[postinstall] skip native prepare; set NCURATOR_REBUILD_NATIVE=1 to run it')
}
