import type { HumanMessage } from '@langchain/core/messages'
import { isSystemMessage } from '@langchain/core/messages'
import type { AiRunContext } from '../types'
import type { HumanRuntimeCache } from './types'
import {
  createWorkspaceInstructionsMessage,
  isWorkspaceInstructionsMessage
} from './node/utils/messageTail'
import { loadWorkspaceInstructions } from './workspaceInstructions'

/**
 * Loads workspace instructions once per run and keeps one synthetic user message
 * immediately after the system prompt. The message is runtime-only: it never
 * enters the transcript, so compaction rebuilds the array without it and this
 * function inserts the cached message again on the next budget pass.
 */
export const ensureWorkspaceInstructionsMessage = async (input: {
  ctx: Pick<AiRunContext, 'workspaceRoots'>
  cache: HumanRuntimeCache
}): Promise<void> => {
  if (!input.cache.workspaceInstructions) {
    let message: HumanMessage | undefined
    try {
      const snapshot = await loadWorkspaceInstructions(input.ctx.workspaceRoots)
      if (snapshot) message = createWorkspaceInstructionsMessage(snapshot.text)
    } catch {
      message = undefined
    }
    input.cache.workspaceInstructions = {
      checked: true,
      ...(message ? { message } : {})
    }
  }

  const message = input.cache.workspaceInstructions.message
  const messages = input.cache.messages
  if (!message || !messages || messages.length === 0) return
  if (messages.some(isWorkspaceInstructionsMessage)) return

  const systemIndex = messages.findIndex(isSystemMessage)
  messages.splice(systemIndex >= 0 ? systemIndex + 1 : 0, 0, message)
}
