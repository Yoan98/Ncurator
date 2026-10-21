import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createPackage } from '@electron/asar'
import { afterEach, describe, expect, it } from 'vitest'
import {
  VC_REDIST_DLL_NAMES,
  assertVcRuntimeDllsPackaged,
  installWindowsVcRuntime,
  resolvePackagedWindowsNativeBinaries
} from '../../../../scripts/build/package/vc-runtime.mjs'

const execFileAsync = promisify(execFile)
let temporaryDirectory = ''

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

const writeDummyDll = async (directory: string, filename: string) => {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, filename), 'dummy')
}

const stageNativeBinaries = (stageDir: string) => [
  path.join(
    stageDir,
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v3',
    'win32',
    'x64',
    'onnxruntime_binding.node'
  ),
  path.join(
    stageDir,
    'node_modules',
    '@node-rs',
    'jieba-win32-x64-msvc',
    'jieba.win32-x64-msvc.node'
  )
]

const writeNativeBinaries = async (binaries: string[]) => {
  for (const binary of binaries) {
    await mkdir(path.dirname(binary), { recursive: true })
    await writeFile(binary, 'native fixture')
  }
}

const writePackagedRuntime = async (appRoot: string) => {
  const binaries = resolvePackagedWindowsNativeBinaries(appRoot)
  await writeNativeBinaries(binaries)
  for (const binary of binaries) {
    for (const filename of VC_REDIST_DLL_NAMES) {
      await writeDummyDll(path.dirname(binary), filename)
    }
  }
  return binaries
}

describe('VC++ redistributable packaging', () => {
  it('installs the redistributable DLLs next to both ONNX Runtime and Jieba binaries', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const stageDir = path.join(temporaryDirectory, 'stage')
    const vcRedistDir = path.join(temporaryDirectory, 'vc-redist')
    const binaries = stageNativeBinaries(stageDir)
    await writeNativeBinaries(binaries)
    for (const filename of VC_REDIST_DLL_NAMES) await writeDummyDll(vcRedistDir, filename)

    installWindowsVcRuntime({ stageDir, vcRedistDir, platform: 'win32', arch: 'x64' })

    for (const binary of binaries) {
      for (const filename of VC_REDIST_DLL_NAMES) {
        expect(await readFile(path.join(path.dirname(binary), filename))).toEqual(
          await readFile(path.join(vcRedistDir, filename))
        )
      }
    }
  })

  it('throws when a redistributable source DLL is missing', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const stageDir = path.join(temporaryDirectory, 'stage')
    const vcRedistDir = path.join(temporaryDirectory, 'vc-redist')
    await writeNativeBinaries(stageNativeBinaries(stageDir))
    for (const filename of VC_REDIST_DLL_NAMES.slice(0, -1)) {
      await writeDummyDll(vcRedistDir, filename)
    }

    expect(() =>
      installWindowsVcRuntime({ stageDir, vcRedistDir, platform: 'win32', arch: 'x64' })
    ).toThrow('VC++ redistributable DLL missing')
  })

  it('rejects a stage missing the Windows Jieba optional binary package', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const stageDir = path.join(temporaryDirectory, 'stage')
    const vcRedistDir = path.join(temporaryDirectory, 'vc-redist')
    await writeNativeBinaries(stageNativeBinaries(stageDir).slice(0, 1))
    for (const filename of VC_REDIST_DLL_NAMES) await writeDummyDll(vcRedistDir, filename)

    expect(() =>
      installWindowsVcRuntime({ stageDir, vcRedistDir, platform: 'win32', arch: 'x64' })
    ).toThrow('jieba.win32-x64-msvc.node')
  })

  it('skips installation on non-Windows x64 platforms', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const stageDir = path.join(temporaryDirectory, 'stage')
    const vcRedistDir = path.join(temporaryDirectory, 'vc-redist')
    const binaries = stageNativeBinaries(stageDir)
    await writeNativeBinaries(binaries)

    installWindowsVcRuntime({ stageDir, vcRedistDir, platform: 'darwin', arch: 'arm64' })

    for (const binary of binaries) {
      expect(await readdir(path.dirname(binary))).toEqual([path.basename(binary)])
    }
  })

  it('asserts the redistributable DLLs are present in a packaged Windows app', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const appRoot = path.join(temporaryDirectory, 'win-unpacked')
    await writePackagedRuntime(appRoot)

    expect(() =>
      assertVcRuntimeDllsPackaged(appRoot, { platform: 'win32', arch: 'x64' })
    ).not.toThrow()
  })

  it.each([0, 1])('rejects a missing DLL in packaged native target %i', async (index) => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const appRoot = path.join(temporaryDirectory, 'win-unpacked')
    const binaries = await writePackagedRuntime(appRoot)
    const omittedDll = path.join(path.dirname(binaries[index]!), 'vcruntime140.dll')
    await rm(omittedDll)

    expect(() => assertVcRuntimeDllsPackaged(appRoot, { platform: 'win32', arch: 'x64' })).toThrow(
      omittedDll
    )
  })

  it('rejects a packaged Jieba binary that is absent from app.asar.unpacked', async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
    const appRoot = path.join(temporaryDirectory, 'win-unpacked')
    const binaries = await writePackagedRuntime(appRoot)
    await rm(binaries[1]!)

    expect(() => assertVcRuntimeDllsPackaged(appRoot, { platform: 'win32', arch: 'x64' })).toThrow(
      'packaged Windows native binary missing'
    )
  })

  it('skips the packaged assertion on non-Windows platforms', () => {
    expect(() =>
      assertVcRuntimeDllsPackaged('/nonexistent', { platform: 'darwin', arch: 'arm64' })
    ).not.toThrow()
  })

  it.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
    'audit-app rejects a Windows package with ONNX DLLs but missing Jieba runtime',
    async () => {
      temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ncurator-vc-runtime-'))
      const appSource = path.join(temporaryDirectory, 'app-source')
      const packageDirectory = path.join(temporaryDirectory, 'package')
      const archivePath = path.join(packageDirectory, 'win-unpacked', 'resources', 'app.asar')
      await mkdir(path.join(appSource, 'out', 'main'), { recursive: true })
      await mkdir(path.dirname(archivePath), { recursive: true })
      await writeFile(
        path.join(appSource, 'out', 'main', 'index.js'),
        'export const ready = true\n'
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
      const appRoot = path.join(packageDirectory, 'win-unpacked')
      const binaries = await writePackagedRuntime(appRoot)
      await rm(path.join(path.dirname(binaries[1]!), 'vcruntime140.dll'))

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
      expect(stderr).toContain('jieba-win32-x64-msvc')
    }
  )
})
