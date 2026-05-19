import type { HumanDecisionHint, HumanThought, HumanTodoItem } from '../types'

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

const FINAL_DELIVERY_CHECK_ITEM = '检查是否已经满足用户诉求并能进入最终交付'

const buildTodoIndex = (items: HumanTodoItem[]): Map<string, HumanTodoItem['status']> =>
  new Map(items.map((item) => [item.item, item.status]))

export const validateTodoListTransition = (input: {
  previous: HumanTodoItem[]
  next: HumanTodoItem[]
}): HumanDecisionHint | undefined => {
  const previousIndex = buildTodoIndex(input.previous)
  const nextIndex = buildTodoIndex(input.next)

  const invalidItems = input.next
    .filter((item) => {
      const previousStatus = previousIndex.get(item.item)
      if (!previousStatus) return false
      if (previousStatus === 'done') {
        return item.status !== 'done'
      }
      if (previousStatus === 'obsolete') {
        return item.status !== 'obsolete'
      }
      return false
    })
    .map((item) => item.item)

  const droppedTodoItems = input.previous
    .filter(
      (item) =>
        item.status === 'todo' &&
        item.item !== FINAL_DELIVERY_CHECK_ITEM &&
        !nextIndex.has(item.item)
    )
    .map((item) => item.item)

  return invalidItems.length > 0 || droppedTodoItems.length > 0
    ? {
        code: 'brain_todolist_invalid_transition',
        detail: {
          invalidItems,
          droppedTodoItems
        }
      }
    : undefined
}

export const applyThoughtPatch = (input: {
  memory: HumanThought
  thought: HumanThought
}): HumanThought => ({
  next: normalizeThoughtText(input.thought.next),
  todolist: Array.isArray(input.thought.todolist)
    ? normalizeTodoItems(input.thought.todolist)
    : input.memory.todolist,
  progressionSummary:
    typeof input.thought.progressionSummary === 'string'
      ? normalizeThoughtText(input.thought.progressionSummary)
      : input.memory.progressionSummary
})
