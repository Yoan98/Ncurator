import type { AiRunState, HumanTaskRunner } from '../../../../../src/main/services/ai/types'
import { createDirectHumanExecNode } from '../../../../../src/main/services/ai/main/node/directHumanExecNode'
import { createSynthesisHumanNode } from '../../../../../src/main/services/ai/main/node/synthesisHumanNode'
import { defineAiMainCase, getEventsByType } from './helpers'

const createBaseState = (runtime: { runId: string }): AiRunState => ({
  runId: runtime.runId,
  sessionId: 'test-session',
  status: 'running',
  input: '请直接给出最终答复。',
  mainStage: 'main_direct_human_exec',
  contextRounds: 0,
  contextEvidence: ['已有上下文摘要'],
  plan: [
    {
      id: 'task-1',
      title: '核对现状',
      userInput: '读取当前 workspace 状态。',
      status: 'completed',
      deliveryMarkdown: '# 子任务交付'
    }
  ],
  dispatchCursor: 1
})

defineAiMainCase({
  caseId: 'main-final-delivery',
  caseType: 'basic',
  groups: ['basic'],
  description: 'direct/synthesis 节点都只应写 finalDeliveryMarkdown，并保留新的任务事件语义。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const directCtx = runtime.createAiRunContext()
    const synthesisCtx = runtime.createAiRunContext()
    const directRunner: HumanTaskRunner = async () => ({
      taskId: 'direct-human',
      status: 'completed',
      summary: '已给出直接答复。',
      deliveryMarkdown: '# Direct Delivery'
    })
    const synthesisRunner: HumanTaskRunner = async () => ({
      taskId: 'synthesis-human',
      status: 'completed',
      summary: '已汇总全部任务交付。',
      deliveryMarkdown: '# Synthesis Delivery'
    })
    const directNode = createDirectHumanExecNode({ ctx: directCtx, runHumanTask: directRunner })
    const synthesisNode = createSynthesisHumanNode({
      ctx: synthesisCtx,
      runHumanTask: synthesisRunner
    })

    const directOutput = await directNode(createBaseState(runtime))
    const synthesisOutput = await synthesisNode({
      ...createBaseState(runtime),
      mainStage: 'main_synthesis_human'
    })

    return {
      directOutput,
      synthesisOutput,
      taskCompletedEvents: getEventsByType(runtime, 'task_completed')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.directOutput.finalDeliveryMarkdown === '# Direct Delivery' &&
        result.synthesisOutput.finalDeliveryMarkdown === '# Synthesis Delivery' &&
        !('finalDeliveryTaskId' in result.directOutput) &&
        !('resultCode' in result.directOutput),
      {
        name: 'main-final-delivery-shape',
        message: 'direct/synthesis 结果应只写 finalDeliveryMarkdown，不再回写旧结果字段'
      }
    )
    runtime.assertThat(
      result.taskCompletedEvents.some((event) => event.taskId === 'direct-human') &&
        result.taskCompletedEvents.some((event) => event.taskId === 'synthesis-human'),
      {
        name: 'main-final-delivery-events',
        message: 'direct/synthesis 完成后应继续发出 task_completed 事件'
      }
    )
  }
})
