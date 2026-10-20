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

// 原件来源：https://js.msa.gov.cn/art/2025/4/14/art_11434_1552287.html
const LEGACY_DOC_FIXTURE_PATH =
  `${SHARED_WORKSPACE_FIXTURE_PATH}/长江干线（江苏段）大型船舶通航安全风险分级管控办法（初稿）.doc` as const

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
            streamingModeOverride: 'force_non_stream'
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: '请只根据我选中的旧版 Word 文档，读出标题和正文开头二十个字，简洁列出即可。'
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
          const successfulResults = filterAiRunEventsByType(
            result.events,
            'tool_call_result'
          ).filter((event) => event.result?.ok === true)
          const startedToolNames = starts.map((event) => event.toolName)
          const successfulReadToolNames = successfulResults.map((event) => event.toolName)
          const sourcePaths = starts
            .map((event) => event.input.sourcePath)
            .filter((value): value is string => typeof value === 'string')

          runtime.assertThat(
            result.output?.status === 'completed' &&
              startedToolNames.some(
                (name) => name.startsWith('docx_read_') || name === 'docx_search'
              ) &&
              successfulReadToolNames.some(
                (name) => name.startsWith('docx_read_') || name === 'docx_search'
              ) &&
              sourcePaths.some((sourcePath) => sourcePath.toLowerCase().endsWith('.doc')) &&
              !startedToolNames.some((name) =>
                [
                  'docx_content_edit',
                  'docx_format',
                  'docx_table_edit',
                  'docx_comments_revisions'
                ].includes(name)
              ) &&
              result.beforeHash === result.afterHash,
            {
              name: 'human-live-reads-selected-legacy-doc-with-docx-read-tools',
              message:
                'live human 应通过 docx-read 工具成功读取选中的公开 .doc，回答标题与开篇文字，并保持源文件不变。',
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
            streamingModeOverride: 'force_non_stream'
          })
          const output = await runner.run({
            taskId: runtime.taskId,
            userInput:
              '请把我选中的旧版 Word 文档第一行标题改成“公开样例阅读说明”，修改原文件，不要另建文件。如果工具不支持编辑旧版 .doc，就说明只读限制并结束，不要尝试转换格式，也不用询问其他方案。'
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
            (event) => event.toolName === 'docx_content_edit'
          )
          const editResults = filterAiRunEventsByType(result.events, 'tool_call_result').filter(
            (event) => event.toolName === 'docx_content_edit'
          )
          const errors = collectToolErrorMessages(result.events, 'docx_content_edit')

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
                'live human 不得通过 DOCX 写工具成功修改 .doc；若尝试编辑 .doc，则应收到只读拒绝错误信息。',
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
