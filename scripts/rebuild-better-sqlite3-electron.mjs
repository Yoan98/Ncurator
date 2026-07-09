import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { get } from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()

const resolveFrom = (id, paths = [root]) => require.resolve(id, { paths })
const resolveFromRoot = (id) => resolveFrom(id)

const readPackage = (id) => require(resolveFromRoot(`${id}/package.json`))

const download = (url, targetPath, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error(`Too many redirects while downloading ${url}`))
      return
    }

    const request = get(
      url,
      {
        headers: {
          'User-Agent': 'ncurator-native-rebuild'
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
          reject(new Error(`Download failed with HTTP ${statusCode}: ${url}`))
          return
        }

        pipeline(response, createWriteStream(targetPath)).then(resolve).catch(reject)
      }
    )
    request.setTimeout(180_000, () => {
      request.destroy(new Error(`Download timed out: ${url}`))
    })
    request.on('error', reject)
  })

export const rebuildBetterSqlite3ForElectron = async (input = {}) => {
  const electronVersion = input.electronVersion || readPackage('electron').version
  const platform = input.platform || process.platform
  const arch = input.arch || process.arch
  const betterSqlitePackagePath = resolveFromRoot('better-sqlite3/package.json')
  const betterSqliteDir = path.dirname(betterSqlitePackagePath)
  const betterSqliteVersion = readPackage('better-sqlite3').version
  const prebuildInstallPackagePath = resolveFrom('prebuild-install/package.json', [
    betterSqliteDir
  ])
  const prebuildInstallDir = path.dirname(prebuildInstallPackagePath)
  const { getAbi } = require(resolveFrom('node-abi', [prebuildInstallDir]))
  const tar = require(resolveFrom('tar-fs', [prebuildInstallDir]))
  const abi = getAbi(electronVersion, 'electron')
  const assetName = `better-sqlite3-v${betterSqliteVersion}-electron-v${abi}-${platform}-${arch}.tar.gz`
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${betterSqliteVersion}/${assetName}`
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ncurator-better-sqlite3-'))
  const archivePath = path.join(tempDir, assetName)
  const binaryPath = path.join(betterSqliteDir, 'build', 'Release', 'better_sqlite3.node')

  try {
    await mkdir(path.dirname(binaryPath), { recursive: true })
    console.log(
      `[native] installing better-sqlite3 for electron ${electronVersion} ${platform}-${arch}`
    )
    await download(url, archivePath)
    await pipeline(
      createReadStream(archivePath),
      createGunzip(),
      tar.extract(betterSqliteDir, {
        readable: true,
        writable: true,
        hardlinkAsFilesFallback: true
      })
    )
    if (!existsSync(binaryPath)) {
      throw new Error(`better-sqlite3 native binary was not extracted: ${binaryPath}`)
    }
    console.log(`[native] installed ${path.relative(root, binaryPath)}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export default async function beforeBuild(context = {}) {
  await rebuildBetterSqlite3ForElectron({
    electronVersion: context.electronVersion,
    platform: context.platform?.nodeName,
    arch: context.arch
  })
  return false
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await rebuildBetterSqlite3ForElectron()
}
