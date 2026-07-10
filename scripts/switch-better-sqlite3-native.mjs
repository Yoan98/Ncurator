/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { rebuildBetterSqlite3ForElectron } from './rebuild-better-sqlite3-electron.mjs'

const require = createRequire(import.meta.url)
const root = process.cwd()
const cacheRoot = path.join(root, 'node_modules', '.native-cache', 'better-sqlite3')
const markerPath = path.join(cacheRoot, 'current.json')
const binaryRelativePath = path.join('build', 'Release', 'better_sqlite3.node')

const resolveFromRoot = (id) => require.resolve(id, { paths: [root] })

const readPackage = (id) => require(resolveFromRoot(`${id}/package.json`))

const getBetterSqliteDir = () => path.dirname(resolveFromRoot('better-sqlite3/package.json'))

const getActiveBinaryPath = () => path.join(getBetterSqliteDir(), binaryRelativePath)

const getElectronAbi = () => {
  const electronVersion = readPackage('electron').version
  const betterSqliteDir = getBetterSqliteDir()
  const prebuildInstallPackagePath = require.resolve('prebuild-install/package.json', {
    paths: [betterSqliteDir]
  })
  const prebuildInstallDir = path.dirname(prebuildInstallPackagePath)
  const { getAbi } = require(require.resolve('node-abi', { paths: [prebuildInstallDir] }))
  return {
    electronVersion,
    abi: getAbi(electronVersion, 'electron')
  }
}

const targetInfo = (target) => {
  const platform = process.platform
  const arch = process.arch
  if (target === 'node') {
    return {
      target,
      runtime: 'node',
      runtimeVersion: process.versions.node,
      abi: process.versions.modules,
      platform,
      arch,
      cacheDir: path.join(cacheRoot, `node-v${process.versions.modules}-${platform}-${arch}`)
    }
  }
  if (target === 'electron') {
    const { electronVersion, abi } = getElectronAbi()
    return {
      target,
      runtime: 'electron',
      runtimeVersion: electronVersion,
      abi,
      platform,
      arch,
      cacheDir: path.join(cacheRoot, `electron-v${abi}-${platform}-${arch}`)
    }
  }
  throw new Error(`unknown native target: ${target}`)
}

const cacheBinaryPath = (info) => path.join(info.cacheDir, 'better_sqlite3.node')

const ensureBinaryExists = (binaryPath, label) => {
  if (!existsSync(binaryPath)) {
    throw new Error(`${label} does not exist: ${binaryPath}`)
  }
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: 'inherit',
    env: options.env || process.env,
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

const writeMarker = (info) => {
  mkdirSync(cacheRoot, { recursive: true })
  writeFileSync(
    markerPath,
    `${JSON.stringify(
      {
        ...info,
        cacheDir: path.relative(root, info.cacheDir),
        activeBinary: path.relative(root, getActiveBinaryPath()),
        switchedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`
  )
}

const copyCacheToActive = (info) => {
  const source = cacheBinaryPath(info)
  const target = getActiveBinaryPath()
  ensureBinaryExists(source, `${info.runtime} cached better-sqlite3 binary`)
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(source, target)
  writeMarker(info)
  console.log(
    `[native] active better-sqlite3 => ${info.runtime} abi ${info.abi} (${info.platform}-${info.arch})`
  )
}

const cacheActiveBinary = (info) => {
  const active = getActiveBinaryPath()
  ensureBinaryExists(active, 'active better-sqlite3 binary')
  mkdirSync(info.cacheDir, { recursive: true })
  copyFileSync(active, cacheBinaryPath(info))
}

const ensureNodeCache = (info) => {
  if (existsSync(cacheBinaryPath(info))) return
  console.log(`[native] preparing better-sqlite3 for node ${process.versions.node}`)
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'install'], {
    cwd: getBetterSqliteDir()
  })
  cacheActiveBinary(info)
}

const ensureElectronCache = async (info) => {
  if (existsSync(cacheBinaryPath(info))) return
  console.log(`[native] preparing better-sqlite3 for electron ${info.runtimeVersion}`)
  await rebuildBetterSqlite3ForElectron({
    electronVersion: info.runtimeVersion,
    platform: info.platform,
    arch: info.arch
  })
  cacheActiveBinary(info)
}

const switchTarget = async (target) => {
  const info = targetInfo(target)
  if (target === 'node') {
    ensureNodeCache(info)
  } else {
    await ensureElectronCache(info)
  }
  copyCacheToActive(info)
}

const status = () => {
  const active = getActiveBinaryPath()
  console.log(`[native] active binary: ${path.relative(root, active)}`)
  if (existsSync(markerPath)) {
    console.log(readFileSync(markerPath, 'utf8').trim())
  } else {
    console.log('[native] no current marker')
  }
  for (const target of ['node', 'electron']) {
    const info = targetInfo(target)
    console.log(
      `[native] cache ${target}: ${existsSync(cacheBinaryPath(info)) ? 'ready' : 'missing'} ${path.relative(
        root,
        cacheBinaryPath(info)
      )}`
    )
  }
}

const clean = () => {
  rmSync(cacheRoot, { recursive: true, force: true })
  console.log('[native] cache removed')
}

const main = async () => {
  const command = process.argv[2] || 'status'
  if (command === 'node' || command === 'electron') {
    await switchTarget(command)
    return
  }
  if (command === 'prepare') {
    await switchTarget('node')
    await switchTarget('electron')
    return
  }
  if (command === 'status') {
    status()
    return
  }
  if (command === 'clean') {
    clean()
    return
  }
  throw new Error(`unknown command: ${command}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
