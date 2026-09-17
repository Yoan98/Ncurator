import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 与 electron-builder productName / shortcutName 一致；候选包本身不改名。 */
export const PACKAGE_PRODUCT_NAME = '馆长'
export const PACKAGE_E2E_DISPLAY_NAME = '馆长 E2E'

const WINDOWS_E2E_INSTALL_MARKER = `${path.sep}NCurator-E2E`
const MAC_E2E_INSTALL_MARKER = `${path.sep}NCurator-E2E`

export const isPackageE2EInstallPath = (targetPath, platform = process.platform) => {
  const normalized = path.resolve(String(targetPath || ''))
  if (!normalized) return false
  const marker = platform === 'darwin' ? MAC_E2E_INSTALL_MARKER : WINDOWS_E2E_INSTALL_MARKER
  return normalized.toLowerCase().includes(marker.toLowerCase())
}

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

const runPowerShellJson = (script, { log = () => {} } = {}) => {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  )
  const stdout = String(result.stdout || '').trim()
  const stderr = String(result.stderr || '').trim()
  if (result.status !== 0) {
    throw new Error(
      `PowerShell 隔离步骤失败：${stderr || stdout || `exit ${String(result.status)}`}`
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

const windowsHelpersPs = `
function Test-E2EPath([string]$target, [string]$installRoot) {
  if ([string]::IsNullOrWhiteSpace($target)) { return $false }
  try { $full = [IO.Path]::GetFullPath($target) } catch { return $false }
  return $full.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase)
}

function Get-ShortcutDirs() {
  @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs')
  ) | Where-Object { $_ -and (Test-Path $_) }
}

function Read-Shortcut($shell, [string]$lnkPath) {
  if (-not (Test-Path -LiteralPath $lnkPath)) { return $null }
  $s = $shell.CreateShortcut($lnkPath)
  return @{
    path = $lnkPath
    targetPath = [string]$s.TargetPath
    arguments = [string]$s.Arguments
    workingDirectory = [string]$s.WorkingDirectory
    iconLocation = [string]$s.IconLocation
    description = [string]$s.Description
  }
}

function Write-Shortcut($shell, $info) {
  $dir = Split-Path -Parent $info.path
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $s = $shell.CreateShortcut($info.path)
  $s.TargetPath = [string]$info.targetPath
  $s.Arguments = [string]$info.arguments
  $s.WorkingDirectory = [string]$info.workingDirectory
  if ($info.iconLocation) { $s.IconLocation = [string]$info.iconLocation }
  if ($info.description) { $s.Description = [string]$info.description }
  $s.Save()
}
`

/** 正式包 E2E 静默安装前：备份正式「馆长」快捷方式与非 E2E 卸载项。 */
export const snapshotWindowsPackageE2EState = ({
  installRoot,
  snapshotPath,
  log = () => {}
}) => {
  if (process.platform !== 'win32') {
    throw new Error('snapshotWindowsPackageE2EState 仅支持 Windows')
  }
  mkdirSync(path.dirname(snapshotPath), { recursive: true })

  const result = runPowerShellJson(
    `
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8
${windowsHelpersPs}
$productName = ${JSON.stringify(PACKAGE_PRODUCT_NAME)}
$installRoot = [IO.Path]::GetFullPath(${JSON.stringify(installRoot)})
$snapshotPath = ${JSON.stringify(snapshotPath)}
$productLnk = "$productName.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcutSnapshots = @()
foreach ($dir in Get-ShortcutDirs) {
  $info = Read-Shortcut $shell (Join-Path $dir $productLnk)
  if ($null -eq $info) { continue }
  if (Test-E2EPath $info.targetPath $installRoot) { continue }
  $shortcutSnapshots += $info
}
$uninstallSnapshots = @()
$root = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
if (Test-Path $root) {
  Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($null -eq $p) { return }
    $displayName = [string]$p.DisplayName
    $installLocation = [string]$p.InstallLocation
    $uninstallString = [string]$p.UninstallString
    $matchesProduct =
      ($displayName -eq $productName) -or
      ($uninstallString -match [regex]::Escape($productName)) -or
      ($installLocation -match 'Ncurator|NCurator|馆长')
    if (-not $matchesProduct) { return }
    if (Test-E2EPath $installLocation $installRoot) { return }
    if (Test-E2EPath $uninstallString $installRoot) { return }
    $uninstallSnapshots += @{
      key = $_.PSChildName
      DisplayName = $displayName
      DisplayVersion = [string]$p.DisplayVersion
      InstallLocation = $installLocation
      UninstallString = $uninstallString
      QuietUninstallString = [string]$p.QuietUninstallString
      Publisher = [string]$p.Publisher
      DisplayIcon = [string]$p.DisplayIcon
    }
  }
}
$snapshot = @{
  schemaVersion = 1
  capturedAt = (Get-Date).ToString('o')
  installRoot = $installRoot
  shortcuts = @($shortcutSnapshots)
  uninstall = @($uninstallSnapshots)
}
$snapshotDir = Split-Path -Parent $snapshotPath
if (-not (Test-Path -LiteralPath $snapshotDir)) {
  New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null
}
$json = ($snapshot | ConvertTo-Json -Depth 6 -Compress)
[IO.File]::WriteAllText($snapshotPath, $json, [Text.UTF8Encoding]::new($false))
Write-Output $json
`,
    { log }
  )

  const shortcutCount = Array.isArray(result?.shortcuts) ? result.shortcuts.length : 0
  const uninstallCount = Array.isArray(result?.uninstall) ? result.uninstall.length : 0
  log(
    `已备份正式启动入口：快捷方式 ${String(shortcutCount)} 个，卸载项 ${String(uninstallCount)} 个 → ${snapshotPath}`
  )
  return result
}

/** 正式包 E2E 静默安装后：隔离 E2E 快捷方式并恢复正式入口。 */
export const restoreWindowsPackageE2ELaunchers = ({
  installRoot,
  executablePath,
  snapshotPath,
  log = () => {}
}) => {
  if (process.platform !== 'win32') {
    throw new Error('restoreWindowsPackageE2ELaunchers 仅支持 Windows')
  }
  if (!existsSync(executablePath)) {
    throw new Error(`Windows E2E 可执行文件不存在：${executablePath}`)
  }
  if (!existsSync(snapshotPath)) {
    throw new Error(`缺少 Windows E2E 隔离快照：${snapshotPath}`)
  }

  const result = runPowerShellJson(
    `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8
${windowsHelpersPs}
$productName = ${JSON.stringify(PACKAGE_PRODUCT_NAME)}
$e2eDisplayName = ${JSON.stringify(PACKAGE_E2E_DISPLAY_NAME)}
$installRoot = [IO.Path]::GetFullPath(${JSON.stringify(installRoot)})
$executablePath = [IO.Path]::GetFullPath(${JSON.stringify(executablePath)})
$snapshotPath = ${JSON.stringify(snapshotPath)}
$productLnk = "$productName.lnk"
$e2eLnk = "$e2eDisplayName.lnk"
function Remove-ShortcutSafe([string]$lnkPath) {
  if (-not (Test-Path -LiteralPath $lnkPath)) { return $true }
  for ($i = 0; $i -lt 6; $i++) {
    try {
      [IO.File]::Delete((Resolve-Path -LiteralPath $lnkPath).Path)
      return $true
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  try {
    $stale = Join-Path (Split-Path -Parent $lnkPath) ("$e2eDisplayName-stale-$([guid]::NewGuid().ToString('N').Substring(0,8)).lnk")
    Move-Item -LiteralPath $lnkPath -Destination $stale -Force
    return $true
  } catch {
    return $false
  }
}
$snapshot = Get-Content -LiteralPath $snapshotPath -Raw -Encoding utf8 | ConvertFrom-Json
$shell = New-Object -ComObject WScript.Shell
$restoredShortcuts = 0
$createdE2eShortcuts = 0
$removedE2eProductShortcuts = 0
$snapshotPaths = @{}
if ($snapshot.shortcuts) {
  foreach ($item in @($snapshot.shortcuts)) {
    if ($item.path) { $snapshotPaths[[string]$item.path] = $true }
  }
}

foreach ($dir in Get-ShortcutDirs) {
  $productPath = Join-Path $dir $productLnk
  $e2ePath = Join-Path $dir $e2eLnk
  Write-Shortcut $shell @{
    path = $e2ePath
    targetPath = $executablePath
    arguments = ''
    workingDirectory = $installRoot
    iconLocation = "$executablePath,0"
    description = $e2eDisplayName
  }
  $createdE2eShortcuts++
}

if ($snapshot.shortcuts) {
  foreach ($item in @($snapshot.shortcuts)) {
    if (-not $item.path -or -not $item.targetPath) { continue }
    if (Test-E2EPath ([string]$item.targetPath) $installRoot) { continue }
    Write-Shortcut $shell @{
      path = [string]$item.path
      targetPath = [string]$item.targetPath
      arguments = [string]$item.arguments
      workingDirectory = [string]$item.workingDirectory
      iconLocation = [string]$item.iconLocation
      description = [string]$item.description
    }
    $restoredShortcuts++
  }
}

foreach ($dir in Get-ShortcutDirs) {
  $productPath = Join-Path $dir $productLnk
  $current = Read-Shortcut $shell $productPath
  if ($null -eq $current) { continue }
  if (-not (Test-E2EPath $current.targetPath $installRoot)) { continue }
  if ($snapshotPaths.ContainsKey($productPath)) { continue }
  if (Remove-ShortcutSafe $productPath) {
    $removedE2eProductShortcuts++
  } else {
    throw "无法隔离仍指向 E2E 的正式快捷方式（文件被占用）：$productPath"
  }
}

$restoredUninstall = 0
if ($snapshot.uninstall) {
  foreach ($item in @($snapshot.uninstall)) {
    if (-not $item.key) { continue }
    $keyPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$($item.key)"
    if (-not (Test-Path $keyPath)) {
      New-Item -Path $keyPath -Force | Out-Null
    }
    $props = @{
      DisplayName = [string]$item.DisplayName
      DisplayVersion = [string]$item.DisplayVersion
      InstallLocation = [string]$item.InstallLocation
      UninstallString = [string]$item.UninstallString
      QuietUninstallString = [string]$item.QuietUninstallString
      Publisher = [string]$item.Publisher
      DisplayIcon = [string]$item.DisplayIcon
    }
    foreach ($name in $props.Keys) {
      $value = $props[$name]
      if ([string]::IsNullOrWhiteSpace($value)) { continue }
      New-ItemProperty -Path $keyPath -Name $name -Value $value -PropertyType String -Force | Out-Null
    }
    $restoredUninstall++
  }
}

$root = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
if (Test-Path $root) {
  Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($null -eq $p) { return }
    $installLocation = [string]$p.InstallLocation
    $uninstallString = [string]$p.UninstallString
    if (-not ((Test-E2EPath $installLocation $installRoot) -or (Test-E2EPath $uninstallString $installRoot))) {
      return
    }
    New-ItemProperty -Path $_.PSPath -Name 'DisplayName' -Value $e2eDisplayName -PropertyType String -Force | Out-Null
  }
}

Write-Output (@{
  restoredShortcuts = $restoredShortcuts
  createdE2eShortcuts = $createdE2eShortcuts
  removedE2eProductShortcuts = $removedE2eProductShortcuts
  restoredUninstall = $restoredUninstall
} | ConvertTo-Json -Compress)
`,
    { log }
  )

  log(
    [
      'Windows E2E 启动入口已隔离：',
      `恢复正式快捷方式 ${String(result?.restoredShortcuts ?? 0)}`,
      `创建「${PACKAGE_E2E_DISPLAY_NAME}」${String(result?.createdE2eShortcuts ?? 0)}`,
      `移除误指向 E2E 的「${PACKAGE_PRODUCT_NAME}」${String(result?.removedE2eProductShortcuts ?? 0)}`,
      `恢复卸载项 ${String(result?.restoredUninstall ?? 0)}`
    ].join('；')
  )
  return result
}


export const readWindowsPackageE2ESnapshot = (snapshotPath) => {
  const raw = readFileSync(snapshotPath, 'utf8')
  return JSON.parse(raw)
}
