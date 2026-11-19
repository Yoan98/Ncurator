import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isAppTheme, type AppTheme } from '../../../shared/appPreferences'
import { getUserDataPath } from '../../utils/userDataPath'

/**
 * First-frame appearance preference.
 *
 * The main window (and its splash) is created before SQLite is initialised, so `app_settings`
 * is not readable yet. This file keeps only the theme preference so the first painted frame
 * matches the saved appearance; `app_settings.theme` stays the single source of truth and is
 * written here on every save.
 */
const FILE_NAME = 'appearance.json'

const filePath = (): string => path.join(getUserDataPath(), FILE_NAME)

export const readStoredAppTheme = (): AppTheme => {
  try {
    const parsed = JSON.parse(readFileSync(filePath(), 'utf8')) as { theme?: unknown } | null
    const stored = typeof parsed?.theme === 'string' ? parsed.theme : null
    return isAppTheme(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export const writeStoredAppTheme = (theme: AppTheme): void => {
  try {
    writeFileSync(filePath(), `${JSON.stringify({ theme })}\n`, 'utf8')
  } catch (error) {
    // A failed write only costs the first frame; the saved setting stays authoritative.
    console.error('[APPEARANCE] Failed to persist the appearance preference:', error)
  }
}
