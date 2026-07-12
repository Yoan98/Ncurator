/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createWriteStream, createReadStream } from 'node:fs'
import { get } from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()
const cacheRoot = path.join(root, 'node_modules', '.native-cache', 'better-sqlite3')
const resourceRoot = path.join(root, 'resources', 'native', 'better-sqlite3')
const manifestPath = path.join(cacheRoot, 'manifest.json')
const binaryRelativePath = path.join('build', 'Release', 'better_sqlite3.node')

const resolveFromRoot = (id) => require.resolve(id, { paths: [root] })
const resolveFrom = (id, paths = [root]) => require.resolve(id, { paths })
const readPackage = (id) => require(resolveFromRoot(`${id}/package.json`))
const getBetterSqliteDir = () => path.dirname(resolveFromRoot('better-sqlite3/package.json'))

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
      cacheDirName: `node-v${process.versions.modules}-${platform}-${arch}`
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
      cacheDirName: `electron-v${abi}-${platform}-${arch}`
    }
  }
  throw new Error(`unknown native target: ${target}`)
}

const cacheDir = (info) => path.join(cacheRoot, info.cacheDirName)
const cacheBinaryPath = (info) => path.join(cacheDir(info), 'better_sqlite3.node')
const resourceDir = (info) => path.join(resourceRoot, info.cacheDirName)
const resourceBinaryPath = (info) => path.join(resourceDir(info), 'better_sqlite3.node')

const ensureBinaryExists = (binaryPath, label) => {
  if (!existsSync(binaryPath)) {
    throw new Error(`${label} does not exist: ${binaryPath}`)
  }
}

const download = (url, targetPath, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error(`too many redirects while downloading ${url}`))
      return
    }

    const request = get(
      url,
      {
        headers: {
          'User-Agent': 'ncurator-native-prepare'
        }
      },
      (response) => {
        const statusCode = response.statusCode || 0
        const location = response.headers.location
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume()
          download(new URL(location, url).toString(), targetPath, redirectCount + 1)
            .then(resolve)
            .catch(reject)
          return
        }
        if (statusCode !== 200) {
          response.resume()
          reject(new Error(`download failed with HTTP ${statusCode}: ${url}`))
          return
        }
        pipeline(response, createWriteStream(targetPath)).then(resolve).catch(reject)
      }
    )
    request.setTimeout(180_000, () => {
      request.destroy(new Error(`download timed out: ${url}`))
    })
    request.on('error', reject)
  })

const readTar = () => {
  const betterSqliteDir = getBetterSqliteDir()
  const prebuildInstallPackagePath = require.resolve('prebuild-install/package.json', {
    paths: [betterSqliteDir]
  })
  const prebuildInstallDir = path.dirname(prebuildInstallPackagePath)
  return require(resolveFrom('tar-fs', [prebuildInstallDir]))
}

const downloadNativeToCache = async (info, options = {}) => {
  const betterSqliteVersion = readPackage('better-sqlite3').version
  const assetName = `better-sqlite3-v${betterSqliteVersion}-${info.runtime}-v${info.abi}-${info.platform}-${info.arch}.tar.gz`
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${betterSqliteVersion}/${assetName}`
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ncurator-better-sqlite3-'))
  const archivePath = path.join(tempDir, assetName)
  const extractDir = path.join(tempDir, 'extract')
  const extractedBinaryPath = path.join(extractDir, binaryRelativePath)
  const targetBinaryPath = cacheBinaryPath(info)

  try {
    await mkdir(extractDir, { recursive: true })
    const log = options.silent ? console.error : console.log
    log(
      `[native] downloading better-sqlite3 ${info.runtime} abi ${info.abi} (${info.platform}-${info.arch})`
    )
    await download(url, archivePath)
    await pipeline(
      createReadStream(archivePath),
      createGunzip(),
      readTar().extract(extractDir, {
        readable: true,
        writable: true,
        hardlinkAsFilesFallback: true
      })
    )
    ensureBinaryExists(extractedBinaryPath, 'downloaded better-sqlite3 binary')
    mkdirSync(path.dirname(targetBinaryPath), { recursive: true })
    copyFileSync(extractedBinaryPath, targetBinaryPath)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

const writeManifest = (infos) => {
  mkdirSync(cacheRoot, { recursive: true })
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        targets: infos.map((info) => ({
          ...info,
          cacheDir: path.relative(root, cacheDir(info)),
          cacheBinary: path.relative(root, cacheBinaryPath(info))
        }))
      },
      null,
      2
    )}\n`
  )
}

const ensureCache = async (target, options = {}) => {
  const info = targetInfo(target)
  if (!existsSync(cacheBinaryPath(info))) {
    await downloadNativeToCache(info, options)
  }
  ensureBinaryExists(cacheBinaryPath(info), `${info.runtime} cached better-sqlite3 binary`)
  writeManifest([info])
  if (!options.silent) {
    console.log(
      `[native] ready ${info.runtime} abi ${info.abi}: ${path.relative(root, cacheBinaryPath(info))}`
    )
  }
  return info
}

const printPath = async (target) => {
  const info = await ensureCache(target, { silent: true })
  process.stdout.write(`${cacheBinaryPath(info)}\n`)
}

const exportElectronResource = async () => {
  const info = await ensureCache('electron')
  mkdirSync(resourceDir(info), { recursive: true })
  copyFileSync(cacheBinaryPath(info), resourceBinaryPath(info))
  console.log(`[native] exported ${path.relative(root, resourceBinaryPath(info))}`)
}

const status = () => {
  if (existsSync(manifestPath)) {
    console.log(readFileSync(manifestPath, 'utf8').trim())
  } else {
    console.log('[native] no manifest')
  }
  for (const target of ['node', 'electron']) {
    const info = targetInfo(target)
    console.log(
      `[native] cache ${target}: ${existsSync(cacheBinaryPath(info)) ? 'ready' : 'missing'} ${path.relative(
        root,
        cacheBinaryPath(info)
      )}`
    )
    console.log(
      `[native] resource ${target}: ${existsSync(resourceBinaryPath(info)) ? 'ready' : 'missing'} ${path.relative(
        root,
        resourceBinaryPath(info)
      )}`
    )
  }
}

const clean = () => {
  rmSync(cacheRoot, { recursive: true, force: true })
  rmSync(resourceRoot, { recursive: true, force: true })
  console.log('[native] cache and resources removed')
}

const main = async () => {
  const command = process.argv[2] || 'status'
  const target = process.argv[3]
  if (command === 'ensure') {
    await ensureCache(target || 'node')
    return
  }
  if (command === 'path') {
    await printPath(target || 'node')
    return
  }
  if (command === 'prepare') {
    await ensureCache('node')
    await ensureCache('electron')
    return
  }
  if (command === 'export-electron-resource') {
    await exportElectronResource()
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
