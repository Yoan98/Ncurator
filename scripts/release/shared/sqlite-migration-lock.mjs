import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const migrationsDirectory = path.join(
  root,
  'src',
  'main',
  'services',
  'storage',
  'sqlite',
  'migrations'
)
const valueAfter = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const lockPath = path.resolve(
  valueAfter('--lock-file') || path.join(migrationsDirectory, 'released-migrations.json')
)
const migrationFilePattern = /^(\d{3})_[a-z0-9_]+\.ts$/u

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Normalize CRLF so Windows checkout with autocrlf still matches published LF hashes. */
const normalizeMigrationBytes = (bytes) => Buffer.from(bytes.toString('utf8').replace(/\r\n/gu, '\n'))

const readMigration = async (file) => {
  const bytes = normalizeMigrationBytes(await readFile(path.join(migrationsDirectory, file)))
  const source = bytes.toString('utf8')
  const version = Number(file.match(migrationFilePattern)?.[1])
  const declaredVersion = Number(source.match(/\bversion:\s*(\d+)/u)?.[1])
  const name = source.match(/\bname:\s*'([^']+)'/u)?.[1] || ''
  if (!version || declaredVersion !== version || !name) {
    throw new Error(`invalid SQLite migration definition: ${file}`)
  }
  return { version, name, file, sha256: sha256(bytes) }
}

const readCurrentMigrations = async () => {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => migrationFilePattern.test(file))
    .sort()
  const migrations = await Promise.all(files.map(readMigration))
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `SQLite migration files must be contiguous: expected ${index + 1}, found ${migration.version}`
      )
    }
  })
  return migrations
}

const readLock = async () => JSON.parse(await readFile(lockPath, 'utf8'))

const validateLock = async (lock, current) => {
  if (lock.publishedThrough !== lock.migrations.length) {
    throw new Error('SQLite migration lock publishedThrough does not match its entries')
  }
  for (const locked of lock.migrations) {
    const actual = current[locked.version - 1]
    if (!actual || JSON.stringify(actual) !== JSON.stringify(locked)) {
      throw new Error(
        `published SQLite migration ${locked.version} changed; published migrations are immutable`
      )
    }
  }
}

const current = await readCurrentMigrations()
const lock = await readLock()
await validateLock(lock, current)

if (process.argv.includes('--promote-current')) {
  const nextLock = { publishedThrough: current.length, migrations: current }
  await writeFile(lockPath, `${JSON.stringify(nextLock, null, 2)}\n`, 'utf8')
  process.stdout.write(`[release] locked SQLite migrations through version ${current.length}\n`)
} else {
  process.stdout.write(
    `[release] verified SQLite migrations through published version ${lock.publishedThrough}\n`
  )
}
