import type { HumanState, BrainMemoryOp } from '../../types'

const INVALID_MEMORY_OP_HINT =
  'memoryReducer 检测到非法记忆编辑，已忽略对应操作，请重新判断下一步。'

const hasEvidenceIds = (
  evidences: HumanState['brainMemory']['inside']['evidences'],
  evidenceIds: string[]
): boolean => {
  const evidenceSet = new Set(evidences.map((item) => item.id))
  return evidenceIds.every((evidenceId) => evidenceSet.has(evidenceId))
}

const updateAtIndex = <T>(list: T[], index: number, value: T): T[] => {
  const next = [...list]
  next[index] = value
  return next
}

const removeAtIndex = <T>(list: T[], index: number): T[] => {
  return list.filter((_, currentIndex) => currentIndex !== index)
}

const applyFactOp = (
  inside: HumanState['brainMemory']['inside'],
  op: Extract<BrainMemoryOp, { field: 'facts' }>
) => {
  if (!hasEvidenceIds(inside.evidences, op.value.evidenceIds)) {
    return { inside, invalid: true }
  }

  if (op.op === 'add') {
    return {
      inside: {
        ...inside,
        facts: [...inside.facts, op.value]
      },
      invalid: false
    }
  }

  if (op.index < 0 || op.index >= inside.facts.length) {
    return { inside, invalid: true }
  }

  return {
    inside: {
      ...inside,
      facts: updateAtIndex(inside.facts, op.index, op.value)
    },
    invalid: false
  }
}

const applyEvidenceOp = (
  inside: HumanState['brainMemory']['inside'],
  op: Extract<BrainMemoryOp, { field: 'evidences' }>
) => {
  if (op.op === 'add') {
    return {
      inside: {
        ...inside,
        evidences: [...inside.evidences, op.value]
      },
      invalid: false
    }
  }

  if (op.index < 0 || op.index >= inside.evidences.length) {
    return { inside, invalid: true }
  }

  return {
    inside: {
      ...inside,
      evidences: updateAtIndex(inside.evidences, op.index, op.value)
    },
    invalid: false
  }
}

const applyOpenQuestionOp = (
  inside: HumanState['brainMemory']['inside'],
  op: Extract<BrainMemoryOp, { field: 'openQuestions' }>
) => {
  if (op.op === 'add') {
    return {
      inside: {
        ...inside,
        openQuestions: [...inside.openQuestions, op.value]
      },
      invalid: false
    }
  }

  if (op.index < 0 || op.index >= inside.openQuestions.length) {
    return { inside, invalid: true }
  }

  return {
    inside: {
      ...inside,
      openQuestions: updateAtIndex(inside.openQuestions, op.index, op.value)
    },
    invalid: false
  }
}

export const reduceBrainMemory = (input: {
  inside: HumanState['brainMemory']['inside']
  memoryOps: BrainMemoryOp[]
}): {
  inside: HumanState['brainMemory']['inside']
  watchHint?: string
} => {
  let nextInside = input.inside
  let hasInvalidOp = false

  input.memoryOps.forEach((op) => {
    if (op.op === 'remove') {
      if (op.field === 'facts') {
        if (op.index < 0 || op.index >= nextInside.facts.length) {
          hasInvalidOp = true
          return
        }
        nextInside = {
          ...nextInside,
          facts: removeAtIndex(nextInside.facts, op.index)
        }
        return
      }
      if (op.field === 'evidences') {
        if (op.index < 0 || op.index >= nextInside.evidences.length) {
          hasInvalidOp = true
          return
        }
        nextInside = {
          ...nextInside,
          evidences: removeAtIndex(nextInside.evidences, op.index)
        }
        return
      }
      if (op.index < 0 || op.index >= nextInside.openQuestions.length) {
        hasInvalidOp = true
        return
      }
      nextInside = {
        ...nextInside,
        openQuestions: removeAtIndex(nextInside.openQuestions, op.index)
      }
      return
    }

    const outcome =
      op.field === 'facts'
        ? applyFactOp(nextInside, op)
        : op.field === 'evidences'
          ? applyEvidenceOp(nextInside, op)
          : applyOpenQuestionOp(nextInside, op)

    nextInside = outcome.inside
    if (outcome.invalid) hasInvalidOp = true
  })

  return {
    inside: nextInside,
    watchHint: hasInvalidOp ? INVALID_MEMORY_OP_HINT : undefined
  }
}
