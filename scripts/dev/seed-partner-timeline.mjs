#!/usr/bin/env node
/**
 * 给当前伙伴灌跨日/月/年聊天假数据，方便本机预览时间轴。
 *
 * 用法：
 *   node scripts/dev/seed-partner-timeline.mjs
 *   node scripts/dev/seed-partner-timeline.mjs --partner "伙伴名"
 *   node scripts/dev/seed-partner-timeline.mjs --db "/path/to/app.sqlite"
 *
 * 默认数据库：~/Library/Application Support/ncurator-dev/app.sqlite（dev）
 * 灌完后请在应用内切换一次伙伴或重启，以重新打开消息列表。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const DAY_MS = 24 * 60 * 60 * 1000

const parseArgs = (argv) => {
  const args = { partner: null, db: null, list: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--list') args.list = true
    else if (token === '--partner') args.partner = String(argv[++index] || '').trim()
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

const main = () => {
  const args = parseArgs(process.argv.slice(2))
  const dbPath = path.resolve(args.db || process.env.NCURATOR_TIMELINE_SEED_DB || defaultDbPath())
  if (!fs.existsSync(dbPath)) {
    console.error(`数据库不存在: ${dbPath}`)
    process.exit(1)
  }

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  const partners = db.prepare('SELECT id, name FROM partner ORDER BY updated_at DESC').all()
  if (partners.length === 0) {
    console.error('没有伙伴可灌数，请先在应用里创建一个伙伴。')
    process.exit(1)
  }

  if (args.list) {
    for (const partner of partners) {
      console.log(`${partner.name}\t${partner.id}`)
    }
    db.close()
    return
  }

  const partner =
    (args.partner
      ? partners.find((item) => item.name === args.partner || item.id === args.partner)
      : partners[0]) || null
  if (!partner) {
    console.error(`找不到伙伴: ${args.partner}`)
    process.exit(1)
  }

  const now = Date.now()
  const seeds = [
    { at: atDaysAgo(400), text: '两年前左右的一条记录' },
    { at: atDaysAgo(200), text: '去年某月的一条记录' },
    { at: atDaysAgo(120), text: '今年更早月份的对话 A' },
    { at: atDaysAgo(90), text: '今年更早月份的对话 B' },
    { at: atDaysAgo(45), text: '约一个半月前' },
    { at: atDaysAgo(44), text: '约一个半月前次日' },
    { at: atDaysAgo(20), text: '二十天前' },
    { at: atDaysAgo(3), text: '四天前（近一周内）' },
    { at: atDaysAgo(1), text: '昨天的消息' },
    { at: now - 60_000, text: '今天刚刚说的话' }
  ]

  const nextSeq =
    Number(
      db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM chat_session_message_log WHERE partner_id = ?').get(
        partner.id
      )?.seq || 0
    ) + 1

  const insert = db.prepare(`
    INSERT INTO chat_session_message_log (id, partner_id, run_id, seq, entry_json, created_at)
    VALUES (@id, @partner_id, @run_id, @seq, @entry_json, @created_at)
  `)

  const insertMany = db.transaction(() => {
    let seq = nextSeq
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

  insertMany()
  db.close()

  console.log(`已向伙伴「${partner.name}」(${partner.id}) 写入 ${seeds.length} 组跨时间消息。`)
  console.log(`数据库: ${dbPath}`)
  console.log('请在应用内切换一次伙伴或重启后再看左侧时间轴。')
}

main()
