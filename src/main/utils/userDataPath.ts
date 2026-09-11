import os from 'node:os'
import path from 'node:path'

const FALLBACK_USER_DATA_PATH = path.join(os.tmpdir(), 'ncurator-user-data')

let configuredUserDataPath: string | undefined

export const configureUserDataPath = (value: string): void => {
  const trimmed = String(value || '').trim()
  if (!trimmed) throw new Error('userData path is empty')
  configuredUserDataPath = path.resolve(trimmed)
}

export const getUserDataPath = (): string => {
  const overridePath = String(process.env.NCURATOR_USER_DATA_PATH || '').trim()
  if (overridePath) return path.resolve(overridePath)
  if (configuredUserDataPath) return configuredUserDataPath
  return FALLBACK_USER_DATA_PATH
}
