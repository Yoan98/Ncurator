import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

describe('ai human mock-llm text backend', () => {
  it('human-text-file-read-write', async () => {
    await runBackendCase({
      caseId: 'human-text-file-read-write',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description: '验证 human 通过真实 graph 读取、修改并复读普通文本。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'notes.md')
        const filePath = sourcePath
        await fs.writeFile(filePath, '# Status\n\nOwner: TBD\n', 'utf8')
        const runner = await createAiServiceTestRunner(runtime, {
          userInput: '把 notes.md 的负责人从 TBD 更新为 Alice，并确认内容。',
          llmScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['text-file'],
                  summary: '学习文本读写能力'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'text_file_read',
                  args: { sourcePath },
                  summary: '读取原文'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'text_file_edit',
                  args: {
                    sourcePath,
                    action: 'edit',
                    edits: [{ oldText: 'Owner: TBD', newText: 'Owner: Alice' }]
                  },
                  summary: '更新负责人'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'text_file_read',
                  args: { sourcePath },
                  summary: '复读确认'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '文本已更新。',
                  deliveryMarkdown: '负责人已更新为 Alice。'
                })
              }
            ]
          }
        })
        const output = await runner.run()
        return {
          output,
          events: runtime.eventCollector.snapshot(),
          content: await fs.readFile(filePath, 'utf8')
        }
      },
      assert: async (result, runtime) => {
        const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
        const fileArtifacts = filterAiRunEventsByType(result.events, 'file_artifact')
        runtime.assertThat(
          result.output.status === 'completed' &&
            starts.filter((event) => event.toolName === 'text_file_read').length === 2 &&
            starts.some((event) => event.toolName === 'text_file_edit') &&
            result.content.includes('Owner: Alice') &&
            !result.content.includes('Owner: TBD') &&
            fileArtifacts.some((event) => event.capability === 'text_file'),
          {
            name: 'human-text-production-chain',
            message: 'human 应真实完成文本读取、修改、复读和文件交付。',
            data: { starts, content: result.content, fileArtifacts }
          }
        )
      }
    })
  })
})
