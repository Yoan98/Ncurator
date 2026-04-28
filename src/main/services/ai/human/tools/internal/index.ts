import { tool } from '@langchain/core/tools'
import type { JsonObject } from '../../../../../../shared/types'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolFamilyDefinition } from '../types'
import { buildLoadedHistoryContext, filterRoundHistory } from '../../memory/roundHistory'
import { renderToolResultDataText } from '../../shared/toolResultRenderers'
import { HISTORY_LIST_TOOL_SPEC, HISTORY_SEARCH_TOOL_SPEC } from './toolSpecs'

const buildSearchHits = (rounds: ReturnType<typeof filterRoundHistory>, query: string) => {
  const lowered = query.toLowerCase()
  return rounds.map((round) => {
    const summary = round.decision.decision.summary
    const resultSummary =
      round.execution.kind === 'hand'
        ? round.execution.toolResults
            .map((item) =>
              [item.summary, renderToolResultDataText(item), item.diagnosticText]
                .filter(Boolean)
                .join('\n')
            )
            .join('\n')
        : round.execution.kind === 'mouth'
          ? round.execution.summary
          : round.execution.kind === 'learning'
            ? round.execution.learningOutcome.loadedSkillIds.join(', ')
            : round.execution.watchHint.code
    const matchedText = [summary, resultSummary]
      .find((item) => item.toLowerCase().includes(lowered))
      || summary
    return {
      roundId: round.roundId,
      stage: round.execution.kind,
      summary,
      matchedText
    }
  })
}

export const internalToolFamily: ToolFamilyDefinition = {
  familyId: 'internal',
  buildTools: ({ ctx, cache, runId, taskId }) => {
    const toolEvents = createToolEventEmitter({
      ctx,
      runId,
      taskId,
      stage: 'human_hand'
    })

    const historySearchTool = tool(
      async (args) =>
        await withToolLifecycle({
          emitter: toolEvents,
          toolName: HISTORY_SEARCH_TOOL_SPEC.name,
          args: args as JsonObject,
          execute: async (session) => {
            ctx.checkCancelled()
            const state = cache.currentState
            if (!state) {
              throw new Error('human state is required for history search')
            }

            const rounds = filterRoundHistory({
              roundHistory: state.memory.history.roundHistory,
              filters: args
            })
            const payload = {
              ok: true,
              code: 'ok' as const,
              hits: buildSearchHits(rounds, String(args.query)),
              ...buildLoadedHistoryContext({
                filters: args,
                rounds
              })
            }

            session.succeed(
              payload.hits,
              undefined,
              {
                toolName: HISTORY_SEARCH_TOOL_SPEC.name,
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
                toolName: HISTORY_SEARCH_TOOL_SPEC.name,
                ok: false,
                code: 'failed',
                data: {
                  ok: false,
                  code: 'failed',
                  error: error.message,
                  hits: []
                }
              }
            )
          }
        }),
      {
        name: HISTORY_SEARCH_TOOL_SPEC.name,
        description: HISTORY_SEARCH_TOOL_SPEC.promptSpec.description,
        schema: HISTORY_SEARCH_TOOL_SPEC.schema
      }
    )

    const historyListTool = tool(
      async (args) =>
        await withToolLifecycle({
          emitter: toolEvents,
          toolName: HISTORY_LIST_TOOL_SPEC.name,
          args: args as JsonObject,
          execute: async (session) => {
            ctx.checkCancelled()
            const state = cache.currentState
            if (!state) {
              throw new Error('human state is required for history list')
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
                decision: round.decision.decision.summary
              })),
              undefined,
              {
                toolName: HISTORY_LIST_TOOL_SPEC.name,
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
                toolName: HISTORY_LIST_TOOL_SPEC.name,
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
        name: HISTORY_LIST_TOOL_SPEC.name,
        description: HISTORY_LIST_TOOL_SPEC.promptSpec.description,
        schema: HISTORY_LIST_TOOL_SPEC.schema
      }
    )

    return [historySearchTool, historyListTool]
  }
}
