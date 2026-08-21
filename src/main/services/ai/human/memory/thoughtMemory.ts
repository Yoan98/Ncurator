import type { HumanThought, HumanTodoItem } from '../types'

const normalizeThoughtText = (value: string): string =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

const normalizeTodoItems = (items: HumanTodoItem[]): HumanTodoItem[] =>
  items
    .map((item) => {
      const normalized: HumanTodoItem = {
        item: String(item.item || '').trim(),
        status: item.status
      }
      if (typeof item.evidence === 'string' && item.evidence.trim().length > 0) {
        normalized.evidence = normalizeThoughtText(item.evidence)
      }
      return normalized
    })
    .filter((item) => item.item.length > 0)

export const normalizeHumanThought = (thought: HumanThought): HumanThought => ({
  next: normalizeThoughtText(thought.next),
  ...(Array.isArray(thought.todolist)
    ? { todolist: normalizeTodoItems(thought.todolist) }
    : {})
})
