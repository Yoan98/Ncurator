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

export const readAppDistribution = (resourcesPath?: string): AppDistribution => {
  if (!resourcesPath) return 'domestic'
  try {
    const marker = JSON.parse(
      readFileSync(path.join(resourcesPath, 'app-distribution.json'), 'utf8')
    ) as {
      distribution?: string
    }
    return resolveDistribution(marker.distribution)
  } catch {
    return 'domestic'
  }
}

const distribution = readAppDistribution(process.resourcesPath)
let runtime: AppRuntimeSnapshot = { distribution, locale: 'zh-CN', serviceRoute: distribution }
export const getAppRuntime = (): Readonly<AppRuntimeSnapshot> => runtime
export const initializeAppRuntime = (
  systemLanguages: readonly string[],
  settings?: { language: AppLanguage; serviceRoute: ServiceRoute }
): void => {
  runtime = {
    distribution,
    locale: resolveAppLocale(settings?.language || 'system', systemLanguages),
    serviceRoute: settings?.serviceRoute || distribution
  }
}
// Language takes effect on the next launch. Route changes affect new operations only.
export const setServiceRoute = (serviceRoute: ServiceRoute): void => {
  runtime = { ...runtime, serviceRoute }
}
