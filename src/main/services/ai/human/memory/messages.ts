import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { HumanRoundRecord } from '../types'
import { buildToolResultMessageContent } from '../shared/historyRenderers'

const toToolCall = (input: {
  id: string
  name: string
  args: Record<string, unknown>
}): { id: string; name: string; args: Record<string, unknown>; type: 'tool_call' } => ({
  id: input.id,
  name: input.name,
  args: input.args,
  type: 'tool_call'
})

export const deriveMessagesFromRounds = (rounds: HumanRoundRecord[]): BaseMessage[] => {
  const messages: BaseMessage[] = []

  for (const round of rounds) {
    const content = round.thought.text

    if (round.nextAction.action === 'hand') {
      const calls = round.nextAction.calls
      const toolResults = round.execution.kind === 'hand' ? round.execution.toolResults : []
      messages.push(
        new AIMessage({
          content,
          tool_calls: calls.map((call, index) =>
            toToolCall({
              id: call.toolCallId || `call-${round.roundId}-${index}`,
              name: call.toolName,
              args: call.args
            })
          )
        })
      )
      toolResults.forEach((result, index) => {
        messages.push(
          new ToolMessage({
            content: buildToolResultMessageContent(result),
            tool_call_id: calls[index]?.toolCallId || `call-${round.roundId}-${index}`
          })
        )
      })
      continue
    }

    if (round.nextAction.action === 'learning') {
      const resultText = round.execution.kind === 'learning' ? round.execution.result : ''
      const toolCallId = round.nextAction.toolCallId || `learn-${round.roundId}`
      messages.push(
        new AIMessage({
          content,
          tool_calls: [
            toToolCall({
              id: toolCallId,
              name: 'learn_skill',
              args: { skillIds: round.nextAction.wantLearnSkillIds }
            })
          ]
        })
      )
      messages.push(
        new ToolMessage({
          content: resultText,
          tool_call_id: toolCallId
        })
      )
      continue
    }

    messages.push(new AIMessage({ content }))
  }

  return messages
}
