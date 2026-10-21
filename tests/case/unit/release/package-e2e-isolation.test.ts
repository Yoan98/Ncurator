import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PACKAGE_E2E_DISPLAY_NAME,
  PACKAGE_PRODUCT_NAME,
  isPackageE2EInstallPath,
  isPackageE2ELauncherTarget,
  removePackageE2EInstallDirectory,
  renameMacPackageE2EApp,
  resolveMacPackageE2EAppPath,
  resolvePackageE2ECleanupRoot
} from '../../../../scripts/test/package-e2e-isolation.mjs'
import {
  findInstalledWindowsShortcut,
  prepareDesktopLaunch,
  resolveMacApplication
} from '../../../../scripts/test/desktop-launch.mjs'

const tempRoots: string[] = []

const runWindowsShell = (script: string, environment: NodeJS.ProcessEnv = {}) => {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')
    ],
    { env: { ...process.env, ...environment }, encoding: 'utf8', windowsHide: true }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

const createWindowsShortcut = (shortcutPath: string, targetPath: string) => {
  runWindowsShell(
    String.raw`
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($env:NCURATOR_UNIT_SHORTCUT_PATH)
$link.TargetPath = $env:NCURATOR_UNIT_SHORTCUT_TARGET
$link.WorkingDirectory = [IO.Path]::GetDirectoryName($env:NCURATOR_UNIT_SHORTCUT_TARGET)
$link.Save()
`,
    { NCURATOR_UNIT_SHORTCUT_PATH: shortcutPath, NCURATOR_UNIT_SHORTCUT_TARGET: targetPath }
  )
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('package e2e isolation helpers', () => {
  it.skipIf(process.platform !== 'win32')(
    'finds an actual Windows shortcut for a Unicode target path',
    () => {
      const desktop = runWindowsShell(
        "[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; [Console]::Write([Environment]::GetFolderPath('Desktop'))"
      )
      const root = fs.mkdtempSync(path.join(desktop, 'ncurator-shortcut-unit-'))
      tempRoots.push(root)
      const target = path.join(root, '带 空格.exe')
      const shortcut = path.join(root, 'installed.lnk')
      fs.writeFileSync(target, 'unit shortcut target')
      createWindowsShortcut(shortcut, target)

      expect(findInstalledWindowsShortcut(target)).toBe(shortcut)
    }
  )

  it.skipIf(process.platform !== 'win32')(
    'reads Windows launch configuration before rejecting a mismatched shortcut',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-launch-config-'))
      tempRoots.push(root)
      const shortcut = path.join(root, 'installed.lnk')
      createWindowsShortcut(shortcut, process.execPath)
      const launcher = await prepareDesktopLaunch({
        executablePath: path.join(root, 'NCurator-E2E', '馆长.exe'),
        entryPath: shortcut,
        env: {
          PATH: process.env.PATH || '',
          SystemRoot: process.env.SystemRoot || 'C:\\Windows',
          NCURATOR_USER_DATA_PATH: path.join(root, 'data')
        }
      })
      try {
        const result = spawnSync(
          process.execPath,
          [path.resolve('scripts/test/desktop-launch.mjs')],
          {
            env: { ...process.env, ...launcher.env },
            encoding: 'utf8',
            windowsHide: true,
            timeout: 15_000
          }
        )
        expect(result.error).toBeUndefined()
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(
          'Installed shortcut target does not match the E2E executable'
        )
      } finally {
        await launcher.dispose()
      }
    }
  )

  it('keeps desktop launch configuration private and out of the launch command', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-desktop-entry-'))
    tempRoots.push(root)
    const app = path.join(root, 'NCurator-E2E', '带 空格.app')
    const executablePath = path.join(app, 'Contents', 'MacOS', '馆长')
    expect(resolveMacApplication(executablePath)).toBe(app)
    const launcher = await prepareDesktopLaunch({
      executablePath,
      entryPath: process.platform === 'win32' ? path.join(root, 'installed.lnk') : app,
      env: { NCURATOR_USER_DATA_PATH: path.join(root, 'data'), TEST_SECRET: 'unit-private-value' }
    })
    const configPath = launcher.env.NCURATOR_E2E_DESKTOP_LAUNCH_CONFIG
    try {
      expect(fs.readFileSync(launcher.executablePath, 'utf8')).not.toContain('unit-private-value')
      expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).environment.TEST_SECRET).toBe(
        'unit-private-value'
      )
      if (process.platform !== 'win32') expect(fs.statSync(configPath).mode & 0o777).toBe(0o600)
    } finally {
      await launcher.dispose()
    }
    expect(fs.existsSync(configPath)).toBe(false)
    await expect(
      prepareDesktopLaunch({
        executablePath: '/Applications/馆长.app/Contents/MacOS/馆长',
        env: {}
      })
    ).rejects.toThrow('Refusing to launch a production installation')
  })

  it('detects NCurator-E2E install paths on Windows and macOS', () => {
    expect(
      isPackageE2EInstallPath(
        path.join('C:', 'Users', 'Admin', 'AppData', 'Local', 'NCurator-E2E', '馆长.exe')
      )
    ).toBe(true)
    expect(isPackageE2EInstallPath(path.join('D:', '馆长', 'Ncurator', '馆长.exe'))).toBe(false)
    expect(
      isPackageE2EInstallPath(
        path.join('/Users', 'me', 'Applications', 'NCurator-E2E', 'macos-arm64', '馆长.app')
      )
    ).toBe(true)
    expect(isPackageE2EInstallPath(path.join('/Applications', '馆长.app'))).toBe(false)
  })

  it('resolves the NCurator-E2E cleanup root and refuses production paths', () => {
    const installRoot = path.join(os.tmpdir(), 'ncurator-e2e-cleanup-root', 'NCurator-E2E')
    const appPath = path.join(installRoot, 'macos-arm64', `${PACKAGE_E2E_DISPLAY_NAME}.app`)
    expect(resolvePackageE2ECleanupRoot(appPath)).toBe(path.resolve(installRoot))
    expect(resolvePackageE2ECleanupRoot(installRoot)).toBe(path.resolve(installRoot))
    expect(() => resolvePackageE2ECleanupRoot(path.join('D:', '馆长', 'Ncurator'))).toThrow(
      /拒绝清理非 E2E 安装路径/
    )
  })

  it('only treats launchers pointing at the E2E install as removable', () => {
    const installRoot = path.join('C:', 'Users', 'Admin', 'AppData', 'Local', 'NCurator-E2E')
    expect(isPackageE2ELauncherTarget(path.join(installRoot, '馆长.exe'), installRoot)).toBe(true)
    expect(
      isPackageE2ELauncherTarget(path.join('D:', '馆长', 'Ncurator', '馆长.exe'), installRoot)
    ).toBe(false)
    expect(isPackageE2ELauncherTarget('', installRoot)).toBe(false)
    expect(
      isPackageE2ELauncherTarget(
        path.join(installRoot, '馆长.exe'),
        path.join('D:', '馆长', 'Ncurator')
      )
    ).toBe(false)
  })

  it('deletes the E2E install directory and refuses to delete anything else', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-e2e-dir-'))
    tempRoots.push(parent)
    const installRoot = path.join(parent, 'NCurator-E2E')
    const nested = path.join(installRoot, 'locales')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(installRoot, '馆长.exe'), 'x')
    const production = path.join(parent, 'Ncurator')
    fs.mkdirSync(production)
    fs.writeFileSync(path.join(production, '馆长.exe'), 'keep')

    const result = removePackageE2EInstallDirectory(path.join(installRoot, '馆长.exe'))
    expect(result.removed).toBe(true)
    expect(fs.existsSync(installRoot)).toBe(false)
    expect(fs.existsSync(path.join(production, '馆长.exe'))).toBe(true)

    expect(() => removePackageE2EInstallDirectory(production)).toThrow(/拒绝清理非 E2E 安装路径/)
    expect(fs.existsSync(path.join(production, '馆长.exe'))).toBe(true)
  })

  it('resolves and renames the macOS E2E app to a distinct display name', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-e2e-mac-iso-'))
    tempRoots.push(root)
    const staged = path.join(root, `${PACKAGE_PRODUCT_NAME}.app`)
    fs.mkdirSync(path.join(staged, 'Contents', 'MacOS'), { recursive: true })
    fs.writeFileSync(path.join(staged, 'Contents', 'MacOS', 'dummy'), 'x')

    expect(resolveMacPackageE2EAppPath(staged)).toBe(
      path.join(root, `${PACKAGE_E2E_DISPLAY_NAME}.app`)
    )
    const renamed = renameMacPackageE2EApp(staged)
    expect(renamed).toBe(path.join(root, `${PACKAGE_E2E_DISPLAY_NAME}.app`))
    expect(fs.existsSync(staged)).toBe(false)
    expect(fs.existsSync(renamed)).toBe(true)
    expect(renameMacPackageE2EApp(renamed)).toBe(renamed)
  })
})
