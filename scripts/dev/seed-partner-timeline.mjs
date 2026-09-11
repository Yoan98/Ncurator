#!/usr/bin/env node
/**
 * 给时间轴专用伙伴灌跨日/月/年聊天假数据，方便本机预览时间轴。
 *
 * 用法：
 *   node scripts/dev/seed-partner-timeline.mjs
 *   node scripts/dev/seed-partner-timeline.mjs --list
 *   node scripts/dev/seed-partner-timeline.mjs --db "/path/to/app.sqlite"
 *   node scripts/dev/seed-partner-timeline.mjs --force   # 已有种子数据时仍清空重灌
 *
 * 默认数据库：~/Library/Application Support/ncurator-dev/app.sqlite（dev）
 * 专用伙伴：固定名「时间轴 · 预览」——有则复用，无则新建；已有完整种子则跳过。
 * 同时写入 ai_run + chat_session_message_log（UI 消息投影依赖 ai_run）。
 * 灌完后请在应用内切换到该伙伴或重启，以重新打开消息列表。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const DAY_MS = 24 * 60 * 60 * 1000
const TIMELINE_SEED_PARTNER_NAME = '时间轴 · 预览'
const TIMELINE_SEED_MARKER = '[timeline-seed]'

const parseArgs = (argv) => {
  const args = { db: null, list: false, force: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--list') args.list = true
    else if (token === '--force') args.force = true
    else if (token === '--db') args.db = String(argv[++index] || '').trim()
  }
  return args
}

const startOfLocalDay = (timestamp) => {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const atDaysAgo = (daysAgo, hour = 10) => {
  const dayStart = startOfLocalDay(Date.now()) - daysAgo * DAY_MS
  return dayStart + hour * 60 * 60 * 1000
}

const defaultDbPath = () =>
  path.join(os.homedir(), 'Library', 'Application Support', 'ncurator-dev', 'app.sqlite')

const userEntry = (text) =>
  JSON.stringify({
    kind: 'user',
    content: text,
    input: text,
    context: { selectedReferences: [], attachments: [] }
  })

const assistantEntry = (content) =>
  JSON.stringify({
    kind: 'assistant',
    content,
    toolCalls: []
  })

const ensureTimelinePartner = (db) => {
  const existing = db
    .prepare('SELECT id, name FROM partner WHERE name = ? LIMIT 1')
    .get(TIMELINE_SEED_PARTNER_NAME)
  if (existing) {
    return { partner: existing, created: false }
  }

  const now = Date.now()
  const partner = {
    id: randomUUID(),
    name: TIMELINE_SEED_PARTNER_NAME,
    avatar_shape: 'circle',
    avatar_color: 'teal',
    created_at: now,
    updated_at: now,
    last_viewed_at: now,
    pinned: 0,
    pinned_at: null
  }
  db.prepare(
    `
    INSERT INTO partner (
      id, name, avatar_shape, avatar_color, created_at, updated_at, last_viewed_at, pinned, pinned_at
    )
    VALUES (
      @id, @name, @avatar_shape, @avatar_color, @created_at, @updated_at, @last_viewed_at, @pinned, @pinned_at
    )
  `
  ).run(partner)
  return { partner: { id: partner.id, name: partner.name }, created: true }
}

const countSeededRuns = (db, partnerId) =>
  Number(
    db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM ai_run
        WHERE partner_id = ?
          AND input LIKE ?
      `
      )
      .get(partnerId, `${TIMELINE_SEED_MARKER}%`)?.count || 0
  )

const countSeededLogPairs = (db, partnerId) =>
  Number(
    db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM chat_session_message_log
        WHERE partner_id = ?
          AND entry_json LIKE ?
      `
      )
      .get(partnerId, `%${TIMELINE_SEED_MARKER}%`)?.count || 0
  )

const hasCompleteSeed = (db, partnerId, expectedGroups) => {
  const runs = countSeededRuns(db, partnerId)
  const logEntries = countSeededLogPairs(db, partnerId)
  return runs >= expectedGroups && logEntries >= expectedGroups * 2
}

const main = () => {
  const args = parseArgs(process.argv.slice(2))
  const dbPath = path.resolve(args.db || process.env.NCURATOR_TIMELINE_SEED_DB || defaultDbPath())
  if (!fs.existsSync(dbPath)) {
    console.error(`数据库不存在: ${dbPath}`)
    process.exit(1)
  }

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  if (args.list) {
    const partners = db.prepare('SELECT id, name FROM partner ORDER BY updated_at DESC').all()
    for (const partner of partners) {
      const marker = partner.name === TIMELINE_SEED_PARTNER_NAME ? '  ← timeline seed' : ''
      console.log(`${partner.name}\t${partner.id}${marker}`)
    }
    db.close()
    return
  }

  const { partner, created } = ensureTimelinePartner(db)

  const now = Date.now()
  const seeds = [
    { at: atDaysAgo(400), text: `${TIMELINE_SEED_MARKER} 两年前左右的一条记录` },
    { at: atDaysAgo(200), text: `${TIMELINE_SEED_MARKER} 去年某月的一条记录` },
    { at: atDaysAgo(120), text: `${TIMELINE_SEED_MARKER} 今年更早月份的对话 A` },
    { at: atDaysAgo(90), text: `${TIMELINE_SEED_MARKER} 今年更早月份的对话 B` },
    { at: atDaysAgo(45), text: `${TIMELINE_SEED_MARKER} 约一个半月前` },
    { at: atDaysAgo(44), text: `${TIMELINE_SEED_MARKER} 约一个半月前次日` },
    { at: atDaysAgo(20), text: `${TIMELINE_SEED_MARKER} 二十天前` },
    { at: atDaysAgo(3), text: `${TIMELINE_SEED_MARKER} 四天前（近一周内）` },
    { at: atDaysAgo(1), text: `${TIMELINE_SEED_MARKER} 昨天的消息` },
    { at: now - 60_000, text: `${TIMELINE_SEED_MARKER} 今天刚刚说的话` }
  ]

  if (!args.force && hasCompleteSeed(db, partner.id, seeds.length)) {
    console.log(
      `伙伴「${partner.name}」(${partner.id}) 已有完整时间轴种子（${seeds.length} 组），跳过（需要重灌请加 --force）。`
    )
    console.log(`数据库: ${dbPath}`)
    console.log('请在应用内切换到该伙伴后再看左侧时间轴。')
    db.close()
    return
  }

  const insertLog = db.prepare(`
    INSERT INTO chat_session_message_log (id, partner_id, run_id, seq, entry_json, created_at)
    VALUES (@id, @partner_id, @run_id, @seq, @entry_json, @created_at)
  `)

  const insertRun = db.prepare(`
    INSERT INTO ai_run (
      id, partner_id, user_message_id, assistant_message_id, status, input,
      selected_references_json, attachments_json, model_name, main_model_json,
      execution_permission, partial_answer, partial_answer_role, final_answer,
      error, failure_code, failure_raw_message, pending_approval_json, artifacts_json,
      created_at, updated_at, finished_at
    ) VALUES (
      @id, @partner_id, @user_message_id, @assistant_message_id, @status, @input,
      @selected_references_json, @attachments_json, @model_name, @main_model_json,
      @execution_permission, @partial_answer, @partial_answer_role, @final_answer,
      @error, @failure_code, @failure_raw_message, @pending_approval_json, @artifacts_json,
      @created_at, @updated_at, @finished_at
    )
  `)

  const seedPartner = db.transaction(() => {
    db.prepare('DELETE FROM chat_session_message_log WHERE partner_id = ?').run(partner.id)
    db.prepare('DELETE FROM ai_run WHERE partner_id = ?').run(partner.id)

    let seq = 1
    for (const seed of seeds) {
      const runId = randomUUID()
      const userMessageId = randomUUID()
      const assistantMessageId = randomUUID()
      const assistantText = `收到：${seed.text}`
      const finishedAt = seed.at + 1000

      insertRun.run({
        id: runId,
        partner_id: partner.id,
        user_message_id: userMessageId,
        assistant_message_id: assistantMessageId,
        status: 'completed',
        input: seed.text,
        selected_references_json: null,
        attachments_json: '[]',
        model_name: 'timeline-seed',
        main_model_json: null,
        execution_permission: 'review',
        partial_answer: assistantText,
        partial_answer_role: 'answer',
        final_answer: assistantText,
        error: null,
        failure_code: null,
        failure_raw_message: null,
        pending_approval_json: null,
        artifacts_json: '[]',
        created_at: seed.at,
        updated_at: finishedAt,
        finished_at: finishedAt
      })

      insertLog.run({
        id: userMessageId,
        partner_id: partner.id,
        run_id: runId,
        seq,
        entry_json: userEntry(seed.text),
        created_at: seed.at
      })
      seq += 1
      insertLog.run({
        id: assistantMessageId,
        partner_id: partner.id,
        run_id: runId,
        seq,
        entry_json: assistantEntry(assistantText),
        created_at: finishedAt
      })
      seq += 1
    }
    db.prepare('UPDATE partner SET updated_at = ?, last_viewed_at = ? WHERE id = ?').run(
      now,
      now,
      partner.id
    )
  })

  seedPartner()
  db.close()

  const action = created ? '新建并写入' : '清空后重灌'
  console.log(
    `已${action}伙伴「${partner.name}」(${partner.id})：${seeds.length} 组跨时间消息（含 ai_run）。`
  )
  console.log(`数据库: ${dbPath}`)
  console.log('请在应用内切换到该伙伴或重启后再看左侧时间轴。')
}

main()
