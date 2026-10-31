import { cp, lstat, readdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { compareReleaseVersions, parseReleaseTag } from '../tag.mjs'

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

export const cleanupLocalTestLogs = async (root, { tag } = {}) => {
  const current = parseReleaseTag(tag)
  const rootPath = await realpath(root)
  const testsPath = path.join(rootPath, 'tests')
  const scratchPath = path.join(rootPath, '.codex-tmp')
  for (const directory of [testsPath, scratchPath]) {
    const entry = await lstat(directory).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (entry?.isSymbolicLink()) {
      throw new Error(`refusing to clean release logs through a symbolic link: ${directory}`)
    }
  }
  await rm(path.join(testsPath, 'logs'), { recursive: true, force: true })
  const entries = await readdir(scratchPath, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const removed = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('release-')) continue
    let previous
    try {
      previous = parseReleaseTag(entry.name.slice('release-'.length))
    } catch {
      continue
    }
    if (
      previous.family !== current.family ||
      compareReleaseVersions(previous.version, current.version) > 0
    )
      continue
    const directory = path.join(scratchPath, entry.name)
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    removed.push(directory)
  }
  return removed
}
