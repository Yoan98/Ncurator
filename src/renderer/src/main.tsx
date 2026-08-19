import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

const reportGlobalError = (event: ErrorEvent): void => {
  console.error('[APP-ERROR] uncaught', event.error || event.message)
}

window.addEventListener('error', reportGlobalError)

window.addEventListener('unhandledrejection', (event) => {
  console.error('[APP-ERROR] unhandled rejection', event.reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
