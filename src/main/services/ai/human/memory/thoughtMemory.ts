import type { HumanThought, HumanThoughtMemory, HumanTodoItem } from '../types'

const normalizeThoughtText = (value: string): string =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

const normalizeTodoItems = (items: HumanTodoItem[]): HumanTodoItem[] =>
  items
    .map((item) => ({
      item: String(item.item || '').trim(),
      status: item.status
    }))
    .filter((item) => item.item.length > 0)

export const applyThoughtPatch = (input: {
  memory: HumanThoughtMemory
  thought: HumanThought
}): HumanThoughtMemory => ({
  todolist: Array.isArray(input.thought.todolist)
    ? normalizeTodoItems(input.thought.todolist)
    : input.memory.todolist,
  progressionSummary:
    typeof input.thought.progressionSummary === 'string'
      ? normalizeThoughtText(input.thought.progressionSummary)
      : input.memory.progressionSummary
})
