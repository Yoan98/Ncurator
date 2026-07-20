import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const require = createRequire(import.meta.url)
const WIN_CODE_SIGN_VERSION = '2.6.0'
const WIN_CODE_SIGN_ARCHIVE = `winCodeSign-${WIN_CODE_SIGN_VERSION}.7z`
const WIN_CODE_SIGN_URL =
  `https://github.com/electron-userland/electron-builder-binaries/releases/download/` +
  `winCodeSign-${WIN_CODE_SIGN_VERSION}/${WIN_CODE_SIGN_ARCHIVE}`
const WIN_CODE_SIGN_SHA512 =
  'e8b408d9df413c2dd7b346684d07b5a37b4f880dbc73bf8f63af50f62fe90fc958e39a6c32d1ee2f0bf7bd1724895af7671d5c6cdc8b94147c493c0275c1f0b4'

if (process.platform !== 'win32') process.exit(0)

const cacheRoot = path.resolve(
  String(process.env.ELECTRON_BUILDER_CACHE || '').trim() ||
    path.join(process.env.LOCALAPPDATA || os.homedir(), 'electron-builder', 'Cache')
)
const vendorRoot = path.join(cacheRoot, 'winCodeSign')
const vendorDirectory = path.join(vendorRoot, `winCodeSign-${WIN_CODE_SIGN_VERSION}`)
const requiredFiles = [
  path.join(vendorDirectory, 'rcedit-x64.exe'),
  path.join(vendorDirectory, 'windows-10', 'x64', 'signtool.exe')
]

const fileExists = (filePath) =>
  access(filePath)
    .then(() => true)
    .catch(() => false)

const cacheIsReady = async () =>
  (await Promise.all(requiredFiles.map((filePath) => fileExists(filePath)))).every(Boolean)

if (await cacheIsReady()) {
  process.stdout.write(`[build:win] electron-builder winCodeSign cache is ready\n`)
  process.exit(0)
}

const canCreateSymbolicLinks = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-symlink-probe-'))
  try {
    const target = path.join(directory, 'target')
    await writeFile(target, 'probe', 'utf8')
    await symlink(target, path.join(directory, 'link'))
    return true
  } catch {
    return false
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (await canCreateSymbolicLinks()) {
  process.stdout.write(
    '[build:win] symbolic links are available; electron-builder will prepare winCodeSign\n'
  )
  process.exit(0)
}

const sevenZipPackage = require.resolve('7zip-bin/package.json', {
  paths: [path.dirname(require.resolve('electron-builder/package.json'))]
})
const sevenZip = path.join(path.dirname(sevenZipPackage), 'win', 'x64', '7za.exe')
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-wincodesign-'))
const archivePath = path.join(temporaryDirectory, WIN_CODE_SIGN_ARCHIVE)
const extractedDirectory = path.join(temporaryDirectory, 'extracted')

const run = (command, commandArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })

try {
  process.stdout.write('[build:win] preparing winCodeSign without symbolic links\n')
  const response = await fetch(WIN_CODE_SIGN_URL)
  if (!response.ok) {
    throw new Error(`winCodeSign download failed: HTTP ${response.status}`)
  }
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()))
  const archiveHash = createHash('sha512')
    .update(await readFile(archivePath))
    .digest('hex')
  if (archiveHash !== WIN_CODE_SIGN_SHA512) {
    throw new Error('winCodeSign archive SHA512 verification failed')
  }

  await mkdir(extractedDirectory, { recursive: true })
  await run(sevenZip, ['x', '-snl-', '-bd', archivePath, `-o${extractedDirectory}`])
  for (const relativePath of ['rcedit-x64.exe', path.join('windows-10', 'x64', 'signtool.exe')]) {
    if (!(await fileExists(path.join(extractedDirectory, relativePath)))) {
      throw new Error(`winCodeSign archive is missing ${relativePath}`)
    }
  }

  await mkdir(vendorRoot, { recursive: true })
  const resolvedVendorRoot = path.resolve(vendorRoot)
  if (path.dirname(path.resolve(vendorDirectory)) !== resolvedVendorRoot) {
    throw new Error(`refusing to replace unexpected cache path: ${vendorDirectory}`)
  }
  await rm(vendorDirectory, { recursive: true, force: true })
  try {
    await rename(extractedDirectory, vendorDirectory)
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    await cp(extractedDirectory, vendorDirectory, { recursive: true })
  }
  process.stdout.write(`[build:win] prepared ${vendorDirectory}\n`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
