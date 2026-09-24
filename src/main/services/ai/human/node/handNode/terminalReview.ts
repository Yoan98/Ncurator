import { z } from 'zod/v4'
import type { ChatMessageLogEntry } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import {
  buildTerminalReviewPrompt,
  type TerminalReviewPromptOperation
} from '../../prompts/terminalReview'
import { getTerminalStartDirectory } from '../../tools/terminal/workingDirectory'
import { isCancelledError } from '../../../utils/runFailure'

export type TerminalReviewCandidate = TerminalReviewPromptOperation

export type TerminalReviewDecision = {
  operationId: string
  decision: 'auto_approve' | 'needs_human_review'
  reason: string
}

const reviewSchema = z.object({
  operations: z.array(
    z.object({
      operationId: z.string().min(1),
      decision: z.enum(['auto_approve', 'needs_human_review']),
      reason: z.string().min(1)
    })
  )
})

const humanFallback = (
  operations: readonly TerminalReviewCandidate[],
  reason: string
): TerminalReviewDecision[] =>
  operations.map((operation) => ({
    operationId: operation.operationId,
    decision: 'needs_human_review',
    reason
  }))

export const reviewTerminalCommands = async (input: {
  ctx: AiRunContext
  taskId: string
  userInput: string
  operations: TerminalReviewCandidate[]
}): Promise<TerminalReviewDecision[]> => {
  if (input.operations.length === 0) return []
  try {
    const prompt = buildTerminalReviewPrompt({
      userRequest: input.userInput,
      platform: input.ctx.platform,
      startDirectory: getTerminalStartDirectory(),
      operations: input.operations
    })
    const response = await input.ctx.chatStructured({
      caller: 'human.terminal_review',
      taskId: input.taskId,
      system: prompt.system,
      user: prompt.user,
      schema: reviewSchema,
      schemaName: 'terminal_review',
      temperature: 0,
      streamingMode: 'force_non_stream',
      retryOutputErrors: false
    })
    const byId = new Map<string, TerminalReviewDecision>()
    for (const operation of response.output.operations) {
      if (
        byId.has(operation.operationId) ||
        !input.operations.some((candidate) => candidate.operationId === operation.operationId)
      ) {
        return humanFallback(input.operations, 'AI 审核结果包含重复或未知操作')
      }
      byId.set(operation.operationId, operation)
    }
    return input.operations.map(
      (candidate) =>
        byId.get(candidate.operationId) || {
          operationId: candidate.operationId,
          decision: 'needs_human_review',
          reason: 'AI 审核未返回此操作的结论'
        }
    )
  } catch (error) {
    if (isCancelledError(error)) throw error
    input.ctx.checkCancelled()
    return humanFallback(input.operations, 'AI 审核不可用')
  }
}

export const buildTerminalReviewAnnotation = (input: {
  reviewId: string
  decisions: TerminalReviewDecision[]
}): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'terminal_review_resolved',
  payload: {
    reviewId: input.reviewId,
    operations: input.decisions
  }
})
