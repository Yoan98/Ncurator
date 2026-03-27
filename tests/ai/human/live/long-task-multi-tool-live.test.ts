import { describe, it } from 'vitest'
import { writeTestDocxFile } from '../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { summarizeHumanSteps } from '../testUtils'
import {
  createRateLimitedLiveChatStructuredOverride,
  createHumanLiveKbFixture,
  DOCX_READ_TOOL_NAMES,
  DOCX_WRITE_TOOL_NAMES,
  filterHumanStepsByStage,
  filterToolCallResultEventsByNames,
  HUMAN_LIVE_STRONG_MODEL,
  KB_TOOL_NAMES
} from './testUtils'

const liveIt = HUMAN_LIVE_STRONG_MODEL ? it : it.skip

describe('ai human live backend', () => {
  liveIt('long-task-multi-tool-live', async () => {
    await runBackendCase({
      caseId: 'long-task-multi-tool-live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      description: '验证真实 AI 调用下 human 会完成多轮 brain/hand 交替，并联动 KB 与 docx 处理长任务。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: HUMAN_LIVE_STRONG_MODEL?.model_name ?? null,
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'long-task-live.docx', [
          {
            type: 'heading',
            text: 'Weekly Review Pack',
            level: 1
          },
          {
            type: 'paragraph',
            text: 'Weekly risk summary: RISK_TODO'
          },
          {
            type: 'paragraph',
            text: 'Owner note: OWNER_TODO'
          }
        ])

        const kbFixture = createHumanLiveKbFixture()
        const runner = createHumanTestRunner(runtime, {
          chatStructuredOverride: HUMAN_LIVE_STRONG_MODEL
            ? createRateLimitedLiveChatStructuredOverride(HUMAN_LIVE_STRONG_MODEL)
            : undefined,
          selectedDocumentIds: kbFixture.selectedDocumentIds,
          documentsStoreOverrides: kbFixture.storeOverrides
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: [
            '请完成一个长任务：',
            '1. 直接从当前已选资料里检索本周风险总结和负责人说明，不要重复列文档。',
            '2. 再打开 `long-task-live.docx`，把 `RISK_TODO` 和 `OWNER_TODO` 分别替换成你从资料里得到的内容。',
            '3. 最后给我一个简短交付说明，不要覆盖保存源文件。',
            '4. 每一轮只做一个明确的工具动作，不要并行批量组合多个读写步骤。',
            '5. 不要编造资料里没有的事实。'
          ].join('\n')
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const brainSteps = filterHumanStepsByStage(result.events, 'human_brain')
        const handSteps = filterHumanStepsByStage(result.events, 'human_hand')
        const kbResults = filterToolCallResultEventsByNames(result.events, KB_TOOL_NAMES)
        const docxReadResults = filterToolCallResultEventsByNames(result.events, DOCX_READ_TOOL_NAMES)
        const docxWriteResults = filterToolCallResultEventsByNames(
          result.events,
          DOCX_WRITE_TOOL_NAMES
        )
        const docxDeliveryResults = filterToolCallResultEventsByNames(
          result.events,
          DOCX_DELIVERY_TOOL_NAMES
        )
        const distinctToolNames = new Set(
          [...kbResults, ...docxReadResults, ...docxWriteResults, ...docxDeliveryResults].map(
            (event) => event.toolName
          )
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            brainSteps.length >= 2 &&
            handSteps.length >= 2 &&
            kbResults.length >= 1 &&
            docxReadResults.some((event) => event.toolName === 'docx_open') &&
            docxWriteResults.some((event) => event.toolName === 'docx_apply_ops'),
          {
            name: 'long-live-case-shows-multi-round-brain-hand-and-multi-tool-chain',
            message: 'long-task-multi-tool-live 应真实出现多轮 brain/hand 交替，并联动 KB 与 docx 多类工具。',
            data: {
              steps: summarizeHumanSteps(result.events),
              distinctToolNames: Array.from(distinctToolNames)
            }
          }
        )

        runtime.assertThat(
          distinctToolNames.size >= 3 &&
            result.output.deliveryMarkdown?.trim().length !== 0,
          {
            name: 'long-live-case-finishes-with-stable-delivery',
            message: 'long-task-multi-tool-live 应在长链路下稳定完成，并产出可消费的最终交付说明。',
            data: {
              toolNames: Array.from(distinctToolNames),
              deliveryMarkdown: result.output.deliveryMarkdown
            }
          }
        )
      }
    })
  }, 300_000)
})
