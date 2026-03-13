import { describe, expect, test } from 'vitest'
import type { HumanTaskOutput, JsonObject } from '../../../../src/shared/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runRuntimeCase } from '../../../harness/main/capabilityCase'
import { runDeterministicMainContextGraph } from '../../../harness/main/mainContextRuntime'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const okOutput = (input: {
  taskId: string
  summary: string
  deliveryMarkdown: string
}): HumanTaskOutput => ({
  taskId: input.taskId,
  status: 'completed',
  summary: input.summary,
  deliveryMarkdown: input.deliveryMarkdown,
  resultCode: 'ok'
})

const extractDecisionSequence = (responses: JsonObject[]): string[] =>
  responses
    .map((item) => {
      const mode = item.mode
      return typeof mode === 'string' ? mode : ''
    })
    .filter(Boolean)

describe('main/ai/runtime/context', () => {
  test('context roundtrip should resolve reference and route to direct human', async () => {
    const caseId = 'context-roundtrip-resolves-reference'
    const caseMetadata = {
      description: '验证 main graph 在一次 context roundtrip 后能利用新增证据收敛到 direct human。',
      taskGoal: '确认 need_context 写回的 context evidence 能影响下一轮 intent 决策，并结束于 direct human。',
      scenarioTags: ['runtime', 'main-context', 'roundtrip', 'deterministic'],
      expectedOutcome: 'success',
      requiredFixtures: [],
      retentionTier: 'canonical',
      lifecycle: 'active',
      runPolicy: 'gating',
      capabilityArea: 'ai-runtime'
    } as const

    await runRuntimeCase({
      caseId,
      description: caseMetadata.description,
      caseMetadata,
      expectedOutcome: caseMetadata.expectedOutcome,
      scenarioTags: caseMetadata.scenarioTags,
      requiredFixtures: caseMetadata.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: (result) => ({
        status: result.finalState.error ? 'blocked' : 'completed',
        resultCode: result.finalState.error ? 'blocked' : 'ok',
        summary: 'main context roundtrip resolved reference'
      }),
      buildSignalOverrides: (result) => ({
        contextRoundCount: result.finalState.contextRounds,
        contextEvidenceCount: result.finalState.contextEvidence.length,
        internalContextDeliveryCount: result.humanDispatchCalls.filter((item) =>
          item.taskId.startsWith('context-')
        ).length,
        contextFinalRoute:
          result.finalState.finalDeliveryTaskId === 'direct-human'
            ? 'main_direct_human_exec'
            : result.finalState.mainStage,
        fellBackByRoundCap: false,
        contextDecisionSequence: extractDecisionSequence(result.chatJsonResults),
        internalContextTaskIds: result.humanDispatchCalls
          .filter((item) => item.taskId.startsWith('context-'))
          .map((item) => item.taskId),
        contextEvidenceItems: result.finalState.contextEvidence,
        effectiveContextEvidenceAdded: result.finalState.contextEvidence.some((item) =>
          item.includes('spec.docx')
        ),
        contextResolutionStatus: 'resolved'
      }),
      execute: async (runtime) =>
        runDeterministicMainContextGraph({
          runId: runtime.runId,
          workspaceRootPath: runtime.workspaceRoot,
          eventCollector: runtime.eventCollector,
          userInput: '继续刚才第二步，把它保存成最终版本。',
          historyOverride: {
            recentTurnsText: [
              'user: 我们刚才在处理 spec.docx。',
              'assistant: 已记录。',
              'user: 接下来会有多个步骤，请继续。'
            ].join('\n'),
            sessionSummaryText: '当前任务围绕 spec.docx 的后续处理。'
          },
          chatJsonResponses: [
            {
              mode: 'need_context',
              reason: '缺少“第二步”和“它”的具体指代，需要先澄清目标文档和输出文件。'
            },
            {
              mode: 'direct_human',
              reason: '上下文已经补足，当前请求可直接执行。'
            }
          ],
          humanTaskResponses: [
            {
              taskId: 'context-1',
              output: okOutput({
                taskId: 'context-1',
                summary: '已确认第二步指的是将 spec.docx 另存为 output.docx。',
                deliveryMarkdown: [
                  '# 子任务交付',
                  '',
                  '## 已完成',
                  '确认“它”指的是 spec.docx，目标输出为 output.docx。'
                ].join('\n')
              })
            },
            {
              taskId: 'direct-human',
              output: okOutput({
                taskId: 'direct-human',
                summary: '已按澄清后的目标完成直接执行。',
                deliveryMarkdown: [
                  '# 最终答复',
                  '',
                  '## 结论',
                  '本次直接执行目标已经明确：处理 spec.docx，并保存为 output.docx。'
                ].join('\n')
              })
            }
          ]
        }),
      assert: async (result, runtime) => {
        const events = runtime.eventCollector.snapshot()
        const internalContextDelivery = events.find(
          (event) =>
            event.type === 'task_delivery_ready' &&
            event.taskId === 'context-1' &&
            event.internal === true
        )
        recordAssertion(runtime.assertions, {
          id: 'context.final-delivery.direct-human',
          pass: result.finalState.finalDeliveryTaskId === 'direct-human',
          details: `finalDeliveryTaskId=${result.finalState.finalDeliveryTaskId || 'none'}`
        })
        recordAssertion(runtime.assertions, {
          id: 'context.rounds.single-round',
          pass: result.finalState.contextRounds === 1,
          details: `contextRounds=${result.finalState.contextRounds}`
        })
        recordAssertion(runtime.assertions, {
          id: 'context.evidence.includes-summary',
          pass: result.finalState.contextEvidence.some((item) => item.includes('spec.docx')),
          details: JSON.stringify(result.finalState.contextEvidence)
        })
        recordAssertion(runtime.assertions, {
          id: 'context.intent.second-pass-sees-new-evidence',
          pass:
            result.chatJsonCalls.length >= 2 &&
            result.chatJsonCalls[1].user.includes('spec.docx') &&
            result.chatJsonCalls[1].user.includes('output.docx'),
          details: result.chatJsonCalls[1]?.user || 'missing second intent prompt'
        })
        recordAssertion(runtime.assertions, {
          id: 'context.delivery.internal-task-emitted',
          pass: Boolean(internalContextDelivery),
          details: internalContextDelivery ? JSON.stringify(internalContextDelivery) : 'missing context delivery'
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-runtime', caseId)
    expect(report.metrics.contextRoundCount).toBe(1)
    expect(report.metrics.contextFinalRoute).toBe('main_direct_human_exec')
    expect(report.signals.contextDecisionSequence).toEqual(['need_context', 'direct_human'])
    expect(report.signals.contextResolutionStatus).toBe('resolved')
    expect(report.signals.contextEvidenceItems.some((item) => item.includes('spec.docx'))).toBe(true)
  })

  test('context max rounds should fall back to plan after limit is reached', async () => {
    const caseId = 'context-max-rounds-falls-back-to-plan'
    const caseMetadata = {
      description: '验证 main graph 在连续 need_context 后命中轮次上限并降级到 plan。',
      taskGoal: '确认 contextRounds 达到上限后不再进入 main_context_human，而是按契约转入 main_plan。',
      scenarioTags: ['runtime', 'main-context', 'fallback', 'deterministic'],
      expectedOutcome: 'success',
      requiredFixtures: [],
      retentionTier: 'canonical',
      lifecycle: 'active',
      runPolicy: 'gating',
      capabilityArea: 'ai-runtime'
    } as const

    await runRuntimeCase({
      caseId,
      description: caseMetadata.description,
      caseMetadata,
      expectedOutcome: caseMetadata.expectedOutcome,
      scenarioTags: caseMetadata.scenarioTags,
      requiredFixtures: caseMetadata.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: (result) => ({
        status: result.finalState.error ? 'blocked' : 'completed',
        resultCode: result.finalState.error ? 'blocked' : 'ok',
        summary: 'main context fell back to plan after round cap'
      }),
      buildSignalOverrides: (result) => ({
        contextRoundCount: result.finalState.contextRounds,
        contextEvidenceCount: result.finalState.contextEvidence.length,
        internalContextDeliveryCount: result.humanDispatchCalls.filter((item) =>
          item.taskId.startsWith('context-')
        ).length,
        contextFinalRoute: 'main_plan',
        fellBackByRoundCap: true,
        contextDecisionSequence: ['need_context', 'need_context', 'to_plan'],
        internalContextTaskIds: result.humanDispatchCalls
          .filter((item) => item.taskId.startsWith('context-'))
          .map((item) => item.taskId),
        contextEvidenceItems: result.finalState.contextEvidence,
        effectiveContextEvidenceAdded: false,
        contextResolutionStatus: 'fallback_to_plan'
      }),
      execute: async (runtime) =>
        runDeterministicMainContextGraph({
          runId: runtime.runId,
          workspaceRootPath: runtime.workspaceRoot,
          eventCollector: runtime.eventCollector,
          userInput: '继续处理上次那个文档，按之前方式做完。',
          historyOverride: {
            recentTurnsText: [
              'user: 我们上次同时讨论了 alpha.docx 和 beta.docx。',
              'assistant: 已记录这两个文档。',
              'user: 之后还提到了几种不同的“之前方式”。'
            ].join('\n'),
            sessionSummaryText: '当前历史中同时存在多个候选文档和处理方式。'
          },
          chatJsonResponses: [
            {
              mode: 'need_context',
              reason: '无法唯一定位“上次那个文档”和“之前方式”，需要补充上下文。'
            },
            {
              mode: 'need_context',
              reason: '第一轮上下文仍不足以唯一定位目标文档和处理方式。'
            },
            {
              tasks: [
                {
                  id: 'plan-1',
                  title: '整理待确认项',
                  objective: '汇总当前仍不明确的文档对象与处理方式，并形成后续澄清交付。'
                }
              ]
            }
          ],
          humanTaskResponses: [
            {
              taskId: 'context-1',
              output: okOutput({
                taskId: 'context-1',
                summary: '已确认存在多个候选文档，但仍无法唯一定位当前目标。',
                deliveryMarkdown: [
                  '# 子任务交付',
                  '',
                  '## 已完成',
                  '确认 alpha.docx 与 beta.docx 都可能是当前目标。'
                ].join('\n')
              })
            },
            {
              taskId: 'context-2',
              output: okOutput({
                taskId: 'context-2',
                summary: '第二轮仍无法确认“之前方式”具体指哪一种处理流程。',
                deliveryMarkdown: [
                  '# 子任务交付',
                  '',
                  '## 风险与未决',
                  '当前仍缺少唯一可执行的文档和处理方式。'
                ].join('\n')
              })
            },
            {
              taskId: 'plan-1',
              output: okOutput({
                taskId: 'plan-1',
                summary: '已汇总当前未决项，准备进入最终汇总交付。',
                deliveryMarkdown: '# 子任务交付\n\n## 未决\n仍需用户澄清文档对象和处理方式。'
              })
            },
            {
              taskId: 'synthesis-human',
              output: okOutput({
                taskId: 'synthesis-human',
                summary: '已汇总当前上下文不足结论。',
                deliveryMarkdown: '# 最终答复\n\n## 未完成或待确认\n当前仍需用户澄清具体文档与处理方式。'
              })
            }
          ]
        }),
      assert: async (result, runtime) => {
        const planCreated = runtime.eventCollector
          .snapshot()
          .some((event) => event.type === 'plan_created')
        recordAssertion(runtime.assertions, {
          id: 'context.rounds.hit-cap',
          pass: result.finalState.contextRounds === 2,
          details: `contextRounds=${result.finalState.contextRounds}`
        })
        recordAssertion(runtime.assertions, {
          id: 'context.no-third-context-task',
          pass: result.humanDispatchCalls.every((item) => item.taskId !== 'context-3'),
          details: JSON.stringify(result.humanDispatchCalls.map((item) => item.taskId))
        })
        recordAssertion(runtime.assertions, {
          id: 'context.plan-created-after-cap',
          pass: planCreated,
          details: `tasks=${JSON.stringify(result.finalState.plan)}`
        })
        recordAssertion(runtime.assertions, {
          id: 'context.plan-prompt-includes-context-evidence',
          pass:
            result.chatJsonCalls.length >= 3 &&
            result.chatJsonCalls[2].user.includes('alpha.docx') &&
            result.chatJsonCalls[2].user.includes('beta.docx'),
          details: result.chatJsonCalls[2]?.user || 'missing plan prompt'
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-runtime', caseId)
    expect(report.metrics.contextRoundCount).toBe(2)
    expect(report.metrics.fellBackByRoundCap).toBe(true)
    expect(report.metrics.contextFinalRoute).toBe('main_plan')
    expect(report.signals.contextDecisionSequence).toEqual(['need_context', 'need_context', 'to_plan'])
    expect(report.signals.contextResolutionStatus).toBe('fallback_to_plan')
  })
})
