import type {
  AssistantProcessDisplay,
  ChatMessageLogEntry,
  IpcJsonObject
} from '../../../../shared/types'
import { isRuntimeSkillId } from '../../../../shared/runtimeCapabilities'
import { normalizeThoughtText } from '../../../../shared/thoughtText'
import { createDisplayProcessGroup, createDisplayProcessItem } from './utils'
import type {
  AssistantProcessGroup,
  AssistantProcessStatus,
  AssistantProcessThought
} from './types'

const CONTROL_TOOL_NAMES = new Set(['learn_skill', 'update_plan'])

export const projectProcessGroups = (input: {
  runId: string
  entries: ChatMessageLogEntry[]
}): { processGroups: AssistantProcessGroup[]; processThoughts: AssistantProcessThought[] } => {
  const groupById = new Map<string, AssistantProcessGroup>()
  const orderedGroupIds: string[] = []
  const thoughts: AssistantProcessThought[] = []
  const toolArgsById = new Map<string, IpcJsonObject>()
  let thinkingOpen = false
  let monotonic = 0

  const stamp = (): number => monotonic++

  const upsertGroup = (group: AssistantProcessGroup): void => {
    if (!groupById.has(group.id)) orderedGroupIds.push(group.id)
    groupById.set(group.id, group)
  }

  const completeGroup = (groupId: string, status: AssistantProcessStatus): void => {
    const existing = groupById.get(groupId)
    if (!existing) return
    groupById.set(groupId, {
      ...existing,
      status,
      items: existing.items.map((item) => ({ ...item, status }))
    })
  }

  for (const entry of input.entries) {
    if (entry.kind === 'annotation') {
      if (entry.eventType === 'thinking_started') {
        thinkingOpen = true
      } else if (entry.eventType === 'thinking_completed') {
        thinkingOpen = false
      } else if (entry.eventType === 'learning_started') {
        const skillId = entry.payload.skillId
        if (!isRuntimeSkillId(skillId)) continue
        upsertGroup(
          createDisplayProcessGroup({
            groupId: `${input.runId}:learning:${skillId}`,
            kind: 'learning',
            display: { kind: 'learning', skillId },
            status: 'running',
            createdAt: stamp(),
            sourceEventType: 'assistant_process_group_started'
          })
        )
      } else if (entry.eventType === 'learning_completed') {
        const skillId = entry.payload.skillId
        if (!isRuntimeSkillId(skillId)) continue
        completeGroup(`${input.runId}:learning:${skillId}`, 'completed')
      } else if (entry.eventType === 'compaction_checkpoint') {
        upsertGroup(
          createDisplayProcessGroup({
            groupId: `${input.runId}:compaction:${stamp()}`,
            kind: 'compaction',
            display: { kind: 'compaction' },
            status: 'completed',
            createdAt: stamp(),
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
        const thoughtCreatedAt = stamp()
        thoughts.push({
          id: `${input.runId}:thought:${thoughtCreatedAt}`,
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
      if (CONTROL_TOOL_NAMES.has(entry.toolName)) continue
      const display: AssistantProcessDisplay = {
        kind: 'tool',
        toolName: entry.toolName,
        input: toolArgsById.get(entry.toolCallId) || {}
      }
      const status: AssistantProcessStatus = entry.ok ? 'completed' : 'failed'
      const item = createDisplayProcessItem({
        itemId: entry.toolCallId,
        display,
        status,
        createdAt: stamp(),
        sourceEventType: 'assistant_process_item_started'
      })
      const group = createDisplayProcessGroup({
        groupId: `${input.runId}:tool:${entry.toolCallId}`,
        kind: 'skill',
        display,
        status,
        createdAt: item.createdAt,
        sourceEventType: 'assistant_process_group_started'
      })
      upsertGroup({ ...group, items: [item] })
    }
  }

  const processGroups = orderedGroupIds
    .map((id) => groupById.get(id))
    .filter((group): group is AssistantProcessGroup => Boolean(group))
    .sort((left, right) => left.createdAt - right.createdAt)

  const processThoughts = thoughts.sort((left, right) => left.createdAt - right.createdAt)

  return { processGroups, processThoughts }
}
