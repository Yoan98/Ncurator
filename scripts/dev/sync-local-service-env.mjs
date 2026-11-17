import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const fields = [
  'NCURATOR_LOCAL_API_ORIGIN',
  'NCURATOR_LOCAL_WEB_ORIGIN',
  'NCURATOR_APP_SECRET_DESKTOP'
]

export function syncLocalServiceEnvironment(source, root = process.cwd()) {
  const destination = path.join(root, '.env.local')
  function readCurrent() {
    try {
      return readFileSync(destination, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw new Error('Could not read .env.local for synchronization')
    }
  }
  let expected = readCurrent()
  function replace(values) {
    const retained = (expected ?? '')
      .split(/\r?\n/)
      .filter(
        (line) => !fields.some((name) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line))
      )
      .join('\n')
      .trimEnd()
    const next = [retained, ...fields.map((name) => `${name}=${values[name] ?? ''}`), ''].join('\n')
    const temporary = destination + '.' + randomUUID()
    try {
      try {
        writeFileSync(temporary, next, { flag: 'wx', mode: 0o600 })
      } catch {
        throw new Error(
          'Could not prepare .env.local; synchronization failed, do not launch the desktop'
        )
      }
      // Check both replacements, including edits made after the old key was invalidated.
      if (readCurrent() !== expected) {
        throw new Error(
          '.env.local changed during synchronization; stopped without overwriting concurrent changes, do not launch the desktop'
        )
      }
      try {
        renameSync(temporary, destination)
      } catch {
        throw new Error(
          'Could not replace .env.local; synchronization failed, do not launch the desktop'
        )
      }
      expected = next
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  // Invalidate the previous key before reading a potentially missing/rebuilt source.
  replace({})
  let client
  try {
    client = parseEnv(readFileSync(source, 'utf8'))
  } catch {
    throw new Error(
      'Could not read local client configuration; previous desktop key was invalidated'
    )
  }
  const values = {
    NCURATOR_LOCAL_API_ORIGIN: client.NCURATOR_API_ORIGIN,
    NCURATOR_LOCAL_WEB_ORIGIN: client.NCURATOR_WEB_ORIGIN,
    NCURATOR_APP_SECRET_DESKTOP: client.NCURATOR_APP_SECRET_DESKTOP
  }
  for (const name of fields.slice(0, 2)) {
    try {
      const url = new URL(values[name])
      if (
        url.origin !== values[name] ||
        url.protocol !== 'http:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port
      )
        throw new Error()
    } catch {
      throw new Error('Invalid local client origins; previous desktop key was invalidated')
    }
  }
  const key = values.NCURATOR_APP_SECRET_DESKTOP
  if (!key || key.length < 16 || /\s|\$\{/.test(key)) {
    throw new Error('Invalid local client application key; previous desktop key was invalidated')
  }
  replace(values)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error('Usage: node scripts/dev/sync-local-service-env.mjs <client.env>')
    syncLocalServiceEnvironment(process.argv[2])
    console.log('Local desktop service configuration synchronized.')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
