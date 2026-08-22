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
import { classifyInterruptionReason } from './utils/runFailure'
import { createInitialHumanState } from './human/state/schema'
import type { HumanState } from './human/types'

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
    const userInput = String(payload.input || '')
    let mergedSelectedReferences = payload.selectedReferences
    let mergedWorkspace = payload.workspace
    let initialState: HumanState = createInitialHumanState({
      taskId: payload.runId,
      userInput
    })
    try {
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
      initialState = resumeSnapshot
        ? restoreHumanStateFromResumeSnapshot({
            runId: payload.runId,
            userInput,
            reason: resumeSnapshot.reason,
            snapshot: resumeSnapshot.humanState
          })
        : initialState
      await runAiRuntimePreflight(deps)
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
      const reason = isRecoverableHumanRunError(e) ? e.reason : classifyInterruptionReason(e)
      const humanState =
        isRecoverableHumanRunError(e) && e.lastHumanState ? e.lastHumanState : initialState
      let resumeSnapshotSaved = false
      try {
        const session = await deps.chatStore.getChatSession(payload.sessionId)
        if (session) {
          await saveHumanResumeSnapshot({
            chatStore: deps.chatStore,
            sessionId: payload.sessionId,
            reason,
            runId: payload.runId,
            userInput,
            selectedReferences: mergedSelectedReferences || [],
            workspace: mergedWorkspace,
            humanState,
            errorMessage: e instanceof Error ? e.message : String(e || ''),
            updatedAt: Date.now()
          })
          resumeSnapshotSaved = true
        }
      } catch (snapshotError) {
        console.error('[AI-RUN] failed to save resume snapshot:', snapshotError)
      }
      if (reason === 'user_cancelled' || isCancelledError(e)) {
        return createCancelledAiRunState({
          runId: payload.runId,
          sessionId: payload.sessionId,
          input: payload.input,
          resumeSnapshotSaved
        })
      }
      const failure = toRendererRunFailure(e)
      const message =
        reason === 'runtime_limit' ? '已达到运行上限，可继续对话推进' : failure.message
      return createFailedAiRunState({
        runId: payload.runId,
        sessionId: payload.sessionId,
        input: payload.input,
        error: message,
        failureSource: reason === 'runtime_limit' ? 'internal' : failure.source,
        failureHttpStatus: failure.httpStatus,
        failureProviderCode: failure.providerCode,
        failureCode: reason,
        resumeSnapshotSaved
      })
    }
  }
}
