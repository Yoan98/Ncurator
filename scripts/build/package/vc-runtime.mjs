import fs from 'node:fs'
import path from 'node:path'

export const VC_REDIST_DLL_NAMES = [
  'msvcp140.dll',
  'msvcp140_1.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll'
]

const ONNX_BIN_SEGMENTS = ['node_modules', 'onnxruntime-node', 'bin', 'napi-v3', 'win32', 'x64']

const isWindowsX64 = (platform, arch) => platform === 'win32' && arch === 'x64'

const assertDirectory = (directory, label) => {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${label} not found: ${directory}`)
  }
}

export const installWindowsVcRuntime = ({
  stageDir,
  vcRedistDir,
  platform = process.platform,
  arch = process.arch
}) => {
  if (!isWindowsX64(platform, arch)) return

  assertDirectory(vcRedistDir, 'VC++ redistributable source directory')
  const targetDirectory = path.join(stageDir, ...ONNX_BIN_SEGMENTS)
  assertDirectory(targetDirectory, 'ONNX Runtime target binary directory')

  for (const filename of VC_REDIST_DLL_NAMES) {
    const source = path.join(vcRedistDir, filename)
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error(`VC++ redistributable DLL missing: ${source}`)
    }
    fs.copyFileSync(source, path.join(targetDirectory, filename))
  }
  process.stdout.write('[package] installed VC++ redistributable DLLs into ONNX Runtime binary directory\n')
}

export const resolveVcRuntimeDllDirectory = (appRoot) =>
  path.join(appRoot, 'resources', 'app.asar.unpacked', ...ONNX_BIN_SEGMENTS)

export const assertVcRuntimeDllsPackaged = (
  appRoot,
  { platform = process.platform, arch = process.arch } = {}
) => {
  if (!isWindowsX64(platform, arch)) return

  const directory = resolveVcRuntimeDllDirectory(appRoot)
  for (const filename of VC_REDIST_DLL_NAMES) {
    const dllPath = path.join(directory, filename)
    if (!fs.existsSync(dllPath) || !fs.statSync(dllPath).isFile()) {
      throw new Error(`packaged VC++ redistributable DLL missing: ${filename}`)
    }
  }
}
