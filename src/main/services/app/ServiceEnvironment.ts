import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { OFFICIAL_API_ORIGINS, OFFICIAL_ORIGINS } from '../../../shared/appPreferences'

export interface DesktopServiceEnvironment {
  environment: 'local' | 'production'
  api: string
  web: string
  appKey: string
}

const localKeyName = 'NCURATOR_LOCAL_APP_SECRET_DESKTOP'
const productionKeyName = 'NCURATOR_APP_SECRET_DESKTOP'

function readEnvironmentFile(root: string): NodeJS.Dict<string> {
  try {
    return parseEnv(readFileSync(path.join(root, '.env'), 'utf8') + '\n')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error('Could not read .env')
  }
}

function applicationKey(settings: NodeJS.Dict<string>, name: string): string {
  const key = settings[name]
  if (!key || key.length < 16 || /\s|\$\{/.test(key)) {
    throw new Error(`Missing or invalid ${name} in .env`)
  }
  return key
}

export const readProductionDesktopAppKey = (root = process.cwd()): string =>
  applicationKey(readEnvironmentFile(root), productionKeyName)

export function readDesktopServiceEnvironment(
  root = process.cwd(),
  inherited: NodeJS.ProcessEnv = process.env
): DesktopServiceEnvironment {
  const settings = readEnvironmentFile(root)
  const environment = inherited.NCURATOR_SERVICE_ENV ?? settings.NCURATOR_SERVICE_ENV
  if (environment !== 'local' && environment !== 'production') {
    throw new Error('NCURATOR_SERVICE_ENV must be local or production')
  }
  const prefix = `NCURATOR_${environment.toUpperCase()}`
  const origin = (suffix: 'API_ORIGIN' | 'WEB_ORIGIN'): string => {
    const name = `${prefix}_${suffix}`
    const value = inherited[name] ?? settings[name]
    if (typeof value !== 'string') throw new Error(`Missing or invalid ${name}`)
    try {
      const url = new URL(value)
      if (
        url.origin !== value ||
        url.username ||
        url.password ||
        (environment === 'local'
          ? url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
          : value !==
            (suffix === 'API_ORIGIN' ? OFFICIAL_API_ORIGINS.domestic : OFFICIAL_ORIGINS.domestic))
      )
        throw new Error()
    } catch {
      throw new Error(`Missing or invalid ${name}`)
    }
    return value
  }
  const api = origin('API_ORIGIN')
  const web = origin('WEB_ORIGIN')
  const appKey = applicationKey(
    settings,
    environment === 'local' ? localKeyName : productionKeyName
  )
  return { environment, api, web, appKey }
}
