import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright'

const execFileAsync = promisify(execFile)
const [appPath = '', outputPath = ''] = process.argv.slice(2)

if (!appPath || !outputPath) {
  throw new Error('usage: node scripts/release/verify-macos-signature.mjs <app> <output-file>')
}

await execFileAsync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
const { stdout, stderr } = await execFileAsync('/usr/bin/codesign', [
  '-d',
  '-r-',
  '--verbose=4',
  appPath
])
const signatureDetails = `${stdout}\n${stderr}`

if (/^Signature=adhoc$/mu.test(signatureDetails)) {
  throw new Error('macOS release must not use an ad-hoc signature')
}
if (/designated => .*cdhash\b/mu.test(signatureDetails)) {
  throw new Error('macOS designated requirement must remain stable across versions')
}
if (!/^Authority=.+$/mu.test(signatureDetails)) {
  throw new Error('macOS release does not contain a signing authority')
}
if (!/designated => .*identifier "com\.yoan\.ncurator"/mu.test(signatureDetails)) {
  throw new Error('macOS release has an unexpected designated requirement')
}

const verifyPackagedAppLaunch = async () => {
  const runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-launch-check-'))
  const userDataDirectory = path.join(runtimeDirectory, 'user-data')
  const homeDirectory = path.join(runtimeDirectory, 'home')
  await mkdir(userDataDirectory, { recursive: true })
  await mkdir(homeDirectory, { recursive: true })
  const { stdout: executableName } = await execFileAsync('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleExecutable',
    path.join(appPath, 'Contents', 'Info.plist')
  ])
  const executable = path.join(appPath, 'Contents', 'MacOS', executableName.trim())
  let output = ''
  let electronApp
  let legacyPortServer = null
  try {
    legacyPortServer = net.createServer()
    await new Promise((resolve, reject) => {
      legacyPortServer.once('error', (error) => {
        if (error?.code === 'EADDRINUSE') {
          legacyPortServer = null
          resolve()
          return
        }
        reject(error)
      })
      legacyPortServer.listen(9333, '127.0.0.1', resolve)
    })
  } catch (error) {
    legacyPortServer?.close()
    throw error
  }

  try {
    electronApp = await electron.launch({
      executablePath: executable,
      env: {
        ...process.env,
        HOME: homeDirectory,
        NCURATOR_E2E_OBSERVER: '1',
        NCURATOR_E2E_WINDOW_MODE: 'background',
        NCURATOR_USER_DATA_PATH: userDataDirectory
      },
      timeout: 60_000
    })
    const child = electronApp.process()
    child?.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })
    child?.stderr?.on('data', (chunk) => {
      output += String(chunk)
    })
    const page = await electronApp.firstWindow({ timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.api), undefined, { timeout: 60_000 })
    const deadline = Date.now() + 10_000
    let cdpVerified = false
    while (Date.now() < deadline) {
      try {
        const [portText] = (
          await readFile(path.join(userDataDirectory, 'DevToolsActivePort'), 'utf8')
        ).split(/\r?\n/u)
        const port = Number.parseInt(String(portText || '').trim(), 10)
        if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
          throw new Error('invalid DevToolsActivePort')
        }
        const response = await fetch(`http://127.0.0.1:${String(port)}/json/version`)
        if (!response.ok) throw new Error(`CDP endpoint returned ${response.status}`)
        cdpVerified = true
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    if (!cdpVerified) throw new Error('packaged app CDP endpoint did not become ready')
    process.stdout.write('[release] packaged macOS app launch verification passed\n')
  } catch (error) {
    throw new Error(`packaged macOS app did not become ready: ${String(error)}\n${output}`)
  } finally {
    await electronApp?.close().catch(() => undefined)
    await new Promise((resolve) => {
      if (!legacyPortServer) return resolve()
      legacyPortServer.close(() => resolve())
    })
    await rm(runtimeDirectory, { recursive: true, force: true })
  }
}

await verifyPackagedAppLaunch()

const identity = signatureDetails
  .split('\n')
  .filter((line) => /^(Authority=|designated =>)/u.test(line))
  .join('\n')
await writeFile(outputPath, `${identity}\n`, 'utf8')
process.stdout.write(`${identity}\n`)
