import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxHistoryResult,
  type DocxSearchResult,
  type DocxRollbackResult,
  type DocxMutationResult
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-history-and-rollback', async () => {
    await runBackendCase({
      caseId: 'docx-history-and-rollback',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证版本历史查询与按 versionRef 回滚。',
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
          const initialSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'history-rollback.docx',
            query: 'Version one.'
          })
          const firstEdit = await harness.invoke<DocxMutationResult>('docx_text_edit', {
            sourcePath: initialSearch.sourcePath,
            query: 'Version one.',
            replace: 'Version two.'
          })
          const secondEdit = await harness.invoke<DocxMutationResult>('docx_text_edit', {
            sourcePath: firstEdit.sourcePath,
            query: 'Keep this line.',
            replace: 'Keep this line, updated.'
          })
          const history = await harness.invoke<DocxHistoryResult>('docx_history', {
            sourcePath: secondEdit.sourcePath,
            limit: 10
          })
          const rollbackByVersion = await harness.invoke<DocxRollbackResult>('docx_rollback', {
            sourcePath: secondEdit.sourcePath,
            versionRef: firstEdit.currentVersionRef
          })
          const searchAfterRollback = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: rollbackByVersion.sourcePath,
            query: 'Keep this line, updated.'
          })
          const rollbackToInitial = await harness.invoke<DocxRollbackResult>('docx_rollback', {
            sourcePath: rollbackByVersion.sourcePath,
            versionRef: initialSearch.currentVersionRef
          })
          const sourceBufferAfter = await fs.readFile(sourcePath)

          return {
            initialSearch,
            firstEdit,
            secondEdit,
            history,
            rollbackByVersion,
            searchAfterRollback,
            rollbackToInitial,
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
            result.history.versions[2]?.versionRef === result.initialSearch.currentVersionRef,
          {
            name: 'snapshot-history-tracks-current-and-ancestors',
            message: 'docx_history 应能追溯到多轮编辑形成的祖先版本链。',
            data: result.history.versions
          }
        )

        runtime.assertThat(
          result.rollbackByVersion.currentVersionRef === result.firstEdit.currentVersionRef &&
            result.searchAfterRollback.matches.length === 0 &&
            result.rollbackToInitial.currentVersionRef === result.initialSearch.currentVersionRef,
          {
            name: 'rollback-restores-target-ancestor-without-breaking-structure',
            message: '按 versionRef 回滚后，应回到目标祖先版本且结构保持有效。',
            data: {
              rollbackByVersion: result.rollbackByVersion,
              rollbackToInitial: result.rollbackToInitial,
              searchAfterRollback: result.searchAfterRollback.matches
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
