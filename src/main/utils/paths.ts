import { app } from 'electron'
import os from 'os'
import path from 'path'

const E2E_USER_DATA_PATH = String(process.env.NCURATOR_USER_DATA_PATH || '').trim()
const E2E_MODELS_PATH = String(process.env.NCURATOR_MODELS_PATH || '').trim()
const FALLBACK_USER_DATA_PATH = path.join(os.tmpdir(), 'ncurator-user-data')
const KNOWN_DARWIN_USER_DATA_DIRS = ['ncurator', 'ncurator-desktop'] as const

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
  if (platform !== 'darwin') return []
  return KNOWN_DARWIN_USER_DATA_DIRS.map((dirName) =>
    path.join(homeDir, 'Library', 'Application Support', dirName)
  )
}

const resolveElectronUserDataPath = (): string => {
  const electronApp = app as { getPath?: (name: string) => string } | undefined
  if (electronApp?.getPath) {
    return electronApp.getPath('userData')
  }
  return FALLBACK_USER_DATA_PATH
}

export const USER_DATA_PATH = E2E_USER_DATA_PATH
  ? path.resolve(E2E_USER_DATA_PATH)
  : resolveElectronUserDataPath()
export const SQLITE_DB_PATH = path.join(USER_DATA_PATH, 'app.sqlite')
export const LANCE_DB_PATH = path.join(USER_DATA_PATH, 'lancedb')

export const listModelPathCandidates = (
  userDataPath: string = USER_DATA_PATH,
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
    E2E_MODELS_PATH ? path.resolve(E2E_MODELS_PATH) : '',
    ...orderedModelPaths
  ].filter(Boolean)

  return dedupePaths(candidates)
}

export const MODELS_PATH = listModelPathCandidates()[0]
