import { END, START, StateGraph } from '@langchain/langgraph'
import type { HumanTaskInput, HumanTaskOutput } from '../../../../shared/types'
import type { AiRunContext } from '../types'
import { createHumanBrainNode } from '../node/human/brainNode'
import { createHumanToolExecNode } from '../node/human/toolExecNode'
import type { HumanRunState } from '../node/human/types'
import { createHumanRunStateSchema } from '../state/stateSchemas'

export const createHumanGraphRunner = (input: { ctx: AiRunContext; maxSteps?: number }) => {
  const { ctx } = input
  const maxSteps = Math.max(1, Number(input.maxSteps || 6))
  const State = createHumanRunStateSchema()

  const brainNode = createHumanBrainNode({ ctx })
  const toolExecNode = createHumanToolExecNode({ ctx })

  const graph = new StateGraph(State)
    .addNode('human_brain_node', (state: HumanRunState) => brainNode(state))
    .addNode('human_tool_exec_node', (state: HumanRunState) => toolExecNode(state))
    .addEdge(START, 'human_brain_node')
    .addConditionalEdges('human_brain_node', (state: HumanRunState) => {
      if (state.status !== 'running') return END
      if (state.phase === 'tool_exec') return 'human_tool_exec_node'
      return END
    })
    .addConditionalEdges('human_tool_exec_node', (state: HumanRunState) => {
      if (state.status !== 'running') return END
      return 'human_brain_node'
    })
    .compile()

  return async (taskInput: HumanTaskInput): Promise<HumanTaskOutput> => {
    const output = (await graph.invoke({
      runId: ctx.runId,
      input: taskInput,
      phase: 'brain',
      status: 'running',
      steps: 0,
      maxSteps,
      messages: [],
      activeTools: [],
      summary: '',
      resultCode: 'failed'
    } as HumanRunState)) as HumanRunState

    return {
      taskId: taskInput.taskId,
      status: output.status === 'completed' ? 'completed' : 'blocked',
      summary: output.summary,
      resultCode: output.resultCode,
      resultData: output.resultData
    }
  }
}
