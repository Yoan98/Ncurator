import { tool } from '@langchain/core/tools'
import type { JsonObject } from '../../../../../../shared/types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolFamilyDefinition } from '../types'
import { buildLoadedHistoryContext, filterRoundHistory } from '../../memory/roundHistory'
import { HISTORY_RECALL_TOOL_SPEC } from './toolSpecs'

export const internalToolFamily: ToolFamilyDefinition = {
  familyId: 'internal',
  buildTools: ({ ctx, cache, runId, taskId }) => {
    const toolEvents = createToolEventEmitter({
      ctx,
      runId,
      taskId,
      stage: 'human_hand'
    })

    return [
      tool(
        async (args) =>
          await withToolLifecycle({
            emitter: toolEvents,
            toolName: HISTORY_RECALL_TOOL_SPEC.name,
            args: args as JsonObject,
            execute: async (session) => {
              ctx.checkCancelled()
              const state = cache.currentState
              if (!state) {
                throw new Error('human state is required for history recall')
              }

              const rounds = filterRoundHistory({
                roundHistory: state.memory.history.roundHistory,
                filters: args
              })
              const payload = {
                ok: true,
                code: 'ok' as const,
                ...buildLoadedHistoryContext({
                  filters: args,
                  rounds
                })
              }

              session.succeed(
                rounds.map((round) => ({
                  roundId: round.roundId,
                  executionKind: round.execution.kind,
                  decision: round.decision.decision.summary,
                  result:
                    round.execution.kind === 'mouth'
                      ? round.execution.summary
                      : round.execution.kind === 'pre_execution_blocked'
                        ? round.execution.watchHint.code
                        : round.execution.kind === 'learning'
                          ? round.execution.learningOutcome.loadedSkillIds.join(', ')
                          : round.execution.toolResults.map((item) => item.toolName).join(', ')
                })),
                undefined,
                {
                  toolName: HISTORY_RECALL_TOOL_SPEC.name,
                  ok: true,
                  code: 'ok',
                  data: payload
                }
              )

              return payload
            },
            onError: (error, session) => {
              session.fail(
                [],
                error.message,
                undefined,
                {
                  toolName: HISTORY_RECALL_TOOL_SPEC.name,
                  ok: false,
                  code: 'failed',
                  data: {
                    ok: false,
                    code: 'failed',
                    error: error.message,
                    rounds: []
                  }
                }
              )
            }
          }),
        {
          name: HISTORY_RECALL_TOOL_SPEC.name,
          description: HISTORY_RECALL_TOOL_SPEC.promptSpec.purpose,
          schema: HISTORY_RECALL_TOOL_SPEC.schema
        }
      )
    ]
  }
}
