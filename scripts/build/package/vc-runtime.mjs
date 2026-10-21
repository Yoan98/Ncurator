import fs from 'node:fs'
import path from 'node:path'

export const VC_REDIST_DLL_NAMES = [
  'msvcp140.dll',
  'msvcp140_1.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll'
]

const WINDOWS_NATIVE_BINARIES = [
  'node_modules/onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime_binding.node',
  'node_modules/@node-rs/jieba-win32-x64-msvc/jieba.win32-x64-msvc.node'
]

const isWindowsX64 = (platform, arch) => platform === 'win32' && arch === 'x64'

const assertFile = (filePath, label) => {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} missing: ${filePath}`)
  }
}

const resolveNativeBinaries = (root) =>
  WINDOWS_NATIVE_BINARIES.map((relativePath) => path.join(root, ...relativePath.split('/')))

export const resolvePackagedWindowsNativeBinaries = (appRoot) =>
  resolveNativeBinaries(path.join(appRoot, 'resources', 'app.asar.unpacked'))

export const installWindowsVcRuntime = ({
  stageDir,
  vcRedistDir,
  platform = process.platform,
  arch = process.arch
}) => {
  if (!isWindowsX64(platform, arch)) return

  const sources = VC_REDIST_DLL_NAMES.map((filename) => {
    const source = path.join(vcRedistDir, filename)
    assertFile(source, 'VC++ redistributable DLL')
    return source
  })
  const binaries = resolveNativeBinaries(stageDir)
  for (const binary of binaries) assertFile(binary, 'Windows native binary')
  for (const binary of binaries) {
    for (const source of sources) {
      fs.copyFileSync(source, path.join(path.dirname(binary), path.basename(source)))
    }
  }
  process.stdout.write(
    '[package] installed VC++ redistributable DLLs next to ONNX Runtime and Jieba binaries\n'
  )
}

export const assertVcRuntimeDllsPackaged = (
  appRoot,
  { platform = process.platform, arch = process.arch } = {}
) => {
  if (!isWindowsX64(platform, arch)) return

  for (const binary of resolvePackagedWindowsNativeBinaries(appRoot)) {
    const directory = path.dirname(binary)
    for (const filename of VC_REDIST_DLL_NAMES) {
      assertFile(path.join(directory, filename), 'packaged VC++ redistributable DLL')
    }
    assertFile(binary, 'packaged Windows native binary')
  }
}
