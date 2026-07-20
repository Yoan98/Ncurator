import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const DIST_DIR = path.join(ROOT, 'dist')
const LOGS_ROOT = path.join(ROOT, 'tests', 'logs', 'package')

const createRunId = () => new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')

const resolvePnpmCommand = () => {
  const npmExecPath = String(process.env.npm_execpath || '').trim()
  if (npmExecPath && /\.(?:c?js|mjs)$/u.test(npmExecPath)) {
    return { command: process.execPath, prefixArgs: [npmExecPath] }
  }
  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    prefixArgs: []
  }
}

const sha256File = async (filePath) =>
  await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })

const readPackageAudit = () => {
  const auditPath = path.join(DIST_DIR, 'package-audit.json')
  if (!existsSync(auditPath)) throw new Error(`打包审计报告不存在：${auditPath}`)
  return JSON.parse(readFileSync(auditPath, 'utf8'))
}

const resolveSingleInstaller = (extension) => {
  const audit = readPackageAudit()
  const matches = (audit.installers || []).filter((item) =>
    String(item.name || '')
      .toLowerCase()
      .endsWith(extension)
  )
  if (matches.length !== 1) {
    throw new Error(
      `期望 package-audit.json 中只有一个 ${extension} 安装包，实际为 ${String(matches.length)}`
    )
  }
  const artifactPath = path.join(DIST_DIR, matches[0].name)
  if (!existsSync(artifactPath)) throw new Error(`安装包不存在：${artifactPath}`)
  return artifactPath
}

const findMountedMacApp = (mountPath) => {
  const apps = readdirSync(mountPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => path.join(mountPath, entry.name))
  if (apps.length !== 1) {
    throw new Error(`DMG 中期望只有一个 .app，实际为 ${String(apps.length)}：${mountPath}`)
  }
  return apps[0]
}

const resolveMacExecutable = (appPath) => {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist')
  const result = spawnSync(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plistPath],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(`无法读取 macOS 应用可执行文件：${String(result.stderr || result.stdout)}`)
  }
  const executableName = String(result.stdout || '').trim()
  const executablePath = path.join(appPath, 'Contents', 'MacOS', executableName)
  if (!existsSync(executablePath)) throw new Error(`macOS 可执行文件不存在：${executablePath}`)
  return executablePath
}

const assertMacAppNotRunning = (executablePath) => {
  const result = spawnSync('/usr/bin/pgrep', ['-f', executablePath], { encoding: 'utf8' })
  if (result.status === 0 && String(result.stdout || '').trim()) {
    throw new Error(`测试安装目录中的应用仍在运行，请先关闭：${executablePath}`)
  }
}

const clearQuarantine = (targetPath) => {
  const inspect = spawnSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', targetPath], {
    encoding: 'utf8'
  })
  if (inspect.status !== 0) return
  const clear = spawnSync('/usr/bin/xattr', ['-r', '-d', 'com.apple.quarantine', targetPath], {
    encoding: 'utf8'
  })
  if (clear.status !== 0) {
    throw new Error(
      [
        `无法清除 quarantine：${targetPath}`,
        '请先手动执行：',
        `sudo xattr -r -d com.apple.quarantine ${JSON.stringify(targetPath)}`
      ].join('\n')
    )
  }
}

