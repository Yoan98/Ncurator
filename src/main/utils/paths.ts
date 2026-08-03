import { app } from 'electron'
import os from 'os'
import path from 'path'

const FALLBACK_USER_DATA_PATH = path.join(os.tmpdir(), 'ncurator-user-data')
const KNOWN_USER_DATA_DIRS = ['ncurator', 'ncurator-desktop'] as const

const isEphemeralPath = (targetPath: string, tmpDir: string = os.tmpdir()): boolean => {
  const normalizedTarget = path.resolve(targetPath)
  const normalizedTmpDir = path.resolve(tmpDir)
  return (
    normalizedTarget === normalizedTmpDir ||
    normalizedTarget.startsWith(`${normalizedTmpDir}${path.sep}`)
  )
}

const dedupePaths = (paths: string[]): string[] => {
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const candidate of paths) {
    const normalized = path.resolve(candidate)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      deduped.push(normalized)
    }
  }
  return deduped
}

export const listKnownPersistentUserDataPaths = (
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir()
): string[] => {
  if (platform === 'darwin') {
    return KNOWN_USER_DATA_DIRS.map((dirName) =>
      path.join(homeDir, 'Library', 'Application Support', dirName)
    )
  }
  if (platform === 'win32') {
    return KNOWN_USER_DATA_DIRS.map((dirName) =>
      path.join(homeDir, 'AppData', 'Roaming', dirName)
    )
  }
  return []
}

const resolveElectronUserDataPath = (): string => {
  const electronApp = app as { getPath?: (name: string) => string } | undefined
  if (electronApp?.getPath) {
    return electronApp.getPath('userData')
  }
  return FALLBACK_USER_DATA_PATH
}

export const getUserDataPath = (): string => {
  const overridePath = String(process.env.NCURATOR_USER_DATA_PATH || '').trim()
  return overridePath ? path.resolve(overridePath) : resolveElectronUserDataPath()
}

export const getSqliteDbPath = (): string => path.join(getUserDataPath(), 'app.sqlite')

export const getLanceDbPath = (): string => path.join(getUserDataPath(), 'lancedb')

export const listModelPathCandidates = (
  userDataPath: string = getUserDataPath(),
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
  tmpDir: string = os.tmpdir()
): string[] => {
  const activeModelsPath = path.join(userDataPath, 'models')
  const persistentModelPaths = listKnownPersistentUserDataPaths(platform, homeDir).map((candidate) =>
    path.join(candidate, 'models')
  )
  const orderedModelPaths = isEphemeralPath(userDataPath, tmpDir)
    ? [...persistentModelPaths, activeModelsPath]
    : [activeModelsPath, ...persistentModelPaths]

  const candidates = [
    String(process.env.NCURATOR_MODELS_PATH || '').trim()
      ? path.resolve(String(process.env.NCURATOR_MODELS_PATH).trim())
      : '',
    ...orderedModelPaths
  ].filter(Boolean)

  return dedupePaths(candidates)
}

export const getModelsPath = (): string => listModelPathCandidates()[0]
