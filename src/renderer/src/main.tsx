import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initializeI18n } from './i18n'
import ErrorBoundary from './components/ErrorBoundary'

const reportGlobalError = (event: ErrorEvent): void => {
  console.error('[APP-ERROR] uncaught', event.error || event.message)
}

window.addEventListener('error', reportGlobalError)

window.addEventListener('unhandledrejection', (event) => {
  console.error('[APP-ERROR] unhandled rejection', event.reason)
})

const start = async (): Promise<void> => {
  const startup = await window.api.appStartupGetStatus()
  await initializeI18n(startup)
  if (startup.locale === 'zh-CN') await import('monaco-editor/nls/lang/zh-cn.js')
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}
void start().catch((error) => {
  console.error('Application startup failed', error)
  const root = document.getElementById('root')
  if (root) root.textContent = 'Unable to start the application. Please restart.'
})
