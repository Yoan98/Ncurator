import { spawnSync } from 'node:child_process'
import { existsSync, renameSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 与 electron-builder productName 一致；候选包本身不改名。 */
export const PACKAGE_PRODUCT_NAME = '馆长'
/** macOS 测试安装副本显示名；测完随 NCurator-E2E 目录删除。 */
export const PACKAGE_E2E_DISPLAY_NAME = '馆长 E2E'
const PACKAGE_E2E_ROOT_NAME = 'NCurator-E2E'

const e2ePathSegmentPattern = /(^|[\\/])NCurator-E2E(?=[\\/]|$)/iu

export const isPackageE2EInstallPath = (targetPath) => {
  const raw = String(targetPath || '').trim()
  if (!raw) return false
  return e2ePathSegmentPattern.test(raw)
}

export const resolvePackageE2ECleanupRoot = (targetPath) => {
  const raw = String(targetPath || '').trim()
  if (!isPackageE2EInstallPath(raw)) {
    throw new Error(`拒绝清理非 E2E 安装路径：${raw || '(empty)'}`)
  }
  let current = path.resolve(raw)
  while (path.basename(current) !== PACKAGE_E2E_ROOT_NAME) {
    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error(`无法解析 E2E 安装根目录：${raw}`)
    }
    current = parent
  }
  return current
}

export const isPackageE2ELauncherTarget = (targetPath, installRoot) => {
  if (!isPackageE2EInstallPath(installRoot) || !String(targetPath || '').trim()) return false
  const root = path.resolve(installRoot)
  let target
  try {
    target = path.resolve(String(targetPath))
  } catch {
    return false
  }
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (process.platform === 'win32') {
    return (
      target.toLowerCase() === root.toLowerCase() ||
      target.toLowerCase().startsWith(prefix.toLowerCase())
    )
  }
  return target === root || target.startsWith(prefix)
}

export const resolveWindowsPackageE2EInstallRoot = () =>
  path.join(os.homedir(), 'AppData', 'Local', PACKAGE_E2E_ROOT_NAME)

export const resolveMacPackageE2EInstallRoot = () =>
  path.join(os.homedir(), 'Applications', PACKAGE_E2E_ROOT_NAME)

export const resolveMacPackageE2EAppPath = (installedAppPath) => {
  const currentName = path.basename(installedAppPath)
  if (currentName === `${PACKAGE_E2E_DISPLAY_NAME}.app`) return installedAppPath
  if (currentName !== `${PACKAGE_PRODUCT_NAME}.app`) {
    throw new Error(
      `macOS 正式包 E2E 期望安装名为 ${PACKAGE_PRODUCT_NAME}.app，实际为 ${currentName}`
    )
  }
  return path.join(path.dirname(installedAppPath), `${PACKAGE_E2E_DISPLAY_NAME}.app`)
}

/**
 * 把安装副本改名为「馆长 E2E.app」，避免与正式 Applications 下的「馆长.app」同名混淆。
 * 只改本机 E2E 安装副本，不修改 DMG 内原始产物。
 */
export const renameMacPackageE2EApp = (installedAppPath, { log = () => {} } = {}) => {
  const targetAppPath = resolveMacPackageE2EAppPath(installedAppPath)
  if (path.resolve(installedAppPath) === path.resolve(targetAppPath)) {
    log(`macOS E2E 应用已是隔离名：${targetAppPath}`)
    return targetAppPath
  }
  if (existsSync(targetAppPath)) {
    rmSync(targetAppPath, { recursive: true, force: true })
  }
  renameSync(installedAppPath, targetAppPath)
  log(`macOS E2E 应用已改名为：${targetAppPath}`)
  return targetAppPath
}

const runPowerShell = (script) => {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  )
}

const runPowerShellJson = (script, { log = () => {} } = {}) => {
  const result = runPowerShell(script)
  const stdout = String(result.stdout || '').trim()
  const stderr = String(result.stderr || '').trim()
  if (result.status !== 0) {
    throw new Error(
      `PowerShell E2E 清理失败：${stderr || stdout || `exit ${String(result.status)}`}`
    )
  }
  if (!stdout) return null
  const jsonLine = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (!jsonLine) return null
  if (!jsonLine.startsWith('{') && !jsonLine.startsWith('[')) {
    log(stdout)
    return null
  }
  return JSON.parse(jsonLine)
}

