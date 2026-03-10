import { app } from 'electron'
import path from 'path'

export const USER_DATA_PATH = app.getPath('userData')
export const LANCE_DB_PATH = path.join(USER_DATA_PATH, 'lancedb')
export const MODELS_PATH = path.join(USER_DATA_PATH, 'models')
