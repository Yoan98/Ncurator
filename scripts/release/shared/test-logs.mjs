import { rm } from 'node:fs/promises'
import path from 'node:path'

export const cleanupLocalTestLogs = async (root) => {
  const rootPath = path.resolve(root)
  const logsPath = path.resolve(rootPath, 'tests', 'logs')
  const relative = path.relative(rootPath, logsPath)
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`refusing to clean test logs outside the release root: ${logsPath}`)
  }
  await rm(logsPath, { recursive: true, force: true })
}
