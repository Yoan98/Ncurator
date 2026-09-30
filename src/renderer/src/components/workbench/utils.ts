import type {
  AiRunEvent,
  AssistantProcessDisplay,
  IpcJsonArray,
  IpcJsonObject,
  IpcJsonValue,
  RuntimeSkillId,
  SearchResult
} from '../../../../shared/types'
import { RUNTIME_TOOL_CATALOG, type RuntimeToolName } from '../../../../shared/runtimeCapabilities'
import {
  getAssistantMixedStatus as getMixedStatus,
  getAssistantToolIconKind as getToolIconKind,
  getAssistantToolSummaryText as getToolSummaryText,
  getAssistantToolUiKind as getToolUiKind,
  resolveItemIconKind
} from '../../../../shared/assistantExecutionSummary'
import { getAssistantToolItemCopy, readToolFileLabel } from '../../../../shared/assistantToolCopy'
import type {
  AssistantProcessGroup,
  AssistantProcessGroupItem,
  AssistantProcessThought,
  AssistantProcessIconKind,
  AssistantProcessSkillKey,
  AssistantProcessStatus,
  AssistantRichTextSegment,
  AssistantToolName,
  WorkbenchFileRef
} from './types'

const getPageNumberFromMetadata = (metadata: SearchResult['metadata']): number | undefined => {
  if (!metadata) return undefined
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as { page?: number }
      return typeof parsed.page === 'number' ? parsed.page : undefined
    } catch {
      return undefined
    }
  }
  return typeof metadata.page === 'number' ? metadata.page : undefined
}

