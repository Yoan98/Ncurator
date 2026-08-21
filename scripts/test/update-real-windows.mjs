import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { extractFile, uncache } from '@electron/asar'
import { _electron as electron } from 'playwright'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000

const parseArgs = (argv) => {
  const result = {
    sourceInstaller: '',
    sourceVersion: '',
    expectedVersion: '',
    targetInstaller: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    keepWork: false,
    reuseUpdateCache: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--source-installer' && value) result.sourceInstaller = path.resolve(value)
    else if (key === '--source-version' && value) result.sourceVersion = value
    else if (key === '--expected-version' && value) result.expectedVersion = value
    else if (key === '--target-installer' && value) result.targetInstaller = path.resolve(value)
    else if (key === '--timeout-ms' && value) result.timeoutMs = Number(value)
    else if (key === '--keep-work') {
      result.keepWork = true
      continue
    } else if (key === '--reuse-update-cache') {
      result.reuseUpdateCache = true
      continue
    } else continue
    index += 1
  }

  return result
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const pathExists = (filePath) =>
  access(filePath)
    .then(() => true)
    .catch(() => false)

const validateVersionPair = (sourceVersion, expectedVersion) => {
  const parseVersion = (version) => {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/u)
    return match ? match.slice(1).map(Number) : undefined
  }
  const source = parseVersion(sourceVersion)
  const expected = parseVersion(expectedVersion)
  if (!source || !expected) {
    throw new Error(
      'Pass explicit --source-version and --expected-version values, for example 0.1.68 -> 0.1.69'
    )
  }
  const comparison = expected.findIndex((value, index) => value !== source[index])
  if (comparison < 0 || expected[comparison] < source[comparison]) {
    throw new Error('expected-version must be newer than source-version')
  }
}

const allocatePort = async () => {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to allocate a debug port')
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return address.port
}

