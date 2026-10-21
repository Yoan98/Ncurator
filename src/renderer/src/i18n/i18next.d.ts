import 'i18next'
import type { zh } from './resources'
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'app'
    resources: { app: typeof zh }
    enableSelector: true
  }
}
