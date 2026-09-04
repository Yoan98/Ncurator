import type {
  AssistantProcessDisplay,
  ChatMessageLogEntry,
  ChatMessageLogRecord,
  IpcJsonObject
} from '../../../../shared/types'
import { normalizeThoughtText } from '../../../../shared/thoughtText'
import { createDisplayProcessGroup, createDisplayProcessItem, shouldShowAssistantThinkingWait } from './utils'
import type {
  AssistantProcessGroup,
  AssistantProcessStatus,
  AssistantProcessThought
} from './types'

const HIDDEN_PROCESS_TOOL_NAMES = new Set(['update_plan'])

export const projectProcessGroups = (input: {
  runId: string
  records: readonly Pick<ChatMessageLogRecord, 'entry' | 'seq' | 'createdAt'>[]
}): { processGroups: AssistantProcessGroup[]; processThoughts: AssistantProcessThought[] } => {
  const groupById = new Map<string, AssistantProcessGroup>()
  const orderedGroupIds: string[] = []
  const thoughts: AssistantProcessThought[] = []
  const toolArgsById = new Map<string, IpcJsonObject>()
  let thinkingOpen = false
  let fallbackOrder = 0

  const resolveCreatedAt = (record: Pick<ChatMessageLogRecord, 'seq' | 'createdAt'>): number => {
    if (Number.isFinite(record.createdAt) && record.createdAt > 0) return record.createdAt
    // Stable fallback that preserves log order when createdAt is missing.
    return record.seq > 0 ? record.seq : ++fallbackOrder
  }

  const upsertGroup = (group: AssistantProcessGroup): void => {
    if (!groupById.has(group.id)) orderedGroupIds.push(group.id)
    groupById.set(group.id, group)
  }

  for (const record of input.records) {
    const entry: ChatMessageLogEntry = record.entry
    if (entry.kind === 'annotation') {
      if (entry.eventType === 'thinking_started') {
        thinkingOpen = true
      } else if (entry.eventType === 'thinking_completed') {
        thinkingOpen = false
      } else if (entry.eventType === 'compaction_checkpoint') {
        const createdAt = resolveCreatedAt(record)
        upsertGroup(
          createDisplayProcessGroup({
            groupId: `${input.runId}:compaction:${record.seq}`,
            kind: 'compaction',
            display: { kind: 'compaction' },
            status: 'completed',
            createdAt,
            sourceEventType: 'assistant_process_group_started'
          })
        )
      }
      continue
    }

    if (entry.kind === 'assistant') {
      if (!thinkingOpen) continue
      const text = normalizeThoughtText(entry.content)
      if (text) {
        const thoughtCreatedAt = resolveCreatedAt(record)
        thoughts.push({
          id: `${input.runId}:thought:seq:${record.seq}`,
          text,
          createdAt: thoughtCreatedAt,
          sourceEventType: 'assistant_process_thought'
        })
      }
      for (const call of entry.toolCalls) {
        toolArgsById.set(call.id, call.args)
      }
      continue
    }

    if (entry.kind === 'tool') {
      if (HIDDEN_PROCESS_TOOL_NAMES.has(entry.toolName)) continue
      const display: AssistantProcessDisplay = {
        kind: 'tool',
        toolName: entry.toolName,
        input: toolArgsById.get(entry.toolCallId) || {}
      }
      const status: AssistantProcessStatus = entry.ok ? 'completed' : 'failed'
      const createdAt = resolveCreatedAt(record)
      const item = createDisplayProcessItem({
        itemId: entry.toolCallId,
        display,
        status,
        createdAt,
        sourceEventType: 'assistant_process_item_started'
      })
      const group = createDisplayProcessGroup({
        groupId: `${input.runId}:tool:${entry.toolCallId}`,
        kind: 'skill',
        display,
        status,
        createdAt,
        sourceEventType: 'assistant_process_group_started'
      })
      upsertGroup({ ...group, items: [item] })
    }
  }

  const projectedGroups = orderedGroupIds
    .map((id) => groupById.get(id))
    .filter((group): group is AssistantProcessGroup => Boolean(group))
  const processThoughts = thoughts.sort((left, right) => left.createdAt - right.createdAt)

  // Annotation window still open: restore UI wait only when the segment rule allows it.
  if (
    thinkingOpen &&
    shouldShowAssistantThinkingWait({
      processGroups: projectedGroups,
      processThoughts
    })
  ) {
    const createdAt =
      processThoughts.at(-1)?.createdAt ?? projectedGroups.at(-1)?.createdAt ?? Date.now()
    upsertGroup(
      createDisplayProcessGroup({
        groupId: `${input.runId}:thinking`,
        kind: 'thinking',
        display: { kind: 'thinking' },
        status: 'running',
        createdAt: createdAt + 1,
        sourceEventType: 'thinking'
      })
    )
  }

  const processGroups = orderedGroupIds
    .map((id) => groupById.get(id))
    .filter((group): group is AssistantProcessGroup => Boolean(group))
    .sort((left, right) => left.createdAt - right.createdAt)

  return { processGroups, processThoughts }
}
