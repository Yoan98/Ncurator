import { createHumanGraphRunner } from './human/graph/humanGraph'
import { toRendererRunFailure } from './errors'
import { createAiRunContext } from './runtime'
import { runAiRuntimePreflight } from './runtimePreflight'
import {
  createCancelledAiRunState,
  createCompletedAiRunState,
  createFailedAiRunState
} from './run/state'
import type { AiRunDeps, AiRunStartPayload, AiRunState } from './types'
import {
  resolveResumeSelectedReferences,
  resolveResumeWorkspace,
  restoreHumanStateFromResumeSnapshot,
  saveHumanResumeSnapshot
} from './utils/resumeSnapshot'
import { isCancelledError, isRecoverableHumanRunError } from './utils/runFailure'

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
    let mergedSelectedReferences = payload.selectedReferences
    let mergedWorkspace = payload.workspace
    try {
      await runAiRuntimePreflight(deps)
      const resumeSnapshot = await deps.chatStore.getSessionResumeSnapshot(payload.sessionId)
      mergedSelectedReferences = resolveResumeSelectedReferences({
        payloadSelectedReferences: payload.selectedReferences,
        snapshotSelectedReferences: resumeSnapshot?.selectedReferences
      })
      mergedWorkspace = resolveResumeWorkspace({
        payloadWorkspace: payload.workspace,
        snapshotWorkspace: resumeSnapshot?.workspace
      })
      const effectivePayload: AiRunStartPayload = {
        ...payload,
        selectedReferences: mergedSelectedReferences,
        workspace: mergedWorkspace
      }
      const initialState = resumeSnapshot
        ? restoreHumanStateFromResumeSnapshot({
            runId: payload.runId,
            userInput: String(payload.input || ''),
            reason: resumeSnapshot.reason,
            snapshot: resumeSnapshot.humanState
          })
        : undefined
      const ctx = createAiRunContext(effectivePayload, deps)
      const runHumanTask = createHumanGraphRunner({ ctx })
      const output = await runHumanTask(
        {
          taskId: payload.runId,
          userInput: String(payload.input || '')
        },
        {
          emitAnswerEvents: true,
          initialState
        }
      )
      await deps.chatStore.clearSessionResumeSnapshot(payload.sessionId)
      return createCompletedAiRunState({
        runId: payload.runId,
        sessionId: payload.sessionId,
        input: String(payload.input || ''),
        finalDeliveryMarkdown: output.deliveryMarkdown,
        finalArtifacts: output.artifacts || []
      })
    } catch (e) {
      if (isRecoverableHumanRunError(e) && e.lastHumanState) {
        const failure = toRendererRunFailure(e)
        await saveHumanResumeSnapshot({
          chatStore: deps.chatStore,
          sessionId: payload.sessionId,
          reason: e.reason,
          runId: payload.runId,
          userInput: String(payload.input || ''),
          selectedReferences: mergedSelectedReferences || [],
          workspace: mergedWorkspace,
          humanState: e.lastHumanState,
          errorMessage: e.message,
          updatedAt: Date.now()
        })
        if (e.reason === 'user_cancelled') {
          return createCancelledAiRunState({
            runId: payload.runId,
            sessionId: payload.sessionId,
            input: payload.input,
            resumeSnapshotSaved: true
          })
        }
        return createFailedAiRunState({
          runId: payload.runId,
          sessionId: payload.sessionId,
          input: payload.input,
          error: failure.message,
          failureSource: failure.source,
          failureHttpStatus: failure.httpStatus,
          failureProviderCode: failure.providerCode,
          failureCode: e.reason,
          resumeSnapshotSaved: true
        })
      }
      if (isCancelledError(e)) {
        return createCancelledAiRunState({
          runId: payload.runId,
          sessionId: payload.sessionId,
          input: payload.input,
          resumeSnapshotSaved: Boolean(
            await deps.chatStore.getSessionResumeSnapshot(payload.sessionId)
          )
        })
      }
      await deps.chatStore.clearSessionResumeSnapshot(payload.sessionId)
      console.error('[AI-RUN] unexpected failure:', e)
      const failure = toRendererRunFailure(e)
      return createFailedAiRunState({
        runId: payload.runId,
        sessionId: payload.sessionId,
        input: payload.input,
        error: failure.message,
        failureSource: failure.source,
        failureHttpStatus: failure.httpStatus,
        failureProviderCode: failure.providerCode,
        failureCode: 'error',
        resumeSnapshotSaved: false
      })
    }
  }
}
