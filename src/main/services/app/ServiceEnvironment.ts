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

function readEnvironmentFile(root: string, name: '.env' | '.env.local'): NodeJS.Dict<string> {
  try {
    return parseEnv(readFileSync(path.join(root, name), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`Could not read ${name}`)
  }
}

function applicationKey(settings: NodeJS.Dict<string>, file: '.env' | '.env.local'): string {
  const key = settings.NCURATOR_APP_SECRET_DESKTOP
  if (!key || key.length < 16 || /\s|\$\{/.test(key)) {
    throw new Error(`Missing or invalid NCURATOR_APP_SECRET_DESKTOP in ${file}`)
  }
  return key
}

export const readProductionDesktopAppKey = (root = process.cwd()): string =>
  applicationKey(readEnvironmentFile(root, '.env'), '.env')

export function readDesktopServiceEnvironment(
  root = process.cwd(),
  inherited: NodeJS.ProcessEnv = process.env
): DesktopServiceEnvironment {
  const production = readEnvironmentFile(root, '.env')
  const local = readEnvironmentFile(root, '.env.local')
  const environment =
    inherited.NCURATOR_SERVICE_ENV ?? local.NCURATOR_SERVICE_ENV ?? production.NCURATOR_SERVICE_ENV
  if (environment !== 'local' && environment !== 'production') {
    throw new Error('NCURATOR_SERVICE_ENV must be local or production')
  }
  const prefix = `NCURATOR_${environment.toUpperCase()}`
  const origin = (suffix: 'API_ORIGIN' | 'WEB_ORIGIN'): string => {
    const name = `${prefix}_${suffix}`
    const value = inherited[name] ?? local[name] ?? production[name]
    if (typeof value !== 'string') throw new Error(`Missing or invalid ${name}`)
    try {
      const url = new URL(value ?? '')
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
  const file = environment === 'local' ? '.env.local' : '.env'
  // Credentials are selected by file, never by a dotenv merge or inherited process value.
  const appKey = applicationKey(environment === 'local' ? local : production, file)
  return { environment, api, web, appKey }
}