const stopWindowsPackageE2EProcesses = (cleanupRoot, { log = () => {} } = {}) => {
  const result = runPowerShell(`
$ErrorActionPreference = 'SilentlyContinue'
$root = [IO.Path]::GetFullPath(${JSON.stringify(cleanupRoot)}).TrimEnd('\\') + '\\'
Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
}
`)
  if (result.status !== 0) {
    log(`结束 E2E 进程时出现警告：${String(result.stderr || result.stdout || '').trim()}`)
  }
}

const cleanupWindowsPackageE2ELaunchers = (cleanupRoot, { log = () => {} } = {}) => {
  const result = runPowerShellJson(
    `
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8
$installRoot = [IO.Path]::GetFullPath(${JSON.stringify(cleanupRoot)})
function Test-E2EPath([string]$target) {
  if ([string]::IsNullOrWhiteSpace($target)) { return $false }
  if ($target.ToLower().Contains($installRoot.ToLower())) { return $true }
  try {
    $full = [IO.Path]::GetFullPath($target.Trim().Trim('"'))
    return $full.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}
$dirs = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
$shell = New-Object -ComObject WScript.Shell
$removedShortcuts = 0
foreach ($dir in $dirs) {
  Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $shortcut = $shell.CreateShortcut($_.FullName)
    if (-not (Test-E2EPath ([string]$shortcut.TargetPath))) { return }
    Remove-Item -LiteralPath $_.FullName -Force
    $script:removedShortcuts++
  }
}
$removedUninstall = 0
$uninstallRoot = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
if (Test-Path $uninstallRoot) {
  Get-ChildItem $uninstallRoot -ErrorAction SilentlyContinue | ForEach-Object {
    $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($null -eq $props) { return }
    $hit = $false
    foreach ($value in @($props.InstallLocation, $props.UninstallString, $props.QuietUninstallString, $props.DisplayIcon)) {
      if (Test-E2EPath ([string]$value)) { $hit = $true; break }
    }
    if (-not $hit) { return }
    Remove-Item -LiteralPath $_.PSPath -Recurse -Force
    $script:removedUninstall++
  }
}
$softwareKey = 'HKCU:\\Software\\com.yoan.ncurator'
if (Test-Path $softwareKey) {
  $installLocation = [string](Get-ItemProperty $softwareKey -ErrorAction SilentlyContinue).InstallLocation
  if (Test-E2EPath $installLocation) {
    Remove-Item -LiteralPath $softwareKey -Recurse -Force
  }
}
Write-Output (@{
  removedShortcuts = $removedShortcuts
  removedUninstall = $removedUninstall
} | ConvertTo-Json -Compress)
`,
    { log }
  )
  log(
    `已清理指向 E2E 的启动入口：快捷方式 ${String(result?.removedShortcuts ?? 0)} 个，卸载项 ${String(result?.removedUninstall ?? 0)} 个`
  )
  return result
}

const sleep = (ms) => {
  const buffer = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(buffer, 0, 0, ms)
}

export const removePackageE2EInstallDirectory = (installRoot, { log = () => {} } = {}) => {
  const cleanupRoot = resolvePackageE2ECleanupRoot(installRoot)
  if (!existsSync(cleanupRoot)) {
    log(`E2E 安装目录不存在，跳过：${cleanupRoot}`)
    return { cleanupRoot, removed: false }
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    rmSync(cleanupRoot, { recursive: true, force: true })
    if (!existsSync(cleanupRoot)) {
      log(`已删除 E2E 安装目录：${cleanupRoot}`)
      return { cleanupRoot, removed: true }
    }
    sleep(250)
  }
  throw new Error(`无法删除 E2E 安装目录：${cleanupRoot}`)
}

/** 测完删除 NCurator-E2E 安装目录；Windows 同时去掉指向它的快捷方式和卸载项。 */
export const cleanupPackagedE2EInstall = ({ installRoot, log = () => {} } = {}) => {
  const cleanupRoot = resolvePackageE2ECleanupRoot(installRoot)
  if (process.platform === 'win32') {
    stopWindowsPackageE2EProcesses(cleanupRoot, { log })
    cleanupWindowsPackageE2ELaunchers(cleanupRoot, { log })
    sleep(400)
  }
  return removePackageE2EInstallDirectory(cleanupRoot, { log })
}
