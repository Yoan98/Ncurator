import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000

const parseArgs = (argv) => {
  const result = {
    sourceApp: '',
    sourceVersion: '',
    expectedVersion: '',
    timeoutMs: DEFAULT_TIMEOUT_MS
  }

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--source-app' && value) result.sourceApp = path.resolve(value)
    else if (key === '--source-version' && value) result.sourceVersion = value
    else if (key === '--expected-version' && value) result.expectedVersion = value
    else if (key === '--timeout-ms' && value) result.timeoutMs = Number(value)
    else continue
    index += 1
  }

  return result
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const validateVersionPair = (sourceVersion, expectedVersion) => {
  const parseVersion = (version) => {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/u)
    return match ? match.slice(1).map(Number) : undefined
  }
  const source = parseVersion(sourceVersion)
  const expected = parseVersion(expectedVersion)
  if (!source || !expected) {
    throw new Error('必须显式传入 --source-version 和 --expected-version，例如 0.1.1 -> 0.1.2')
  }
  const comparison = expected.findIndex((value, index) => value !== source[index])
  if (comparison < 0 || expected[comparison] < source[comparison]) {
    throw new Error('expected-version 必须高于 source-version')
  }
}

const allocatePort = async () => {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法分配调试端口')
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return address.port
}

const readBundleVersion = async (appPath) => {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist')
  const { stdout } = await execFileAsync('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    plistPath
  ])
  return stdout.trim()
}

const readBundleExecutable = async (appPath) => {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist')
  const { stdout } = await execFileAsync('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleExecutable',
    plistPath
  ])
  return stdout.trim()
}

const readGenericUpdateUrl = async () => {
  const builderConfig = await readFile(path.join(ROOT, 'electron-builder.yml'), 'utf8')
  const publishBlock = builderConfig.match(
    /publish:\s*\n\s*provider:\s*generic\s*\n\s*url:\s*([^\s#]+)/u
  )
  if (!publishBlock?.[1]) {
    throw new Error('electron-builder.yml 必须配置 generic 自动更新地址')
  }
  return publishBlock[1]
}

const readEmbeddedUpdateUrl = async (appPath) => {
  const configPath = path.join(appPath, 'Contents', 'Resources', 'app-update.yml')
  const config = await readFile(configPath, 'utf8')
  const match = config.match(/^url:\s*(\S+)$/mu)
  if (!match?.[1]) throw new Error('测试 App 缺少自动更新地址')
  return match[1]
}

const verifyStableMacSignature = async (appPath) => {
  await execFileAsync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
  const { stderr } = await execFileAsync('/usr/bin/codesign', ['-d', '-r-', '--verbose=4', appPath])
  if (/^Signature=adhoc$/mu.test(stderr) || /designated => .*cdhash\b/mu.test(stderr)) {
    throw new Error('真实更新测试要求固定的非 ad-hoc macOS 签名')
  }
  if (!/^Authority=.+$/mu.test(stderr)) {
    throw new Error('真实更新测试没有找到 macOS 签名身份')
  }
}

const resolveBuiltAppPath = async (outputPath) => {
  const candidates = [
    path.join(outputPath, `mac-${process.arch}`, '馆长.app'),
    path.join(outputPath, 'mac', '馆长.app'),
    path.join(outputPath, `mac-${process.arch}`, 'Ncurator.app'),
    path.join(outputPath, 'mac', 'Ncurator.app')
  ]
  for (const candidate of candidates) {
    if (
      await access(candidate)
        .then(() => true)
        .catch(() => false)
    )
      return candidate
  }
  throw new Error(`没有找到测试旧版本 App：${outputPath}`)
}

const buildOldApp = async ({ outputPath, version, logs }) => {
  const electronBuilder = path.join(ROOT, 'node_modules', '.bin', 'electron-builder')
  process.stdout.write(`[update-real] 打包测试旧版本 ${version}\n`)
  const { stdout, stderr } = await execFileAsync(
    electronBuilder,
    [
      '--mac',
      `--${process.arch}`,
      '--dir',
      '--publish',
      'never',
      '--config.forceCodeSigning=true',
      `--config.extraMetadata.version=${version}`,
      `--config.directories.output=${outputPath}`
    ],
    {
      cwd: ROOT,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    }
  )
  if (stdout.trim()) logs.push(`[electron-builder:stdout] ${stdout.trim()}`)
  if (stderr.trim()) logs.push(`[electron-builder:stderr] ${stderr.trim()}`)
  return await resolveBuiltAppPath(outputPath)
}

const terminateTestApp = async (appPath) => {
  await execFileAsync('/usr/bin/pkill', ['-f', appPath]).catch(() => undefined)
  await delay(1000)
}

const waitForBundleVersion = async (appPath, expectedVersion, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  let version = await readBundleVersion(appPath)
  while (Date.now() < deadline && version !== expectedVersion) {
    await delay(2000)
    version = await readBundleVersion(appPath)
  }
  return version
}

const launchApp = async ({ appPath, userDataPath, homePath, remoteDebuggingPort, logs }) => {
  const executableName = await readBundleExecutable(appPath)
  const executablePath = path.join(appPath, 'Contents', 'MacOS', executableName)
  const electronApp = await electron.launch({
    executablePath,
    cwd: path.dirname(appPath),
    env: {
      ...process.env,
      HOME: homePath,
      NCURATOR_E2E_OBSERVER: '1',
      NCURATOR_E2E_WINDOW_MODE: 'background',
      NCURATOR_USER_DATA_PATH: userDataPath,
      NCURATOR_EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort)
    }
  })
  const child = electronApp.process()
  child?.stdout?.on('data', (chunk) => logs.push(`[stdout] ${String(chunk).trim()}`))
  child?.stderr?.on('data', (chunk) => logs.push(`[stderr] ${String(chunk).trim()}`))
  const page = await electronApp.firstWindow()
  await page.waitForFunction(() => Boolean(window.api))
  return { electronApp, page }
}

const waitForUpdateDownload = async (page, timeoutMs, statusHistory) => {
  const deadline = Date.now() + timeoutMs
  let previousStatus = ''
  let previousProgressStep = -1

  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => window.api.appUpdateGetSnapshot())
    const progressStep = Math.floor(snapshot.progressPercent || 0)
    const shouldRecord =
      snapshot.status !== previousStatus ||
      (snapshot.status === 'downloading' && progressStep > previousProgressStep)
    if (shouldRecord) {
      statusHistory.push({
        at: new Date().toISOString(),
        status: snapshot.status,
        currentVersion: snapshot.currentVersion,
        availableVersion: snapshot.availableVersion,
        progressPercent: snapshot.progressPercent,
        error: snapshot.error
      })
      process.stdout.write(
        `[update-real] ${snapshot.status}${snapshot.progressPercent == null ? '' : ` ${snapshot.progressPercent.toFixed(1)}%`}\n`
      )
      previousStatus = snapshot.status
      previousProgressStep = progressStep
    }
    if (snapshot.status === 'downloaded' || snapshot.status === 'error') return snapshot
    await delay(2000)
  }

  throw new Error(`等待更新下载超时（${String(timeoutMs)}ms）`)
}

