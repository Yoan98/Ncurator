import { cp, rm } from 'node:fs/promises'
import path from 'node:path'

export const preserveReleaseTestLogs = async (sourceRoot, releaseRoot) => {
  try {
    await cp(path.join(sourceRoot, 'tests/logs'), path.join(releaseRoot, 'tests/logs'), {
      recursive: true,
      force: true
    })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

export const cleanupLocalTestLogs = async (root) => {
  const rootPath = path.resolve(root)
  const logsPath = path.resolve(rootPath, 'tests', 'logs')
  const relative = path.relative(rootPath, logsPath)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`refusing to clean test logs outside the release root: ${logsPath}`)
  }
  await rm(logsPath, { recursive: true, force: true })
}
