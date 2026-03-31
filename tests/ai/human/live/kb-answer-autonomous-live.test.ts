import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterAiRunEventsByType, summarizeHumanSteps } from '../testUtils'
import {
  collectToolResultPreviewText,
  createRateLimitedLiveChatStructuredOverride,
  createHumanLiveKbFixture,
  createHumanLiveKbSelectedReferences,
  filterHumanStepsByStage,
  filterToolCallResultEventsByNames,
  HUMAN_LIVE_PRIMARY_MODEL,
  KB_TOOL_NAMES
} from './testUtils'

const liveIt = HUMAN_LIVE_PRIMARY_MODEL ? it : it.skip

describe('ai human live backend', () => {
  liveIt('kb-answer-autonomous-live', async () => {
    await runBackendCase({
      caseId: 'kb-answer-autonomous-live',
      domain: 'ai',
      suite: 'human',
      groups: ['live'],
      description: '验证真实 AI 调用下 human 会基于当前已选 KB 资料完成单任务问答。',
      fixtures: [],
      runMode: 'single',
      runtimeModelName: HUMAN_LIVE_PRIMARY_MODEL?.model_name ?? null,
      execute: async (runtime) => {
        const kbFixture = createHumanLiveKbFixture()
        const selectedReferences = createHumanLiveKbSelectedReferences(runtime.workspaceRoot)
        await fs.mkdir(path.join(runtime.workspaceRoot, 'kb'), { recursive: true })
        await Promise.all([
          fs.writeFile(
            path.join(runtime.workspaceRoot, 'kb', 'Risk Playbook.md'),
            'Weekly risk summary should stay marked as pending follow-up until compliance signs off.',
            'utf8'
          ),
          fs.writeFile(
            path.join(runtime.workspaceRoot, 'kb', 'Owner Notes.md'),
            'Owner note should mention that Compliance leads the final review window.',
            'utf8'
          )
        ])
        const runner = createHumanTestRunner(runtime, {
          liveModelConfig: HUMAN_LIVE_PRIMARY_MODEL || undefined,
          chatStructuredOverride: HUMAN_LIVE_PRIMARY_MODEL
            ? createRateLimitedLiveChatStructuredOverride(HUMAN_LIVE_PRIMARY_MODEL)
            : undefined,
          selectedDocumentIds: kbFixture.selectedDocumentIds,
          selectedReferences,
          documentsStoreOverrides: kbFixture.storeOverrides
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: [
            '请仅基于当前已选本地资料回答：本周风险总结是什么？',
            '不要编造未在资料里出现的事实。'
          ].join('\n')
        })

        return {
          output,
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const brainSteps = filterHumanStepsByStage(result.events, 'human_brain')
        const kbToolResults = filterToolCallResultEventsByNames(result.events, KB_TOOL_NAMES)
        const deliveryEvents = filterAiRunEventsByType(result.events, 'task_delivery_ready')
        const kbPreviewText = collectToolResultPreviewText(result.events, KB_TOOL_NAMES)

        runtime.assertThat(
          result.output.status === 'completed' &&
            brainSteps.length >= 1 &&
            kbToolResults.length >= 1 &&
            deliveryEvents.length === 1,
          {
            name: 'kb-live-case-finishes-after-real-kb-tooling',
            message: 'kb-answer-autonomous-live 应至少出现 brain 与一次真实 KB 工具调用，并最终完成交付。',
            data: {
              steps: summarizeHumanSteps(result.events),
              kbToolNames: kbToolResults.map((event) => event.toolName),
              deliveryCount: deliveryEvents.length
            }
          }
        )

        runtime.assertThat(
          result.output.deliveryMarkdown?.trim().length !== 0 &&
            kbPreviewText.includes('Risk Playbook.md') &&
            !kbPreviewText.includes('Out of Scope Notes.md'),
          {
            name: 'kb-live-case-consumes-scoped-local-materials',
            message: 'kb-answer-autonomous-live 应消费当前已选本地资料结果，且不能越出已选资料范围。',
            data: {
              deliveryMarkdown: result.output.deliveryMarkdown,
              kbPreviewText
            }
          }
        )
      }
    })
  }, 300_000)
})
