import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import type { DocxCreateResult } from './testUtils'

describe('ai tool docx backend', () => {
  it('docx-create-target-appears-before-apply-becomes-update', async () => {
    await runBackendCase({
      caseId: 'docx-create-target-appears-before-apply-becomes-update',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 create-target replay 后目标被外部创建时，apply 按 updated 备份并覆盖，回退恢复外部文件。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const targetFileName = 'net-additions-only.docx'
        const targetPath = path.join(runtime.workspaceRoot, targetFileName)
        const harness = createDocxToolHarness(runtime)
        try {
          harness.ctx.beginDocxApplyRun()
          const created = await harness.invoke<DocxCreateResult>('docx_edit', {
            sourcePath: targetFileName,
            actions: [{
              type: 'create_document',
              blocks: [
                { type: 'heading', level: 1, text: 'AI Final Report' },
                { type: 'paragraph', text: 'AI final paragraph.' }
              ]
            }]
          })

          await writeTestDocxFile(runtime.workspaceRoot, targetFileName, [
            { type: 'paragraph', text: 'User-created file before AI apply.' }
          ])
          const userCreatedBytes = await fs.readFile(targetPath)
          const records = await harness.ctx.applyDocxRunEdits()
          const appliedBytes = await fs.readFile(targetPath)
          const record = records[0]
          const revert = record
            ? await runtime.docxApplyService.revertRecord({ applyId: record.id })
            : { success: false }
          const revertedBytes = await fs.readFile(targetPath)

          return {
            created,
            records,
            appliedChanged: Buffer.compare(userCreatedBytes, appliedBytes) !== 0,
            revertedMatchesUserCreated: Buffer.compare(userCreatedBytes, revertedBytes) === 0,
            revert
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.created.currentRevisionRef === 'v2' &&
            result.records.length === 1 &&
            result.records[0]?.operation === 'updated' &&
            result.records[0]?.before_exists === true &&
            Boolean(result.records[0]?.before_snapshot_path) &&
            result.appliedChanged === true,
          {
            name: 'create-target-appears-before-apply-becomes-update',
            message: '目标文件在写回前出现时，应按 updated checkpoint 处理并覆盖当前磁盘文件。',
            data: result.records
          }
        )

        runtime.assertThat(
          result.revert.success === true && result.revertedMatchesUserCreated === true,
          {
            name: 'create-target-appears-before-apply-reverts-checkpoint',
            message: '回退应恢复写回前用户创建的目标文件。',
            data: result.revert
          }
        )
      }
    })
  })
})
