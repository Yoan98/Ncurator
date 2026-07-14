/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFile, spawn } from 'node:child_process'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright'

const execFileAsync = promisify(execFile)
const ROOT = process.cwd()
const DEFAULT_SOURCE_VERSION = '0.1.0'
const DEFAULT_EXPECTED_VERSION = '0.1.1'
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000

const parseArgs = (argv) => {
  const result = {
    sourceApp: '',
    sourceVersion: DEFAULT_SOURCE_VERSION,
    expectedVersion: DEFAULT_EXPECTED_VERSION,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    githubReleaseTag: ''
  }

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--source-app' && value) result.sourceApp = path.resolve(value)
    else if (key === '--source-version' && value) result.sourceVersion = value
    else if (key === '--expected-version' && value) result.expectedVersion = value
    else if (key === '--timeout-ms' && value) result.timeoutMs = Number(value)
    else if (key === '--github-release-tag' && value) result.githubReleaseTag = value
    else continue
    index += 1
  }

  return result
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

const startGitHubReleaseProxy = async (releaseTag) => {
  if (!/^v\d+\.\d+\.\d+$/u.test(releaseTag)) {
    throw new Error(`GitHub Release Tag 不合法：${releaseTag}`)
  }
  const releaseApiUrl = `https://api.github.com/repos/Yoan98/Ncurator/releases/tags/${releaseTag}`
  const { stdout: releaseJson } = await execFileAsync(
    '/usr/bin/curl',
    ['--fail', '--silent', '--show-error', '--retry', '3', '--max-time', '60', releaseApiUrl],
    { maxBuffer: 5 * 1024 * 1024 }
  )
  const release = JSON.parse(releaseJson)
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]))
  const activeDownloads = new Set()
  const server = createServer(async (request, response) => {
    const assetName = path.basename(new URL(request.url || '/', 'http://127.0.0.1').pathname)
    const asset = assets.get(assetName)
    if (!asset) {
      response.writeHead(404).end()
      return
    }
    const curlArgs = [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--retry',
      '3',
      '--header',
      'Accept: application/octet-stream',
      asset.url
    ]
    const download = spawn('/usr/bin/curl', curlArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    activeDownloads.add(download)
    let stderr = ''
    download.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    response.writeHead(200, {
      'content-type': asset.content_type || 'application/octet-stream',
      'content-length': String(asset.size),
      'cache-control': 'no-store'
    })
    download.stdout.pipe(response)
    download.once('close', (code) => {
      activeDownloads.delete(download)
      if (code !== 0 && !response.destroyed) response.destroy(new Error(stderr || `curl ${code}`))
    })
    response.once('close', () => {
      if (!download.killed && !response.writableFinished) download.kill('SIGTERM')
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法启动 GitHub Release 测试代理')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const download of activeDownloads) download.kill('SIGTERM')
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
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

const setBundleVersion = async (appPath, version) => {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist')
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
    await execFileAsync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${version}`, plistPath])
  }
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

const writeUpdateConfig = async (appPath, updateUrl) => {
  const configPath = path.join(appPath, 'Contents', 'Resources', 'app-update.yml')
  await writeFile(
    configPath,
    `provider: generic\nurl: ${updateUrl}\nupdaterCacheDirName: ncurator-updater\n`,
    'utf8'
  )
}

const resolveBuiltAppPath = async (outputPath) => {
  const candidates = [
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
      `--config.extraMetadata.version=${version}`,
      `--config.directories.output=${outputPath}`
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      },
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
  const executablePath = path.join(appPath, 'Contents', 'MacOS', 'Ncurator')
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

const main = async () => {
  if (process.platform !== 'darwin') {
    throw new Error('当前真实升级脚本只支持 macOS；Windows 需要在 Windows 测试机执行')
  }

  const options = parseArgs(process.argv.slice(2))
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
  let releaseProxy
  let report

  await mkdir(reportDir, { recursive: true })
  await mkdir(userDataPath, { recursive: true })
  await mkdir(homePath, { recursive: true })
  await writeFile(markerPath, `created=${startedAt}\n`, 'utf8')

  try {
    releaseProxy = options.githubReleaseTag
      ? await startGitHubReleaseProxy(options.githubReleaseTag)
      : undefined
    const updateUrl = releaseProxy?.url || (await readGenericUpdateUrl())
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
    await setBundleVersion(testAppPath, options.sourceVersion)
    await writeUpdateConfig(testAppPath, updateUrl)
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
        `线上目标版本不符合预期：${downloadedSnapshot.availableVersion || '未知版本'}`
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
      updateUrl: releaseProxy?.url || 'production',
      error: error instanceof Error ? error.message : String(error)
    }
    process.exitCode = 1
  } finally {
    await firstLaunch?.electronApp.close().catch(() => undefined)
    await terminateTestApp(testAppPath)
    await releaseProxy?.close().catch(() => undefined)
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
