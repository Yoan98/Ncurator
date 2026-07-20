import fs from 'node:fs'
import path from 'node:path'

const isFile = (filePath) => {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

export const getNodePtySpawnHelperPath = (directory) => path.join(directory, 'spawn-helper')

export const isNodePtyNativeReleaseReady = (directory, platform = process.platform) => {
  if (platform === 'win32') {
    return isFile(path.join(directory, 'conpty.node')) || isFile(path.join(directory, 'pty.node'))
  }

  const bindingPath = path.join(directory, 'pty.node')
  const helperPath = getNodePtySpawnHelperPath(directory)
  if (!isFile(bindingPath) || !isFile(helperPath)) return false

  try {
    fs.accessSync(helperPath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export const prepareNodePtyNativeRelease = (directory, platform = process.platform) => {
  if (platform === 'win32') return isNodePtyNativeReleaseReady(directory, platform)

  const helperPath = getNodePtySpawnHelperPath(directory)
  if (!isFile(path.join(directory, 'pty.node')) || !isFile(helperPath)) return false

  try {
    const currentMode = fs.statSync(helperPath).mode & 0o777
    fs.chmodSync(helperPath, currentMode | 0o111)
  } catch {
    return false
  }
  return isNodePtyNativeReleaseReady(directory, platform)
}

export const assertNodePtyNativeReleaseReady = (directory, label, platform = process.platform) => {
  if (prepareNodePtyNativeRelease(directory, platform)) return
  const helperSuffix = platform === 'win32' ? '' : ' or spawn-helper is not executable'
  throw new Error(`${label} is incomplete${helperSuffix}: ${directory}`)
}
