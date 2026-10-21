import { PRODUCT_NAME_EN, PRODUCT_NAME_ZH } from './constants'

export type AppDistribution = 'domestic' | 'international'
export type ServiceRoute = AppDistribution
export type AppLocale = 'zh-CN' | 'en'
export type AppLanguage = 'system' | AppLocale

export interface AppRuntimeSnapshot {
  distribution: AppDistribution
  locale: AppLocale
  serviceRoute: ServiceRoute
}

export const isServiceRoute = (value: string | undefined | null): value is ServiceRoute =>
  value === 'domestic' || value === 'international'
export const isAppLanguage = (value: string | undefined | null): value is AppLanguage =>
  value === 'system' || value === 'zh-CN' || value === 'en'
export const resolveDistribution = (value?: string | null): AppDistribution =>
  value === 'international' ? 'international' : 'domestic'

export const resolveAppLocale = (
  preference: AppLanguage,
  systemLanguages: readonly string[]
): AppLocale => {
  if (preference !== 'system') return preference
  for (const language of systemLanguages) {
    if (/^zh(?:[-_]|$)/iu.test(language)) return 'zh-CN'
    if (/^en(?:[-_]|$)/iu.test(language)) return 'en'
  }
  return 'en'
}

export const OFFICIAL_ORIGINS: Record<ServiceRoute, string> = {
  domestic: 'https://www.guanzhangai.cn',
  international: 'https://www.ncurator.com'
}
export const DOWNLOAD_ORIGINS: Record<AppDistribution, string> = {
  domestic: 'https://download.guanzhangai.cn',
  international: 'https://download.ncurator.com'
}
export const productName = (locale: AppLocale): string =>
  locale === 'zh-CN' ? PRODUCT_NAME_ZH : PRODUCT_NAME_EN
export const officialUrl = (route: ServiceRoute, pathname: string): string =>
  `${OFFICIAL_ORIGINS[route]}${pathname}`
export const manualUrl = (runtime: AppRuntimeSnapshot, anchor = ''): string =>
  officialUrl(runtime.serviceRoute, `/${runtime.locale === 'zh-CN' ? 'zh' : 'en'}/manual${anchor}`)
export const downloadPageUrl = (runtime: AppRuntimeSnapshot): string =>
  officialUrl(runtime.distribution, `/${runtime.locale === 'zh-CN' ? 'zh' : 'en'}`)
export const routeForOfficialUrl = (value: string): ServiceRoute | null => {
  try {
    const origin = new URL(value).origin
    if (origin === OFFICIAL_ORIGINS.domestic) return 'domestic'
    if (origin === OFFICIAL_ORIGINS.international) return 'international'
  } catch {
    /* Invalid external addresses are never official endpoints. */
  }
  return null
}
