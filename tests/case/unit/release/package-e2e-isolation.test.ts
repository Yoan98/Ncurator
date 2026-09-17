import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PACKAGE_E2E_DISPLAY_NAME,
  PACKAGE_PRODUCT_NAME,
  isPackageE2EInstallPath,
  renameMacPackageE2EApp,
  resolveMacPackageE2EAppPath
} from '../../../../scripts/test/package-e2e-isolation.mjs'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('package e2e isolation helpers', () => {
  it('detects NCurator-E2E install paths on Windows and macOS', () => {
    expect(
      isPackageE2EInstallPath(
        path.join('C:', 'Users', 'Admin', 'AppData', 'Local', 'NCurator-E2E', '馆长.exe'),
        'win32'
      )
    ).toBe(true)
    expect(isPackageE2EInstallPath(path.join('D:', '馆长', 'Ncurator', '馆长.exe'), 'win32')).toBe(
      false
    )
    expect(
      isPackageE2EInstallPath(
        path.join('/Users', 'me', 'Applications', 'NCurator-E2E', 'macos-arm64', '馆长.app'),
        'darwin'
      )
    ).toBe(true)
    expect(
      isPackageE2EInstallPath(path.join('/Applications', '馆长.app'), 'darwin')
    ).toBe(false)
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
