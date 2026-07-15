import { createContext, useContext } from 'react'
import type { AppUpdateSnapshot } from '../../../shared/types'

export type AppUpdateContextValue = {
  snapshot: AppUpdateSnapshot | null
  actionPending: boolean
  downloadUpdate: () => Promise<void>
  retryUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
}

export const AppUpdateContext = createContext<AppUpdateContextValue | null>(null)

export const useAppUpdate = (): AppUpdateContextValue => {
  const value = useContext(AppUpdateContext)
  if (!value) throw new Error('useAppUpdate must be used inside AppUpdateProvider')
  return value
}
