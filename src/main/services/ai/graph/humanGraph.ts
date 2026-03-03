import { END, START, StateGraph } from '@langchain/langgraph'
import type { JsonObject, HumanTaskInput, HumanTaskOutput } from '../../../../shared/types'
import type { AiRunContext } from '../types'
import { createHumanInitNode } from '../node/human/initNode'
import { createHumanBrainNode } from '../node/human/brainNode'
import { createHumanToolExecNode } from '../node/human/toolExecNode'
import { createHumanSlotCommitNode } from '../node/human/slotCommitNode'
import { createHumanExitNode } from '../node/human/exitNode'
import type { HumanRunState } from '../node/human/types'
import { createHumanRunStateSchema } from '../state/stateSchemas'

export const createHumanGraphRunner = (input: {
  ctx: AiRunContext
  maxSteps?: number
}) => {
  const { ctx } = input
  const maxSteps = Math.max(1, Number(input.maxSteps || 6))
  const State = createHumanRunStateSchema()

  const initNode = createHumanInitNode()
  const brainNode = createHumanBrainNode({ ctx })
  const toolExecNode = createHumanToolExecNode({ ctx })
  const slotCommitNode = createHumanSlotCommitNode({ ctx })
  const exitNode = createHumanExitNode()

  const graph = new StateGraph(State)
    .addNode('human_init_node', (state: HumanRunState) => initNode(state))
    .addNode('human_brain_node', (state: HumanRunState) => brainNode(state))
    .addNode('human_tool_exec_node', (state: HumanRunState) => toolExecNode(state))
    .addNode('human_slot_commit_node', (state: HumanRunState) => slotCommitNode(state))
    .addNode('human_exit_node', (state: HumanRunState) => exitNode(state))
    .addEdge(START, 'human_init_node')
    .addEdge('human_init_node', 'human_brain_node')
    // brain 只能选择：继续 tool 执行，或直接终态退出。
    .addConditionalEdges('human_brain_node', (state: HumanRunState) => {
      if (state.phase === 'tool_exec') return 'human_tool_exec_node'
      return 'human_exit_node'
    })
    // tool_exec 成功后进入 slot_commit，失败/终态直接退出。
    .addConditionalEdges('human_tool_exec_node', (state: HumanRunState) => {
      if (state.phase === 'slot_commit') return 'human_slot_commit_node'
      if (state.phase === 'brain') return 'human_brain_node'
      return 'human_exit_node'
    })
    // slot_commit 是每步写状态的唯一入口，提交后回到 brain。
    .addConditionalEdges('human_slot_commit_node', (state: HumanRunState) => {
      if (state.phase === 'brain') return 'human_brain_node'
      return 'human_exit_node'
    })
    .addEdge('human_exit_node', END)
    .compile()

  return async (taskInput: HumanTaskInput): Promise<HumanTaskOutput> => {
    const initialSlotState = taskInput.slotState || {}
    const initialArtifacts = taskInput.slotArtifacts || {}

    const output = (await graph.invoke({
      runId: taskInput.runId,
      sessionId: taskInput.sessionId,
      input: taskInput,
      phase: 'brain',
      terminalState: 'running',
      steps: 0,
      maxSteps,
      messages: [],
      activeTools: [],
      capabilityByTool: {},
      lastToolMessages: [],
      consume: [],
      produce: [],
      expect: [],
      slotState: initialSlotState,
      slotArtifacts: initialArtifacts,
      slotDelta: {},
      summary: '',
      resultCode: 'failed'
    } as HumanRunState)) as HumanRunState

    const terminalState = output.terminalState === 'completed' ? 'completed' : 'blocked'
    return {
      taskId: taskInput.taskId,
      terminalState,
      steps: output.steps,
      summary: output.summary,
      resultCode: output.resultCode,
      resultData: output.resultData,
      slotDelta: output.slotDelta,
      slotState: output.slotState as JsonObject,
      slotArtifacts: output.slotArtifacts
    }
  }
}
