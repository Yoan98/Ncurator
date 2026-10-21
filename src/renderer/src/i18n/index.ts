import type { AppSettingsErrorCode } from '../../../shared/appErrors'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { zh, en } from './resources'
import { manualUrl, productName, type AppRuntimeSnapshot } from '../../../shared/appPreferences'

const i18n = createInstance()
let runtime: AppRuntimeSnapshot = {
  locale: 'zh-CN',
  distribution: 'domestic',
  serviceRoute: 'domestic'
}
export const getRendererRuntime = (): Readonly<AppRuntimeSnapshot> => runtime
export const getProductName = (): string => productName(runtime.locale)
export const getManualUrl = (anchor = ''): string => manualUrl(runtime, anchor)
export const updateRendererRoute = (serviceRoute: AppRuntimeSnapshot['serviceRoute']): void => {
  runtime = { ...runtime, serviceRoute }
}
void i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'en',
  supportedLngs: ['zh-CN', 'en'],
  defaultNS: 'app',
  resources: { 'zh-CN': { app: zh }, en: { app: en } },
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false }
})
export const initializeI18n = async (snapshot: AppRuntimeSnapshot): Promise<void> => {
  runtime = { ...snapshot }
  await i18n.changeLanguage(snapshot.locale)
  document.documentElement.lang = snapshot.locale
  document.title = getProductName()
}
export const t = i18n.t.bind(i18n)
export default i18n

export const providerDisplayName = (id: string, fallback: string): string => {
  if (runtime.locale === 'zh-CN') return fallback
  return (
    (
      {
        dashscope: 'Qwen',
        mimo: 'Xiaomi MiMo',
        zhipu: 'Zhipu GLM',
        deepseek: 'DeepSeek'
      } as Record<string, string>
    )[id] || fallback
  )
}

export const appSettingsErrorText = (code: AppSettingsErrorCode): string => {
  switch (code) {
    case 'invalid_language':
      return t(($) => $.preferences.invalidLanguage)
    case 'invalid_service_route':
      return t(($) => $.preferences.invalidServiceRoute)
    case 'invalid_index_speed':
      return t(($) => $.preferences.invalidIndexSpeed)
    case 'invalid_notification_setting':
      return t(($) => $.preferences.invalidNotifications)
  }
}
