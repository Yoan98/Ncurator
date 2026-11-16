import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  officialApiUrl,
  officialUrl,
  routeForOfficialUrl,
  resolveAppLocale,
  resolveDistribution,
  type AppDistribution,
  type AppLanguage,
  type AppRuntimeSnapshot,
  type ServiceRoute
} from '../../../shared/appPreferences'

type DistributionConfiguration = { distribution: AppDistribution; appKey?: string }
const packaged = Boolean(process.versions.electron && !process.defaultApp)
const readConfiguration = (resourcesPath?: string): DistributionConfiguration => {
  if (!resourcesPath) throw new Error('Missing application distribution configuration')
  const marker = JSON.parse(readFileSync(path.join(resourcesPath, 'app-distribution.json'), 'utf8')) as DistributionConfiguration
  return { distribution: resolveDistribution(marker.distribution), appKey: marker.appKey }
}
export const readAppDistribution = (resourcesPath?: string): AppDistribution => readConfiguration(resourcesPath).distribution
const packagedConfiguration = packaged ? readConfiguration(process.resourcesPath) : null
export const getOfficialAppKey = (): string => {
  const key = packaged ? packagedConfiguration?.appKey : process.env.NCURATOR_APP_SECRET_DESKTOP
  if (typeof key !== 'string' || key.length < 16 || /\s/.test(key)) throw new Error('Missing official application key')
  return key
}
const distribution = packagedConfiguration?.distribution ?? resolveDistribution(process.env.NCURATOR_DISTRIBUTION || 'domestic')
type LocalServiceOrigins = { api: string; web: string }
let localService: LocalServiceOrigins | undefined

export function configureLocalService() {
  if (packaged || distribution !== 'domestic') return
  const api = process.env.NCURATOR_API_ORIGIN
  const web = process.env.NCURATOR_WEB_ORIGIN
  if (!api && !web) return
  if (!api || !web || ![api, web].every(value => {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port && url.origin === value
  })) throw new Error('Local desktop API and website must both be loopback origins with ports')
  localService = { api, web }
}

export const usesLocalService = () => Boolean(localService)
export const serviceApiUrl = (route: ServiceRoute, pathname: string) =>
  route === 'domestic' && localService ? localService.api + pathname : officialApiUrl(route, pathname)
export const serviceWebUrl = (route: ServiceRoute, pathname: string) =>
  route === 'domestic' && localService ? localService.web + pathname : officialUrl(route, pathname)

export function routeForServiceUrl(value: string): ServiceRoute | null {
  const route = routeForOfficialUrl(value)
  if (!localService) return route
  try {
    const origin = new URL(value).origin
    if (origin === localService.api || origin === localService.web) return 'domestic'
  } catch { /* The value is not a service URL. */ }
  return route === 'domestic' ? null : route
}

let runtime: AppRuntimeSnapshot = { distribution, locale: 'zh-CN', serviceRoute: distribution }
export const getAppRuntime = (): Readonly<AppRuntimeSnapshot> => runtime
export const initializeAppRuntime = (
  systemLanguages: readonly string[],
  settings?: { language: AppLanguage; serviceRoute: ServiceRoute }
): void => {
  runtime = {
    distribution,
    locale: resolveAppLocale(settings?.language || 'system', systemLanguages),
    serviceRoute: distribution,
    ...(localService && { accountWebOrigin: localService.web })
  }
}
