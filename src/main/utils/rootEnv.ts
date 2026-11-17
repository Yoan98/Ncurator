import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'

let loaded = false

const ROOT_ENV_FILES = ['.env.local', '.env'] as const

const expandEnvironmentReferences = (value: string): string =>
  value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_match, name: string) =>
    String(process.env[name] || '')
  )

export const loadRootEnvOnce = (): void => {
  if (loaded) return
  if (String(process.env.AI_TEST_DISABLE_DOTENV || '').trim() === '1') return
  loaded = true

  const rootDir = process.cwd()
  for (const fileName of ROOT_ENV_FILES) {
    const envPath = path.resolve(rootDir, fileName)
    let raw = ''
    try {
      raw = readFileSync(envPath, 'utf8')
    } catch {
      continue
    }

    for (const [key, value] of Object.entries(parseEnv(raw))) {
      if (key === 'NCURATOR_APP_SECRET_DESKTOP' || value === undefined) continue
      const current = String(process.env[key] || '').trim()
      if (current) continue
      process.env[key] = expandEnvironmentReferences(value)
    }
  }
}