const waitForUpdateAvailable = async (page, timeoutMs, statusHistory) => {
  const deadline = Date.now() + timeoutMs
  let previousStatus = ''

  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => window.api.appUpdateGetSnapshot())
    if (snapshot.status !== previousStatus) {
      statusHistory.push({
        at: new Date().toISOString(),
        status: snapshot.status,
        currentVersion: snapshot.currentVersion,
        availableVersion: snapshot.availableVersion,
        error: snapshot.error
      })
      process.stdout.write(`[update-real] ${snapshot.status}\n`)
      previousStatus = snapshot.status
    }
    if (snapshot.status === 'available' || snapshot.status === 'error') return snapshot
    await delay(1000)
  }

  throw new Error(`等待发现新版本超时（${String(timeoutMs)}ms）`)
}

const main = async () => {
  if (process.platform !== 'darwin') {
    throw new Error('当前真实升级脚本只支持 macOS；Windows 需要在 Windows 测试机执行')
  }

  const options = parseArgs(process.argv.slice(2))
  validateVersionPair(options.sourceVersion, options.expectedVersion)
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const reportDir = path.join(ROOT, 'tests', 'logs', 'settings', 'update', 'real', runId)
  const runtimeDir = path.join(ROOT, '.codex-tmp', 'app-update-real', runId)
  const packagedOutputPath = path.join(runtimeDir, 'packaged')
  const testAppPath = path.join(runtimeDir, 'Ncurator.app')
  const userDataPath = path.join(runtimeDir, 'user-data')
  const homePath = path.join(runtimeDir, 'home')
  const markerPath = path.join(userDataPath, 'update-smoke-marker.txt')
  const logs = []
  const statusHistory = []
  const startedAt = new Date().toISOString()
  let firstLaunch
  let report
  let updateUrl = 'production'

  await mkdir(reportDir, { recursive: true })
  await mkdir(userDataPath, { recursive: true })
  await mkdir(homePath, { recursive: true })
  await writeFile(markerPath, `created=${startedAt}\n`, 'utf8')

  try {
    updateUrl = await readGenericUpdateUrl()
    const sourceApp =
      options.sourceApp ||
      (await buildOldApp({
        outputPath: packagedOutputPath,
        version: options.sourceVersion,
        logs
      }))
    options.sourceApp = sourceApp
    process.stdout.write(`[update-real] 克隆测试 App：${sourceApp}\n`)
    await execFileAsync('/bin/cp', ['-cR', sourceApp, testAppPath])
    await verifyStableMacSignature(testAppPath)
    const embeddedUpdateUrl = await readEmbeddedUpdateUrl(testAppPath)
    if (embeddedUpdateUrl !== updateUrl) {
      throw new Error(`测试 App 更新地址不正确：${embeddedUpdateUrl}`)
    }
    const preparedVersion = await readBundleVersion(testAppPath)
    if (preparedVersion !== options.sourceVersion) {
      throw new Error(`测试旧版本准备失败：${preparedVersion}`)
    }

    const remoteDebuggingPort = await allocatePort()
    firstLaunch = await launchApp({
      appPath: testAppPath,
      userDataPath,
      homePath,
      remoteDebuggingPort,
      logs
    })
    const initialSnapshot = await firstLaunch.page.evaluate(() => window.api.appUpdateGetSnapshot())
    if (initialSnapshot.currentVersion !== options.sourceVersion) {
      throw new Error(`应用读取到的版本不正确：${initialSnapshot.currentVersion}`)
    }

    await firstLaunch.page.evaluate(() => window.api.appUpdateCheck())
    const availableSnapshot = await waitForUpdateAvailable(
      firstLaunch.page,
      options.timeoutMs,
      statusHistory
    )
    if (availableSnapshot.status === 'error') {
      throw new Error(availableSnapshot.error || '真实更新检查失败')
    }
    if (availableSnapshot.availableVersion !== options.expectedVersion) {
      throw new Error(`线上目标版本不符合预期：${availableSnapshot.availableVersion || '未知版本'}`)
    }

    await firstLaunch.page.evaluate(() => {
      void window.api.appUpdateDownload()
    })
    const downloadedSnapshot = await waitForUpdateDownload(
      firstLaunch.page,
      options.timeoutMs,
      statusHistory
    )
    if (downloadedSnapshot.status === 'error') {
      throw new Error(downloadedSnapshot.error || '真实更新下载失败')
    }
    if (downloadedSnapshot.availableVersion !== options.expectedVersion) {
      throw new Error(
        `下载完成版本不符合预期：${downloadedSnapshot.availableVersion || '未知版本'}`
      )
    }

    const processExit = new Promise((resolve) => {
      firstLaunch.electronApp.process()?.once('exit', (code, signal) => resolve({ code, signal }))
    })
    await firstLaunch.page.evaluate(() => window.api.appUpdateInstall()).catch(() => undefined)
    await Promise.race([processExit, delay(30_000)])

    const finalBundleVersion = await waitForBundleVersion(
      testAppPath,
      options.expectedVersion,
      120_000
    )
    const markerPreserved = await import('node:fs/promises')
      .then(({ access }) => access(markerPath).then(() => true))
      .catch(() => false)
    const installError = [...logs]
      .reverse()
      .find(
        (entry) =>
          entry.includes('SQRLCodeSignatureErrorDomain') || entry.includes('Code signature at URL')
      )

    report = {
      success: finalBundleVersion === options.expectedVersion && markerPreserved,
      startedAt,
      finishedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      sourceVersion: options.sourceVersion,
      expectedVersion: options.expectedVersion,
      finalBundleVersion,
      markerPreserved,
      installError,
      statusHistory,
      sourceApp: options.sourceApp,
      updateUrl,
      note:
        finalBundleVersion === options.expectedVersion
          ? '真实更新已替换测试 App'
          : installError
            ? '更新包已下载并校验通过，但 macOS 代码签名校验阻止了安装'
            : '更新包已下载，但测试 App 没有被替换；请检查 Squirrel 日志'
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
      sourceApp: options.sourceApp,
      updateUrl,
      error: error instanceof Error ? error.message : String(error)
    }
    process.exitCode = 1
  } finally {
    await firstLaunch?.electronApp.close().catch(() => undefined)
    await terminateTestApp(testAppPath)
    await writeFile(path.join(reportDir, 'process.log'), `${logs.join('\n')}\n`, 'utf8')
    await writeFile(
      path.join(reportDir, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    )
    await rm(runtimeDir, { recursive: true, force: true })
    process.stdout.write(`[update-real] 报告：${path.join(reportDir, 'report.json')}\n`)
  }
}

await main()