const runInherited = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32' && /\.(cmd|bat)$/iu.test(command),
      ...options
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${String(code ?? signal)}`))
    })
  })

const readInstalledVersion = async (installDirectory) => {
  const asarPath = path.join(installDirectory, 'resources', 'app.asar')
  uncache(asarPath)
  const packageJson = extractFile(asarPath, 'package.json')
  return JSON.parse(packageJson.toString('utf8')).version
}

const findExecutable = async (installDirectory) => {
  const entries = await readdir(installDirectory)
  const executable = entries.find(
    (name) => /\.exe$/iu.test(name) && !/^Uninstall .*\.exe$/iu.test(name)
  )
  if (!executable) throw new Error(`No main executable found in ${installDirectory}`)
  return path.join(installDirectory, executable)
}

const findUninstaller = async (installDirectory) => {
  const entries = await readdir(installDirectory)
  const uninstaller = entries.find((name) => /^Uninstall .*\.exe$/iu.test(name))
  return uninstaller ? path.join(installDirectory, uninstaller) : undefined
}

const buildInstaller = async ({ outputPath, version }) => {
  process.stdout.write(`[update-real-win] Building packaged version ${version}\n`)
  await runInherited('pnpm.cmd', ['run', 'build'])
  const electronBuilder = path.join(ROOT, 'node_modules', '.bin', 'electron-builder.cmd')
  await runInherited(electronBuilder, [
    '--win',
    '--x64',
    '--publish',
    'never',
    `--config.extraMetadata.version=${version}`,
    `--config.directories.output=${outputPath}`
  ])
  const installerName = (await readdir(outputPath)).find((name) => /\.exe$/iu.test(name))
  if (!installerName) throw new Error(`Built installer was not found in ${outputPath}`)
  const installerPath = path.join(outputPath, installerName)
  if (!(await pathExists(installerPath))) {
    throw new Error(`Built installer was not found: ${installerPath}`)
  }
  return installerPath
}

const installSourceVersion = async (installerPath, installDirectory, logs) => {
  process.stdout.write(`[update-real-win] Installing ${installerPath}\n`)
  try {
    const result = await execFileAsync(
      installerPath,
      ['/S', '/currentuser', `/D=${installDirectory}`],
      {
        timeout: 10 * 60 * 1000,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      }
    )
    if (result.stdout.trim()) logs.push(`[installer:stdout] ${result.stdout.trim()}`)
    if (result.stderr.trim()) logs.push(`[installer:stderr] ${result.stderr.trim()}`)
  } catch (error) {
    const detail = error instanceof Error ? `${error.message} (code=${String(error.code)})` : String(error)
    throw new Error(`Source installer failed: ${detail}`)
  }
  const executablePath = await findExecutable(installDirectory)
  return executablePath
}

const stopInstalledProcesses = async (installDirectory) => {
  const escaped = installDirectory.replaceAll("'", "''")
  const command =
    `$root = [IO.Path]::GetFullPath('${escaped}').TrimEnd('\\') + '\\'; ` +
    'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ' +
    'Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } | ' +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    windowsHide: true
  }).catch(() => undefined)
  await delay(1000)
}

const waitForInstalledVersion = async (installDirectory, expectedVersion, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  let version = ''
  while (Date.now() < deadline) {
    try {
      version = await readInstalledVersion(installDirectory)
      if (version === expectedVersion) return version
    } catch {
      // The installer can briefly replace app.asar while this poll is running.
    }
    await delay(2000)
  }
  return version
}

const isUpdaterInstallerRunning = async () => {
  const command =
    '@(Get-CimInstance Win32_Process -Filter "Name LIKE \'%Windows-x64.exe\' -or Name LIKE \'%windows-x64.exe\'" -ErrorAction SilentlyContinue).Count'
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    windowsHide: true
  })
  return Number(stdout.trim()) > 0
}

const waitForUpdaterInstallerExit = async (timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  let consecutiveNotRunning = 0
  while (Date.now() < deadline) {
    const running = await isUpdaterInstallerRunning()
    consecutiveNotRunning = running ? 0 : consecutiveNotRunning + 1
    if (consecutiveNotRunning >= 5) return
    await delay(1000)
  }
  throw new Error('Timed out waiting for the Windows update installer to exit')
}

const launchApp = async ({ executablePath, userDataPath, port, logs }) => {
  const electronApp = await electron.launch({
    executablePath,
    cwd: path.dirname(executablePath),
    env: {
      ...process.env,
      NCURATOR_E2E_OBSERVER: '1',
      NCURATOR_E2E_WINDOW_MODE: 'visible',
      NCURATOR_USER_DATA_PATH: userDataPath,
      NCURATOR_EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT: String(port)
    },
    timeout: 120_000
  })
  const child = electronApp.process()
  child?.stdout?.on('data', (chunk) => logs.push(`[stdout] ${String(chunk).trim()}`))
  child?.stderr?.on('data', (chunk) => logs.push(`[stderr] ${String(chunk).trim()}`))
  const page = await electronApp.firstWindow({ timeout: 120_000 })
  await page.waitForFunction(() => Boolean(window.api), undefined, { timeout: 120_000 })
  return { electronApp, page }
}

const recordSnapshot = (snapshot, statusHistory) => {
  statusHistory.push({
    at: new Date().toISOString(),
    status: snapshot.status,
    currentVersion: snapshot.currentVersion,
    availableVersion: snapshot.availableVersion,
    progressPercent: snapshot.progressPercent,
    error: snapshot.error
  })
}

const waitForStatus = async ({ page, statuses, timeoutMs, statusHistory }) => {
  const deadline = Date.now() + timeoutMs
  let previousStatus = ''
  let previousProgressStep = -1
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => window.api.appUpdateGetSnapshot())
    const progressStep = Math.floor(snapshot.progressPercent || 0)
    const changed =
      snapshot.status !== previousStatus ||
      (snapshot.status === 'downloading' && progressStep >= previousProgressStep + 5)
    if (changed) {
      recordSnapshot(snapshot, statusHistory)
      process.stdout.write(
        `[update-real-win] ${snapshot.status}${snapshot.progressPercent == null ? '' : ` ${snapshot.progressPercent.toFixed(1)}%`}\n`
      )
      previousStatus = snapshot.status
      previousProgressStep = progressStep
    }
    if (statuses.includes(snapshot.status)) return snapshot
    await delay(1000)
  }
  throw new Error(`Timed out waiting for update status: ${statuses.join(', ')}`)
}

const createLocalFeed = async ({ directory }) => {
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/u, '')
    const filePath = path.join(directory, requestPath)
    if (!path.resolve(filePath).startsWith(path.resolve(directory))) {
      res.writeHead(403)
      res.end()
      return
    }
    readFile(filePath)
      .then((data) => {
        const contentType = requestPath.endsWith('.yml')
          ? 'text/yaml; charset=utf-8'
          : 'application/octet-stream'
        res.writeHead(200, {
          'content-type': contentType,
          'content-length': data.length,
          'cache-control': 'no-store'
        })
        res.end(data)
      })
      .catch(() => {
        res.writeHead(404)
        res.end()
      })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = address && typeof address === 'object' ? address.port : 0
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

const sha512Base64 = async (filePath) => {
  const data = await readFile(filePath)
  return createHash('sha512').update(data).digest('base64')
}

const writeLatestYml = async ({ installerPath, version, feedDirectory }) => {
  const fileName = path.basename(installerPath)
  const stats = await stat(installerPath)
  const sha512 = await sha512Base64(installerPath)
  const latest = [
    `version: ${version}`,
    'files:',
    `  - url: ${fileName}`,
    `    sha512: ${sha512}`,
    `    size: ${stats.size}`,
    `path: ${fileName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  ].join('\n')
  await writeFile(path.join(feedDirectory, 'latest.yml'), latest, 'utf8')
  return latest
}

