import path from 'node:path'
import { test } from 'vitest'
import { createDocxToolRuntime } from '../../../../../src/main/services/ai/human/tools/docx/runtime'
import { callExpectedWorkerAction } from '../../../../../src/main/services/ai/human/tools/docx/tools/workerTool'
import type { DocxWorkerResponse } from '../../../../../src/main/services/ai/human/tools/docx/worker/types'
import type { AiRunEvent, AiTaskResultCode, JsonObject } from '../../../../../src/shared/types'
import {
  createDocxToolHarness,
  writeWorkbenchSampleDocx
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type DocxOpenResult = {
  ok: boolean
  code: AiTaskResultCode
  docId: string
}

type DocxFailureResult = {
  ok: boolean
  code: AiTaskResultCode
  error?: string
}

type DocxOutlineResult = {
  ok: boolean
  code: AiTaskResultCode
  blocks: Array<{ blockId: string; type: string; text: string }>
}

type DocxSearchResult = {
  ok: boolean
  code: AiTaskResultCode
  matches: Array<{ blockId: string; text: string }>
}

type DocxApplyOpsResult = {
  ok: boolean
  code: AiTaskResultCode
  newDocId: string
  changedBlocks: Array<{ blockId: string }>
}

type DocxHistoryResult = {
  ok: boolean
  code: AiTaskResultCode
  currentDocId: string
  snapshots: Array<{ docId: string }>
}

type DocxRollbackResult = {
  ok: boolean
  code: AiTaskResultCode
  docId: string
  previousDocId: string
}

type DocxPreviewResult = {
  ok: boolean
  code: AiTaskResultCode
  previewPath: string
  format: 'html' | 'png' | 'pdf'
}

type DocxValidateResult = {
  ok: boolean
  code: AiTaskResultCode
  problems: Array<{ code: string; message: string }>
}

type DocxSaveResult = {
  ok: boolean
  code: AiTaskResultCode
  outPath: string
}

type DocxWorkerMismatchResult = {
  ok: boolean
  code?: AiTaskResultCode
  error?: string
}

const isEventType = <TType extends AiRunEvent['type']>(
  event: AiRunEvent,
  type: TType
): event is Extract<AiRunEvent, { type: TType }> => event.type === type

test('docx-runtime-behavior', async () => {
  await runBackendCase({
    caseId: 'docx-runtime-behavior',
    caseType: 'basic',
    domain: 'ai',
    layer: 'backend',
    suite: 'tools',
    groups: ['docx'],
    description: 'docx tools preserve lastDocId flow, snapshot history, semantic search, preview, validate, and save behavior after the split.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const harness = createDocxToolHarness(runtime, {
        approvalPolicy: 'deny-medium-high'
      })

      try {
        const missingDocIdResult = await harness.invoke<DocxFailureResult>('docx_outline', {})
        const sourcePath = await writeWorkbenchSampleDocx(runtime.workspaceRoot, 'docs/sample.docx')
        const workerMismatchCtx = runtime.createAiRunContext()
        const workerMismatchRuntime = createDocxToolRuntime({
          ctx: {
            runId: workerMismatchCtx.runId,
            checkCancelled: workerMismatchCtx.checkCancelled,
            sendEvent: workerMismatchCtx.sendEvent,
            requestApproval: workerMismatchCtx.requestApproval,
            trackDocxOpen: workerMismatchCtx.trackDocxOpen,
            trackDocxChanges: workerMismatchCtx.trackDocxChanges,
            trackDocxPreview: workerMismatchCtx.trackDocxPreview,
            embeddingService: workerMismatchCtx.embeddingService
          },
          runId: runtime.runId,
          taskId: runtime.taskId,
          workspaceRootPath: runtime.workspaceRoot,
          safePreviewChars: 1400,
          emitActivity: () => undefined
        })
        workerMismatchRuntime.callWorker = async () =>
          ({
            requestId: 'docx-worker-mismatch',
            ok: true,
            payload: {
              action: 'validate',
              problems: []
            }
          }) satisfies DocxWorkerResponse
        const workerMismatchResult = (await callExpectedWorkerAction({
          runtime: workerMismatchRuntime,
          toolName: 'docx_outline',
          toolCallId: 'docx-worker-mismatch',
          request: {
            action: 'open',
            payload: {
              sourcePath
            }
          },
          expectedAction: 'outline'
        })) as DocxWorkerMismatchResult
        const openResult = await harness.invoke<DocxOpenResult>('docx_open', {
          sourcePath
        })
        const outlineResult = await harness.invoke<DocxOutlineResult>('docx_outline', {})
        const getBlockResult = await harness.invoke<JsonObject>('docx_get_block', {
          blockId: outlineResult.blocks[0]?.blockId || ''
        })
        const semanticSearchResult = await harness.invoke<DocxSearchResult>('docx_search', {
          query: 'on track',
          mode: 'semantic'
        })
        const applyOpsResult = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
          ops: [
            {
              type: 'replace_text',
              query: 'on track',
              replace: 'delayed',
              replaceAll: true
            }
          ]
        })
        const historyResult = await harness.invoke<DocxHistoryResult>('docx_get_history', {})
        const rollbackResult = await harness.invoke<DocxRollbackResult>('docx_rollback', {
          steps: 1
        })
        const previewResult = await harness.invoke<DocxPreviewResult>('docx_render_preview', {
          format: 'html'
        })
        const validateResult = await harness.invoke<DocxValidateResult>('docx_validate', {})
        const saveResult = await harness.invoke<DocxSaveResult>('docx_save', {
          docId: applyOpsResult.newDocId,
          outPath: 'output.docx'
        })
        const overwriteDeniedResult = await harness.invoke<DocxFailureResult>('docx_save', {
          docId: applyOpsResult.newDocId,
          outPath: sourcePath,
          overwrite: true
        })

        return {
          missingDocIdResult,
          workerMismatchResult,
          sourcePath,
          openResult,
          outlineResult,
          getBlockResult,
          semanticSearchResult,
          applyOpsResult,
          historyResult,
          rollbackResult,
          previewResult,
          validateResult,
          saveResult,
          overwriteDeniedResult,
          activities: harness.activities,
          events: runtime.eventCollector.snapshot()
        }
      } finally {
        await harness.release()
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.openResult.ok && result.openResult.docId.length > 0, {
        name: 'docx-open',
        message: 'docx_open should return a tracked docId',
        data: result.openResult
      })

      runtime.assertThat(
        result.missingDocIdResult.code === 'invalid_input' &&
          result.missingDocIdResult.error ===
            'docId is required before docx_outline; open a document first',
        {
          name: 'docx-missing-docid',
          message:
            'docx tools that rely on implicit lastDocId should still fail with the centralized runtime docId error before open',
          data: result.missingDocIdResult
        }
      )

      runtime.assertThat(
        result.workerMismatchResult.ok === false &&
          result.workerMismatchResult.code === 'failed' &&
          result.workerMismatchResult.error === 'worker protocol mismatch (outline)',
        {
          name: 'docx-worker-mismatch',
          message:
            'worker action mismatches should still be normalized through the shared runtime failure handling',
          data: result.workerMismatchResult
        }
      )

      runtime.assertThat(result.outlineResult.blocks.length > 0, {
        name: 'docx-outline',
        message: 'docx_outline should resolve blocks using the implicit lastDocId',
        data: result.outlineResult
      })

      runtime.assertThat(String(result.getBlockResult.block?.blockId || '').length > 0, {
        name: 'docx-get-block',
        message: 'docx_get_block should resolve a block using the implicit lastDocId',
        data: result.getBlockResult
      })

      runtime.assertThat(result.semanticSearchResult.matches.length > 0, {
        name: 'docx-semantic-search',
        message: 'docx_search in semantic mode should return ranked matches from the cached semantic index',
        data: result.semanticSearchResult
      })

      runtime.assertThat(
        result.applyOpsResult.ok &&
          result.applyOpsResult.newDocId !== result.openResult.docId &&
          result.applyOpsResult.changedBlocks.length > 0,
        {
          name: 'docx-apply-ops',
          message: 'docx_apply_ops should create a new immutable snapshot and report changed blocks',
          data: result.applyOpsResult
        }
      )

      runtime.assertThat(
        result.historyResult.currentDocId === result.applyOpsResult.newDocId &&
          result.historyResult.snapshots.length >= 2,
        {
          name: 'docx-history',
          message: 'docx_get_history should default to the latest snapshot and include lineage entries',
          data: result.historyResult
        }
      )

      runtime.assertThat(
        result.rollbackResult.docId === result.openResult.docId &&
          result.rollbackResult.previousDocId === result.applyOpsResult.newDocId,
        {
          name: 'docx-rollback',
          message: 'docx_rollback should restore the parent snapshot when using implicit lastDocId',
          data: result.rollbackResult
        }
      )

      runtime.assertThat(
        result.previewResult.ok &&
          result.previewResult.format === 'html' &&
          result.previewResult.previewPath.endsWith('.docx'),
        {
          name: 'docx-preview',
          message: 'docx_render_preview should create the preview artifact for the current snapshot',
          data: result.previewResult
        }
      )

      runtime.assertThat(result.validateResult.problems.length === 0, {
        name: 'docx-validate',
        message: 'docx_validate should succeed for the generated regression document',
        data: result.validateResult
      })

      runtime.assertThat(
        result.saveResult.ok &&
          result.saveResult.outPath === path.join(path.dirname(result.sourcePath), 'output.docx'),
        {
          name: 'docx-save',
          message: 'docx_save should write to a workspace-bound path relative to the source document directory',
          data: result.saveResult
        }
      )

      runtime.assertThat(result.overwriteDeniedResult.code === 'approval_denied', {
        name: 'docx-save-overwrite-denied',
        message: 'docx_save should still require approval before overwriting an existing workspace file',
        data: result.overwriteDeniedResult
      })

      const artifactEvents = result.events.filter((event) => isEventType(event, 'file_artifact'))
      runtime.assertThat(artifactEvents.length === 2, {
        name: 'docx-artifact-events',
        message: 'docx preview and save should both emit file_artifact events',
        data: artifactEvents
      })

      runtime.assertThat(
        result.activities.some((activity) => activity.actionType === 'docx_open' && activity.status === 'completed') &&
          result.activities.some(
            (activity) => activity.actionType === 'docx_apply_ops' && activity.status === 'completed'
          ),
        {
          name: 'docx-activities',
          message: 'docx read/write flow should keep emitting activity events after the file split',
          data: result.activities
        }
      )
    }
  })
})
