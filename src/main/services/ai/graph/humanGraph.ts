import { END, START, StateGraph } from '@langchain/langgraph'
import type { HumanTaskInput, HumanTaskOutput } from '../../../../shared/types'
import type { AiRunContext, HumanRunDispatchOptions } from '../types'
import { createHumanBrainNode } from '../node/human/brainNode'
import { createHumanResponseNode } from '../node/human/responseNode'
import { isHumanTerminalStatus } from '../node/human/runtimeState'
import { createHumanSkillLoaderNode } from '../node/human/skillLoaderNode'
import { createHumanToolExecNode } from '../node/human/toolExecNode'
import type { HumanRunState } from '../node/human/types'
import { createHumanRunStateSchema } from '../state/stateSchemas'

export const createHumanGraphRunner = (input: { ctx: AiRunContext; maxSteps?: number }) => {
  const { ctx } = input
  const maxSteps = Math.max(0, Number(input.maxSteps ?? 6))
  // Each human step can traverse brain + loader/tool nodes, so LangGraph recursion
  // must scale with maxSteps instead of relying on the default limit.
  const recursionLimit = Math.max(32, maxSteps * 4 + 8)
  const State = createHumanRunStateSchema()

  const brainNode = createHumanBrainNode({ ctx })
  const responseNode = createHumanResponseNode({ ctx })
  const skillLoaderNode = createHumanSkillLoaderNode({ ctx })
  const toolExecNode = createHumanToolExecNode({ ctx })

  const graph = new StateGraph(State)
    .addNode('human_brain_node', (state: HumanRunState) => brainNode(state))
    .addNode('human_response_node', (state: HumanRunState) => responseNode(state))
    .addNode('human_skill_loader_node', (state: HumanRunState) => skillLoaderNode(state))
    .addNode('human_tool_exec_node', (state: HumanRunState) => toolExecNode(state))
    .addEdge(START, 'human_brain_node')
    .addConditionalEdges('human_brain_node', (state: HumanRunState) => {
      if (state.status === 'response') return 'human_response_node'
      if (state.status === 'skill_loader') return 'human_skill_loader_node'
      if (state.status === 'tool_exec') return 'human_tool_exec_node'
      if (isHumanTerminalStatus(state.status)) return END
      return END
    })
    .addConditionalEdges('human_skill_loader_node', (state: HumanRunState) => {
      if (state.status === 'response') return 'human_response_node'
      if (state.status === 'brain') return 'human_brain_node'
      if (isHumanTerminalStatus(state.status)) return END
      return END
    })
    .addConditionalEdges('human_tool_exec_node', (state: HumanRunState) => {
      if (state.status === 'response') return 'human_response_node'
      if (state.status === 'brain') return 'human_brain_node'
      if (isHumanTerminalStatus(state.status)) return END
      return END
    })
    .addEdge('human_response_node', END)
    .compile()

  return async (
    taskInput: HumanTaskInput,
    options: HumanRunDispatchOptions
  ): Promise<HumanTaskOutput> => {
    const output = (await graph.invoke(
      {
        runId: ctx.runId,
        input: taskInput,
        status: 'brain',
        deliveryKind: options.deliveryKind,
        streamAnswer: Boolean(options.streamAnswer),
        internalDelivery: Boolean(options.internalDelivery),
        steps: 0,
        maxSteps,
        loadedSkillIds: [],
        loadedToolsets: {},
        activeSkillIds: [],
        stepHistory: [],
        summary: '',
        deliveryMarkdown: '',
        resultCode: 'failed'
      } as HumanRunState,
      {
        recursionLimit
      }
    )) as HumanRunState

    return {
      taskId: taskInput.taskId,
      status: output.status === 'completed' ? 'completed' : 'blocked',
      summary: output.summary,
      deliveryMarkdown: output.deliveryMarkdown,
      resultCode: output.resultCode,
      resultData: output.resultData,
      localSourceStatus: output.localSourceStatus,
      localSourceSummary: output.localSourceSummary
    }
  }
}
