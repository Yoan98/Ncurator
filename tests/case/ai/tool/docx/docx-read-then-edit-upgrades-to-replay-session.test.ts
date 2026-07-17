import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type {
  DocxMutationResult,
  DocxOutlineResult,
  DocxSearchResult
} from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-read-then-edit-upgrades-to-replay-session', async () => {
    await runBackendCase({
      caseId: 'docx-read-then-edit-upgrades-to-replay-session',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证纯读后首次编辑会升级到 replay session，并继续沿用同一路径的 docx 会话。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'upgrade-edit.docx', [
          { type: 'paragraph', text: '原始段落。' },
          { type: 'paragraph', text: '需要替换的内容。' }
        ])
        const harness = createDocxToolHarness(runtime)
        try {
          const outline = await harness.invoke<DocxOutlineResult>('docx_read_outline', {
            sourcePath: 'upgrade-edit.docx'
          })
          const mutation = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: 'upgrade-edit.docx',
            actions: [{
              type: 'replace_text',
              query: '需要替换的内容。',
              replace: '已经改写后的内容。',
              blockIds: [outline.blocks[1]!.blockId]
            }]
          })
          const search = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: 'upgrade-edit.docx',
            query: '已经改写后的内容',
            mode: 'literal'
          })
          return {
            mutation,
            search,
            readSessionCount: harness.state.readSessionBySourcePath.size,
            replaySessionCount: harness.state.replaySessionBySourcePath.size
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.mutation.currentRevisionRef === 'v2' &&
            result.search.currentRevisionRef === 'v2' &&
            result.search.returnedMatchCount >= 1 &&
            result.readSessionCount === 0 &&
            result.replaySessionCount === 1,
          {
            name: 'docx-first-edit-upgrades-to-replay-session',
            message: '首次编辑应从 read session 升级到 replay session，释放旧 read session，并让后续读取看到最新内容。',
            data: result
          }
        )
      }
    })
  })
})
