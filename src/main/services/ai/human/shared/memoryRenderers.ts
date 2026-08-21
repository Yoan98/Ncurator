import type { HumanTodoItem } from '../types'

export const renderTodoItems = (items: HumanTodoItem[]): string =>
  items
    .map((item) => {
      const line = `- [${item.status}] ${item.item}`
      return item.evidence ? `${line}（依据：${item.evidence}）` : line
    })
    .join('\n')