const isIpcJsonObject = (value: IpcJsonValue): value is IpcJsonObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const readStringField = (value: IpcJsonObject, key: string): string | undefined => {
  const record = value as Record<string, IpcJsonValue>
  const candidate = record[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate : undefined
}

const readNestedObject = (value: IpcJsonObject, key: string): IpcJsonObject | undefined => {
  const record = value as Record<string, IpcJsonValue>
  const candidate = record[key]
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate
    : undefined
}

const isRuntimeToolName = (toolName: string): toolName is RuntimeToolName =>
  Object.prototype.hasOwnProperty.call(RUNTIME_TOOL_CATALOG, toolName)

const normalizeToolName = (toolName: string): AssistantToolName =>
  isRuntimeToolName(toolName) ? toolName : 'unnamed'

const text = (
  value: string,
  emphasis = false,
  iconKind?: AssistantProcessIconKind
): AssistantRichTextSegment => ({
  text: value,
  emphasis,
  iconKind
})

const sentence = (...segments: AssistantRichTextSegment[]): AssistantRichTextSegment[] => segments

const plainText = (segments: AssistantRichTextSegment[]): string =>
  segments.map((segment) => segment.text).join('')

const getDisplaySkillKey = (display: AssistantProcessDisplay): AssistantProcessSkillKey => {
  if (display.kind === 'tool') return getToolUiKind(normalizeToolName(display.toolName))
  return 'generic'
}

const getDisplayIconKind = (display: AssistantProcessDisplay): AssistantProcessIconKind => {
  if (display.kind === 'thinking') return 'default'
  if (display.kind === 'retry') return 'retry'
  if (display.kind === 'compaction') return 'compaction'
  if (display.kind === 'tool') {
    return resolveItemIconKind({
      toolName: normalizeToolName(display.toolName),
      input: display.input
    })
  }
  return getToolIconKind(getDisplaySkillKey(display))
}

const getToolItemText = (
  toolName: AssistantToolName,
  status: AssistantProcessStatus,
  input?: IpcJsonObject
): AssistantRichTextSegment[] => getAssistantToolItemCopy(toolName, status, input).detail

const getToolItemHeaderShort = (
  toolName: AssistantToolName,
  status: AssistantProcessStatus,
  input?: IpcJsonObject
): string => getAssistantToolItemCopy(toolName, status, input).headerShort

const getDisplayGroupText = (
  display: AssistantProcessDisplay,
  status: AssistantProcessStatus
): AssistantRichTextSegment[] => {
  if (display.kind === 'thinking') {
    if (status === 'running') return sentence(text('让俺想想'))
    return []
  }
  if (display.kind === 'retry') {
    const progress = `${display.attempt}/${display.maxAttempts}`
    if (status === 'running') return sentence(text(`正在重试 ${progress}`))
    if (status === 'partial_failed') return sentence(text(`部分重试失败 ${progress}`))
    return sentence(text(`重试失败 ${progress}`))
  }
  if (display.kind === 'compaction') {
    if (status === 'running') return sentence(text('东西太多了，让俺整理下'))
    if (status === 'completed') return sentence(text('呼，终于整理好了，累死俺了'))
    if (status === 'partial_failed') return sentence(text('上下文整理有部分失败'))
    return sentence(text('上下文整理失败了'))
  }
  if (display.kind === 'tool') {
    return getToolItemText(normalizeToolName(display.toolName), status, display.input)
  }
  return getToolSummaryText(getDisplaySkillKey(display), status)
}

const getDisplayItemText = (
  display: AssistantProcessDisplay,
  status: AssistantProcessStatus
): AssistantRichTextSegment[] => {
  if (display.kind === 'tool') {
    return getToolItemText(normalizeToolName(display.toolName), status, display.input)
  }
  if (display.kind === 'retry') {
    return sentence(text(display.message || ''))
  }
  return getDisplayGroupText(display, status)
}

export {
  buildAssistantExecutionSummaryText,
  resolveAssistantExecutionIcon,
  resolveAssistantExecutionStatus,
  resolveItemIconKind
} from '../../../../shared/assistantExecutionSummary'

const createProcessGroup = (input: {
  id: string
  kind: AssistantProcessGroup['kind']
  skillKey: AssistantProcessSkillKey
  iconKind: AssistantProcessIconKind
  status: AssistantProcessStatus
  runningText: AssistantRichTextSegment[]
  completedText: AssistantRichTextSegment[]
  failedText: AssistantRichTextSegment[]
  partialFailedText: AssistantRichTextSegment[]
  items?: AssistantProcessGroupItem[]
  createdAt: number
  sourceEventType: AssistantProcessGroup['sourceEventType']
  skillId?: RuntimeSkillId
}): AssistantProcessGroup => ({
  id: input.id,
  kind: input.kind,
  skillKey: input.skillKey,
  iconKind: input.iconKind,
  status: input.status,
  runningText: input.runningText,
  completedText: input.completedText,
  failedText: input.failedText,
  partialFailedText: input.partialFailedText,
  items: input.items || [],
  createdAt: input.createdAt,
  sourceEventType: input.sourceEventType,
  skillId: input.skillId
})

const resolveGroupStatus = (items: AssistantProcessGroupItem[]): AssistantProcessStatus => {
  return getMixedStatus(items.map((item) => item.status))
}

const upsertProcessGroup = (
  groups: AssistantProcessGroup[],
  next: AssistantProcessGroup
): AssistantProcessGroup[] =>
  [...groups.filter((group) => group.id !== next.id), next].sort(
    (left, right) => left.createdAt - right.createdAt
  )

const mergeProcessGroup = (
  groups: AssistantProcessGroup[],
  groupId: string,
  mapper: (group: AssistantProcessGroup) => AssistantProcessGroup
): AssistantProcessGroup[] => groups.map((group) => (group.id === groupId ? mapper(group) : group))

export const createDisplayProcessGroup = (input: {
  groupId: string
  kind: AssistantProcessGroup['kind']
  display: AssistantProcessDisplay
  status: AssistantProcessStatus
  createdAt: number
  sourceEventType: AssistantProcessGroup['sourceEventType']
}): AssistantProcessGroup => {
  const skillKey = getDisplaySkillKey(input.display)
  return createProcessGroup({
    id: input.groupId,
    kind: input.kind,
    skillKey,
    iconKind: getDisplayIconKind(input.display),
    status: input.status,
    runningText: getDisplayGroupText(input.display, 'running'),
    completedText: getDisplayGroupText(input.display, 'completed'),
    failedText: getDisplayGroupText(input.display, 'failed'),
    partialFailedText: getDisplayGroupText(input.display, 'partial_failed'),
    createdAt: input.createdAt,
    sourceEventType: input.sourceEventType
  })
}

export const createDisplayProcessItem = (input: {
  itemId: string
  display: AssistantProcessDisplay
  status: AssistantProcessStatus
  createdAt: number
  sourceEventType: AssistantProcessGroupItem['sourceEventType']
  existing?: AssistantProcessGroupItem
  terminalReviewState?: AssistantProcessGroupItem['terminalReviewState'] | null
  terminalReviewDecision?: AssistantProcessGroupItem['terminalReviewDecision'] | null
}): AssistantProcessGroupItem => {
  const toolName =
    input.display.kind === 'tool' ? normalizeToolName(input.display.toolName) : undefined
  const headerShortText = toolName
    ? getToolItemHeaderShort(
        toolName,
        input.status,
        input.display.kind === 'tool' ? input.display.input : undefined
      )
    : input.existing?.headerShortText
  return {
    id: input.itemId,
    status: input.status,
    terminalReviewState:
      input.terminalReviewState === null
        ? undefined
        : (input.terminalReviewState ?? input.existing?.terminalReviewState),
    terminalReviewDecision:
      input.terminalReviewDecision === null
        ? undefined
        : (input.terminalReviewDecision ?? input.existing?.terminalReviewDecision),
    runningText: input.existing?.runningText || getDisplayItemText(input.display, 'running'),
    completedText: input.existing?.completedText || getDisplayItemText(input.display, 'completed'),
    failedText: input.existing?.failedText || getDisplayItemText(input.display, 'failed'),
    partialFailedText:
      input.existing?.partialFailedText || getDisplayItemText(input.display, 'partial_failed'),
    headerShortText,
    createdAt: input.existing?.createdAt || input.createdAt,
    sourceEventType: input.sourceEventType,
    toolName,
    input:
      input.existing?.input || (input.display.kind === 'tool' ? input.display.input : undefined),
    targetLabel:
      input.existing?.targetLabel ||
      (input.display.kind === 'tool' ? readToolFileLabel(input.display.input) : undefined),
    interaction: input.existing?.interaction
  }
}

const createFileRefFromObject = (
  item: IpcJsonObject,
  origin: WorkbenchFileRef['origin']
): WorkbenchFileRef | null => {
  const nestedDocument = readNestedObject(item, 'document')
  const path =
    readStringField(item, 'path') ||
    readStringField(item, 'file_path') ||
    readStringField(item, 'absolute_path') ||
    readStringField(item, 'source_path') ||
    (nestedDocument ? readStringField(nestedDocument, 'file_path') : undefined)
  const fileName =
    readStringField(item, 'fileName') ||
    readStringField(item, 'file_name') ||
    readStringField(item, 'name') ||
    readStringField(item, 'document_name') ||
    (nestedDocument ? readStringField(nestedDocument, 'name') : undefined)

  if (!path || !fileName) return null
  const isDirectory =
    String(readStringField(item, 'kind') || readStringField(item, 'type') || '').toLowerCase() ===
      'directory' || String(path).endsWith('/')
  return {
    path,
    fileName,
    origin,
    summary: readStringField(item, 'summary'),
    isDirectory
  }
}

export const getAssistantToolNarrative = (toolName?: string): string =>
  plainText(getToolSummaryText(getToolUiKind(normalizeToolName(String(toolName || ''))), 'running'))

export const resolveQuestionInteraction = (
  item: AssistantProcessGroupItem
): AssistantProcessGroupItem['interaction'] | undefined => {
  if (item.interaction) return item.interaction
  if (item.toolName !== 'ask_user_question' || !item.input) return undefined
  const input = item.input as {
    questions?: NonNullable<AssistantProcessGroupItem['interaction']>['questions']
  }
  return Array.isArray(input.questions) ? { questions: input.questions } : undefined
}

export const buildAssistantProcessText = (event: AiRunEvent): string | null => {
  if (event.type === 'assistant_process_group_started') {
    return plainText(getDisplayGroupText(event.display, 'running'))
  }
  if (event.type === 'assistant_process_group_completed') {
    return event.display ? plainText(getDisplayGroupText(event.display, 'completed')) : null
  }
  if (event.type === 'assistant_process_group_failed') {
    return event.display ? plainText(getDisplayGroupText(event.display, 'failed')) : null
  }
  if (event.type === 'assistant_process_item_started') {
    return plainText(getDisplayItemText(event.display, 'running'))
  }
  if (event.type === 'assistant_process_item_completed') {
    return event.display ? plainText(getDisplayItemText(event.display, 'completed')) : null
  }
  if (event.type === 'assistant_process_item_failed') {
    return event.display ? plainText(getDisplayItemText(event.display, 'failed')) : null
  }
  return null
}

export const createAssistantThinkingGroup = (messageId: string): AssistantProcessGroup =>
  createProcessGroup({
    id: `${messageId}:thinking`,
    kind: 'thinking',
    skillKey: 'generic',
    iconKind: 'default',
    status: 'running',
    runningText: sentence(text('让俺想想')),
    completedText: [],
    failedText: [],
    partialFailedText: [],
    createdAt: Date.now(),
    sourceEventType: 'thinking'
  })

export const createSearchProcessGroup = (messageId: string): AssistantProcessGroup =>
  createProcessGroup({
    id: `${messageId}:search`,
    kind: 'skill',
    skillKey: 'kb',
    iconKind: 'search',
    status: 'running',
    runningText: getToolSummaryText('kb', 'running'),
    completedText: getToolSummaryText('kb', 'completed'),
    failedText: getToolSummaryText('kb', 'failed'),
    partialFailedText: getToolSummaryText('kb', 'partial_failed'),
    createdAt: Date.now(),
    sourceEventType: 'thinking'
  })

export const completeAssistantProcessGroups = (
  groups: AssistantProcessGroup[],
  status: AssistantProcessStatus = 'completed'
): AssistantProcessGroup[] =>
  groups
    .filter((group) => {
      if (group.kind === 'finalizing' || group.kind === 'learning' || group.kind === 'thinking') {
        return false
      }
      // Successful retry is not a retained process row.
      if (status === 'completed' && group.kind === 'retry') return false
      return true
    })
    .map((group) => {
      if (group.status !== 'running') return group
      const nextItems = group.items.map((item) =>
        item.status === 'running' ? { ...item, status } : item
      )
      return {
        ...group,
        status: status === 'failed' ? 'failed' : resolveGroupStatus(nextItems),
        items: nextItems
      }
    })

export const reduceAssistantProcessThoughts = (
  current: AssistantProcessThought[],
  event: AiRunEvent
): AssistantProcessThought[] => {
  if (event.type !== 'assistant_process_thought') return current
  const text = event.text.trim()
  if (!text) return current
  const next: AssistantProcessThought = {
    id: event.thoughtId,
    text,
    createdAt: event.createdAt,
    sourceEventType: event.type
  }
  return [...current.filter((item) => item.id !== next.id), next].sort(
    (left, right) => left.createdAt - right.createdAt
  )
}

const withoutThinkingGroups = (groups: AssistantProcessGroup[]): AssistantProcessGroup[] =>
  groups.filter((group) => group.kind !== 'thinking')

const withoutRetryGroups = (groups: AssistantProcessGroup[]): AssistantProcessGroup[] =>
  groups.filter((group) => group.kind !== 'retry')

const isRetryProcessEvent = (event: {
  groupId: string
  display?: AssistantProcessDisplay
}): boolean => event.display?.kind === 'retry' || event.groupId.includes(':llm-retry')

const upsertGroupFromDisplayEvent = (
  current: AssistantProcessGroup[],
  input: {
    groupId: string
    kind: AssistantProcessGroup['kind']
    display: AssistantProcessDisplay
    status: AssistantProcessStatus
    createdAt: number
    sourceEventType: AssistantProcessGroup['sourceEventType']
  }
): AssistantProcessGroup[] => {
  // Thinking UI is driven by thinking started/completed process events.
  // A new thinking started replaces any previous thinking row (incl. optimistic placeholder).
  // Retry is a competing wait state and must replace thinking immediately.
  // One run has one retry row: later attempts update it instead of stacking.
  const existingRetry = current.find((group) => group.kind === 'retry')
  const baseGroups =
    input.kind === 'retry'
      ? current.filter((group) => group.kind !== 'thinking' && group.kind !== 'retry')
      : input.kind === 'thinking'
        ? withoutThinkingGroups(current)
        : current
  const existing =
    input.kind === 'retry' ? existingRetry : baseGroups.find((group) => group.id === input.groupId)
  const next = createDisplayProcessGroup({
    groupId: existing?.id || input.groupId,
    kind: input.kind,
    display: input.display,
    status: input.status,
    createdAt: existing?.createdAt || input.createdAt,
    sourceEventType: input.sourceEventType
  })
  return upsertProcessGroup(baseGroups, {
    ...next,
    items: existing?.items || [],
    subagents: existing?.subagents
  })
}

const resolveRetryGroupId = (
  current: AssistantProcessGroup[],
  groupId: string,
  displayKind?: AssistantProcessDisplay['kind']
): string => {
  if (displayKind === 'retry' || groupId.includes(':llm-retry')) {
    return current.find((group) => group.kind === 'retry')?.id || groupId
  }
  return groupId
}

const completeProcessGroupById = (
  current: AssistantProcessGroup[],
  groupId: string,
  status: AssistantProcessStatus,
  display?: AssistantProcessDisplay
): AssistantProcessGroup[] =>
  mergeProcessGroup(current, resolveRetryGroupId(current, groupId, display?.kind), (group) => {
    const nextItems =
      status === 'failed'
        ? group.items.map((item) => (item.status === 'running' ? { ...item, status } : item))
        : group.items
    return {
      ...group,
      status:
        status === 'completed' && nextItems.length > 0 ? resolveGroupStatus(nextItems) : status,
      runningText: display ? getDisplayGroupText(display, 'running') : group.runningText,
      completedText: display ? getDisplayGroupText(display, 'completed') : group.completedText,
      failedText: display ? getDisplayGroupText(display, 'failed') : group.failedText,
      partialFailedText: display
        ? getDisplayGroupText(display, 'partial_failed')
        : group.partialFailedText,
      items: nextItems
    }
  })

const upsertProcessItem = (
  current: AssistantProcessGroup[],
  input: {
    groupId: string
    itemId: string
    display: AssistantProcessDisplay
    status: AssistantProcessStatus
    createdAt: number
    sourceEventType: AssistantProcessGroupItem['sourceEventType']
    terminalReviewState?: AssistantProcessGroupItem['terminalReviewState'] | null
    terminalReviewDecision?: AssistantProcessGroupItem['terminalReviewDecision'] | null
  }
): AssistantProcessGroup[] => {
  const groupId = resolveRetryGroupId(current, input.groupId, input.display.kind)
  const existingGroup = current.find((group) => group.id === groupId)
  const groupsWithParent = existingGroup
    ? current
    : upsertGroupFromDisplayEvent(current, {
        groupId,
        kind: input.display.kind === 'tool' ? 'skill' : input.display.kind,
        display: input.display,
        status: 'running',
        createdAt: input.createdAt,
        sourceEventType: input.sourceEventType
      })

  return mergeProcessGroup(groupsWithParent, groupId, (group) => {
    const existingItem = group.items.find((item) => item.id === input.itemId)
    const nextItem = createDisplayProcessItem({
      itemId: input.itemId,
      display: input.display,
      status: input.status,
      createdAt: input.createdAt,
      sourceEventType: input.sourceEventType,
      existing: existingItem,
      terminalReviewState: input.terminalReviewState,
      terminalReviewDecision: input.terminalReviewDecision
    })
    return {
      ...group,
      status: 'running',
      items: [...group.items.filter((item) => item.id !== input.itemId), nextItem].sort(
        (left, right) => left.createdAt - right.createdAt
      )
    }
  })
}

const completeProcessItem = (
  current: AssistantProcessGroup[],
  input: {
    groupId: string
    itemId: string
    status: AssistantProcessStatus
    display?: AssistantProcessDisplay
    sourceEventType: AssistantProcessGroupItem['sourceEventType']
  }
): AssistantProcessGroup[] =>
  mergeProcessGroup(
    current,
    resolveRetryGroupId(current, input.groupId, input.display?.kind),
    (group) => {
      const nextItems = group.items.map((item) => {
        if (item.id !== input.itemId) return item
        const toolName =
          input.display?.kind === 'tool' ? normalizeToolName(input.display.toolName) : item.toolName
        return {
          ...item,
          status: input.status,
          completedText: input.display
            ? getDisplayItemText(input.display, 'completed')
            : item.completedText,
          failedText: input.display ? getDisplayItemText(input.display, 'failed') : item.failedText,
          partialFailedText: input.display
            ? getDisplayItemText(input.display, 'partial_failed')
            : item.partialFailedText,
          headerShortText:
            input.display && toolName
              ? getToolItemHeaderShort(
                  toolName,
                  input.status,
                  input.display.kind === 'tool' ? input.display.input : item.input
                )
              : item.headerShortText,
          sourceEventType: input.sourceEventType
        }
      })
      return {
        ...group,
        status: resolveGroupStatus(nextItems),
        items: nextItems
      }
    }
  )

const updateTerminalReviewStates = (
  groups: AssistantProcessGroup[],
  states: ReadonlyMap<string, NonNullable<AssistantProcessGroupItem['terminalReviewState']>>
): AssistantProcessGroup[] =>
  groups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      const state = states.get(item.id)
      return state ? { ...item, terminalReviewState: state } : item
    })
  }))

