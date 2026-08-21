import type { HumanTodoItem } from '../types'

export const renderTodoItems = (items: HumanTodoItem[]): string =>
  items.map((item) => `- [${item.status}] ${item.item}`).join('\n')
