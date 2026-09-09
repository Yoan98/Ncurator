import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  DatabaseVersionTooNewError,
  InvalidMigrationHistoryError,
  SqliteCore
} from '../../../../src/main/services/storage/sqlite/SqliteCore'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []
const releasedV9FixturePath = path.resolve('tests/fixtures/sqlite/released-v9.sql')

const createDatabasePath = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-sqlite-migration-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'app.sqlite')
}

const openRawDatabase = (databasePath: string): Database.Database => {
  const nativeBinding = String(process.env.NCURATOR_BETTER_SQLITE3_NATIVE_BINDING || '').trim()
  return new Database(databasePath, nativeBinding ? { nativeBinding } : undefined)
}

const createReleasedV9Database = async (databasePath: string): Promise<void> => {
  const db = openRawDatabase(databasePath)
  try {
    db.exec(await fs.readFile(releasedV9FixturePath, 'utf8'))
  } finally {
    db.close()
  }
}

const schemaSignature = (databasePath: string): unknown => {
  const db = openRawDatabase(databasePath)
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name"
    )
    .all() as Array<{ name: string }>
  const columns = Object.fromEntries(
    tables.map(({ name }) => [
      name,
      db
        .prepare(`PRAGMA table_info(${name})`)
        .all()
        .map((row) => {
          const column = row as {
            name: string
            type: string
            notnull: number
            dflt_value: string | null
            pk: number
          }
          return {
            name: column.name,
            type: column.type,
            notnull: column.notnull,
            defaultValue: column.dflt_value,
            primaryKey: column.pk
          }
        })
    ])
  )
  const indexes = db
    .prepare(
      "SELECT name, tbl_name AS tableName, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((row) => {
      const index = row as { name: string; tableName: string; sql: string }
      return { ...index, sql: index.sql.replace(/\s+/gu, ' ').trim() }
    })
  db.close()
  return { tables: tables.map(({ name }) => name), columns, indexes }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('SQLite migration contract', () => {
  it('creates v10 directly and upgrades the released v9 schema to the same final structure', async () => {
    const freshPath = await createDatabasePath()
    const upgradedPath = await createDatabasePath()
    const fresh = new SqliteCore(freshPath)
    fresh.initialize()
    fresh.close()

    await createReleasedV9Database(upgradedPath)

    const upgraded = new SqliteCore(upgradedPath)
    upgraded.initialize()
    const migrationRows = upgraded
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all()
    const partnerTable = upgraded
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partner'")
      .get()
    const sessionTable = upgraded
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_session'")
      .get()
    const searchTurnTable = upgraded
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_search_turn'")
      .get()
    const integrity = upgraded.getConnection().pragma('quick_check')
    const foreignKeys = upgraded.getConnection().pragma('foreign_key_check')
    upgraded.close()

    expect(migrationRows).toHaveLength(CURRENT_SCHEMA_VERSION)
    expect(migrationRows.at(-1)).toEqual({ version: 10, name: 'upgrade_from_v9' })
    expect(partnerTable).toEqual({ name: 'partner' })
    expect(sessionTable).toBeUndefined()
    expect(searchTurnTable).toBeUndefined()
    expect(integrity).toEqual([{ quick_check: 'ok' }])
    expect(foreignKeys).toEqual([])
    expect(schemaSignature(upgradedPath)).toEqual(schemaSignature(freshPath))
  })

  it('records a pending v10 afterCommit hook and runs it only once', async () => {
    const databasePath = await createDatabasePath()
    const sqlite = new SqliteCore(databasePath)
    sqlite.initialize()
    const pending = sqlite
      .prepare('SELECT version, name, status FROM schema_migration_hooks')
      .all()
    expect(pending).toEqual([{ version: 10, name: 'upgrade_from_v9', status: 'pending' }])

    const lanceDbPath = path.join(path.dirname(databasePath), 'lancedb')
    const leftoverPath = path.join(lanceDbPath, 'stale-vector-data')
    await fs.mkdir(lanceDbPath, { recursive: true })
    await fs.writeFile(leftoverPath, 'old-chunks')

    await sqlite.runPendingAfterCommitHooks({ lanceDbPath })
    await expect(fs.access(leftoverPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(
      sqlite.prepare('SELECT status FROM schema_migration_hooks WHERE version = 10').get()
    ).toEqual({ status: 'done' })

    await fs.mkdir(lanceDbPath, { recursive: true })
    await fs.writeFile(leftoverPath, 'new-index')
    await sqlite.runPendingAfterCommitHooks({ lanceDbPath })
    await expect(fs.access(leftoverPath)).resolves.toBeUndefined()
    sqlite.close()
  })

  it('makes repeated initialization a no-op after the database reaches current schema', async () => {
    const databasePath = await createDatabasePath()
    const sqlite = new SqliteCore(databasePath)
    sqlite.initialize()
    const before = sqlite
      .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
      .all()
    sqlite.initialize()
    const after = sqlite
      .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
      .all()
    sqlite.close()

    expect(after).toEqual(before)
  })

  it('rolls back the complete pending batch when the v9 schema is invalid', async () => {
    const databasePath = await createDatabasePath()
    await createReleasedV9Database(databasePath)
    const damaged = openRawDatabase(databasePath)
    damaged.exec('DROP TABLE chat_conversation_memory;')
    damaged.close()

    const sqlite = new SqliteCore(databasePath)
    expect(() => sqlite.initialize()).toThrow()

    const inspected = openRawDatabase(databasePath)
    const version = inspected.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
    const scheduledTask = inspected
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scheduled_task'")
      .get()
    const messageLog = inspected
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_session_message_log'"
      )
      .get()
    inspected.close()

    expect(version).toEqual({ version: 9 })
    expect(scheduledTask).toBeUndefined()
    expect(messageLog).toBeUndefined()
  })

  it('rolls back every earlier migration when a later migration fails on an empty database', async () => {
    const databasePath = await createDatabasePath()
    const conflicting = openRawDatabase(databasePath)
    conflicting.exec('CREATE TABLE scheduled_task (fixture_marker TEXT NOT NULL);')
    conflicting.close()

    expect(() => new SqliteCore(databasePath).initialize()).toThrow(
      'table scheduled_task already exists'
    )

    const inspected = openRawDatabase(databasePath)
    const generatedTables = inspected
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migrations', 'partner', 'chat_session_message_log') ORDER BY name"
      )
      .all()
    const fixtureColumns = inspected.prepare('PRAGMA table_info(scheduled_task)').all()
    inspected.close()

    expect(generatedTables).toEqual([])
    expect(fixtureColumns).toMatchObject([{ name: 'fixture_marker' }])
  })

  it('rejects a newer database before writing to it', async () => {
    const databasePath = await createDatabasePath()
    const current = new SqliteCore(databasePath)
    current.initialize()
    current
      .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(11, 'future_schema', 1)
    current.close()

    const sqlite = new SqliteCore(databasePath)
    let thrown: unknown
    try {
      sqlite.initialize()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(DatabaseVersionTooNewError)
    expect(thrown).toMatchObject({ databaseVersion: 11, supportedDatabaseVersion: 10 })

    const inspected = openRawDatabase(databasePath)
    const rows = inspected
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all()
    inspected.close()
    expect(rows.at(-1)).toEqual({ version: 11, name: 'future_schema' })
    expect(rows).toHaveLength(11)
  })

  it('accepts the known version 2 alias and rejects unknown names or gaps', async () => {
    const aliasPath = await createDatabasePath()
    const alias = new SqliteCore(aliasPath)
    alias.initialize()
    alias
      .prepare("UPDATE schema_migrations SET name = 'workspace_change_sets' WHERE version = 2")
      .run()
    alias.close()
    expect(() => {
      const reopened = new SqliteCore(aliasPath)
      reopened.initialize()
      reopened.close()
    }).not.toThrow()

    const nameMismatchPath = await createDatabasePath()
    const nameMismatch = new SqliteCore(nameMismatchPath)
    nameMismatch.initialize()
    nameMismatch
      .prepare("UPDATE schema_migrations SET name = 'unexpected_name' WHERE version = 4")
      .run()
    nameMismatch.close()
    expect(() => new SqliteCore(nameMismatchPath).initialize()).toThrow(
      InvalidMigrationHistoryError
    )

    const gapPath = await createDatabasePath()
    const gap = new SqliteCore(gapPath)
    gap.initialize()
    gap.prepare('DELETE FROM schema_migrations WHERE version = 5').run()
    gap.close()
    expect(() => new SqliteCore(gapPath).initialize()).toThrow(InvalidMigrationHistoryError)
  })

  it('keeps the published migration lock valid and rejects a changed locked migration', async () => {
    const script = path.resolve('scripts/release/shared/sqlite-migration-lock.mjs')
    const { stdout } = await execFileAsync(process.execPath, [script], { cwd: process.cwd() })
    expect(stdout).toContain('verified SQLite migrations through published version 9')

    const tamperedLockPath = await createDatabasePath()
    const lock = JSON.parse(
      await fs.readFile(
        path.resolve('src/main/services/storage/sqlite/migrations/released-migrations.json'),
        'utf8'
      )
    ) as { migrations: Array<{ sha256: string }> }
    lock.migrations[0].sha256 = '0'.repeat(64)
    await fs.writeFile(tamperedLockPath, `${JSON.stringify(lock)}\n`, 'utf8')

    await expect(
      execFileAsync(process.execPath, [script, '--lock-file', tamperedLockPath], {
        cwd: process.cwd()
      })
    ).rejects.toThrow('published SQLite migration 1 changed')
  })
})
