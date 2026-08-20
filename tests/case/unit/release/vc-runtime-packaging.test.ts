import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createPackage } from '@electron/asar'
import { afterEach, describe, expect, it } from 'vitest'
import {
  VC_REDIST_DLL_NAMES,
  assertVcRuntimeDllsPackaged,
  installWindowsVcRuntime,
  resolveVcRuntimeDllDirectory
} from '../../../../scripts/build/package/vc-runtime.mjs'

const execFileAsync = promisify(execFile)
let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

const writeDummyDll = async (directory, filename) => {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, filename), 'dummy')
}

const stageTargetDirectory = (stageDir) =>
  path.join(stageDir, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3', 'win32', 'x64')

describe('VC++ redistributable packaging', () => {
  it('installs the redistributable DLLs next to the ONNX Runtime binaries', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const stageDir = path.join(temporaryDirectory, 'stage')
    const vcRedistDir = path.join(temporaryDirectory, 'vc-redist')
    const targetDir = stageTargetDirectory(stageDir)
    await mkdir(targetDir, { recursive: true })
    for (const filename of VC_REDIST_DLL_NAMES) await writeDummyDll(vcRedistDir, filename)

    installWindowsVcRuntime({ stageDir, vcRedistDir, platform: 'win32', arch: 'x64' })

    for (const filename of VC_REDIST_DLL_NAMES) {
      expect((await stat(path.join(targetDir, filename))).isFile()).toBe(true)
    }
  })

  it('throws when a redistributable source DLL is missing', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const stageDir = path.join(temporaryDirectory, 'stage')
    const vcRedistDir = path.join(temporaryDirectory, 'vc-redist')
    await mkdir(stageTargetDirectory(stageDir), { recursive: true })
    for (const filename of VC_REDIST_DLL_NAMES.slice(0, -1)) {
      await writeDummyDll(vcRedistDir, filename)
    }

    expect(() =>
      installWindowsVcRuntime({ stageDir, vcRedistDir, platform: 'win32', arch: 'x64' })
    ).toThrow('VC++ redistributable DLL missing')
  })

  it('skips installation on non-Windows x64 platforms', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const stageDir = path.join(temporaryDirectory, 'stage')
    const vcRedistDir = path.join(temporaryDirectory, 'vc-redist')
    const targetDir = stageTargetDirectory(stageDir)
    await mkdir(targetDir, { recursive: true })

    installWindowsVcRuntime({ stageDir, vcRedistDir, platform: 'darwin', arch: 'arm64' })

    expect(await readdir(targetDir)).toEqual([])
  })

  it('asserts the redistributable DLLs are present in a packaged Windows app', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const appRoot = path.join(temporaryDirectory, 'win-unpacked')
    const dllDir = resolveVcRuntimeDllDirectory(appRoot)
    for (const filename of VC_REDIST_DLL_NAMES) await writeDummyDll(dllDir, filename)

    expect(() => assertVcRuntimeDllsPackaged(appRoot, { platform: 'win32', arch: 'x64' })).not.toThrow()
  })

  it('throws when a packaged Windows app omits a redistributable DLL', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const appRoot = path.join(temporaryDirectory, 'win-unpacked')
    const dllDir = resolveVcRuntimeDllDirectory(appRoot)
    for (const filename of VC_REDIST_DLL_NAMES.slice(0, -1)) {
      await writeDummyDll(dllDir, filename)
    }

    expect(() => assertVcRuntimeDllsPackaged(appRoot, { platform: 'win32', arch: 'x64' })).toThrow(
      'packaged VC++ redistributable DLL missing'
    )
  })

  it('skips the packaged assertion on non-Windows platforms', () => {
    expect(() =>
      assertVcRuntimeDllsPackaged('/nonexistent', { platform: 'darwin', arch: 'arm64' })
    ).not.toThrow()
  })

  it.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
    'audit-app rejects a Windows package missing the redistributable DLLs',
    async () => {
      temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
      const appSource = path.join(temporaryDirectory, 'app-source')
      const packageDirectory = path.join(temporaryDirectory, 'package')
      const archivePath = path.join(packageDirectory, 'win-unpacked', 'resources', 'app.asar')
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
      await createPackage(appSource, archivePath)

      let stderr = ''
      try {
        await execFileAsync(process.execPath, [
          path.resolve('scripts/build/package/audit-app.mjs'),
          packageDirectory
        ])
      } catch (error) {
        stderr = String((error as { stderr?: string }).stderr || error)
      }
      expect(stderr).toContain('packaged VC++ redistributable DLL missing')
    }
  )
})
