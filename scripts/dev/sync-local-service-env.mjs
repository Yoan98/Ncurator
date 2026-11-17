import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const localKeyName = 'NCURATOR_LOCAL_APP_SECRET_DESKTOP'
const originFields = {
  NCURATOR_LOCAL_API_ORIGIN: 'NCURATOR_API_ORIGIN',
  NCURATOR_LOCAL_WEB_ORIGIN: 'NCURATOR_WEB_ORIGIN'
}

// Match whole assignments so a line inside an unrelated quoted value is left intact.
const assignment =
  /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\r\n]*)[^\r\n]*/gm

function updateEnvironment(current, values) {
  const updates = new Map(
    Object.entries(values).map(([name, value]) => {
      for (const serialized of [value, `'${value}'`, `"${value}"`, `\`${value}\``]) {
        const line = `${name}=${serialized}`
        // Check the assignment as it will appear in the file, followed by a line break.
        if (parseEnv(line + '\n')[name] === value) return [name, line]
      }
      throw new Error(`Could not write ${name} to .env; previous desktop key was invalidated`)
    })
  )
  const missing = new Set(updates.keys())
  const next = current.replace(assignment, (line, name) => {
    if (!updates.has(name)) return line
    missing.delete(name)
    return updates.get(name)
  })
  if (missing.size === 0) return next

  const newline = current.includes('\r\n') ? '\r\n' : '\n'
  const prefix = next && !next.endsWith('\n') ? next + newline : next
  return prefix + Array.from(missing, (name) => updates.get(name)).join(newline) + newline
}

export function syncLocalServiceEnvironment(source, root = process.cwd()) {
  const destination = path.join(root, '.env')
  function readCurrent() {
    try {
      return readFileSync(destination, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw new Error('Could not read .env for synchronization')
    }
  }
  let expected = readCurrent()
  function replace(values) {
    const next = updateEnvironment(expected ?? '', values)
    const temporary = destination + '.' + randomUUID()
    try {
      try {
        writeFileSync(temporary, next, { flag: 'wx', mode: 0o600 })
      } catch {
        throw new Error('Could not prepare .env; synchronization failed, do not launch the desktop')
      }
      // Check both replacements, including edits made after the old key was invalidated.
      if (readCurrent() !== expected) {
        throw new Error(
          '.env changed during synchronization; stopped without overwriting concurrent changes, do not launch the desktop'
        )
      }
      try {
        renameSync(temporary, destination)
      } catch {
        throw new Error('Could not replace .env; synchronization failed, do not launch the desktop')
      }
      expected = next
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  // Invalidate the previous key before reading a potentially missing/rebuilt source.
  replace({ [localKeyName]: '' })
  let client
  try {
    client = parseEnv(readFileSync(source, 'utf8') + '\n')
  } catch {
    throw new Error(
      'Could not read local client configuration; previous desktop key was invalidated'
    )
  }
  const values = {}
  for (const [name, field] of Object.entries(originFields)) {
    const value = client[field]
    try {
      const url = new URL(value)
      if (
        url.origin !== value ||
        url.protocol !== 'http:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port
      )
        throw new Error()
    } catch {
      throw new Error('Invalid local client origins; previous desktop key was invalidated')
    }
    values[name] = value
  }
  const key = client.NCURATOR_APP_SECRET_DESKTOP
  if (!key || key.length < 16 || /\s|\$\{/.test(key)) {
    throw new Error('Invalid local client application key; previous desktop key was invalidated')
  }
  replace({ ...values, [localKeyName]: key })
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
