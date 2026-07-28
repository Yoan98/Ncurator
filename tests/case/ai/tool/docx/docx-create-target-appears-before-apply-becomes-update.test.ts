import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxCreateResult, DocxFailureResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-immediate-create-and-external-change-invalidates-session', async () => {
    await runBackendCase({
      caseId: 'docx-immediate-create-and-external-change-invalidates-session',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description:
        '验证新文件的 insert_blocks 立即落盘，外部覆盖后旧文档 session 会失效并要求重新读取。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const targetFileName = 'net-additions-only.docx'
        const targetPath = path.join(runtime.workspaceRoot, targetFileName)
        const harness = createDocxToolHarness(runtime)
        try {
          const created = await harness.invoke<DocxCreateResult>('docx_edit', {
            sourcePath: targetFileName,
            actions: [
              {
                type: 'insert_blocks',
                position: 'after',
                blocks: [
                  { type: 'heading', level: 1, text: 'AI Final Report' },
                  { type: 'paragraph', text: 'AI final paragraph.' }
                ]
              }
            ]
          })
          const existsAfterCreate = await fs
            .access(targetPath)
            .then(() => true)
            .catch(() => false)

          await writeTestDocxFile(runtime.workspaceRoot, targetFileName, [
            { type: 'paragraph', text: 'External replacement.' }
          ])
          const staleRead = await harness.invoke<DocxFailureResult>('docx_search', {
            sourcePath: targetFileName,
            query: 'External replacement.'
          })
          return { created, existsAfterCreate, staleRead }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.existsAfterCreate &&
            result.created.createdBlocks.length >= 2 &&
            result.staleRead.error.includes('changed outside the active docx session'),
          {
            name: 'docx-create-is-immediate-and-external-change-is-rejected',
            message: 'insert_blocks 应立即落盘；文件被外部覆盖后，旧 session 必须失效。',
            data: result
          }
        )
      }
    })
  })
})
