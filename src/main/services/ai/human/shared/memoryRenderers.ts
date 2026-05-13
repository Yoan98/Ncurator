import type { HumanState, HumanTodoItem } from '../types'

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
  todolist.length > 0 ? todolist.map(renderTodoItem).join('\n') : getRenderFallback(mode)

export const renderHumanThoughtField = (input: {
  state: HumanState
  field: keyof HumanState['memory']['thought']
  mode: HumanMemoryRenderMode
}): string =>
  input.field === 'todolist'
    ? renderTodolistValue(input.state.memory.thought.todolist, input.mode)
    : renderThoughtTextValue(input.state.memory.thought[input.field], input.mode)

export const renderHumanThought = (
  state: HumanState,
  mode: HumanMemoryRenderMode
): string =>
  [
    '当前与下一步：',
    renderThoughtTextValue(state.execution.currentThought?.thought.next || '', mode),
    '',
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
