import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createPackage } from '@electron/asar'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeRelativePath } from '../../../../scripts/package-content-policy.mjs'
import { PROTECTED_MAIN_PLAINTEXT_MARKERS } from '../../../../scripts/package-main-obfuscation.mjs'

const execFileAsync = promisify(execFile)
let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('package content policy paths', () => {
  it('normalizes Windows asar paths before auditing archive roots', () => {
    expect(normalizeRelativePath('\\node_modules\\electron\\index.js')).toBe(
      'node_modules/electron/index.js'
    )
    expect(normalizeRelativePath('\\out\\main\\index.js')).toBe('out/main/index.js')
  })

  it('audits nested files in an asar archive on the current platform', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-package-audit-'))
    const appSource = path.join(temporaryDirectory, 'app-source')
    const packagedApp = path.join(temporaryDirectory, 'package', 'win-unpacked')
    const archivePath = path.join(packagedApp, 'resources', 'app.asar')
    const nodePtyHelperPath = path.join(
      packagedApp,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'node-pty',
      'build',
      'Release',
      'spawn-helper'
    )
    await mkdir(path.join(appSource, 'out', 'main'), { recursive: true })
    await mkdir(path.dirname(archivePath), { recursive: true })
    await mkdir(path.dirname(nodePtyHelperPath), { recursive: true })
    await writeFile(nodePtyHelperPath, '', { mode: 0o755 })
    await writeFile(path.join(appSource, 'out', 'main', 'index.js'), 'export const ready = true\n')
    await writeFile(
      path.join(appSource, 'package.json'),
      `${JSON.stringify({
        name: 'ncurator-audit-fixture',
        version: '1.0.0',
        main: './out/main/index.js',
        private: true,
        dependencies: {}
      })}\n`
    )
    await createPackage(appSource, archivePath)

    await execFileAsync(process.execPath, [
      path.resolve('scripts/audit-packaged-app.mjs'),
      path.join(temporaryDirectory, 'package')
    ])

    const report = JSON.parse(
      await readFile(path.join(temporaryDirectory, 'package', 'package-audit.json'), 'utf8')
    )
    expect(report.applications).toEqual([
      expect.objectContaining({ root: 'win-unpacked', archiveFileCount: 2 })
    ])
  })

  it('rejects a packaged app that exposes protected main-process prompts', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-package-audit-'))
    const appSource = path.join(temporaryDirectory, 'app-source')
    const packagedApp = path.join(temporaryDirectory, 'package', 'win-unpacked')
    const archivePath = path.join(packagedApp, 'resources', 'app.asar')
    await mkdir(path.join(appSource, 'out', 'main'), { recursive: true })
    await mkdir(path.dirname(archivePath), { recursive: true })
    await writeFile(
      path.join(appSource, 'out', 'main', 'index.js'),
      `const prompt = ${JSON.stringify(PROTECTED_MAIN_PLAINTEXT_MARKERS[0].value)}\n`
    )
    await writeFile(
      path.join(appSource, 'package.json'),
      `${JSON.stringify({
        name: 'ncurator-audit-fixture',
        version: '1.0.0',
        main: './out/main/index.js',
        private: true,
        dependencies: {}
      })}\n`
    )
    await createPackage(appSource, archivePath)

    let stderr = ''
    try {
      await execFileAsync(process.execPath, [
        path.resolve('scripts/audit-packaged-app.mjs'),
        path.join(temporaryDirectory, 'package')
      ])
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr || error)
    }
    expect(stderr).toContain('exposes protected main-process plaintext')
  })
})
