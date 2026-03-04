import type { AIMessage, BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiTaskResultCode, HumanTaskInput, JsonObject } from '../../../../../shared/types'

export type HumanPhase = 'brain' | 'tool_exec'

export type HumanRunState = {
  runId: string
  input: HumanTaskInput
  phase: HumanPhase
  terminalState: 'running' | 'completed' | 'blocked'
  steps: number
  maxSteps: number
  messages: BaseMessage[]
  activeTools: StructuredToolInterface[]
  lastAiMessage?: AIMessage
  lastToolName?: string
  summary: string
  resultCode: AiTaskResultCode
  resultData?: JsonObject
}
