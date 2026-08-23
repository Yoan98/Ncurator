import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createHumanTestRunner } from '../../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { SHARED_WORKSPACE_FIXTURE_PATH } from '../../../../harness/backend/aiLiveTestData'
import type { BackendTestRuntime } from '../../../../harness/backend/test-types'
import {
  collectToolErrorMessages,
  filterAiRunEventsByType,
  runWithStructuredOutputRetry
} from '../testUtils'
import type { SelectedReference } from '../../../../../src/shared/types'

const LEGACY_DOC_FIXTURE_PATH =
  `${SHARED_WORKSPACE_FIXTURE_PATH}/风险等级判断标准-图案设计【2026.2.10更新】.doc` as const

const fileHash = async (filePath: string): Promise<string> =>
  createHash('sha256')
    .update(await fs.readFile(filePath))
    .digest('hex')

const buildLegacyDocReference = (
  runtime: BackendTestRuntime
): { absolutePath: string; reference: SelectedReference } => {
  const absolutePath = runtime.getFixtureWorkspacePath(LEGACY_DOC_FIXTURE_PATH)
  const relativePath = path.relative(runtime.workspaceRoot, absolutePath).split(path.sep).join('/')
  return {
    absolutePath,
    reference: {
      kind: 'file',
      workspaceId: 'test-workspace',
      nodeId: 'fixture-legacy-doc-1',
      name: path.basename(absolutePath),
      relativePath,
      absolutePath,
      fileExt: '.doc',
      kbDocumentIds: [],
      kbAvailability: 'not_indexed'
    }
  }
}

describe('ai human live backend', () => {
  it('human-legacy-doc-reading-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-legacy-doc-reading-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证 live 模型通过现有 docx-read 工具读取真实旧版 .doc 文档。',
        fixtures: [LEGACY_DOC_FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const { absolutePath, reference } = buildLegacyDocReference(runtime)
          const beforeHash = await fileHash(absolutePath)
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: [reference],
            runtimeSettingsOverride: {
              llmStreamingMode: 'force_non_stream'
            }
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput:
              '请只根据我选中的旧版 Word 文档回答：风险等级一共分成哪五级，各自对应的区别率是多少？请简洁列出。'
          })

          return {
            output,
            events: runtime.eventCollector.snapshot(),
            beforeHash,
            afterHash: await fileHash(absolutePath)
          }
        },
        assert: async (result, runtime) => {
          const starts = filterAiRunEventsByType(result.events, 'tool_call_started')
          const successfulResults = filterAiRunEventsByType(result.events, 'tool_call_result').filter(
            (event) => event.result?.ok === true
          )
          const startedToolNames = starts.map((event) => event.toolName)
          const successfulReadToolNames = successfulResults.map((event) => event.toolName)
          const sourcePaths = starts
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')

          runtime.assertThat(
            result.output?.status === 'completed' &&
              startedToolNames.some((name) => name.startsWith('docx_read_') || name === 'docx_search') &&
              successfulReadToolNames.some(
                (name) => name.startsWith('docx_read_') || name === 'docx_search'
              ) &&
              sourcePaths.some((sourcePath) => sourcePath.toLowerCase().endsWith('.doc')) &&
              !startedToolNames.includes('docx_edit') &&
              result.beforeHash === result.afterHash,
            {
              name: 'human-live-reads-selected-legacy-doc-with-docx-read-tools',
              message:
                'live human 应通过 docx-read 工具成功读取选中的 .doc，准确回答风险等级，并保持源文件不变。',
              data: {
                startedToolNames,
                successfulReadToolNames,
                sourcePaths,
                sourceUnchanged: result.beforeHash === result.afterHash
              }
            }
          )
        }
      })
    })
  })

  it('human-legacy-doc-edit-skip-live', async () => {
    await runWithStructuredOutputRetry(async () => {
      await runBackendCase({
        caseId: 'human-legacy-doc-edit-skip-live',
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '验证 live 模型尝试编辑旧版 .doc 后遵循工具错误信息，停止重试并保持源文件不变。',
        fixtures: [LEGACY_DOC_FIXTURE_PATH],
        runMode: 'single',
        execute: async (runtime) => {
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const { absolutePath, reference } = buildLegacyDocReference(runtime)
          const beforeHash = await fileHash(absolutePath)
          const runner = createHumanTestRunner(runtime, {
            selectedReferences: [reference],
            runtimeSettingsOverride: {
              llmStreamingMode: 'force_non_stream'
            }
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput:
              '请把我选中的旧版 Word 文档第一行标题改成“图案设计风险等级判断标准”，修改原文件，不要另建文件。'
          })

          return {
            output,
            events: runtime.eventCollector.snapshot(),
            beforeHash,
            afterHash: await fileHash(absolutePath)
          }
        },
        assert: async (result, runtime) => {
          const editStarts = filterAiRunEventsByType(result.events, 'tool_call_started').filter(
            (event) => event.toolName === 'docx_edit'
          )
          const editResults = filterAiRunEventsByType(result.events, 'tool_call_result').filter(
            (event) => event.toolName === 'docx_edit'
          )
          const errors = collectToolErrorMessages(result.events, 'docx_edit')

          const editSucceeded = editResults.some((event) => event.result?.ok === true)
          const rejectedProperly =
            editResults.length > 0 &&
            editResults.every((event) => event.result?.ok === false) &&
            errors.some((error) => error.includes('禁止尝试任何对 .doc 文件的编辑'))

          runtime.assertThat(
            result.output?.status === 'completed' &&
              !editSucceeded &&
              (editResults.length === 0 || rejectedProperly),
            {
              name: 'human-live-docx-does-not-edit-legacy-doc',
              message:
                'live human 不得通过 docx_edit 成功修改 .doc；若尝试用 docx_edit 编辑 .doc，则应收到只读拒绝错误信息。',
              data: {
                editAttemptCount: editStarts.length,
                editSucceeded,
                rejectedProperly,
                errors,
                sourceUnchanged: result.beforeHash === result.afterHash
              }
            }
          )
        }
      })
    })
  })
})