const repointInstalledUpdateUrl = async (installDirectory, updateUrl) => {
  const configPath = path.join(installDirectory, 'resources', 'app-update.yml')
  const config = await readFile(configPath, 'utf8')
  const updated = config.replace(/^url:\s*\S+.*$/mu, `url: ${updateUrl}`)
  if (updated === config) {
    throw new Error(`Installed application is missing its update url: ${configPath}`)
  }
  await writeFile(configPath, updated, 'utf8')
  return updateUrl
}

const uninstallTestApp = async (installDirectory, logs) => {
  await stopInstalledProcesses(installDirectory)
  const uninstallerPath = await findUninstaller(installDirectory)
  if (!uninstallerPath) return
  const result = await execFileAsync(uninstallerPath, ['/S'], {
    timeout: 5 * 60 * 1000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  }).catch((error) => ({ stdout: '', stderr: String(error) }))
  if (result.stdout?.trim()) logs.push(`[uninstaller:stdout] ${result.stdout.trim()}`)
  if (result.stderr?.trim()) logs.push(`[uninstaller:stderr] ${result.stderr.trim()}`)
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const present = await findExecutable(installDirectory)
      .then(() => true)
      .catch(() => false)
    if (!present) return
    await delay(1000)
  }
}

const main = async () => {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('The Windows real update test requires Windows x64')
  }

  const options = parseArgs(process.argv.slice(2))
  validateVersionPair(options.sourceVersion, options.expectedVersion)
  const runId = new Date().toISOString().replace(/[:.]/gu, '-')
  const reportDirectory = path.join(
    ROOT,
    'tests',
    'logs',
    'settings',
    'update',
    'real-windows',
    runId
  )
  const runtimeDirectory = path.join(ROOT, '.codex-tmp', 'app-update-real-windows', runId)
  const outputPath = path.join(runtimeDirectory, 'packaged')
  const feedDirectory = path.join(runtimeDirectory, 'feed')
  const installDirectory = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ncurator')
  const userDataPath = path.join(runtimeDirectory, 'user-data')
  const updaterCacheDirectory = path.join(process.env.LOCALAPPDATA, 'ncurator-updater')
  const updaterCacheBackupDirectory = path.join(
    process.env.LOCALAPPDATA,
    `ncurator-updater.update-real-backup-${runId}`
  )
  const markerPath = path.join(userDataPath, 'update-smoke-marker.txt')
  const logs = []
  const statusHistory = []
  const startedAt = new Date().toISOString()
  let firstLaunch
  let finalLaunch
  let report
  let feed
  let updateUrl = 'local-feed'
  let updaterCacheBackedUp = false
  let testInstallationOwned = false

  await mkdir(reportDirectory, { recursive: true })
  await mkdir(runtimeDirectory, { recursive: true })
  await mkdir(userDataPath, { recursive: true })
  await mkdir(feedDirectory, { recursive: true })
  await writeFile(markerPath, `created=${startedAt}\n`, 'utf8')

  try {
    if (await pathExists(installDirectory)) {
      const entries = await readdir(installDirectory).catch(() => [])
      if (entries.some((name) => /\.exe$/iu.test(name))) {
        throw new Error(`Refusing to replace an existing Ncurator installation: ${installDirectory}`)
      }
    }
    testInstallationOwned = true
    if (!options.reuseUpdateCache && (await pathExists(updaterCacheDirectory))) {
      await rename(updaterCacheDirectory, updaterCacheBackupDirectory)
      updaterCacheBackedUp = true
    }

    const sourceInstaller =
      options.sourceInstaller ||
      (await buildInstaller({ outputPath, version: options.sourceVersion }))
    options.sourceInstaller = sourceInstaller
    const executablePath = await installSourceVersion(sourceInstaller, installDirectory, logs)

    const preparedVersion = await readInstalledVersion(installDirectory)
    if (preparedVersion !== options.sourceVersion) {
      throw new Error(
        `Installed source version is ${preparedVersion}, expected ${options.sourceVersion}`
      )
    }

    const targetInstaller =
      options.targetInstaller ||
      (await buildInstaller({ outputPath, version: options.expectedVersion }))
    options.targetInstaller = targetInstaller
    const stagedInstallerPath = path.join(feedDirectory, path.basename(targetInstaller))
    await cp(targetInstaller, stagedInstallerPath)
    await writeLatestYml({
      installerPath: stagedInstallerPath,
      version: options.expectedVersion,
      feedDirectory
    })

    feed = await createLocalFeed({ directory: feedDirectory })
    updateUrl = feed.url
    process.stdout.write(`[update-real-win] Local update feed: ${updateUrl}\n`)
    await repointInstalledUpdateUrl(installDirectory, updateUrl)

    firstLaunch = await launchApp({
      executablePath,
      userDataPath,
      port: await allocatePort(),
      logs
    })
    const initialSnapshot = await firstLaunch.page.evaluate(() => window.api.appUpdateGetSnapshot())
    recordSnapshot(initialSnapshot, statusHistory)
    if (!initialSnapshot.isPackaged || initialSnapshot.currentVersion !== options.sourceVersion) {
      throw new Error(
        `Packaged application reported an invalid version: ${initialSnapshot.currentVersion}`
      )
    }
    await firstLaunch.page.screenshot({
      path: path.join(reportDirectory, '01-installed-source.png'),
      fullPage: true
    })

    await firstLaunch.page.evaluate(() => window.api.appUpdateCheck())
    const available = await waitForStatus({
      page: firstLaunch.page,
      statuses: ['available', 'error'],
      timeoutMs: options.timeoutMs,
      statusHistory
    })
    if (available.status === 'error') throw new Error(available.error || 'Update check failed')
    if (available.availableVersion !== options.expectedVersion) {
      throw new Error(
        `Available version is ${available.availableVersion || 'unknown'}, expected ${options.expectedVersion}`
      )
    }
    await firstLaunch.page.screenshot({
      path: path.join(reportDirectory, '02-update-available.png'),
      fullPage: true
    })

    const updateButton = firstLaunch.page.getByTestId('workbench-app-update-button')
    if (await updateButton.isVisible().catch(() => false)) await updateButton.click()
    else await firstLaunch.page.evaluate(() => window.api.appUpdateDownload())
    const downloaded = await waitForStatus({
      page: firstLaunch.page,
      statuses: ['downloaded', 'error'],
      timeoutMs: options.timeoutMs,
      statusHistory
    })
    if (downloaded.status === 'error') throw new Error(downloaded.error || 'Update download failed')
    await firstLaunch.page.screenshot({
      path: path.join(reportDirectory, '03-update-downloaded.png'),
      fullPage: true
    })

    const processExit = new Promise((resolve) => {
      firstLaunch.electronApp.process()?.once('exit', (code, signal) => resolve({ code, signal }))
    })
    if (await updateButton.isVisible().catch(() => false)) await updateButton.click()
    else await firstLaunch.page.evaluate(() => window.api.appUpdateInstall()).catch(() => undefined)
    await Promise.race([processExit, delay(60_000)])
    await waitForUpdaterInstallerExit(10 * 60 * 1000)

    const finalInstalledVersion = await waitForInstalledVersion(
      installDirectory,
      options.expectedVersion,
      5 * 60 * 1000
    )
    if (finalInstalledVersion !== options.expectedVersion) {
      throw new Error(
        `Installed version remained ${finalInstalledVersion || 'unreadable'} after update; expected ${options.expectedVersion}. This matches the "Failed to uninstall old application files" failure mode when the old installation files are still locked.`
      )
    }

    await stopInstalledProcesses(installDirectory)
    finalLaunch = await launchApp({
      executablePath,
      userDataPath,
      port: await allocatePort(),
      logs
    })
    const finalSnapshot = await finalLaunch.page.evaluate(() => window.api.appUpdateGetSnapshot())
    recordSnapshot(finalSnapshot, statusHistory)
    const markerPreserved = await pathExists(markerPath)
    await finalLaunch.page.screenshot({
      path: path.join(reportDirectory, '04-updated-app.png'),
      fullPage: true
    })

    report = {
      success: finalSnapshot.currentVersion === options.expectedVersion && markerPreserved,
      startedAt,
      finishedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      sourceVersion: options.sourceVersion,
      expectedVersion: options.expectedVersion,
      finalInstalledVersion,
      finalReportedVersion: finalSnapshot.currentVersion,
      markerPreserved,
      statusHistory,
      sourceInstaller: options.sourceInstaller,
      targetInstaller: options.targetInstaller,
      updateUrl,
      installDirectory
    }
    if (!report.success) process.exitCode = 1
  } catch (error) {
    report = {
      success: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      sourceVersion: options.sourceVersion,
      expectedVersion: options.expectedVersion,
      statusHistory,
      sourceInstaller: options.sourceInstaller,
      targetInstaller: options.targetInstaller,
      updateUrl,
      installDirectory,
      error: error instanceof Error ? error.stack || error.message : String(error)
    }
    process.exitCode = 1
  } finally {
    await feed?.close().catch(() => undefined)
    await firstLaunch?.electronApp.close().catch(() => undefined)
    await finalLaunch?.electronApp.close().catch(() => undefined)
    if (testInstallationOwned) await uninstallTestApp(installDirectory, logs)
    if (!options.reuseUpdateCache) {
      await rm(updaterCacheDirectory, { recursive: true, force: true })
      if (updaterCacheBackedUp) {
        await rename(updaterCacheBackupDirectory, updaterCacheDirectory)
      }
    }
    await writeFile(path.join(reportDirectory, 'process.log'), `${logs.join('\n')}\n`, 'utf8')
    await writeFile(
      path.join(reportDirectory, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    )
    if (!options.keepWork) await rm(runtimeDirectory, { recursive: true, force: true })
    process.stdout.write(`[update-real-win] Report: ${path.join(reportDirectory, 'report.json')}\n`)
  }
}

await main()
