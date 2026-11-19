import { BrowserWindow, nativeTheme } from 'electron'
import {
  resolveAppTheme,
  type AppResolvedTheme,
  type AppTheme
} from '../../../shared/appPreferences'
import { setAppRuntimeTheme } from './AppRuntime'
import { writeStoredAppTheme } from './AppearancePreference'

/** Window chrome colours per theme. Keep in sync with the `--notion-*` tokens in `base.css`. */
const WINDOW_CHROME: Record<AppResolvedTheme, { background: string; symbol: string }> = {
  light: { background: '#FBFBFA', symbol: '#37352F' },
  dark: { background: '#191919', symbol: '#D4D4D4' }
}

type Listener = (theme: AppResolvedTheme) => void

const listeners = new Set<Listener>()
let current: AppTheme = 'system'

const resolved = (): AppResolvedTheme => resolveAppTheme(current, nativeTheme.shouldUseDarkColors)

/**
 * Applies the resolved appearance to the runtime snapshot and notifies listeners.
 *
 * Window chrome is deliberately NOT touched here: auxiliary windows (the native confirm dialog,
 * the browser menu) are created with `transparent: true`, and setting an opaque background on
 * them would replace their transparency with a solid block. Call `applyWindowChrome` explicitly
 * for the windows that actually own native chrome.
 */
export const applyAppearance = (): AppResolvedTheme => {
  const theme = resolved()
  // Main owns the OS override so `prefers-color-scheme` in the renderer tracks the user choice.
  nativeTheme.themeSource = current
  setAppRuntimeTheme(theme)
  for (const listener of listeners) listener(theme)
  return theme
}

/** Applies the themed window background and Windows caption-button colours to one window. */
export const applyWindowChrome = (window: BrowserWindow): void => {
  if (window.isDestroyed()) return
  const { background, symbol } = WINDOW_CHROME[resolved()]
  if (process.platform === 'win32') {
    window.setTitleBarOverlay({ color: background, symbolColor: symbol })
  }
  window.setBackgroundColor(background)
}

export const getResolvedAppTheme = (): AppResolvedTheme => resolved()

/**
 * Sets the three-state preference: `system` delegates to the OS, `light` / `dark` override it.
 * Also persists the first-frame copy so the next launch paints the right colour immediately.
 */
export const setAppThemePreference = (theme: AppTheme): void => {
  current = theme
  writeStoredAppTheme(theme)
  applyAppearance()
}

export const subscribeAppearance = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Seeds the preference restored from disk before SQLite is available. */
export const seedAppThemePreference = (theme: AppTheme): void => {
  current = theme
  nativeTheme.themeSource = theme
}

/** Follows OS light/dark switches while the preference is `system`. */
export const watchSystemAppearance = (): void => {
  nativeTheme.on('updated', () => {
    if (current === 'system') applyAppearance()
  })
}

export const windowChrome = (theme: AppResolvedTheme): { background: string; symbol: string } =>
  WINDOW_CHROME[theme]
