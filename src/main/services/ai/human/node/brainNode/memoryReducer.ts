import type { HumanState, BrainMemoryOp } from '../../types'

const INVALID_MEMORY_OP_HINT =
  'memoryReducer 检测到非法记忆编辑，已忽略对应操作，请重新判断下一步。'

type BrainMemoryInside = HumanState['brainMemory']['inside']
type NonRemoveBrainMemoryOp = Exclude<BrainMemoryOp, { op: 'remove' }>
type BrainMemoryRemoveOp = Extract<BrainMemoryOp, { op: 'remove' }>

const hasEvidenceIds = (
  evidenceIdsInScope: Set<string>,
  evidenceIds: string[]
): boolean => {
  return evidenceIds.every((evidenceId) => evidenceIdsInScope.has(evidenceId))
}

const updateAtIndex = <T>(list: T[], index: number, value: T): T[] => {
  const next = [...list]
  next[index] = value
  return next
}

const removeAtIndex = <T>(list: T[], index: number): T[] => {
  return list.filter((_, currentIndex) => currentIndex !== index)
}

const applyAddOrEdit = <T>(input: {
  list: T[]
  op: {
    op: 'add' | 'edit'
    index?: number
    value: T
  }
  validate?: (value: T) => boolean
}): {
  list: T[]
  invalid: boolean
} => {
  if (input.validate && !input.validate(input.op.value)) {
    return {
      list: input.list,
      invalid: true
    }
  }
  if (input.op.op === 'add') {
    return {
      list: [...input.list, input.op.value],
      invalid: false
    }
  }

  if (
    typeof input.op.index !== 'number' ||
    input.op.index < 0 ||
    input.op.index >= input.list.length
  ) {
    return {
      list: input.list,
      invalid: true
    }
  }

  return {
    list: updateAtIndex(input.list, input.op.index, input.op.value),
    invalid: false
  }
}

const removeCollectionItem = <T>(input: {
  list: T[]
  index: number
}): { list: T[]; invalid: boolean } => {
  if (input.index < 0 || input.index >= input.list.length) {
    return {
      list: input.list,
      invalid: true
    }
  }
  return {
    list: removeAtIndex(input.list, input.index),
    invalid: false
  }
}

const applyNonRemoveOp = (input: {
  inside: BrainMemoryInside
  op: NonRemoveBrainMemoryOp
  validEvidenceIds: Set<string>
}): { inside: BrainMemoryInside; invalid: boolean } => {
  if (input.op.field === 'facts') {
    const outcome = applyAddOrEdit({
      list: input.inside.facts,
      op: input.op,
      validate: (value) => hasEvidenceIds(input.validEvidenceIds, value.evidenceIds)
    })
    return {
      inside: {
        ...input.inside,
        facts: outcome.list
      },
      invalid: outcome.invalid
    }
  }

  if (input.op.field === 'evidences') {
    const outcome = applyAddOrEdit({
      list: input.inside.evidences,
      op: input.op
    })
    return {
      inside: {
        ...input.inside,
        evidences: outcome.list
      },
      invalid: outcome.invalid
    }
  }

  const outcome = applyAddOrEdit({
    list: input.inside.openQuestions,
    op: input.op
  })
  return {
    inside: {
      ...input.inside,
      openQuestions: outcome.list
    },
    invalid: outcome.invalid
  }
}

const applyRemoveOp = (input: {
  inside: BrainMemoryInside
  op: BrainMemoryRemoveOp
}): { inside: BrainMemoryInside; invalid: boolean } => {
  if (input.op.field === 'facts') {
    const outcome = removeCollectionItem({
      list: input.inside.facts,
      index: input.op.index
    })
    return {
      inside: {
        ...input.inside,
        facts: outcome.list
      },
      invalid: outcome.invalid
    }
  }

  if (input.op.field === 'evidences') {
    const outcome = removeCollectionItem({
      list: input.inside.evidences,
      index: input.op.index
    })
    return {
      inside: {
        ...input.inside,
        evidences: outcome.list
      },
      invalid: outcome.invalid
    }
  }

  const outcome = removeCollectionItem({
    list: input.inside.openQuestions,
    index: input.op.index
  })
  return {
    inside: {
      ...input.inside,
      openQuestions: outcome.list
    },
    invalid: outcome.invalid
  }
}

const computeFinalEvidenceIds = (input: {
  inside: BrainMemoryInside
  memoryOps: BrainMemoryOp[]
}): Set<string> => {
  let evidences = input.inside.evidences

  input.memoryOps.forEach((op) => {
    if (op.field !== 'evidences') return

    if (op.op === 'remove') {
      const outcome = applyRemoveOp({
        inside: {
          ...input.inside,
          evidences
        },
        op
      })
      if (!outcome.invalid) evidences = outcome.inside.evidences
      return
    }

    const outcome = applyNonRemoveOp({
      inside: {
        ...input.inside,
        evidences
      },
      op,
      validEvidenceIds: new Set(evidences.map((item) => item.id))
    })
    if (!outcome.invalid) {
      evidences = outcome.inside.evidences
    }
  })

  return new Set(evidences.map((item) => item.id))
}

const hasDanglingFactEvidenceReference = (
  inside: BrainMemoryInside
): boolean => {
  const validEvidenceIds = new Set(inside.evidences.map((item) => item.id))
  return inside.facts.some((fact) => !hasEvidenceIds(validEvidenceIds, fact.evidenceIds))
}

export const reduceBrainMemory = (input: {
  inside: BrainMemoryInside
  memoryOps: BrainMemoryOp[]
}): {
  inside: BrainMemoryInside
  watchHint?: string
} => {
  let nextInside = input.inside
  let hasInvalidOp = false
  const finalEvidenceIds = computeFinalEvidenceIds(input)
  const touchesEvidenceGraph = input.memoryOps.some((op) => op.field === 'facts' || op.field === 'evidences')

  input.memoryOps.forEach((op) => {
    if (op.op === 'remove') {
      const outcome = applyRemoveOp({
        inside: nextInside,
        op
      })
      if (outcome.invalid) {
        hasInvalidOp = true
        return
      }
      nextInside = outcome.inside
      return
    }

    const outcome = applyNonRemoveOp({
      inside: nextInside,
      op,
      validEvidenceIds: finalEvidenceIds
    })

    nextInside = outcome.inside
    if (outcome.invalid) hasInvalidOp = true
  })

  if (touchesEvidenceGraph && hasDanglingFactEvidenceReference(nextInside)) {
    return {
      inside: input.inside,
      watchHint: INVALID_MEMORY_OP_HINT
    }
  }

  return {
    inside: nextInside,
    watchHint: hasInvalidOp ? INVALID_MEMORY_OP_HINT : undefined
  }
}
