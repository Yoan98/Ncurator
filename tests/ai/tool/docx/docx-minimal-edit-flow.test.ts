import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxMutationResult,
  type DocxReadResult
} from './testUtils'

const SAMPLE_DOCX_FIXTURE = path.resolve('tests/fixtures/ai/docx/sample-edit.docx')

describe('ai tool docx backend', () => {
  it('docx-minimal-edit-flow', async () => {
    await runBackendCase({
      caseId: 'docx-minimal-edit-flow',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证修改 docx 某一段话的最小工具链能独立跑通。',
      fixtures: [SAMPLE_DOCX_FIXTURE],
      runMode: 'single',
      execute: async (runtime) => {
          const harness = createDocxToolHarness(runtime)
        try {
          const sourcePath = runtime.getFixtureWorkspacePath(SAMPLE_DOCX_FIXTURE)
          const readBefore = await harness.invoke<DocxReadResult>('docx_read', {
            sourcePath,
            query: 'Hello',
          })
          const applied = await harness.invoke<DocxMutationResult>('docx_text_edit', {
            sourcePath,
            query: 'Hello',
            replace: 'Hi'
          })
          const readAfter = await harness.invoke<DocxReadResult>('docx_read', {
            sourcePath: applied.sourcePath,
            query: 'Hi'
          })
          return {
            readBefore,
            applied,
            readAfter
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.readBefore.matches.length === 1 &&
            result.applied.currentVersionRef !== result.readBefore.currentVersionRef &&
            result.applied.changedBlocks.length === 1 &&
            result.applied.changedBlocks[0]?.action === 'replace_text',
          {
            name: 'minimal-edit-flow-produces-single-targeted-change',
            message: '最小编辑流程应生成新的版本，且只命中目标段落对应的 changedBlocks。',
            data: {
              originalVersionRef: result.readBefore.currentVersionRef,
              currentVersionRef: result.applied.currentVersionRef,
              changedBlocks: result.applied.changedBlocks
            }
          }
        )

        runtime.assertThat(
          result.readAfter.matches.length === 1 &&
            result.readAfter.matches[0]?.bodyIndex === result.readBefore.matches[0]?.bodyIndex &&
            result.applied.warnings.length === 0,
          {
            name: 'minimal-edit-flow-remains-readable-after-edit',
            message: '修改后应能继续被 search 消费，并暴露稳定的结构位置事实。',
            data: {
              searchAfter: result.readAfter.matches,
              warnings: result.applied.warnings
            }
          }
        )
      }
    })
  })
})
