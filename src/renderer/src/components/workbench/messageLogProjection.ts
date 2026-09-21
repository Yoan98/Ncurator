import type {
  AssistantProcessDisplay,
  ChatMessageLogEntry,
  ChatMessageLogRecord,
  IpcJsonObject
} from '../../../../shared/types'
import { normalizeThoughtText } from '../../../../shared/thoughtText'
import { isBrainThinkingOpenInLog } from '../../../../shared/assistantThinkingWait'
import { createDisplayProcessGroup, createDisplayProcessItem } from './utils'
import type {
  AssistantProcessGroup,
  AssistantProcessStatus,
  AssistantProcessThought
} from './types'

const HIDDEN_PROCESS_TOOL_NAMES = new Set(['update_plan'])

export { projectApprovalReviews } from '../../../../shared/workbench/approvalReview'

export const projectProcessGroups = (input: {
  runId: string
  records: readonly Pick<ChatMessageLogRecord, 'entry' | 'seq' | 'createdAt'>[]
  runFinished?: boolean
}): {
  processGroups: AssistantProcessGroup[]
  processThoughts: AssistantProcessThought[]
  isBrainThinking: boolean
} => {
  const groupById = new Map<string, AssistantProcessGroup>()
  const orderedGroupIds: string[] = []
  const thoughts: AssistantProcessThought[] = []
  const toolArgsById = new Map<string, IpcJsonObject>()
  const pendingQuestionToolCallIds: string[] = []
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
      } else if (entry.eventType === 'human_interaction_resolved' && entry.payload.kind === 'question') {
        const toolCallId = pendingQuestionToolCallIds.shift()
        if (toolCallId) {
          const group = groupById.get(`${input.runId}:tool:${toolCallId}`)
          const item = group?.items.find((candidate) => candidate.id === toolCallId)
          if (item?.interaction) {
            const result = entry.payload.result
            const answers = Array.isArray(result.answers)
              ? result.answers.filter((answer): answer is { id: string; selected: string[]; custom?: string } => {
                  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return false
                  const candidate = answer as { id?: unknown; selected?: unknown; custom?: unknown }
                  return typeof candidate.id === 'string' &&
                    Array.isArray(candidate.selected) &&
                    candidate.selected.every((value) => typeof value === 'string') &&
                    (candidate.custom === undefined || typeof candidate.custom === 'string')
                })
              : undefined
            item.interaction = { ...item.interaction, answers }
          }
        }
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
      const interaction = entry.toolName === 'ask_user_question'
        ? (() => {
            const args = toolArgsById.get(entry.toolCallId) as {
              questions?: Array<{
                id: string
                question: string
                options: Array<{ id: string; label: string }>
              }>
            } | undefined
            if (!Array.isArray(args?.questions)) return undefined
            return { questions: args.questions }
          })()
        : undefined
      const group = createDisplayProcessGroup({
        groupId: `${input.runId}:tool:${entry.toolCallId}`,
        kind: 'skill',
        display,
        status,
        createdAt,
        sourceEventType: 'assistant_process_group_started'
      })
      upsertGroup({ ...group, items: [interaction ? { ...item, interaction } : item] })
      if (interaction) pendingQuestionToolCallIds.push(entry.toolCallId)
    }
  }

  const processThoughts = thoughts.sort((left, right) => left.createdAt - right.createdAt)
  const processGroups = orderedGroupIds
    .map((id) => groupById.get(id))
    .filter((group): group is AssistantProcessGroup => Boolean(group))
    .sort((left, right) => left.createdAt - right.createdAt)

  const isBrainThinking = isBrainThinkingOpenInLog(input.records, input.runFinished)

  return { processGroups, processThoughts, isBrainThinking }
}
