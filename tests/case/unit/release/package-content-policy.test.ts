import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createPackage } from '@electron/asar'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertSafePackagePaths,
  assertWebCrawlerSidecarPackage,
  isRuntimeDocPath,
  normalizeRelativePath
} from '../../../../scripts/build/package/content-policy.mjs'
import { PROTECTED_MAIN_PLAINTEXT_MARKERS } from '../../../../scripts/build/package/obfuscation.mjs'
import {
  VC_REDIST_DLL_NAMES,
  resolvePackagedWindowsNativeBinaries
} from '../../../../scripts/build/package/vc-runtime.mjs'

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

  it('permits ExcelJS runtime modules while rejecting other doc directories', () => {
    expect(isRuntimeDocPath('node_modules/exceljs/lib/doc')).toBe(true)
    expect(isRuntimeDocPath('node_modules/exceljs/lib/doc/workbook.js')).toBe(true)
    expect(() => assertSafePackagePaths(['node_modules/exceljs/lib/doc'])).not.toThrow()
    expect(() => assertSafePackagePaths(['node_modules/exceljs/lib/doc/workbook.js'])).not.toThrow()
    expect(() =>
      assertSafePackagePaths(['node_modules/runtime-package/lib/doc/readme.js'])
    ).toThrow('forbidden directory doc')
  })

  it.each([
    'node_modules/yaml/dist/doc',
    'node_modules/yaml/dist/doc/',
    'node_modules/yaml/dist/doc/directives.js',
    'node_modules/yaml/dist/doc/Document.js',
    '\\node_modules\\yaml\\dist\\doc\\directives.js'
  ])('permits the YAML runtime doc path %s', (relativePath) => {
    expect(isRuntimeDocPath(relativePath)).toBe(true)
    expect(() => assertSafePackagePaths([relativePath])).not.toThrow()
  })

  it.each([
    ['node_modules/runtime-package/dist/doc', 'doc'],
    ['node_modules/runtime-package/dist/doc/directives.js', 'doc'],
    ['node_modules/yaml/doc', 'doc'],
    ['node_modules/yaml/lib/doc/directives.js', 'doc'],
    ['node_modules/yaml/docs', 'docs'],
    ['node_modules/yaml/docs/readme.md', 'docs']
  ])('rejects the documentation path outside runtime exceptions %s', (relativePath, directory) => {
    expect(isRuntimeDocPath(relativePath)).toBe(false)
    expect(() => assertSafePackagePaths([relativePath])).toThrow(`forbidden directory ${directory}`)
  })

  it.each(['node_modules/yaml/README.md', 'node_modules/yaml/dist/doc/README.md'])(
    'rejects YAML readme documentation at %s',
    (relativePath) => {
      expect(() => assertSafePackagePaths([relativePath])).toThrow()
    }
  )

  it('rejects runtime directories covered by deterministic package pruning', () => {
    expect(() => assertSafePackagePaths(['node_modules/mathjax-full/es5/tex-svg.js'])).toThrow(
      'removable MathJax distribution'
    )
    expect(() =>
      assertSafePackagePaths(['node_modules/pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js'])
    ).toThrow('unused PDF.js version')
    expect(() => assertSafePackagePaths(['node_modules/exceljs/dist/exceljs.js'])).toThrow(
      'bundled ExcelJS browser distribution'
    )
  })

  it('requires Playwright driver JavaScript and rejects its bundled Node runtime', () => {
    const driver = {
      relativePath:
        'resources/web_crawler_sidecar/bin/app/_internal/playwright/driver/package/cli.js',
      size: 10
    }
    expect(assertWebCrawlerSidecarPackage([driver], 'fixture')).toBe(10)
    expect(() =>
      assertWebCrawlerSidecarPackage(
        [
          driver,
          {
            relativePath: 'resources/web_crawler_sidecar/bin/app/_internal/playwright/driver/node',
            size: 100
          }
        ],
        'fixture'
      )
    ).toThrow('bundled Playwright Node runtime')
    expect(() =>
      assertWebCrawlerSidecarPackage(
        [{ relativePath: 'resources/web_crawler_sidecar/bin/app/app', size: 10 }],
        'fixture'
      )
    ).toThrow('missing the Python Playwright driver JavaScript')
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
    const sidecarExecutablePath = path.join(
      packagedApp,
      'resources',
      'web_crawler_sidecar',
      'bin',
      'web_crawler_sidecar'
    )
    const playwrightDriverPath = path.join(
      packagedApp,
      'resources',
      'web_crawler_sidecar',
      'bin',
      '_internal',
      'playwright',
      'driver',
      'package',
      'cli.js'
    )
    await mkdir(path.join(appSource, 'out', 'main'), { recursive: true })
    await mkdir(path.dirname(archivePath), { recursive: true })
    await mkdir(path.dirname(nodePtyHelperPath), { recursive: true })
    await mkdir(path.dirname(sidecarExecutablePath), { recursive: true })
    await mkdir(path.dirname(playwrightDriverPath), { recursive: true })
    await writeFile(nodePtyHelperPath, '', { mode: 0o755 })
    await writeFile(sidecarExecutablePath, '', { mode: 0o755 })
    await writeFile(playwrightDriverPath, 'module.exports = {}\n')
    for (const binary of resolvePackagedWindowsNativeBinaries(packagedApp)) {
      const vcRuntimeDllDirectory = path.dirname(binary)
      await mkdir(vcRuntimeDllDirectory, { recursive: true })
      await writeFile(binary, 'native fixture')
      for (const filename of VC_REDIST_DLL_NAMES) {
        await writeFile(path.join(vcRuntimeDllDirectory, filename), 'dummy')
      }
    }
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
      path.resolve('scripts/build/package/audit-app.mjs'),
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
        path.resolve('scripts/build/package/audit-app.mjs'),
        path.join(temporaryDirectory, 'package')
      ])
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr || error)
    }
    expect(stderr).toContain('exposes protected main-process plaintext')
  })

  it('rejects a packaged app that omits a recursively traced dependency', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-package-audit-'))
    const appSource = path.join(temporaryDirectory, 'app-source')
    const packageDirectory = path.join(temporaryDirectory, 'package')
    const archivePath = path.join(packageDirectory, 'win-unpacked', 'resources', 'app.asar')
    const tracePath = path.join(temporaryDirectory, 'runtime-trace-report.json')
    await mkdir(path.join(appSource, 'out', 'main'), { recursive: true })
    await mkdir(path.dirname(archivePath), { recursive: true })
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
    await writeFile(
      tracePath,
      `${JSON.stringify({
        schemaVersion: 1,
        packages: [{ name: 'mammoth', version: '1.11.0' }],
        requiredFiles: [{ id: 'mammoth-runtime', package: 'mammoth', path: 'lib/index.js' }]
      })}\n`
    )
    await createPackage(appSource, archivePath)

    let stderr = ''
    try {
      await execFileAsync(process.execPath, [
        path.resolve('scripts/build/package/audit-app.mjs'),
        packageDirectory,
        tracePath
      ])
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr || error)
    }
    expect(stderr).toContain('missing traced runtime package mammoth')
  })

  it.each([
    { id: 'yaml-directives-runtime', package: 'yaml', path: 'dist/doc/directives.js' },
    { id: 'yaml-document-runtime', package: 'yaml', path: 'dist/doc/Document.js' }
  ])('rejects a packaged YAML manifest missing $path', async (missingFile) => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-package-audit-'))
    const appSource = path.join(temporaryDirectory, 'app-source')
    const packageDirectory = path.join(temporaryDirectory, 'package')
    const archivePath = path.join(packageDirectory, 'win-unpacked', 'resources', 'app.asar')
    const tracePath = path.join(temporaryDirectory, 'runtime-trace-report.json')
    const yamlDirectory = path.join(appSource, 'node_modules', 'yaml')
    await mkdir(path.join(appSource, 'out', 'main'), { recursive: true })
    await mkdir(path.dirname(archivePath), { recursive: true })
    await mkdir(yamlDirectory, { recursive: true })
    await writeFile(path.join(appSource, 'out', 'main', 'index.js'), 'export const ready = true\n')
    await writeFile(
      path.join(appSource, 'package.json'),
      `${JSON.stringify({
        name: 'ncurator-audit-fixture',
        version: '1.0.0',
        main: './out/main/index.js',
        private: true,
        dependencies: { yaml: '2.8.1' }
      })}\n`
    )
    await writeFile(
      path.join(yamlDirectory, 'package.json'),
      `${JSON.stringify({ name: 'yaml', version: '2.8.1', main: './dist/index.js' })}\n`
    )
    await writeFile(
      tracePath,
      `${JSON.stringify({
        schemaVersion: 1,
        packages: [{ name: 'yaml', version: '2.8.1' }],
        requiredFiles: [missingFile]
      })}\n`
    )
    await createPackage(appSource, archivePath)

    await expect(
      execFileAsync(process.execPath, [
        path.resolve('scripts/build/package/audit-app.mjs'),
        packageDirectory,
        tracePath
      ])
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`missing required runtime file ${missingFile.id}`)
    })
  })
})
