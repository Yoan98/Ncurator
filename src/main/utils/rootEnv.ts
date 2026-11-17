import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'

let loaded = false

const expandEnvironmentReferences = (value: string): string =>
  value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_match, name: string) =>
    String(process.env[name] || '')
  )

export const loadRootEnvOnce = (): void => {
  if (loaded) return
  if (String(process.env.AI_TEST_DISABLE_DOTENV || '').trim() === '1') return
  loaded = true

  let raw: string
  try {
    raw = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8')
  } catch {
    return
  }

  for (const [key, value] of Object.entries(parseEnv(raw))) {
    if (key === 'NCURATOR_APP_SECRET_DESKTOP' || key === 'NCURATOR_LOCAL_APP_SECRET_DESKTOP')
      continue
    if (value === undefined || process.env[key]?.trim()) continue
    process.env[key] = expandEnvironmentReferences(value)
  }
}
