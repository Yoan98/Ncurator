import type { HumanState, HumanTodoItem } from '../types'

export type HumanMemoryRenderMode = 'brain_prompt' | 'mouth_prompt' | 'fallback_markdown'

const getRenderFallback = (mode: HumanMemoryRenderMode): string =>
  mode === 'fallback_markdown' ? '无' : 'none'

const renderTodoItem = (item: HumanTodoItem): string =>
  `- [${item.status}] ${item.item}`

export const renderTodolist = (state: HumanState, mode: HumanMemoryRenderMode): string =>
  state.memory.todolist.length > 0
    ? state.memory.todolist.map(renderTodoItem).join('\n')
    : getRenderFallback(mode)
