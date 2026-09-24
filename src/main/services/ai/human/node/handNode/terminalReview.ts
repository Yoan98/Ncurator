import { z } from 'zod/v4'
import type { ChatMessageLogEntry } from '../../../../../../shared/types'
import { isLlmOutputError } from '../../../errors'
import type { AiRunContext } from '../../../types'
import { isCancelledError } from '../../../utils/runFailure'
import {
  buildTerminalReviewPrompt,
  type TerminalReviewPromptCommand
} from '../../prompts/terminalReview'
import { getTerminalStartDirectory } from '../../tools/terminal/workingDirectory'

export type TerminalReviewCandidate = TerminalReviewPromptCommand

export type TerminalReviewDecision = {
  commandId: string
  decision: 'auto_approve' | 'needs_human_review'
}

export type TerminalReviewResult = {
  decisions: TerminalReviewDecision[]
}

const MAX_OUTPUT_RETRIES = 3

const reviewSchema = z
  .object({
    decisions: z.array(
      z
        .object({
          commandId: z.string().min(1),
          decision: z.enum(['auto_approve', 'needs_human_review'])
        })
        .strict()
    )
  })
  .strict()

const humanFallback = (commands: readonly TerminalReviewCandidate[]): TerminalReviewResult => ({
  decisions: commands.map((command) => ({
    commandId: command.commandId,
    decision: 'needs_human_review'
  }))
})

const matchDecisions = (
  commands: readonly TerminalReviewCandidate[],
  decisions: readonly TerminalReviewDecision[]
): TerminalReviewDecision[] | undefined => {
  const commandIds = new Set(commands.map((command) => command.commandId))
  if (commandIds.size !== commands.length || decisions.length !== commandIds.size) return undefined

  const byId = new Map<string, TerminalReviewDecision>()
  for (const decision of decisions) {
    if (!commandIds.has(decision.commandId) || byId.has(decision.commandId)) return undefined
    byId.set(decision.commandId, decision)
  }
  if (byId.size !== commandIds.size) return undefined
  const ordered: TerminalReviewDecision[] = []
  for (const command of commands) {
    const decision = byId.get(command.commandId)
    if (!decision) return undefined
    ordered.push(decision)
  }
  return ordered
}

export const reviewTerminalCommands = async (input: {
  ctx: AiRunContext
  taskId: string
  userInput: string
  commands: TerminalReviewCandidate[]
}): Promise<TerminalReviewResult> => {
  if (input.commands.length === 0) return { decisions: [] }

  for (let retryIndex = 0; retryIndex <= MAX_OUTPUT_RETRIES; retryIndex += 1) {
    const prompt = buildTerminalReviewPrompt({
      userRequest: input.userInput,
      platform: input.ctx.platform,
      workingDirectory: getTerminalStartDirectory(),
      commands: input.commands,
      retryHint: retryIndex > 0
    })
    try {
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
      const decisions = matchDecisions(input.commands, response.output.decisions)
      if (decisions) return { decisions }
    } catch (error) {
      if (isCancelledError(error)) throw error
      input.ctx.checkCancelled()
      if (!isLlmOutputError(error)) {
        return humanFallback(input.commands)
      }
    }
  }

  return humanFallback(input.commands)
}

export const buildTerminalReviewAnnotation = (input: {
  reviewId: string
  result: TerminalReviewResult
}): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'terminal_review_resolved',
  payload: {
    reviewId: input.reviewId,
    decisions: input.result.decisions
  }
})
