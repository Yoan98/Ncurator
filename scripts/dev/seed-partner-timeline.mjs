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
 * 专用伙伴：固定名「时间轴 · 预览」——有则复用，无则新建；已有种子则跳过，避免重复堆积。
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

const userEntry = (content) =>
  JSON.stringify({
    kind: 'user',
    content,
    origin: 'human',
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

const hasSeedMessages = (db, partnerId) => {
  const row = db
    .prepare(
      `
      SELECT 1 AS ok
      FROM chat_session_message_log
      WHERE partner_id = ?
        AND entry_json LIKE ?
      LIMIT 1
    `
    )
    .get(partnerId, `%${TIMELINE_SEED_MARKER}%`)
  return Boolean(row)
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

  if (!args.force && hasSeedMessages(db, partner.id)) {
    console.log(
      `伙伴「${partner.name}」(${partner.id}) 已有时间轴种子数据，跳过（需要重灌请加 --force）。`
    )
    console.log(`数据库: ${dbPath}`)
    console.log('请在应用内切换到该伙伴后再看左侧时间轴。')
    db.close()
    return
  }

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

  const insert = db.prepare(`
    INSERT INTO chat_session_message_log (id, partner_id, run_id, seq, entry_json, created_at)
    VALUES (@id, @partner_id, @run_id, @seq, @entry_json, @created_at)
  `)

  const seedPartner = db.transaction(() => {
    db.prepare('DELETE FROM chat_session_message_log WHERE partner_id = ?').run(partner.id)

    let seq = 1
    for (const seed of seeds) {
      const runId = randomUUID()
      insert.run({
        id: randomUUID(),
        partner_id: partner.id,
        run_id: runId,
        seq,
        entry_json: userEntry(seed.text),
        created_at: seed.at
      })
      seq += 1
      insert.run({
        id: randomUUID(),
        partner_id: partner.id,
        run_id: runId,
        seq,
        entry_json: assistantEntry(`收到：${seed.text}`),
        created_at: seed.at + 1000
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

  const action = created ? '新建并写入' : args.force ? '清空后重灌' : '写入'
  console.log(
    `已${action}伙伴「${partner.name}」(${partner.id})：${seeds.length} 组跨时间消息。`
  )
  console.log(`数据库: ${dbPath}`)
  console.log('请在应用内切换到该伙伴或重启后再看左侧时间轴。')
}

main()
