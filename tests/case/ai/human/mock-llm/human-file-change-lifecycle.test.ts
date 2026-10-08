import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TextFileDiffArtifact } from '../../../../../src/shared/types'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { buildCompleteTaskDecision, buildToolDecision } from '../testUtils'

const edit = (sourcePath: string, oldText: string, newText: string) =>
  buildToolDecision({
    toolName: 'text_file_edit',
    args: { sourcePath, action: 'edit', edits: [{ oldText, newText }] },
    summary: '保存文本'
  })

describe('owner run file review lifecycle', () => {
  it('human-file-change-finalization', async () => {
    await runBackendCase({
      caseId: 'human-file-change-finalization',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      harnessMode: 'mock-llm',
      fixtures: [],
      runMode: 'single',
      description: '生产 owner run 在 yield/续接和模型失败后统一收尾已保存文件。',
      execute: async (runtime) => {
        const source = path.join(runtime.workspaceRoot, 'continued.txt')
        await fs.writeFile(source, 'A\nprotected\n')
        const owner = `${runtime.runId}-owner`
        let queued = false
        const first = await createAiServiceTestRunner(runtime, {
          runId: owner,
          userInput: '修改文本后处理追加消息',
          hasPendingUserMessages: () => queued,
          observeEvent: (event) => {
            if (event.type === 'tool_call_result' && event.toolName === 'text_file_edit')
              queued = true
          },
          llmScript: { 'human.brain': [{ output: edit(source, 'A', 'B') }] }
        })
        expect((await first.run()).status).toBe('continued')
        expect(await fs.readFile(source, 'utf8')).toBe('B\nprotected\n')
        const pending = await runtime.docxApplyService.fileChanges.sessions.read(
          first.payload.partnerId,
          owner,
          source
        )
        expect(pending?.workingPath).toBeTruthy()
        expect(pending?.record.previewPath).toBeUndefined()
        expect(first.events.some((event) => event.type === 'file_artifact')).toBe(false)

        const second = await createAiServiceTestRunner(runtime, {
          runId: `${owner}-continuation`,
          ownerRunId: owner,
          userInput: '把 B 继续改为 B2',
          llmScript: {
            'human.brain': [
              { output: edit(source, 'B', 'B2') },
              { output: buildCompleteTaskDecision({ summary: '完成' }) }
            ]
          }
        })
        expect((await second.run()).status).toBe('completed')
        const records = (await runtime.storageService.aiFileChange.listRecords({ runId: owner }))
          .items
        expect(records).toHaveLength(1)
        const review = JSON.parse(
          await fs.readFile(records[0].previewPath!, 'utf8')
        ) as TextFileDiffArtifact
        expect(review.lines.some((line) => line.type === 'remove' && line.text === 'A')).toBe(true)
        expect(review.lines.some((line) => line.type === 'add' && line.text === 'B2')).toBe(true)
        expect(review.lines.some((line) => line.text === 'B')).toBe(false)
        await expect(fs.access(pending!.workingPath!)).rejects.toThrow()

        const failedSource = path.join(runtime.workspaceRoot, 'failed.txt')
        await fs.writeFile(failedSource, 'A')
        const failed = await createAiServiceTestRunner(runtime, {
          runId: `${runtime.runId}-failed`,
          userInput: '保存后模型发生错误',
          llmScript: {
            'human.brain': [
              { output: edit(failedSource, 'A', 'B') },
              ...Array.from({ length: 5 }, () => ({ error: '401 invalid API key' }))
            ]
          }
        })
        expect((await failed.run()).status).toBe('failed')
        expect(await fs.readFile(failedSource, 'utf8')).toBe('B')
        const [failedRecord] = (
          await runtime.storageService.aiFileChange.listRecords({ runId: failed.payload.runId })
        ).items
        expect(failedRecord.status).toBe('applied')
        const failedReview = JSON.parse(
          await fs.readFile(failedRecord.previewPath!, 'utf8')
        ) as TextFileDiffArtifact
        expect(failedReview.lines.some((line) => line.type === 'add' && line.text === 'B')).toBe(
          true
        )
        expect(
          await runtime.docxApplyService.fileChanges.sessions.read(
            failed.payload.partnerId,
            failed.payload.runId,
            failedSource
          )
        ).toBeUndefined()
        runtime.assertThat(true, {
          name: 'owner-finalization-boundaries',
          message: 'yield、续接、完成和失败均遵循固定 A/B 与真正主 run 收尾'
        })
        return { owner, records: records.map((record) => record.id), failedRecord: failedRecord.id }
      },
      assert: async () => undefined
    })
  })
})
