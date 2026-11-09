import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
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
let runtime: AppRuntimeSnapshot = { distribution, locale: 'zh-CN', serviceRoute: distribution }
export const getAppRuntime = (): Readonly<AppRuntimeSnapshot> => runtime
export const initializeAppRuntime = (
  systemLanguages: readonly string[],
  settings?: { language: AppLanguage; serviceRoute: ServiceRoute }
): void => {
  runtime = {
    distribution,
    locale: resolveAppLocale(settings?.language || 'system', systemLanguages),
    serviceRoute: distribution
  }
}
