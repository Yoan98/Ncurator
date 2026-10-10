import { randomUUID } from 'node:crypto'
import type { SubagentUpdate } from '../../../../shared/types'
import type { SqliteCore } from '../sqlite/SqliteCore'
import type { ChatMessageLogStore } from './ChatMessageLogStore'

export type SubagentInfo = Pick<SubagentUpdate, 'agentId' | 'name' | 'task' | 'status'>
export type SubagentAssignment =
  | { name: string; instruction: string; agentId?: never }
  | { agentId: string; instruction: string; name?: never }
type SubagentRow = {
  id: string
  partner_id: string
  name: string
  task: string
  status: SubagentUpdate['status']
}
const info = (row: SubagentRow): SubagentInfo => ({
  agentId: row.id,
  name: row.name,
  task: row.task,
  status: row.status
})
const active = new Set<SubagentUpdate['status']>(['queued', 'running', 'waiting_approval'])

export class AiSubagentStore {
  public constructor(private readonly sqlite: SqliteCore) {}

  public list(partnerId: string): SubagentInfo[] {
    return (
      this.sqlite
        .prepare(
          'SELECT id, partner_id, name, task, status FROM ai_subagent WHERE partner_id = ? ORDER BY created_at, id'
        )
        .all(partnerId) as SubagentRow[]
    ).map(info)
  }

  public enqueue(partnerId: string, assignments: SubagentAssignment[]): SubagentInfo[] {
    return this.sqlite.transaction(() => {
      const now = Date.now()
      return assignments.map((assignment) => {
        if (assignment.agentId) {
          const row = this.sqlite
            .prepare(
              'SELECT id, partner_id, name, task, status FROM ai_subagent WHERE id = ? AND partner_id = ?'
            )
            .get(assignment.agentId, partnerId) as SubagentRow | undefined
          if (!row) throw new Error('子 agent 不存在或不属于当前伙伴')
          if (active.has(row.status)) throw new Error('子 agent 正在执行、排队或等待审批')
          this.sqlite
            .prepare("UPDATE ai_subagent SET status = 'queued', updated_at = ? WHERE id = ?")
            .run(now, row.id)
          return { ...info(row), status: 'queued' as const }
        }
        const agentId = randomUUID()
        this.sqlite
          .prepare(
            'INSERT INTO ai_subagent (id, partner_id, name, task, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          )
          .run(agentId, partnerId, assignment.name, assignment.instruction, 'queued', now, now)
        return {
          agentId,
          name: assignment.name!,
          task: assignment.instruction,
          status: 'queued' as const
        }
      })
    })
  }

  public publish(
    log: ChatMessageLogStore,
    partnerId: string,
    parentRunId: string,
    update: SubagentUpdate
  ): void {
    this.sqlite.transaction(() => {
      log.appendBatchSync({
        partnerId,
        runId: parentRunId,
        entries: [{ kind: 'annotation', eventType: 'subagent_updated', payload: update }]
      })
      if (update.status === 'completed') {
        this.sqlite
          .prepare('DELETE FROM ai_subagent WHERE id = ? AND partner_id = ?')
          .run(update.agentId, partnerId)
      } else {
        this.sqlite
          .prepare(
            'UPDATE ai_subagent SET status = ?, updated_at = ? WHERE id = ? AND partner_id = ?'
          )
          .run(update.status, Date.now(), update.agentId, partnerId)
      }
    })
  }

  public interruptActive(): void {
    this.sqlite
      .prepare(
        "UPDATE ai_subagent SET status = 'interrupted', updated_at = ? WHERE status IN ('queued', 'running', 'waiting_approval')"
      )
      .run(Date.now())
  }

  public deleteByPartner(partnerId: string): void {
    this.sqlite.prepare('DELETE FROM ai_subagent WHERE partner_id = ?').run(partnerId)
  }
}
