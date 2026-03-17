import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createDocxToolHarness, writeWorkbenchSampleDocx } from '../../../../harness/backend/aiToolHarness'

type DocxOpenResult = {
  ok: boolean
  code: string
  summary: string
  docId: string
}

type DocxApplyOpsResult = {
  ok: boolean
  code: string
  summary: string
  newDocId: string
}

type DocxHistoryResult = {
  ok: boolean
  code: string
  summary: string
  currentDocId: string
  snapshots: Array<{
    docId: string
    parentDocId?: string
    createdAt: number
  }>
}

type DocxRollbackResult = {
  ok: boolean
  code: string
  summary: string
  docId?: string
  previousDocId?: string
  stepsApplied?: number
  error?: string
}

type DocxSearchResult = {
  ok: boolean
  code: string
  summary: string
  matches: Array<{
    blockId: string
    text: string
    offsets: Array<{ start: number; end: number }>
  }>
}

type DocxGetBlockFailure = {
  ok: boolean
  code: string
  summary: string
  error?: string
}

describe('docx history rollback errors', () => {
  it('tracks immutable snapshots, rolls back to parent versions, and rejects invalid inputs', async () => {
    await runBackendCase({
      caseId: 'docx-history-rollback-errors',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['docx'],
      description: '验证 docx capability 的历史链、回滚能力与异常输入处理',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeWorkbenchSampleDocx(runtime.workspaceRoot, 'docx-history-flow.docx')
        const harness = createDocxToolHarness(runtime)

        try {
          const openResult = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: path.relative(runtime.workspaceRoot, sourcePath)
          })
          if (!openResult.ok) {
            throw new Error(openResult.summary)
          }

          const hiResult = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
            docId: openResult.docId,
            ops: [
              {
                type: 'replace_text',
                query: 'Hello',
                replace: 'Hi'
              }
            ]
          })
          if (!hiResult.ok) {
            throw new Error(hiResult.summary)
          }

          const greetingResult = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
            docId: hiResult.newDocId,
            ops: [
              {
                type: 'replace_text',
                query: 'Hi',
                replace: 'Greetings'
              }
            ]
          })
          if (!greetingResult.ok) {
            throw new Error(greetingResult.summary)
          }

          const historyResult = await harness.invoke<DocxHistoryResult>('docx_get_history', {
            docId: greetingResult.newDocId,
            maxDepth: 5
          })
          const rollbackResult = await harness.invoke<DocxRollbackResult>('docx_rollback', {
            docId: greetingResult.newDocId,
            steps: 1
          })
          const greetingSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            query: 'Greetings',
            mode: 'literal'
          })
          const hiSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            query: 'Hi team',
            mode: 'literal'
          })
          const invalidRollback = await harness.invoke<DocxRollbackResult>('docx_rollback', {
            steps: 5
          })
          const missingBlock = await harness.invoke<DocxGetBlockFailure>('docx_get_block', {
            blockId: 'missing-block-id'
          })

          runtime.recordEvent({
            type: 'step',
            name: 'docx-history-and-rollback',
            status: 'ok',
            message: 'docx 快照历史、一步回滚与异常输入路径均已执行',
            data: {
              currentDocId: historyResult.currentDocId,
              snapshotCount: historyResult.snapshots.length,
              rollbackDocId: rollbackResult.docId,
              invalidRollbackCode: invalidRollback.code,
              missingBlockCode: missingBlock.code
            }
          })

          return {
            historyResult,
            rollbackResult,
            greetingSearch,
            hiSearch,
            invalidRollback,
            missingBlock,
            activities: harness.activities,
            aiEvents: runtime.eventCollector.snapshot()
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.historyResult.snapshots.length === 3, {
          name: 'docx-history-depth-three',
          message: 'docx_get_history 返回了原始版本到当前版本的 3 个快照',
          data: {
            snapshotCount: result.historyResult.snapshots.length
          }
        })
        runtime.assertThat(result.rollbackResult.ok && result.rollbackResult.stepsApplied === 1, {
          name: 'docx-rollback-one-step',
          message: 'docx_rollback 已成功回退一步'
        })
        runtime.assertThat(result.greetingSearch.matches.length === 0, {
          name: 'docx-rollback-clears-latest-text',
          message: '回滚后不再命中最新版本中的 Greetings'
        })
        runtime.assertThat(result.hiSearch.matches.length === 1, {
          name: 'docx-rollback-restores-parent-text',
          message: '回滚后重新命中了父版本中的 Hi team'
        })
        runtime.assertThat(result.invalidRollback.ok === false && result.invalidRollback.code === 'invalid_input', {
          name: 'docx-rollback-invalid-depth',
          message: '超过历史深度的 rollback 会返回 invalid_input',
          data: {
            code: result.invalidRollback.code
          }
        })
        runtime.assertThat(result.missingBlock.ok === false && result.missingBlock.code === 'invalid_input', {
          name: 'docx-get-block-invalid-id',
          message: '不存在的 blockId 会返回 invalid_input',
          data: {
            code: result.missingBlock.code
          }
        })

        const rollbackActivityCompleted = result.activities.some(
          (activity) =>
            activity.actionType === 'docx_rollback' && activity.status === 'completed'
        )

        runtime.assertThat(rollbackActivityCompleted, {
          name: 'docx-rollback-activity-emitted',
          message: 'docx_rollback 已产出 completed activity 事件'
        })
      }
    })
  })
})
