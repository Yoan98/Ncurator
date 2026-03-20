import { isJsonObject } from '../../../../../utils/aiCapabilityUtils'
import type { JsonObject, JsonValue } from '../../../../../../shared/types'
import { hasSkillDefinition } from '../learningNode/skillRegistry'
import type {
  BrainDecision,
  BrainMemoryOp,
  LastBrainDecision,
  RuntimeSkillId,
  ToolCallParam
} from '../../types'

const toString = (value: JsonValue | undefined, fallback: string): string => {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

const toJsonObject = (value: JsonValue | undefined): JsonObject => {
  return isJsonObject(value) ? value : {}
}

const parseToolCallParam = (value: JsonValue | undefined): ToolCallParam | undefined => {
  if (!isJsonObject(value)) return undefined
  const toolName = toString(value.toolName, '')
  if (!toolName) return undefined
  return {
    toolName,
    args: toJsonObject(value.args)
  }
}

const parseMemoryOp = (value: JsonValue | undefined): BrainMemoryOp | undefined => {
  if (!isJsonObject(value)) return undefined
  const op = toString(value.op, '')
  const field = toString(value.field, '')
  const index = typeof value.index === 'number' ? value.index : undefined

  if (op === 'add' && field === 'facts' && isJsonObject(value.value)) {
    return {
      op: 'add',
      field: 'facts',
      value: {
        id: toString(value.value.id, 'fact'),
        summary: toString(value.value.summary, ''),
        evidenceIds: Array.isArray(value.value.evidenceIds)
          ? value.value.evidenceIds.map((item) => String(item)).filter(Boolean)
          : []
      }
    }
  }

  if (op === 'edit' && field === 'facts' && index !== undefined && isJsonObject(value.value)) {
    return {
      op: 'edit',
      field: 'facts',
      index,
      value: {
        id: toString(value.value.id, 'fact'),
        summary: toString(value.value.summary, ''),
        evidenceIds: Array.isArray(value.value.evidenceIds)
          ? value.value.evidenceIds.map((item) => String(item)).filter(Boolean)
          : []
      }
    }
  }

  if (op === 'add' && field === 'evidences' && isJsonObject(value.value)) {
    return {
      op: 'add',
      field: 'evidences',
      value: {
        id: toString(value.value.id, 'evidence'),
        toolName: toString(value.value.toolName, 'tool'),
        summary: toString(value.value.summary, ''),
        sourceType: 'tool_result',
        rawRef: typeof value.value.rawRef === 'string' ? value.value.rawRef : undefined
      }
    }
  }

  if (op === 'edit' && field === 'evidences' && index !== undefined && isJsonObject(value.value)) {
    return {
      op: 'edit',
      field: 'evidences',
      index,
      value: {
        id: toString(value.value.id, 'evidence'),
        toolName: toString(value.value.toolName, 'tool'),
        summary: toString(value.value.summary, ''),
        sourceType: 'tool_result',
        rawRef: typeof value.value.rawRef === 'string' ? value.value.rawRef : undefined
      }
    }
  }

  if (op === 'add' && field === 'openQuestions') {
    return {
      op: 'add',
      field: 'openQuestions',
      value: toString(value.value, '')
    }
  }

  if (op === 'edit' && field === 'openQuestions' && index !== undefined) {
    return {
      op: 'edit',
      field: 'openQuestions',
      index,
      value: toString(value.value, '')
    }
  }

  if (
    op === 'remove' &&
    index !== undefined &&
    (field === 'facts' || field === 'evidences' || field === 'openQuestions')
  ) {
    return {
      op: 'remove',
      field,
      index
    }
  }

  return undefined
}

const parseDecision = (value: JsonValue | undefined): BrainDecision => {
  if (!isJsonObject(value)) {
    return {
      summary: '当前信息不足，先结束。',
      reason: '模型未返回合法 decision，默认阻塞收敛。',
      expectedOutcome: '输出保守的阻塞结果。'
    }
  }

  return {
    summary: toString(value.summary, '继续推进任务'),
    reason: toString(value.reason, '基于当前上下文做出保守决策'),
    expectedOutcome: toString(value.expectedOutcome, '让任务继续收敛')
  }
}

export const parseBrainDecisionOutput = (rawOutput: JsonObject | object): LastBrainDecision => {
  const raw = isJsonObject(rawOutput as JsonValue) ? (rawOutput as JsonObject) : {}
  const memoryOps = Array.isArray(raw.memoryOps)
    ? raw.memoryOps
        .map((item) => parseMemoryOp(item))
        .filter((item): item is BrainMemoryOp => Boolean(item))
    : []
  const decision = parseDecision(raw.decision)
  const nextAction = isJsonObject(raw.nextAction) ? raw.nextAction : {}
  const action = toString(nextAction.action, 'mouth')

  if (action === 'learning') {
    const wantLearnSkillIds = Array.isArray(nextAction.wantLearnSkillIds)
      ? nextAction.wantLearnSkillIds
          .map((item) => String(item))
          .filter(hasSkillDefinition) as RuntimeSkillId[]
      : []

    return {
      memoryOps,
      decision,
      nextAction:
        wantLearnSkillIds.length > 0
          ? {
              action: 'learning',
              wantLearnSkillIds
            }
          : {
              action: 'mouth',
              status: 'blocked'
            }
    }
  }

  if (action === 'hand') {
    const parallelCallToolParam = Array.isArray(nextAction.parallelCallToolParam)
      ? nextAction.parallelCallToolParam
          .map((item) => parseToolCallParam(item))
          .filter((item): item is ToolCallParam => Boolean(item))
      : []

    return {
      memoryOps,
      decision,
      nextAction:
        parallelCallToolParam.length > 0
          ? {
              action: 'hand',
              parallelCallToolParam
            }
          : {
              action: 'mouth',
              status: 'blocked'
            }
    }
  }

  return {
    memoryOps,
    decision,
    nextAction: {
      action: 'mouth',
      status: nextAction.status === 'completed' ? 'completed' : 'blocked'
    }
  }
}
