import { app } from 'electron'
import os from 'os'
import path from 'path'

const FALLBACK_USER_DATA_PATH = path.join(os.tmpdir(), 'ncurator-user-data')

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

export const getModelsPath = (): string => {
  const overridePath = String(process.env.NCURATOR_MODELS_PATH || '').trim()
  return overridePath ? path.resolve(overridePath) : path.join(getUserDataPath(), 'models')
}
