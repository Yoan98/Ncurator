import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { validateDocxBuffer } from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/validator'
import { createDocxToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { type DocxMutationResult, type DocxSearchResult } from './testUtils'

const FIXTURE = path.resolve('tests/fixtures/workspace/灵感活动设计 需求.docx')

describe('ai tool docx backend', () => {
  it('docx-dangling-image-relationship-contract', async () => {
    await runBackendCase({
      caseId: 'docx-dangling-image-relationship-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证带 NULL 图片残留关系的真实 DOCX 只暴露可读取图片且仍可编辑。',
      fixtures: [FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = runtime.getFixtureWorkspacePath(FIXTURE)
        const harness = createDocxToolHarness(runtime)
        try {
          const beforeProblems = await validateDocxBuffer(await fs.readFile(sourcePath))
          const outline = await harness.invoke<{
            blocks: Array<{ visuals?: { count: number } }>
          }>('docx_read_outline', {
            sourcePath,
            ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: Number.MAX_SAFE_INTEGER }]
          })
          const edited = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath,
            actions: [
              {
                type: 'replace_text',
                query: '灵感活动设计系统需求',
                replace: '灵感活动设计系统需求（已验证可编辑）'
              }
            ]
          })
          const updated = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath,
            query: '已验证可编辑'
          })
          const afterProblems = await validateDocxBuffer(await fs.readFile(sourcePath))
          return {
            beforeProblems,
            visualCount: outline.blocks.reduce((total, block) => total + (block.visuals?.count || 0), 0),
            edited,
            updated,
            afterProblems
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.beforeProblems.length === 1 &&
            result.beforeProblems[0]?.message === 'missing relationship target: NULL' &&
            result.visualCount === 8 &&
            result.edited.changedBlocks.length === 1 &&
            result.updated.matches.length === 1 &&
            result.afterProblems.length === 1 &&
            result.afterProblems[0]?.message === 'missing relationship target: NULL',
          {
            name: 'dangling-image-is-hidden-and-does-not-block-editing',
            message: 'NULL 图片残留不应计入图片数量，也不应阻止正常文本编辑。',
            data: result
          }
        )
      }
    })
  })
})
