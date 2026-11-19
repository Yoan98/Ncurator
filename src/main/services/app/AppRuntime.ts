import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  readDesktopServiceEnvironment,
  readProductionDesktopAppKey,
  type DesktopServiceEnvironment
} from './ServiceEnvironment'
import {
  officialApiUrl,
  officialUrl,
  resolveAppLocale,
  resolveAppTheme,
  resolveDistribution,
  routeForOfficialUrl,
  type AppDistribution,
  type AppLanguage,
  type AppResolvedTheme,
  type AppRuntimeSnapshot,
  type AppTheme,
  type ServiceRoute
} from '../../../shared/appPreferences'

type DistributionConfiguration = { distribution: AppDistribution; appKey?: string }
const packaged = Boolean(process.versions.electron && !process.defaultApp)
const readConfiguration = (resourcesPath?: string): DistributionConfiguration => {
  if (!resourcesPath) throw new Error('Missing application distribution configuration')
  const marker = JSON.parse(
    readFileSync(path.join(resourcesPath, 'app-distribution.json'), 'utf8')
  ) as DistributionConfiguration
  return { distribution: resolveDistribution(marker.distribution), appKey: marker.appKey }
}
export const readAppDistribution = (resourcesPath?: string): AppDistribution =>
  readConfiguration(resourcesPath).distribution
const packagedConfiguration = packaged ? readConfiguration(process.resourcesPath) : null
export const getOfficialAppKey = (): string => {
  const key = packaged
    ? packagedConfiguration?.appKey
    : distribution === 'domestic'
      ? (sourceService ?? readDesktopServiceEnvironment()).appKey
      : (process.env.NCURATOR_APP_SECRET_DESKTOP ?? readProductionDesktopAppKey())
  if (typeof key !== 'string' || key.length < 16 || /\s/.test(key))
    throw new Error('Missing official application key')
  return key
}
let distribution =
  packagedConfiguration?.distribution ??
  resolveDistribution(process.env.NCURATOR_DISTRIBUTION || 'domestic')
let sourceService: DesktopServiceEnvironment | undefined

export function configureServiceEnvironment(
  root = process.cwd(),
  inherited: NodeJS.ProcessEnv = process.env
) {
  if (packaged) return
  sourceService = undefined
  distribution = resolveDistribution(inherited.NCURATOR_DISTRIBUTION || 'domestic')
  runtime = { distribution, locale: runtime.locale, serviceRoute: distribution, theme: runtime.theme }
  if (distribution === 'domestic') sourceService = readDesktopServiceEnvironment(root, inherited)
}

export const usesLocalService = () => sourceService?.environment === 'local'
export const serviceApiUrl = (route: ServiceRoute, pathname: string) =>
  route === 'domestic' && sourceService
    ? sourceService.api + pathname
    : officialApiUrl(route, pathname)
export const serviceWebUrl = (route: ServiceRoute, pathname: string) =>
  route === 'domestic' && sourceService
    ? sourceService.web + pathname
    : officialUrl(route, pathname)

export function routeForServiceUrl(value: string): ServiceRoute | null {
  const route = routeForOfficialUrl(value)
  if (!sourceService) return route
  try {
    const origin = new URL(value).origin
    if (origin === sourceService.api || origin === sourceService.web) return 'domestic'
  } catch {
    /* The value is not a service URL. */
  }
  return route === 'domestic' ? null : route
}

let runtime: AppRuntimeSnapshot = {
  distribution,
  locale: 'zh-CN',
  serviceRoute: distribution,
  theme: 'light'
}
/** Preference restored from disk before SQLite opens, so the first frame already knows it. */
let initialTheme: AppTheme = 'system'
export const getAppRuntime = (): Readonly<AppRuntimeSnapshot> => runtime
export const setInitialAppTheme = (theme: AppTheme): void => {
  initialTheme = theme
}
/** `followsDark` is Main's read of the OS preference; callers pass it so `system` resolves here. */
export const initializeAppRuntime = (
  systemLanguages: readonly string[],
  settings?: { language: AppLanguage; serviceRoute: ServiceRoute; theme?: AppTheme },
  followsDark = false
): void => {
  runtime = {
    distribution,
    locale: resolveAppLocale(settings?.language || 'system', systemLanguages),
    serviceRoute: distribution,
    theme: resolveAppTheme(settings?.theme ?? initialTheme, followsDark),
    ...(sourceService && { accountWebOrigin: sourceService.web })
  }
}

export const setAppRuntimeTheme = (theme: AppResolvedTheme): void => {
  runtime = { ...runtime, theme }
}
