import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  docxHeadingNode,
  docxParagraphNode
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxCreateResult, DocxSearchResult } from './testUtils'

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

describe('ai tool docx backend', () => {
  it('docx-create-with-content-direct-applies', async () => {
    const targetFileName = '深度学习与图形学复习总结.docx'
    await runBackendCase({
      caseId: 'docx-create-with-content-direct-applies',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证新文件的 insert_blocks 立即写回源文件，run 结束时生成可回退 apply 记录。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const targetPath = path.join(runtime.workspaceRoot, targetFileName)
        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxApplyRun()
          const created = await harness.invoke<DocxCreateResult>('docx_edit', {
            sourcePath: targetFileName,
            actions: [
              {
                type: 'insert_blocks',

                blocks: [
                  docxHeadingNode(1, '深度学习与图形学复习总结'),
                  docxParagraphNode('过拟合：训练时间过久时容易出现。'),
                  docxParagraphNode('反走样：采样频率不足时会出现锯齿。')
                ]
              }
            ]
          })
          const records = await harness.ctx.applyDocxRunEdits()
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: targetFileName,
            query: '过拟合',
            mode: 'literal'
          })
          const targetExistsAfterApply = await fileExists(targetPath)
          const record = records[0]
          const revert = record
            ? await runtime.docxApplyService.revertRecord({ applyId: record.id })
            : { success: false }

          return {
            created,
            records,
            search,
            targetExistsAfterApply,
            targetExistsAfterRevert: await fileExists(targetPath),
            revert
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.created.createdBlocks.length >= 2 &&
            result.records.length === 1 &&
            result.records[0]?.status === 'applied' &&
            result.records[0]?.operation === 'created' &&
            result.records[0]?.before_exists === false &&
            result.search.matches.length >= 1 &&
            result.targetExistsAfterApply === true,
          {
            name: 'docx-create-directly-applies-target-file',
            message: 'insert_blocks 应立即创建目标 docx，run 收尾生成 created 差异记录。',
            data: {
              created: result.created,
              records: result.records,
              search: result.search.matches
            }
          }
        )

        runtime.assertThat(
          result.revert.success === true && result.targetExistsAfterRevert === false,
          {
            name: 'docx-create-apply-revert-removes-target-file',
            message: 'created apply 回退时应删除 AI 新建文件。',
            data: result.revert
          }
        )
      }
    })
  })
})