const updateTerminalReviewResults = (
  groups: AssistantProcessGroup[],
  results: ReadonlyMap<
    string,
    {
      state: NonNullable<AssistantProcessGroupItem['terminalReviewState']>
      decision: NonNullable<AssistantProcessGroupItem['terminalReviewDecision']>
    }
  >
): AssistantProcessGroup[] =>
  groups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      const result = results.get(item.id)
      return result
        ? {
            ...item,
            terminalReviewState: result.state,
            terminalReviewDecision: result.decision
          }
        : item
    })
  }))

export const removePendingTerminalReviewItems = (
  groups: AssistantProcessGroup[]
): AssistantProcessGroup[] =>
  groups.flatMap((group) => {
    const items = group.items.filter(
      (item) =>
        item.terminalReviewState !== 'reviewing' &&
        item.terminalReviewState !== 'ready_to_execute' &&
        item.terminalReviewState !== 'waiting_approval'
    )
    if (items.length === 0 && group.items.length > 0) return []
    return items.length === group.items.length
      ? [group]
      : [{ ...group, items, status: resolveGroupStatus(items) }]
  })

export const reduceAssistantProcessGroups = (
  current: AssistantProcessGroup[],
  event: AiRunEvent
): AssistantProcessGroup[] => {
  if (event.type === 'subagent_stream') {
    const groupId = `${event.runId}:tool:${event.toolCallId}`
    return current.map((group) =>
      group.id !== groupId
        ? group
        : {
            ...group,
            subagents: group.subagents?.map((child) => {
              if (child.childRunId !== event.childRunId || child.status !== 'running') return child
              return {
                ...child,
                message: (event.reset ? '' : child.message || '') + (event.delta || ''),
                requesting: event.requesting ?? child.requesting
              }
            })
          }
    )
  }
  if (event.type === 'subagent_updated') {
    const groupId = `${event.runId}:tool:${event.update.toolCallId}`
    const group =
      current.find((item) => item.id === groupId) ||
      createDisplayProcessGroup({
        groupId,
        kind: 'skill',
        display: { kind: 'tool', toolName: 'delegate_to_subagent', input: {} },
        status: 'running',
        createdAt: event.createdAt,
        sourceEventType: event.type
      })
    const previous = group.subagents?.find((child) => child.childRunId === event.update.childRunId)
    const actions = [...(previous?.actions || [])]
    if (event.update.action) {
      const index = actions.findIndex((action) => action.id === event.update.action?.id)
      if (index < 0) actions.push(event.update.action)
      else actions[index] = { ...actions[index], ...event.update.action }
    }
    const active = event.update.status === 'running' || event.update.status === 'queued'
    const child = {
      ...previous,
      ...event.update,
      actions,
      message: active
        ? (event.update.message ?? event.update.action?.text ?? previous?.message)
        : event.update.result,
      requesting: active ? previous?.requesting : false
    }
    const subagents = group.subagents?.some((item) => item.childRunId === child.childRunId)
      ? group.subagents.map((item) => (item.childRunId === child.childRunId ? child : item))
      : [...(group.subagents || []), child]
    const next = { ...group, subagents }
    return current.some((item) => item.id === groupId)
      ? current.map((item) => (item.id === groupId ? next : item))
      : [...current, next]
  }
  if (event.type === 'human_interaction_required') {
    const interaction = event.interaction
    if (interaction.kind !== 'question') return current
    const display: AssistantProcessDisplay = {
      kind: 'tool',
      toolName: 'ask_user_question',
      input: { questions: interaction.questions }
    }
    const groupId = `${event.runId}:tool:${interaction.toolCallId}`
    const next = upsertProcessItem(current, {
      groupId,
      itemId: interaction.toolCallId,
      display,
      status: 'running',
      createdAt: event.createdAt,
      sourceEventType: event.type
    })
    return next.map((group) =>
      group.id !== groupId
        ? group
        : {
            ...group,
            items: group.items.map((item) =>
              item.id === interaction.toolCallId
                ? { ...item, interaction: { questions: interaction.questions } }
                : item
            )
          }
    )
  }

  if (event.type === 'assistant_process_thought') {
    return withoutThinkingGroups(current)
  }

  if (event.type === 'terminal_review_started') {
    return event.commands.reduce((groups, command) => {
      const display: AssistantProcessDisplay = {
        kind: 'tool',
        toolName: 'terminal_run',
        input: command.input
      }
      return upsertProcessItem(groups, {
        groupId: `${event.runId}:tool:${command.commandId}`,
        itemId: command.commandId,
        display,
        status: 'running',
        createdAt: event.createdAt,
        sourceEventType: event.type,
        terminalReviewState: 'reviewing'
      })
    }, current)
  }

  if (event.type === 'terminal_review_resolved') {
    return updateTerminalReviewResults(
      current,
      new Map(
        event.decisions.map(({ commandId, decision }) => [
          commandId,
          {
            state: decision === 'auto_approve' ? 'ready_to_execute' : 'waiting_approval',
            decision
          }
        ])
      )
    )
  }

  if (event.type === 'terminal_review_blocked') {
    return updateTerminalReviewStates(
      current,
      new Map(event.toolCallIds.map((toolCallId) => [toolCallId, 'not_executed']))
    )
  }

  if (event.type === 'approval_batch_decision') {
    return updateTerminalReviewStates(
      current,
      new Map(
        event.decisions.map(({ itemId, action }) => [
          itemId,
          action === 'approve' ? 'ready_to_execute' : 'not_executed'
        ])
      )
    )
  }

  if (event.type === 'assistant_process_group_started') {
    if (
      event.kind === 'learning' ||
      event.kind === 'finalizing' ||
      event.kind === 'thinking' ||
      event.display.kind === 'learning' ||
      event.display.kind === 'finalizing' ||
      event.display.kind === 'thinking'
    ) {
      return withoutThinkingGroups(current)
    }
    return upsertGroupFromDisplayEvent(current, {
      groupId: event.groupId,
      kind: event.kind,
      display: event.display,
      status: 'running',
      createdAt: event.createdAt,
      sourceEventType: event.type
    })
  }

  if (event.type === 'assistant_process_group_completed') {
    if (event.groupId.endsWith(':thinking') || event.display?.kind === 'thinking') {
      return withoutThinkingGroups(current)
    }
    if (isRetryProcessEvent(event)) {
      return withoutRetryGroups(current)
    }
    if (event.groupId.endsWith(':finalizing')) {
      return current.filter((group) => group.id !== event.groupId)
    }
    if (event.display?.kind === 'learning' || event.display?.kind === 'finalizing') return current
    return completeProcessGroupById(current, event.groupId, 'completed', event.display)
  }

  if (event.type === 'assistant_process_group_failed') {
    if (event.groupId.endsWith(':thinking') || event.display?.kind === 'thinking') {
      return withoutThinkingGroups(current)
    }
    if (event.display?.kind === 'learning' || event.display?.kind === 'finalizing') return current
    return completeProcessGroupById(current, event.groupId, 'failed', event.display)
  }

  if (event.type === 'assistant_process_item_started') {
    return upsertProcessItem(current, {
      groupId: event.groupId,
      itemId: event.itemId,
      display: event.display,
      status: 'running',
      createdAt: event.createdAt,
      sourceEventType: event.type,
      terminalReviewState: event.terminalReviewState
    })
  }

  if (event.type === 'assistant_process_item_completed') {
    if (isRetryProcessEvent(event)) {
      return withoutRetryGroups(current)
    }
    return completeProcessItem(current, {
      groupId: event.groupId,
      itemId: event.itemId,
      status: 'completed',
      display: event.display,
      sourceEventType: event.type
    })
  }

  if (event.type === 'assistant_process_item_failed') {
    return completeProcessItem(current, {
      groupId: event.groupId,
      itemId: event.itemId,
      status: 'failed',
      display: event.display,
      sourceEventType: event.type
    })
  }

  if (event.type === 'run_failed') {
    return removePendingTerminalReviewItems(completeAssistantProcessGroups(current, 'failed'))
  }

  if (event.type === 'run_cancelled') {
    return removePendingTerminalReviewItems(completeAssistantProcessGroups(current))
  }

  return current
}

