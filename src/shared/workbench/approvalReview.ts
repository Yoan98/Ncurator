import type { ChatMessageLogRecord, JsonObject } from '../types'

export type ApprovalReviewAction = 'approve' | 'reject' | 'guide'

export type AssistantApprovalReview = {
  toolCallId: string
  toolName: string
  command: string
  commandExplanation?: string
  action: ApprovalReviewAction
  message?: string
}

const resolveCommandExplanation = (review: AssistantApprovalReview): string => {
  const explanation = (review.commandExplanation || '').trim()
  if (explanation) return explanation
  return (review.command || '').trim()
}

/** Hover reveal copy shown in place of the tool narrative. */
export const formatApprovalReviewRevealText = (review: AssistantApprovalReview): string => {
  const explanation = resolveCommandExplanation(review)
  if (review.action !== 'guide') return explanation
  const message = (review.message || '').trim()
  if (!message) return explanation
  if (!explanation) return `已反馈：${message}`
  return `${explanation} · 已反馈：${message}`
}

const asJsonObject = (input?: object): JsonObject | undefined => {
  if (!input || Array.isArray(input)) return undefined
  return input as JsonObject
}

const readCommandFromInput = (input?: object): string => {
  const value = asJsonObject(input)?.command
  return typeof value === 'string' ? value.trim() : ''
}

export const findApprovalReviewForProcessItem = (input: {
  itemId: string
  toolName?: string
  itemInput?: object
  reviews: readonly AssistantApprovalReview[]
}): AssistantApprovalReview | undefined => {
  const toolName = input.toolName
  if (!toolName || toolName === 'browser_use') return undefined

  const byId = input.reviews.find((review) => review.toolCallId === input.itemId)
  if (byId) return byId

  if (toolName === 'terminal_run') {
    const command = readCommandFromInput(input.itemInput)
    if (!command) return undefined
    return input.reviews.find(
      (review) => review.toolName === toolName && review.command === command
    )
  }

  return input.reviews.find((review) => review.toolName === toolName)
}

export const projectApprovalReviews = (input: {
  records: readonly Pick<ChatMessageLogRecord, 'entry'>[]
}): AssistantApprovalReview[] => {
  const reviews: AssistantApprovalReview[] = []
  for (const record of input.records) {
    const entry = record.entry
    if (entry.kind !== 'annotation' || entry.eventType !== 'approval_batch_resolved') continue
    for (const item of entry.payload.items) {
      reviews.push({
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        command: item.command,
        commandExplanation: item.commandExplanation,
        action: item.action,
        message: item.message
      })
    }
  }
  return reviews
}
