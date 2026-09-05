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

const readBrowserApprovalTextFromInput = (input?: object): string => {
  const obj = asJsonObject(input)
  if (!obj) return ''
  const action = typeof obj.action === 'string' && obj.action.trim() ? obj.action.trim() : ''
  const instruction =
    typeof obj.instruction === 'string' && obj.instruction.trim()
      ? obj.instruction.trim()
      : '使用内置浏览器'
  const url = typeof obj.url === 'string' && obj.url.trim() ? obj.url.trim() : ''
  const tabId = typeof obj.tabId === 'string' && obj.tabId.trim() ? obj.tabId.trim() : ''
  const actionId =
    typeof obj.actionId === 'string' && obj.actionId.trim() ? obj.actionId.trim() : ''
  if (action === 'navigate') return `打开网页：${url || instruction}`
  if (action === 'list_tabs') return '列出浏览器标签'
  if (action === 'observe') return `观察页面：${instruction}`
  if (action === 'extract') return `提取页面内容：${instruction}`
  if (action === 'act') return `操作页面：${actionId || instruction}`
  if (action === 'screenshot') return `截取页面：${tabId || instruction}`
  if (action === 'scroll') return `滚动页面：${tabId || instruction}`
  return `操作浏览器：${instruction}`
}

export const findApprovalReviewForProcessItem = (input: {
  itemId: string
  toolName?: string
  itemInput?: object
  reviews: readonly AssistantApprovalReview[]
}): AssistantApprovalReview | undefined => {
  const byId = input.reviews.find((review) => review.toolCallId === input.itemId)
  if (byId) return byId

  const toolName = input.toolName
  if (!toolName) return undefined

  if (toolName === 'terminal_run') {
    const command = readCommandFromInput(input.itemInput)
    if (!command) return undefined
    return input.reviews.find(
      (review) => review.toolName === toolName && review.command === command
    )
  }

  if (toolName === 'browser_use') {
    const browserReviews = input.reviews.filter((review) => review.toolName === 'browser_use')
    if (browserReviews.length === 0) return undefined
    const displayCommand = readBrowserApprovalTextFromInput(input.itemInput)
    const byCommand = browserReviews.find((review) => review.command === displayCommand)
    if (byCommand) return byCommand
    return browserReviews.length === 1 ? browserReviews[0] : undefined
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