export const preparePackagedE2EApplication = async () => {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    throw new Error(`正式包 E2E 只支持 macOS 和 Windows，当前平台：${process.platform}`)
  }

  const runId = createRunId()
  const logDir = path.join(LOGS_ROOT, runId)
  const processLogPath = path.join(logDir, 'build-install.log')
  mkdirSync(logDir, { recursive: true })
  writeFileSync(processLogPath, '', 'utf8')

  const log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}\n`
    process.stdout.write(line)
    appendFileSync(processLogPath, line, 'utf8')
  }

  const runLogged = async (command, args, options = {}) => {
    log(`运行：${[command, ...args].join(' ')}`)
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd || ROOT,
        env: options.env || process.env,
        shell: process.platform === 'win32',
        stdio: ['inherit', 'pipe', 'pipe']
      })
      const forward = (target, chunk) => {
        target.write(chunk)
        appendFileSync(processLogPath, chunk)
      }
      child.stdout.on('data', (chunk) => forward(process.stdout, chunk))
      child.stderr.on('data', (chunk) => forward(process.stderr, chunk))
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (code === 0) resolve()
        else reject(new Error(`${command} 失败：code=${String(code)} signal=${String(signal)}`))
      })
    })
  }

  const pnpm = resolvePnpmCommand()
  const buildScript =
    process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'build:mac:arm64'
        : 'build:mac:x64'
      : 'build:win'
  await runLogged(pnpm.command, [...pnpm.prefixArgs, 'run', buildScript])

  let artifactPath = ''
  let installedAppPath = ''
  let executablePath = ''

  if (process.platform === 'darwin') {
    artifactPath = resolveSingleInstaller('.dmg')
    clearQuarantine(artifactPath)
    const mountPath = await mkdtemp(path.join(os.tmpdir(), 'ncurator-e2e-dmg-'))
    let mounted = false
    try {
      await runLogged('/usr/bin/hdiutil', [
        'attach',
        artifactPath,
        '-nobrowse',
        '-readonly',
        '-mountpoint',
        mountPath
      ])
      mounted = true
      const sourceAppPath = findMountedMacApp(mountPath)
      const installRoot = path.join(os.homedir(), 'Applications', 'NCurator-E2E')
      installedAppPath = path.join(installRoot, path.basename(sourceAppPath))
      const previousExecutable = existsSync(installedAppPath)
        ? resolveMacExecutable(installedAppPath)
        : ''
      if (previousExecutable) assertMacAppNotRunning(previousExecutable)
      mkdirSync(installRoot, { recursive: true })
      rmSync(installedAppPath, { recursive: true, force: true })
      await runLogged('/usr/bin/ditto', [sourceAppPath, installedAppPath])
      clearQuarantine(installedAppPath)
      executablePath = resolveMacExecutable(installedAppPath)
    } finally {
      if (mounted) {
        await runLogged('/usr/bin/hdiutil', ['detach', mountPath])
      }
      rmSync(mountPath, { recursive: true, force: true })
    }
  } else {
    artifactPath = resolveSingleInstaller('.exe')
    const installRoot = path.join(os.homedir(), 'AppData', 'Local', 'NCurator-E2E')
    mkdirSync(installRoot, { recursive: true })
    await runLogged(artifactPath, ['/S', `/D=${installRoot}`])
    installedAppPath = installRoot
    executablePath = path.join(installRoot, 'Ncurator.exe')
    if (!existsSync(executablePath))
      throw new Error(`Windows 安装后的应用不存在：${executablePath}`)
  }

  const artifactSha256 = await sha256File(artifactPath)
  const metadata = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    buildScript,
    artifactPath,
    artifactSha256,
    installedAppPath,
    executablePath
  }
  writeFileSync(
    path.join(logDir, 'artifact.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8'
  )
  log(`正式包已安装：${installedAppPath}`)

  return {
    ...metadata,
    logDir,
    processLogPath,
    env: {
      NCURATOR_E2E_APP_TARGET: 'package',
      NCURATOR_E2E_EXECUTABLE: executablePath,
      NCURATOR_E2E_ARTIFACT_PATH: artifactPath,
      NCURATOR_E2E_ARTIFACT_SHA256: artifactSha256,
      NCURATOR_BETTER_SQLITE3_NATIVE_BINDING: ''
    },
    writeSummary: (input) => {
      writeFileSync(
        path.join(logDir, 'summary.json'),
        `${JSON.stringify({ ...metadata, finishedAt: new Date().toISOString(), ...input }, null, 2)}\n`,
        'utf8'
      )
    }
  }
}
