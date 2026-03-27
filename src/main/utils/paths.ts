import { app } from 'electron'
import path from 'path'

const E2E_USER_DATA_PATH = String(process.env.NCURATOR_USER_DATA_PATH || '').trim()

export const USER_DATA_PATH = E2E_USER_DATA_PATH
  ? path.resolve(E2E_USER_DATA_PATH)
  : app.getPath('userData')
export const LANCE_DB_PATH = path.join(USER_DATA_PATH, 'lancedb')
export const MODELS_PATH = path.join(USER_DATA_PATH, 'models')
