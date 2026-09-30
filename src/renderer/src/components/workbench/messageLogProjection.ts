import type {
  AssistantProcessDisplay,
  ChatMessageLogEntry,
  ChatMessageLogRecord,
  IpcJsonObject
} from '../../../../shared/types'
import { normalizeThoughtText } from '../../../../shared/thoughtText'
import { isBrainThinkingOpenInLog } from '../../../../shared/assistantThinkingWait'
import {
  reduceAssistantProcessGroups,
  createDisplayProcessGroup,
  createDisplayProcessItem,
  removePendingTerminalReviewItems
} from './utils'
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
    group = { ...group, subagents: group.subagents || groupById.get(group.id)?.subagents }
    if (!groupById.has(group.id)) orderedGroupIds.push(group.id)
    groupById.set(group.id, group)
  }

  const setTerminalReviewState = (
    toolCallId: string,
    terminalReviewState: NonNullable<AssistantProcessGroup['items'][number]['terminalReviewState']>
  ): void => {
    const group = groupById.get(`${input.runId}:tool:${toolCallId}`)
    if (!group) return
    upsertGroup({
      ...group,
      items: group.items.map((item) =>
        item.id === toolCallId ? { ...item, terminalReviewState } : item
      )
    })
  }

  for (const record of input.records) {
    const entry: ChatMessageLogEntry = record.entry
    if (entry.kind === 'annotation') {
      if (entry.eventType === 'subagent_updated') {
        const groups = reduceAssistantProcessGroups([...groupById.values()], {
          type: 'subagent_updated',
          runId: input.runId,
          update: entry.payload,
          createdAt: resolveCreatedAt(record)
        })
        groups.forEach(upsertGroup)
      } else if (entry.eventType === 'thinking_started') {
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
      } else if (entry.eventType === 'terminal_review_started') {
        const createdAt = resolveCreatedAt(record)
        for (const commandId of entry.payload.commandIds) {
          const display: AssistantProcessDisplay = {
            kind: 'tool',
            toolName: 'terminal_run',
            input: toolArgsById.get(commandId) || {}
          }
          const item = createDisplayProcessItem({
            itemId: commandId,
            display,
            status: 'running',
            createdAt,
            sourceEventType: 'terminal_review_started',
            terminalReviewState: 'reviewing'
          })
          const group = createDisplayProcessGroup({
            groupId: `${input.runId}:tool:${commandId}`,
            kind: 'skill',
            display,
            status: 'running',
            createdAt,
            sourceEventType: 'assistant_process_group_started'
          })
          upsertGroup({ ...group, items: [item] })
        }
      } else if (entry.eventType === 'terminal_review_resolved') {
        for (const decision of entry.payload.decisions) {
          const group = groupById.get(`${input.runId}:tool:${decision.commandId}`)
          if (!group) continue
          upsertGroup({
            ...group,
            items: group.items.map((item) =>
              item.id !== decision.commandId
                ? item
                : {
                    ...item,
                    terminalReviewState:
                      decision.decision === 'auto_approve'
                        ? 'ready_to_execute'
                        : 'waiting_approval',
                    terminalReviewDecision: decision.decision
                  }
            )
          })
        }
      } else if (entry.eventType === 'approval_batch_resolved') {
        for (const item of entry.payload.items) {
          setTerminalReviewState(
            item.toolCallId,
            item.action === 'approve' ? 'ready_to_execute' : 'not_executed'
          )
        }
        for (const toolCallId of entry.payload.notExecutedToolCallIds || []) {
          setTerminalReviewState(toolCallId, 'not_executed')
        }
      } else if (
        entry.eventType === 'human_interaction_resolved' &&
        entry.payload.kind === 'question'
      ) {
        const toolCallId = pendingQuestionToolCallIds.shift()
        if (toolCallId) {
          const group = groupById.get(`${input.runId}:tool:${toolCallId}`)
          const item = group?.items.find((candidate) => candidate.id === toolCallId)
          if (item?.interaction) {
            const result = entry.payload.result
            const answers = Array.isArray(result.answers)
              ? result.answers.filter(
                  (
                    answer
                  ): answer is {
                    questionId: string
                    selectedOptionIds: string[]
                    userText?: string
                  } => {
                    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return false
                    const candidate = answer as {
                      questionId?: unknown
                      selectedOptionIds?: unknown
                      userText?: unknown
                    }
                    return (
                      typeof candidate.questionId === 'string' &&
                      Array.isArray(candidate.selectedOptionIds) &&
                      candidate.selectedOptionIds.every((value) => typeof value === 'string') &&
                      (candidate.userText === undefined || typeof candidate.userText === 'string')
                    )
                  }
                )
              : undefined
            item.interaction = { ...item.interaction, answers }
          }
        }
      }
      continue
    }

    if (entry.kind === 'assistant') {
      if (thinkingOpen) {
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
      }
      for (const call of entry.toolCalls) {
        toolArgsById.set(call.id, call.args)
      }
      continue
    }

    if (entry.kind === 'tool') {
      if (HIDDEN_PROCESS_TOOL_NAMES.has(entry.toolName)) continue
      const groupId = `${input.runId}:tool:${entry.toolCallId}`
      const existingGroup = groupById.get(groupId)
      const existingItem = existingGroup?.items.find(
        (candidate) => candidate.id === entry.toolCallId
      )
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
        createdAt: existingItem?.createdAt || createdAt,
        sourceEventType: existingItem?.sourceEventType || 'assistant_process_item_started',
        existing: existingItem,
        terminalReviewState:
          existingItem?.terminalReviewState === 'not_executed' ? 'not_executed' : null
      })
      const interaction =
        entry.toolName === 'ask_user_question'
          ? (() => {
              const args = toolArgsById.get(entry.toolCallId) as
                | {
                    questions?: Array<{
                      id: string
                      question: string
                      options: Array<{ id: string; label: string }>
                    }>
                  }
                | undefined
              if (!Array.isArray(args?.questions)) return undefined
              return { questions: args.questions }
            })()
          : undefined
      const group = createDisplayProcessGroup({
        groupId,
        kind: 'skill',
        display,
        status,
        createdAt: existingGroup?.createdAt || createdAt,
        sourceEventType: existingGroup?.sourceEventType || 'assistant_process_group_started'
      })
      upsertGroup({
        ...group,
        items: [interaction ? { ...item, interaction } : item]
      })
      if (interaction) pendingQuestionToolCallIds.push(entry.toolCallId)
    }
  }

  const processThoughts = thoughts.sort((left, right) => left.createdAt - right.createdAt)
  const projectedGroups = orderedGroupIds
    .map((id) => groupById.get(id))
    .filter((group): group is AssistantProcessGroup => Boolean(group))
    .sort((left, right) => left.createdAt - right.createdAt)
  for (const group of projectedGroups) {
    if (input.runFinished && group.subagents)
      group.subagents = group.subagents.map((child) =>
        child.status === 'running' || child.status === 'queued'
          ? {
              ...child,
              requesting: false,
              status: 'interrupted',
              result: '执行被中断，未收到完整结果'
            }
          : child
      )
  }
  const processGroups = input.runFinished
    ? removePendingTerminalReviewItems(projectedGroups)
    : projectedGroups

  const isBrainThinking = isBrainThinkingOpenInLog(input.records, input.runFinished)

  return { processGroups, processThoughts, isBrainThinking }
}
