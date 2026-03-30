import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { summarizeHumanSteps } from '../testUtils'
import {
  areAllPathsAccessible,
  createRateLimitedLiveChatStructuredOverride,
  DOCX_DELIVERY_TOOL_NAMES,
  DOCX_READ_TOOL_NAMES,
  DOCX_WRITE_TOOL_NAMES,
  filterToolCallResultEventsByNames,
  HUMAN_LIVE_PRIMARY_MODEL,
  isDocxPreviewArtifact
} from './testUtils'

const liveIt = HUMAN_LIVE_PRIMARY_MODEL ? it : it.skip

describe('ai human live backend', () => {
  liveIt(
    'docx-edit-autonomous-live',
    async () => {
      await runBackendCase({
        caseId: 'docx-edit-autonomous-live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '验证真实 AI 调用下 human 会自主读取、定位、修改 docx，并产出 preview 交付。',
        fixtures: [],
        runMode: 'single',
        runtimeModelName: HUMAN_LIVE_PRIMARY_MODEL?.model_name ?? null,
        execute: async (runtime) => {
          await writeTestDocxFile(runtime.workspaceRoot, 'docx-edit-live.docx', [
            {
              type: 'heading',
              text: 'Weekly Review',
              level: 1
            },
            {
              type: 'paragraph',
              text: 'Status: TODO'
            },
            {
              type: 'paragraph',
              text: 'Note: keep appendix untouched.'
            }
          ])

          const runner = createHumanTestRunner(
            runtime,
            {
              chatStructuredOverride: HUMAN_LIVE_PRIMARY_MODEL
                ? createRateLimitedLiveChatStructuredOverride(HUMAN_LIVE_PRIMARY_MODEL)
                : undefined
            },
            {
              hardActionLimit: 4
            }
          )

          const output = await runner.run({
            taskId: runtime.taskId,
            userInput: [
              '请修改当前工作区里的 `docx-edit-live.docx`。',
              '把包含 `TODO` 的那一段改成 `Status: Approved after review.`。',
              '完成后生成 html preview，再给我交付说明。',
              '不要覆盖保存到其他磁盘文件。'
            ].join('\n')
          })

          const previewArtifacts = (output.artifacts || []).filter(isDocxPreviewArtifact)
          const previewPaths = previewArtifacts.map((artifact) => artifact.path)

          return {
            output,
            events: runtime.eventCollector.snapshot(),
            previewArtifactCount: previewArtifacts.length,
            previewPathsExist: await areAllPathsAccessible(previewPaths)
          }
        },
        assert: async (result, runtime) => {
          const readResults = filterToolCallResultEventsByNames(result.events, DOCX_READ_TOOL_NAMES)
          const writeResults = filterToolCallResultEventsByNames(
            result.events,
            DOCX_WRITE_TOOL_NAMES
          )
          const deliveryResults = filterToolCallResultEventsByNames(
            result.events,
            DOCX_DELIVERY_TOOL_NAMES
          )

          runtime.assertThat(
            result.output.status === 'completed' &&
              readResults.some((event) => event.toolName === 'docx_open') &&
              writeResults.some((event) => event.toolName === 'docx_apply_ops') &&
              deliveryResults.some((event) => event.toolName === 'docx_render_preview'),
            {
              name: 'docx-live-case-covers-read-locate-write-and-preview',
              message:
                'docx-edit-autonomous-live 应真实出现 docx 读取、基于目标内容的写入，以及 preview 交付工具调用。',
              data: {
                steps: summarizeHumanSteps(result.events),
                toolNames: [
                  ...readResults.map((event) => event.toolName),
                  ...writeResults.map((event) => event.toolName),
                  ...deliveryResults.map((event) => event.toolName)
                ]
              }
            }
          )

          runtime.assertThat(
            result.previewArtifactCount >= 1 &&
              result.previewPathsExist &&
              result.output.deliveryMarkdown?.trim().length !== 0,
            {
              name: 'docx-live-case-produces-reviewable-preview-artifact',
              message: 'docx-edit-autonomous-live 应产出可回看的 preview artifact 或稳定交付说明。',
              data: {
                artifacts: result.output.artifacts,
                deliveryMarkdown: result.output.deliveryMarkdown
              }
            }
          )
        }
      })
    },
    300_000
  )
})
