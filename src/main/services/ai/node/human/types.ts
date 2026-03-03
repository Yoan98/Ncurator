import type { AIMessage, BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  AiTaskKind,
  AiTaskResultCode,
  AiSlotRef,
  HumanTaskInput,
  JsonObject,
  JsonValue
} from '../../../../../shared/types'

export type HumanPhase = 'brain' | 'tool_exec' | 'slot_commit' | 'exit'

export type HumanRunState = {
  runId: string
  sessionId: string
  input: HumanTaskInput
  phase: HumanPhase
  terminalState: 'running' | 'completed' | 'blocked'
  steps: number
  maxSteps: number
  messages: BaseMessage[]
  activeTools: StructuredToolInterface[]
  capabilityByTool: Record<string, AiTaskKind>
  lastAiMessage?: AIMessage
  lastToolMessages: BaseMessage[]
  lastToolName?: string
  lastToolArgs?: JsonObject
  consume: AiSlotRef[]
  produce: AiSlotRef[]
  expect: AiSlotRef[]
  pendingPayload?: JsonObject
  slotState: Record<AiSlotRef, JsonValue>
  slotArtifacts: Record<string, JsonObject>
  slotDelta: JsonObject
  summary: string
  resultCode: AiTaskResultCode
  resultData?: JsonObject
}
