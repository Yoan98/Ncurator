import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import type { DocxFailureResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-create-existing-path-guard', async () => {
    await runBackendCase({
      caseId: 'docx-create-existing-path-guard',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 docx_edit(create_document) 不会覆盖已有目标路径。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const existingPath = await writeTestDocxFile(runtime.workspaceRoot, 'already-exists.docx', [
          { type: 'paragraph', text: '已有内容。' }
        ])
        const beforeBytes = await fs.readFile(existingPath)
        const harness = createDocxToolHarness(runtime)
        try {
          const failure = await harness.invoke<DocxFailureResult>('docx_edit', {
            sourcePath: 'already-exists.docx',
            actions: [{
              type: 'create_document',
              blocks: [
              {
                type: 'paragraph',
                text: '新内容不应该覆盖旧文件。'
              }
            ]
            }]
          })
          const afterBytes = await fs.readFile(existingPath)

          return {
            failure,
            trackedSourceCount: harness.state.replaySessionBySourcePath.size,
            unchanged: Buffer.compare(beforeBytes, afterBytes) === 0
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.failure.error.length > 0 && result.unchanged === true,
          {
            name: 'docx-create-refuses-existing-path',
            message: 'docx_edit(create_document) 遇到已存在路径时应明确失败，且不覆盖原文件。',
            data: result
          }
        )

        runtime.assertThat(
          result.trackedSourceCount === 0,
          {
            name: 'docx-create-existing-path-does-not-open-session',
            message: '创建失败后不应污染当前 run 的 docx session 状态。',
            data: {
              trackedSourceCount: result.trackedSourceCount
            }
          }
        )
      }
    })
  })
})
