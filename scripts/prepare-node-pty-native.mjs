import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = process.cwd()
const nodePtyRoot = path.dirname(require.resolve('node-pty/package.json', { paths: [root] }))
const releaseDir = path.join(nodePtyRoot, 'build', 'Release')
const cacheRoot = path.join(root, 'node_modules', '.native-cache', 'node-pty')
const currentTargetPath = path.join(cacheRoot, 'current-target.txt')

const readPackage = (name) =>
  JSON.parse(readFileSync(require.resolve(`${name}/package.json`, { paths: [root] }), 'utf8'))

const targetKey = (target) => {
  if (target === 'node') {
    return `node-v${process.versions.modules}-${process.platform}-${process.arch}`
  }
  if (target === 'electron') {
    return `electron-${readPackage('electron').version}-${process.platform}-${process.arch}`
  }
  throw new Error(`unknown node-pty target: ${target}`)
}

const cacheDir = (target) => path.join(cacheRoot, targetKey(target), 'Release')

const hasNativeRelease = (directory) => {
  if (process.platform === 'win32') {
    return (
      existsSync(path.join(directory, 'conpty.node')) ||
      existsSync(path.join(directory, 'pty.node'))
    )
  }
  return (
    existsSync(path.join(directory, 'pty.node')) && existsSync(path.join(directory, 'spawn-helper'))
  )
}

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

const rebuildNode = () => {
  const pnpmCli = process.env.npm_execpath
  if (pnpmCli && existsSync(pnpmCli)) {
    run(process.execPath, [pnpmCli, 'rebuild', 'node-pty'])
    return
  }
  run('pnpm', ['rebuild', 'node-pty'])
}

const rebuildElectron = () => {
  const cliPath = require.resolve('@electron/rebuild/lib/cli.js', { paths: [root] })
  run(process.execPath, [
    cliPath,
    '--force',
    '--only',
    'node-pty',
    '--version',
    readPackage('electron').version
  ])
}

const cacheCurrentRelease = (target) => {
  if (!hasNativeRelease(releaseDir)) {
    throw new Error(`node-pty native release missing after ${target} rebuild: ${releaseDir}`)
  }
  const targetCache = cacheDir(target)
  rmSync(targetCache, { recursive: true, force: true })
  mkdirSync(path.dirname(targetCache), { recursive: true })
  cpSync(releaseDir, targetCache, { recursive: true })
}

const restoreCachedRelease = (target) => {
  const source = cacheDir(target)
  if (!hasNativeRelease(source)) return false
  rmSync(releaseDir, { recursive: true, force: true })
  mkdirSync(path.dirname(releaseDir), { recursive: true })
  cpSync(source, releaseDir, { recursive: true })
  return true
}

const ensure = (target) => {
  mkdirSync(cacheRoot, { recursive: true })
  const currentTarget = existsSync(currentTargetPath)
    ? readFileSync(currentTargetPath, 'utf8').trim()
    : ''
  const expectedTarget = targetKey(target)
  if (currentTarget === expectedTarget && hasNativeRelease(releaseDir)) {
    console.log(`[node-pty-native] ready ${expectedTarget}`)
    return
  }
  if (!restoreCachedRelease(target)) {
    if (target === 'node') rebuildNode()
    else rebuildElectron()
    cacheCurrentRelease(target)
  }
  writeFileSync(currentTargetPath, `${expectedTarget}\n`)
  console.log(`[node-pty-native] ready ${expectedTarget}`)
}

const command = process.argv[2] || 'status'
const target = process.argv[3] || 'node'
if (command === 'ensure') {
  ensure(target)
} else if (command === 'prepare') {
  ensure('node')
  ensure('electron')
} else if (command === 'status') {
  console.log(
    existsSync(currentTargetPath)
      ? readFileSync(currentTargetPath, 'utf8').trim()
      : '[node-pty-native] no current target'
  )
} else if (command === 'clean') {
  rmSync(cacheRoot, { recursive: true, force: true })
} else {
  throw new Error(`unknown command: ${command}`)
}
