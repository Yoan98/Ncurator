import { userSkillsMigration } from '../../../../src/main/services/storage/sqlite/migrations/019_user_skills'
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
  it('creates the current schema directly and upgrades the released v9 schema to the same final structure', async () => {
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
    expect(migrationRows).toContainEqual({ version: 10, name: 'upgrade_from_v9' })
    expect(migrationRows).toContainEqual({ version: 20, name: 'skill_name_bindings' })
    expect(migrationRows.at(-1)).toEqual({ version: 22, name: 'llm_manual_models' })
    expect(partnerTable).toEqual({ name: 'partner' })
    expect(sessionTable).toBeUndefined()
    expect(searchTurnTable).toBeUndefined()
    expect(integrity).toEqual([{ quick_check: 'ok' }])
    expect(foreignKeys).toEqual([])
    expect(schemaSignature(upgradedPath)).toEqual(schemaSignature(freshPath))
  })

  it('converts existing ID bindings to names, drops the asset index and leaves files unchanged', async () => {
    const databasePath = await createDatabasePath()
    const prepared = new SqliteCore(databasePath)
    prepared.initialize()
    prepared.exec(`DROP TABLE partner_user_skill;
      ALTER TABLE llm_config DROP COLUMN manual_models_json;
      DROP TABLE embedding_settings;
      ALTER TABLE document DROP COLUMN embedding_identity;
      ALTER TABLE document DROP COLUMN embedding_dim;
      ALTER TABLE document DROP COLUMN embedding_error;`)
    prepared.exec(userSkillsMigration.sql!)
    prepared.prepare('DELETE FROM schema_migrations WHERE version >= 20').run()
    prepared.exec(`INSERT INTO partner (id,name,avatar_shape,avatar_color,created_at,updated_at,last_viewed_at) VALUES ('a','A','circle','blue',1,1,1),('b','B','circle','blue',1,1,1);
      INSERT INTO user_skill VALUES ('user:old','weekly-report','Reports','weekly-report',1);
      INSERT INTO partner_user_skill VALUES ('a','user:old'),('b','user:old');`)
    const directory = path.join(path.dirname(databasePath), 'skills/weekly-report')
    await fs.mkdir(directory, { recursive: true })
    const content = '---\nname: weekly-report\ndescription: Reports\n---\nKeep bytes'
    await fs.writeFile(path.join(directory, 'SKILL.md'), content)
    prepared.close()
    const upgraded = new SqliteCore(databasePath)
    upgraded.initialize()
    expect(upgraded.prepare('SELECT * FROM partner_user_skill ORDER BY partner_id').all()).toEqual([
      { partner_id: 'a', skill_name: 'weekly-report' },
      { partner_id: 'b', skill_name: 'weekly-report' }
    ])
    expect(
      upgraded.prepare("SELECT name FROM sqlite_master WHERE name = 'user_skill'").get()
    ).toBeUndefined()
    expect(await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8')).toBe(content)
    upgraded.close()
  })

  it('upgrades the current v20 schema without invalidating existing local document metadata', async () => {
    const databasePath = await createDatabasePath()
    const previous = new SqliteCore(databasePath)
    previous.initialize()
    previous.exec(`ALTER TABLE llm_config DROP COLUMN manual_models_json;
      DROP TABLE embedding_settings;
      ALTER TABLE document DROP COLUMN embedding_identity;
      ALTER TABLE document DROP COLUMN embedding_dim;
      ALTER TABLE document DROP COLUMN embedding_error;
      DELETE FROM schema_migrations WHERE version >= 21;
      INSERT INTO document (id, name, source_type, import_status, content_hash, active_generation_id, created_at, updated_at)
      VALUES ('local-document', 'notes.txt', 'file', 2, 'unchanged-hash', 'unchanged-generation', 1, 1);`)
    previous.close()
    const upgraded = new SqliteCore(databasePath)
    try {
      upgraded.initialize()
      expect(
        upgraded
          .prepare(
            `SELECT import_status, content_hash, active_generation_id,
        embedding_identity, embedding_dim, embedding_error FROM document WHERE id = 'local-document'`
          )
          .get()
      ).toEqual({
        import_status: 2,
        content_hash: 'unchanged-hash',
        active_generation_id: 'unchanged-generation',
        embedding_identity: 'local:jinaai/jina-embeddings-v2-base-zh',
        embedding_dim: 768,
        embedding_error: null
      })
      expect(upgraded.prepare('SELECT * FROM embedding_settings').all()).toEqual([])
    } finally {
      upgraded.close()
    }
  })

  it('upgrades v21 and collects existing manual selections into their own service config', async () => {
    const databasePath = await createDatabasePath()
    const previous = new SqliteCore(databasePath)
    previous.initialize()
    previous.exec(`ALTER TABLE llm_config DROP COLUMN manual_models_json;
      DELETE FROM schema_migrations WHERE version = 22;
      INSERT INTO llm_config (id, name, providerKind, base_url, api_key)
      VALUES ('manual-service', 'test', 'openai-compatible', 'http://localhost/v1', 'key'),
        ('other-service', 'other', 'openai-compatible', 'http://localhost/v1', 'key');
      INSERT INTO partner (id, name, avatar_shape, avatar_color, created_at, updated_at, last_viewed_at)
      VALUES ('one', 'One', 'circle', 'blue', 1, 1, 1), ('two', 'Two', 'circle', 'blue', 1, 1, 1);`)
    const state = JSON.stringify({
      composer: {
        modelSelection: {
          mainModel: {
            configId: 'manual-service',
            modelName: 'Manual.Model',
            manual: true
          }
        }
      }
    })
    const insert = previous.prepare(
      'INSERT INTO partner_ui_state (partner_id, state_json, updated_at) VALUES (?, ?, 1)'
    )
    insert.run('one', state)
    insert.run('two', state)
    previous.close()
    const upgraded = new SqliteCore(databasePath)
    try {
      upgraded.initialize()
      expect(
        upgraded.prepare('SELECT id, manual_models_json FROM llm_config ORDER BY id').all()
      ).toEqual([
        { id: 'manual-service', manual_models_json: '["Manual.Model"]' },
        { id: 'other-service', manual_models_json: '[]' }
      ])
    } finally {
      upgraded.close()
    }
  })

  it('records a pending v10 afterCommit hook and runs it only once', async () => {
    const databasePath = await createDatabasePath()
    const sqlite = new SqliteCore(databasePath)
    sqlite.initialize()
    const pending = sqlite.prepare('SELECT version, name, status FROM schema_migration_hooks').all()
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
    const futureVersion = CURRENT_SCHEMA_VERSION + 1
    current
      .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(futureVersion, 'future_schema', 1)
    current.close()

    const sqlite = new SqliteCore(databasePath)
    let thrown: unknown
    try {
      sqlite.initialize()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(DatabaseVersionTooNewError)
    expect(thrown).toMatchObject({
      databaseVersion: futureVersion,
      supportedDatabaseVersion: CURRENT_SCHEMA_VERSION
    })

    const inspected = openRawDatabase(databasePath)
    const rows = inspected
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all()
    inspected.close()
    expect(rows.at(-1)).toEqual({ version: futureVersion, name: 'future_schema' })
    expect(rows).toHaveLength(futureVersion)
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

  it('drops leftover terminal file-change rows on upgrade to v11', async () => {
    const databasePath = await createDatabasePath()
    const prepared = new SqliteCore(databasePath)
    prepared.initialize()
    prepared.prepare('DELETE FROM schema_migrations WHERE version >= 11').run()
    prepared.exec(`DROP INDEX idx_chat_session_message_log_subagent_seq;
      DROP INDEX idx_chat_session_message_log_partner_seq;
      ALTER TABLE chat_session_message_log DROP COLUMN subagent_id;
      DROP TABLE ai_subagent;
      CREATE UNIQUE INDEX idx_chat_session_message_log_partner_seq ON chat_session_message_log(partner_id, seq);`)
    prepared.exec('DROP TABLE IF EXISTS app_settings')
    prepared.exec('DROP TABLE open_with_preferences')
    prepared.exec('DROP TABLE partner_user_skill;')
    prepared.exec(`ALTER TABLE llm_config DROP COLUMN manual_models_json;
      DROP TABLE embedding_settings;
      ALTER TABLE document DROP COLUMN embedding_identity;
      ALTER TABLE document DROP COLUMN embedding_dim;
      ALTER TABLE document DROP COLUMN embedding_error;`)
    prepared.exec('ALTER TABLE ai_run DROP COLUMN pending_messages_json')
    prepared
      .prepare(
        `INSERT INTO partner (
          id, name, avatar_shape, avatar_color, pinned, created_at, updated_at, last_viewed_at
        ) VALUES (?, ?, ?, ?, 0, 1, 1, 1)`
      )
      .run('partner-1', 'partner', 'circle', 'blue')
    const insertChange = prepared.prepare(
      `INSERT INTO ai_file_change (
        id, partner_id, run_id, status, capability, path, file_name, operation, source,
        change_count, insert_count, delete_count, created_at, updated_at
      ) VALUES (?, 'partner-1', 'run-1', 'applied', ?, '/tmp/a.txt', ?, 'updated', ?, 1, 0, 0, 1, 1)`
    )
    insertChange.run('keep-text', 'text_file', 'keep.txt', 'text_tool')
    insertChange.run('drop-terminal-source', 'text_file', 'tracked.txt', 'terminal_tool')
    insertChange.run('drop-scan-source', 'text_file', 'scanned.txt', 'workspace_scan')
    insertChange.run('drop-terminal-capability', 'terminal_exec', 'exec.bin', 'text_tool')
    prepared.close()

    const upgraded = new SqliteCore(databasePath)
    upgraded.initialize()
    const rows = upgraded
      .prepare('SELECT id, source, capability FROM ai_file_change ORDER BY id')
      .all()
    upgraded.close()

    expect(rows).toEqual([{ id: 'keep-text', source: 'text_tool', capability: 'text_file' }])
  })

  it('keeps the published migration lock valid and rejects a changed locked migration', async () => {
    const script = path.resolve('scripts/release/shared/sqlite-migration-lock.mjs')
    const lockPath = path.resolve(
      'src/main/services/storage/sqlite/migrations/released-migrations.json'
    )
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as {
      publishedThrough: number
      migrations: Array<{ sha256: string }>
    }
    const { stdout } = await execFileAsync(process.execPath, [script], { cwd: process.cwd() })
    expect(stdout).toContain(
      `verified SQLite migrations through published version ${lock.publishedThrough}`
    )

    const tamperedLockPath = await createDatabasePath()
    lock.migrations[0].sha256 = '0'.repeat(64)
    await fs.writeFile(tamperedLockPath, `${JSON.stringify(lock)}\n`, 'utf8')

    await expect(
      execFileAsync(process.execPath, [script, '--lock-file', tamperedLockPath], {
        cwd: process.cwd()
      })
    ).rejects.toThrow('published SQLite migration 1 changed')
  })
})
