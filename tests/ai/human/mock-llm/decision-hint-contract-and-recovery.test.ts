import path from 'node:path'
import { describe, it } from 'vitest'
import { createDocxToolHarness } from '../../../harness/backend/aiToolHarness'
import { createHumanTestRunner } from '../../../harness/backend/humanHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  buildCompleteTaskDecision,
  buildLearnSkillsDecision,
  buildToolDecision,
  filterAiRunEventsByType
} from '../testUtils'

const SHARED_WORKSPACE_FIXTURE_PATH = 'tests/fixtures/workspace'
const POSITIONED_DOCX_FIXTURE_PATH = 'tests/fixtures/workspace/学习笔记/图形学.docx'
const LARGE_DOCX_FIXTURE_PATH = 'tests/fixtures/workspace/交互式探究学习案例：产业转移.docx'

type DocxOutlineBlockPreview = {
  blockId: string
  type: 'paragraph' | 'table' | 'table_cell'
  layoutMode?: 'normal' | 'positioned'
  text: string
}

type DocxOutlineResultPreview = {
  ok: boolean
  code: 'ok'
  sourcePath: string
  blocks: DocxOutlineBlockPreview[]
}

describe('ai human mock-llm backend', () => {
  it('decision-hint-contract-and-recovery', async () => {
    await runBackendCase({
      caseId: 'decision-hint-contract-and-recovery',
      harnessMode: 'mock-llm',
      domain: 'ai',
      suite: 'human',
      groups: ['mock-llm'],
      description:
        '验证 decision_hint 的关键来源分支会在真实 graph 中产出稳定 contract，并在收到 hint 后继续恢复推进。',
      fixtures: [SHARED_WORKSPACE_FIXTURE_PATH],
      runMode: 'single',
      execute: async (runtime) => {
        const positionedSourcePath = runtime.getFixtureWorkspacePath(POSITIONED_DOCX_FIXTURE_PATH)
        const largeSourcePath = runtime.getFixtureWorkspacePath(LARGE_DOCX_FIXTURE_PATH)
        const docxHarness = createDocxToolHarness(runtime)
        const positionedOutline = await docxHarness.invoke<DocxOutlineResultPreview>('docx_outline', {
          sourcePath: positionedSourcePath,
          ranges: [{ type: 'block_index', fromBlockIndex: 0, toBlockIndex: 80 }]
        })
        await docxHarness.release()

        const positionedParagraphBlockId =
          positionedOutline?.blocks.find(
            (block) => block.type === 'paragraph' && block.layoutMode === 'positioned'
          )?.blockId || 'b:0'

        const runner = createHumanTestRunner(runtime, {
          humanRuntimeOverrides: {
            hardActionLimit: 3,
            modelContextWindowTokens: 60_000
          },
          structuredOutputScript: {
            'human.brain': [
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read'],
                  summary: '第一次学习 docx-read'
                })
              },
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-read'],
                  summary: '重复学习 docx-read，触发 learning_no_effect'
                })
              },
              {
                output: {
                  thought: {
                    next: '先故意给一个错误的 hand plan，触发 brain_output_schema_invalid'
                  },
                  nextAction: {
                    action: 'hand',
                    calls: [
                      {
                        toolName: 'docx_create',
                        args: 'invalid'
                      }
                    ]
                  }
                }
              },
              {
                output: buildLearnSkillsDecision({
                  skillIds: ['docx-write'],
                  summary: '补齐 docx-write，准备测试写保护与大小限制'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'docx_paragraph_edit',
                  args: {
                    sourcePath: positionedSourcePath,
                    action: 'insert_after',
                    anchorBlockId: positionedParagraphBlockId,
                    paragraphs: ['这段内容不应被自动插入。']
                  },
                  summary: '命中 positioned block，触发 hand_docx_positioned_write_blocked'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'docx_outline',
                  args: {
                    sourcePath: largeSourcePath,
                    ranges: [{ type: 'percent', fromPercent: 0, toPercent: 100 }]
                  },
                  summary: '读取超大 docx，触发 hand_tool_result_too_large'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: 'pwd'
                  },
                  summary: '第一轮只读命令，作为 hardActionLimit 的已执行动作'
                })
              },
              {
                output: buildToolDecision({
                  toolName: 'terminal_run',
                  args: {
                    command: 'ls'
                  },
                  summary: '第二轮只读命令，触发 hand_tool_limit_exceeded'
                })
              },
              {
                output: buildCompleteTaskDecision({
                  summary: '收到全部关键 decision_hint 后，直接进入最终交付。'
                })
              }
            ],
            'human.mouth': [
              {
                output: {
                  summary: 'decision_hint 专项链路已验证。',
                  deliveryMarkdown:
                    '# Decision Hint Contract\n\n已验证关键 decision_hint 来源分支能够产出稳定 contract，并在回退后继续完成任务。'
                }
              }
            ]
          }
        })

        const output = await runner.run({
          taskId: runtime.taskId,
          userInput: '请触发关键 decision_hint 分支，并在每次回退后继续推进直到完成。'
        })

        return {
          output,
          events: runtime.eventCollector.snapshot(),
          positionedParagraphBlockId,
          largeSourcePath: path.relative(runtime.workspaceRoot, largeSourcePath)
        }
      },
      assert: async (result, runtime) => {
        const decisionHints = filterAiRunEventsByType(result.events, 'decision_hint')
        const toolResults = filterAiRunEventsByType(result.events, 'tool_call_result')
        const humanSteps = filterAiRunEventsByType(result.events, 'human_step')

        const hasLearningNoEffect = decisionHints.some(
          (event) =>
            event.source === 'learning' &&
            event.code === 'learning_no_effect' &&
            Array.isArray(event.detail?.duplicateSkillIds) &&
            event.detail.duplicateSkillIds.includes('docx-read')
        )
        const hasBrainSchemaInvalid = decisionHints.some(
          (event) =>
            event.source === 'brain' &&
            event.code === 'brain_output_schema_invalid' &&
            Array.isArray(event.detail?.issues)
        )
        const hasPositionedWriteBlocked = decisionHints.some(
          (event) =>
            event.source === 'hand' &&
            event.code === 'hand_docx_positioned_write_blocked' &&
            typeof event.detail?.targetDescription === 'string' &&
            event.detail.targetDescription.includes('图形学.docx')
        )
        const hasToolLimitExceeded = decisionHints.some(
          (event) =>
            event.source === 'hand' &&
            event.code === 'hand_tool_limit_exceeded' &&
            event.detail?.toolCallCount === 4 &&
            event.detail?.limit === 3
        )
        const largeDocxFailure = toolResults.find((event) => {
          if (event.toolName !== 'docx_outline') return false
          const data = event.result?.data
          return Boolean(
            data &&
            typeof data === 'object' &&
            !Array.isArray(data) &&
            'decisionHint' in data
          )
        })
        const largeDocxDecisionHint = largeDocxFailure?.result?.data?.decisionHint
        const hasRecoveryAfterTooLarge = humanSteps.some(
          (event) =>
            event.stage === 'human_brain' &&
            event.action === 'brain_decision' &&
            typeof event.summary === 'string' &&
            event.summary.includes('第一轮只读命令')
        )

        runtime.assertThat(
          result.output.status === 'completed' &&
            hasLearningNoEffect &&
            hasBrainSchemaInvalid &&
            hasPositionedWriteBlocked &&
            largeDocxDecisionHint?.code === 'hand_tool_result_too_large' &&
            largeDocxDecisionHint.detail.toolName === 'docx_outline' &&
            largeDocxDecisionHint.detail.estimatedTokens > largeDocxDecisionHint.detail.limit &&
            hasRecoveryAfterTooLarge &&
            hasToolLimitExceeded,
          {
            name: 'decision-hint-contract-and-recovery',
            message:
              'decision_hint 专项 case 应覆盖 learning / brain / hand 的关键来源分支，并验证超大工具结果会携带稳定 decisionHint contract 且能回退恢复。',
            data: {
              decisionHints,
              toolResults: toolResults.map((event) => ({
                toolName: event.toolName,
                ok: event.result?.ok,
                code: event.result?.code,
                decisionHint: event.result?.data?.decisionHint
              })),
              humanSteps: humanSteps.map((event) => ({
                stage: event.stage,
                action: event.action,
                summary: event.summary
              }))
            }
          }
        )
      }
    })
  })
})
