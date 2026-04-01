import { app } from 'electron'
import os from 'os'
import path from 'path'

const E2E_USER_DATA_PATH = String(process.env.NCURATOR_USER_DATA_PATH || '').trim()
const FALLBACK_USER_DATA_PATH = path.join(os.tmpdir(), 'ncurator-user-data')
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
export const LANCE_DB_PATH = path.join(USER_DATA_PATH, 'lancedb')
export const MODELS_PATH = path.join(USER_DATA_PATH, 'models')
