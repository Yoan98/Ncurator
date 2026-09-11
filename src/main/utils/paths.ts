import { app } from 'electron'
import path from 'path'
import { configureUserDataPath, getUserDataPath } from './userDataPath'

export { getUserDataPath }

export const syncUserDataPathFromElectron = (): void => {
  configureUserDataPath(app.getPath('userData'))
}

export const getSqliteDbPath = (): string => path.join(getUserDataPath(), 'app.sqlite')

export const getLanceDbPath = (): string => path.join(getUserDataPath(), 'lancedb')

export const getModelsPath = (): string => {
  const overridePath = String(process.env.NCURATOR_MODELS_PATH || '').trim()
  return overridePath ? path.resolve(overridePath) : path.join(getUserDataPath(), 'models')
}
