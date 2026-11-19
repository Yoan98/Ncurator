import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppResolvedTheme, AppTheme } from '../../../shared/appPreferences'
import { AppearanceContext, type AppearanceContextValue } from './AppearanceContext'

const applyToDocument = (theme: AppResolvedTheme): void => {
  document.documentElement.dataset.theme = theme
}

export const AppearanceProvider: React.FC<
  React.PropsWithChildren<{ initialTheme: AppResolvedTheme }>
> = ({ initialTheme, children }) => {
  const [resolved, setResolved] = useState<AppResolvedTheme>(initialTheme)
  const [preference, setPreferenceState] = useState<AppTheme>('system')

  useEffect(() => {
    applyToDocument(initialTheme)
  }, [initialTheme])

  useEffect(() => {
    let mounted = true
    void window.api
      .appSettingsGet()
      .then((settings) => {
        if (mounted) setPreferenceState(settings.theme)
      })
      .catch((error) => console.error('Failed to read the appearance preference', error))
    // Main resolves the OS preference, so `system` never has to be interpreted twice.
    const unsubscribeTheme = window.api.onAppThemeChanged((theme) => {
      setResolved(theme)
      applyToDocument(theme)
    })
    return () => {
      mounted = false
      unsubscribeTheme()
    }
  }, [])

  const setPreference = useCallback((theme: AppTheme) => {
    setPreferenceState(theme)
  }, [])

  const value = useMemo<AppearanceContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference]
  )

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export default AppearanceProvider
