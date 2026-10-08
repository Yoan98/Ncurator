import { appendFileChangeArtifactsAndEmitEvents } from './utils/artifacts'
import { SubagentBlockedError } from './run/toolPolicy'
import { createSubagentDispatcher } from './run/subagents'
import { releaseRunFiles } from './run/fileLease'
import { releaseDocxRunSession } from './human/tools/docx/worker/docxWorkerClient'
import { releasePdfRunSession } from '../pdf/worker/pdfWorkerClient'
import { terminalSessionManager } from './human/tools/terminal/TerminalSessionManager'
import { createHumanGraphRunner } from './human/graph/humanGraph'
import { createAiRunContext } from './runtime'
import { runAiRuntimePreflight } from './runtimePreflight'
import {
  createCancelledAiRunState,
  createCompletedAiRunState,
  createContinuedAiRunState,
  createFailedAiRunState
} from './run/state'
import type { AiRunDeps, AiRunStartPayload, AiRunState } from './types'
import { classifyThrownErrorToAiRunFailure, isCancelledError } from './utils/runFailure'
import { resolveAiRunFailurePresentation } from './runFailureCatalog'

export class AiRunService {
  private static instance: AiRunService

  private constructor() {}

  public static getInstance(): AiRunService {
    if (!AiRunService.instance) {
      AiRunService.instance = new AiRunService()
    }
    return AiRunService.instance
  }

  public async run(payload: AiRunStartPayload, deps: AiRunDeps): Promise<AiRunState> {
    const finalizeFiles = async (allowContinuation = false) => {
      if (payload.parentToolCallId) return []
      if (
        allowContinuation &&
        !deps.prepareFileChangeFinalization &&
        deps.hasPendingUserMessages?.()
      )
        return []
      if (
        deps.prepareFileChangeFinalization &&
        !(await deps.prepareFileChangeFinalization(allowContinuation))
      )
        return []
      try {
        const records = await deps.docxApplyService.fileChanges.sessions.finalize(
          payload.partnerId,
          payload.ownerRunId || payload.runId
        )
        return appendFileChangeArtifactsAndEmitEvents({
          records,
          runId: payload.runId,
          taskId: payload.runId,
          sendEvent: deps.sendEvent
        })
      } catch (error) {
        // Preserve the execution outcome; durable inputs remain available for recovery.
        console.error('[FILE-REVIEW-FINALIZE]', {
          ownerRunId: payload.ownerRunId || payload.runId,
          error
        })
        const records = (
          await deps.docxApplyService.fileChanges
            .listRecords({ runId: payload.ownerRunId || payload.runId })
            .catch(() => ({ items: [] }))
        ).items
        return appendFileChangeArtifactsAndEmitEvents({
          records,
          runId: payload.runId,
          taskId: payload.runId,
          sendEvent: deps.sendEvent
        })
      }
    }
    try {
      await runAiRuntimePreflight(deps)
      const ctx = createAiRunContext(payload, {
        ...deps,
        delegateToSubagent: (tasks, toolCallId) => dispatch(tasks, toolCallId)
      })
      const dispatch = createSubagentDispatcher(
        payload,
        deps,
        ctx.getLlmConfig,
        (childPayload, childDeps) => this.run(childPayload, childDeps)
      )
      const runHumanTask = createHumanGraphRunner({ ctx })
      const output = await runHumanTask(
        {
          taskId: payload.runId,
          userInput: String(payload.input || '')
        },
        {
          emitAnswerEvents: true
        }
      )
      if (output.status === 'yielded') {
        return createContinuedAiRunState({
          runId: payload.runId,
          partnerId: payload.partnerId,
          input: String(payload.input || ''),
          finalArtifacts: output.artifacts || []
        })
      }
      await deps.waitForPendingUserMessageSubmissions?.()
      const fileArtifacts = await finalizeFiles(true)
      return createCompletedAiRunState({
        runId: payload.runId,
        partnerId: payload.partnerId,
        input: String(payload.input || ''),
        finalDeliveryMarkdown: output.deliveryMarkdown,
        finalArtifacts:
          payload.parentToolCallId || deps.hasPendingUserMessages?.()
            ? output.artifacts || []
            : [
                ...(output.artifacts || []).filter((artifact) => !artifact.applyId),
                ...fileArtifacts
              ]
      })
    } catch (e) {
      await finalizeFiles()
      if (payload.parentToolCallId && e instanceof SubagentBlockedError)
        return {
          ...createFailedAiRunState({
            runId: payload.runId,
            partnerId: payload.partnerId,
            input: payload.input,
            error: e.message,
            failureSource: 'internal'
          }),
          needsParent: true
        }
      if (isCancelledError(e)) {
        return createCancelledAiRunState({
          runId: payload.runId,
          partnerId: payload.partnerId,
          input: payload.input
        })
      }
      const failure = classifyThrownErrorToAiRunFailure(e)
      if (failure.failureCode === 'user_cancelled') {
        return createCancelledAiRunState({
          runId: payload.runId,
          partnerId: payload.partnerId,
          input: payload.input
        })
      }
      const presentation = resolveAiRunFailurePresentation(failure.failureCode, failure.rawMessage)
      const failureSource = presentation.source === 'user' ? 'internal' : presentation.source
      deps.sendEvent({
        type: 'run_failed',
        runId: payload.runId,
        source: failureSource,
        message: presentation.message,
        rawMessage: presentation.rawMessage,
        httpStatus: failure.httpStatus,
        providerCode: failure.providerCode,
        code: failure.failureCode
      })
      return createFailedAiRunState({
        runId: payload.runId,
        partnerId: payload.partnerId,
        input: payload.input,
        error: presentation.message,
        failureRawMessage: presentation.rawMessage,
        failureSource,
        failureHttpStatus: failure.httpStatus,
        failureProviderCode: failure.providerCode,
        failureCode: failure.failureCode
      })
    } finally {
      await Promise.allSettled([
        deps.releaseRun
          ? deps.releaseRun(payload.runId)
          : Promise.all([
              releaseDocxRunSession(payload.runId),
              releasePdfRunSession(payload.runId),
              deps.browserUseService?.releaseRun?.(payload.runId)
            ]),
        ...(payload.parentToolCallId
          ? [terminalSessionManager.closeByChatSession(payload.runId)]
          : [])
      ])
      releaseRunFiles(payload.runId)
    }
  }
}
