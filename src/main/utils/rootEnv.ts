import { readFileSync } from 'node:fs'
import path from 'node:path'

let loaded = false

const ROOT_ENV_FILES = ['.env.local', '.env'] as const

const unquote = (value: string): string => {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const parseLine = (line: string): { key: string; value: string } | null => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const index = trimmed.indexOf('=')
  if (index <= 0) return null
  const key = trimmed.slice(0, index).trim()
  const value = unquote(trimmed.slice(index + 1))
  if (!key) return null
  return { key, value }
}

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

    for (const line of raw.split('\n')) {
      const parsed = parseLine(line)
      if (!parsed) continue
      const current = String(process.env[parsed.key] || '').trim()
      if (current) continue
      process.env[parsed.key] = parsed.value
    }
  }
}
