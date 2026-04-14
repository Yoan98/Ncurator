import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxApplyOpsResult,
  type DocxHistoryResult,
  type DocxOpenResult,
  type DocxRollbackResult,
  type DocxSearchResult
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-history-and-rollback', async () => {
    await runBackendCase({
      caseId: 'docx-history-and-rollback',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证快照历史查询与多轮继续编辑后的按步数/目标回滚。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'history-rollback.docx')
        await writeTestDocxFile(runtime.workspaceRoot, 'history-rollback.docx', [
          {
            type: 'paragraph',
            text: 'Version one.'
          },
          {
            type: 'paragraph',
            text: 'Keep this line.'
          }
        ])

        const sourceBufferBefore = await fs.readFile(sourcePath)
        const harness = createDocxToolHarness(runtime)
        try {
          const opened = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: 'history-rollback.docx'
          })
          const firstEdit = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
            sourcePath: opened.sourcePath,
            ops: [
              {
                type: 'replace_text',
                query: 'Version one.',
                replace: 'Version two.'
              }
            ]
          })
          const secondEdit = await harness.invoke<DocxApplyOpsResult>('docx_apply_ops', {
            sourcePath: firstEdit.sourcePath,
            ops: [
              {
                type: 'replace_text',
                query: 'Keep this line.',
                replace: 'Keep this line, updated.'
              }
            ]
          })
          const history = await harness.invoke<DocxHistoryResult>('docx_get_history', {
            sourcePath: secondEdit.sourcePath,
            maxDepth: 10
          })
          const rollbackBySteps = await harness.invoke<DocxRollbackResult>('docx_rollback', {
            sourcePath: secondEdit.sourcePath,
            steps: 1
          })
          const searchAfterStepRollback = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: rollbackBySteps.sourcePath,
            query: 'Keep this line, updated.',
            mode: 'literal'
          })
          const rollbackByTarget = await harness.invoke<DocxRollbackResult>('docx_rollback', {
            sourcePath: rollbackBySteps.sourcePath,
            targetVersionRef: opened.currentVersionRef
          })
          const sourceBufferAfter = await fs.readFile(sourcePath)

          return {
            opened,
            firstEdit,
            secondEdit,
            history,
            rollbackBySteps,
            searchAfterStepRollback,
            rollbackByTarget,
            sourceBufferBefore,
            sourceBufferAfter
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.history.versions.length === 3 &&
            result.history.versions[0]?.versionRef === result.secondEdit.currentVersionRef &&
            result.history.versions[1]?.versionRef === result.firstEdit.currentVersionRef &&
            result.history.versions[2]?.versionRef === result.opened.currentVersionRef,
          {
            name: 'snapshot-history-tracks-current-and-ancestors',
            message: 'docx_get_history 应能追溯到多轮编辑形成的祖先版本链。',
            data: result.history.versions
          }
        )

        runtime.assertThat(
          result.rollbackBySteps.currentVersionRef === result.firstEdit.currentVersionRef &&
            result.searchAfterStepRollback.matches.length === 0 &&
            result.rollbackByTarget.currentVersionRef === result.opened.currentVersionRef,
          {
            name: 'rollback-restores-target-ancestor-without-breaking-structure',
            message: '按 steps 与按 targetVersionRef 回滚后，应回到目标祖先版本且结构保持有效。',
            data: {
              rollbackBySteps: result.rollbackBySteps,
              rollbackByTarget: result.rollbackByTarget,
              searchAfterStepRollback: result.searchAfterStepRollback.matches
            }
          }
        )

        runtime.assertThat(result.sourceBufferBefore.equals(result.sourceBufferAfter), {
          name: 'rollback-does-not-touch-source-file-on-disk',
          message: '回滚只应影响 run 内草稿快照，不应改写磁盘源文件。',
          data: {
            sourcePath: path.join(runtime.workspaceRoot, 'history-rollback.docx')
          }
        })
      }
    })
  })
})
