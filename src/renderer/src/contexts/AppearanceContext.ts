import React from 'react'
import type { AppResolvedTheme, AppTheme } from '../../../shared/appPreferences'

export type AppearanceContextValue = {
  /** Preference: `system` follows the OS, `light` / `dark` override it. */
  preference: AppTheme
  /** What is painted right now; `system` is never seen here. */
  resolved: AppResolvedTheme
  setPreference: (theme: AppTheme) => void
}

export const AppearanceContext = React.createContext<AppearanceContextValue | null>(null)

export const useAppearance = (): AppearanceContextValue => {
  const value = React.useContext(AppearanceContext)
  if (!value) throw new Error('useAppearance must be used inside AppearanceProvider')
  return value
}