export const applyQuestionInteractionResult = (
  current: AssistantProcessGroup[],
  event: AiRunEvent
): AssistantProcessGroup[] => {
  if (event.type !== 'human_interaction_resolved' || event.kind !== 'question') return current
  const rawAnswers = event.result.answers
  if (!Array.isArray(rawAnswers)) return current
  const answers = rawAnswers.filter(
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
  if (answers.length === 0) return current

  let targetFound = false
  const next = [...current]
    .reverse()
    .flatMap((group) => {
      const items = [...group.items]
        .reverse()
        .map((item) => {
          if (
            targetFound ||
            item.toolName !== 'ask_user_question' ||
            !resolveQuestionInteraction(item) ||
            resolveQuestionInteraction(item)?.answers
          ) {
            return item
          }
          targetFound = true
          const interaction = resolveQuestionInteraction(item)
          return interaction ? { ...item, interaction: { ...interaction, answers } } : item
        })
        .reverse()
      return [{ ...group, items }]
    })
    .reverse()
  return targetFound ? next : current
}

export const shouldShowAssistantApplyTargets = (input: {
  runFinished: boolean
  applyTargetCount: number
}): boolean => input.runFinished && input.applyTargetCount > 0

export {
  isAssistantActivityToolGroup,
  shouldShowAssistantThinkingIndicator,
  shouldActivityHeaderShimmer
} from '../../../../shared/assistantThinkingWait'

export const dedupeFileRefs = (items: WorkbenchFileRef[]): WorkbenchFileRef[] => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.origin}:${item.path}:${item.applyId || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const getSearchResultFileRef = (result: SearchResult): WorkbenchFileRef | null => {
  const path = result.document?.file_path
  if (!path) return null
  return {
    path,
    fileName: result.document_name,
    origin: result.source_type === 'web' ? 'artifact' : 'search_hit',
    pageNumber: getPageNumberFromMetadata(result.metadata)
  }
}

export const extractReadableFilesFromToolOutput = (
  output: IpcJsonValue,
  fallbackOrigin: WorkbenchFileRef['origin']
): WorkbenchFileRef[] => {
  if (Array.isArray(output)) {
    const refs = (output as IpcJsonArray)
      .map((item) => (isIpcJsonObject(item) ? createFileRefFromObject(item, fallbackOrigin) : null))
      .filter((item): item is WorkbenchFileRef => item !== null)
    return dedupeFileRefs(refs)
  }
  if (isIpcJsonObject(output)) {
    const single = createFileRefFromObject(output, fallbackOrigin)
    return single ? [single] : []
  }
  return []
}

export const formatSessionDate = (timestamp: number): string => {
  const date = new Date(timestamp)
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now()
  const diff = now - timestamp
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (hours < 1) {
    return '刚刚'
  }
  if (hours < 24) {
    return `${hours}小时`
  }
  return `${days}天`
}
