import type { HumanRoundRecord, HumanState, HumanTodoItem } from '../types'

export type HumanMemoryRenderMode = 'brain_prompt' | 'mouth_prompt' | 'fallback_markdown'

const getRenderFallback = (mode: HumanMemoryRenderMode): string =>
  mode === 'fallback_markdown' ? '无' : 'none'

const normalizeMemoryText = (value: string): string =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .trim()

const renderThoughtTextValue = (value: string, mode: HumanMemoryRenderMode): string => {
  const normalized = normalizeMemoryText(value)
  return normalized || getRenderFallback(mode)
}

const renderTodoItem = (item: HumanTodoItem): string =>
  `- [${item.status}] ${item.item}`

const renderTodolistValue = (
  todolist: HumanState['memory']['thought']['todolist'],
  mode: HumanMemoryRenderMode
): string =>
  todolist && todolist.length > 0
    ? todolist.map(renderTodoItem).join('\n')
    : getRenderFallback(mode)

export const renderHumanThoughtField = (input: {
  state: HumanState
  field: keyof HumanState['memory']['thought']
  mode: HumanMemoryRenderMode
}): string =>
  input.field === 'todolist'
    ? renderTodolistValue(input.state.memory.thought.todolist, input.mode)
    : renderThoughtTextValue(input.state.memory.thought[input.field] || '', input.mode)

export const renderHumanThought = (
  state: HumanState,
  mode: HumanMemoryRenderMode
): string =>
  [
    '待办路径：',
    renderHumanThoughtField({
      state,
      field: 'todolist',
      mode
    }),
    '',
    '推进摘要：',
    renderHumanThoughtField({
      state,
      field: 'progressionSummary',
      mode
    })
  ].join('\n')

const renderLatestDecisionText = (
  latestRound: HumanRoundRecord | undefined,
  mode: HumanMemoryRenderMode
): string =>
  latestRound?.thought.thought.next
    ? renderThoughtTextValue(latestRound.thought.thought.next, mode)
    : getRenderFallback(mode)

const renderExecutionText = (
  executionText: string | undefined,
  mode: HumanMemoryRenderMode
): string => renderThoughtTextValue(executionText || '', mode)

export const renderTaskProgress = (input: {
  state: HumanState
  latestRound?: HumanRoundRecord
  latestExecutionText?: string
  mode: HumanMemoryRenderMode
}): string =>
  [
    '最新一轮决策如下',
    '待办路径：',
    renderHumanThoughtField({
      state: input.state,
      field: 'todolist',
      mode: input.mode
    }),
    '',
    '推进摘要：',
    renderHumanThoughtField({
      state: input.state,
      field: 'progressionSummary',
      mode: input.mode
    }),
    '',
    '判断：',
    renderLatestDecisionText(input.latestRound, input.mode),
    '',
    '执行：',
    renderExecutionText(input.latestExecutionText, input.mode)
  ].join('\n')
