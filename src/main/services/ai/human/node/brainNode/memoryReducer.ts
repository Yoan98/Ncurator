import type { HumanState, BrainMemoryOp } from '../../types'

const INVALID_MEMORY_OP_HINT =
  'memoryReducer 检测到非法记忆编辑，已忽略对应操作，请重新判断下一步。'

type BrainMemoryInside = HumanState['brainMemory']['inside']
type BrainMemoryField = keyof BrainMemoryInside
type NonRemoveBrainMemoryOp = Exclude<BrainMemoryOp, { op: 'remove' }>

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

const setFieldValue = <TField extends BrainMemoryField>(
  inside: BrainMemoryInside,
  field: TField,
  value: BrainMemoryInside[TField]
): BrainMemoryInside => ({
  ...inside,
  [field]: value
})

const applyCollectionOp = <T>(input: {
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

const removeCollectionItem = <T>(list: T[], index: number): { list: T[]; invalid: boolean } => {
  if (index < 0 || index >= list.length) {
    return {
      list,
      invalid: true
    }
  }
  return {
    list: removeAtIndex(list, index),
    invalid: false
  }
}

const applyFactsFieldOp = (
  inside: BrainMemoryInside,
  op: Extract<NonRemoveBrainMemoryOp, { field: 'facts' }>,
  validEvidenceIds: Set<string>
) => {
  const outcome = applyCollectionOp({
    list: inside.facts,
    op,
    validate: (value) => hasEvidenceIds(validEvidenceIds, value.evidenceIds)
  })
  return {
    inside: setFieldValue(inside, 'facts', outcome.list),
    invalid: outcome.invalid
  }
}

const applyEvidencesFieldOp = (
  inside: BrainMemoryInside,
  op: Extract<NonRemoveBrainMemoryOp, { field: 'evidences' }>
) => {
  const outcome = applyCollectionOp({
    list: inside.evidences,
    op
  })
  return {
    inside: setFieldValue(inside, 'evidences', outcome.list),
    invalid: outcome.invalid
  }
}

const applyOpenQuestionsFieldOp = (
  inside: BrainMemoryInside,
  op: Extract<NonRemoveBrainMemoryOp, { field: 'openQuestions' }>
) => {
  const outcome = applyCollectionOp({
    list: inside.openQuestions,
    op
  })
  return {
    inside: setFieldValue(inside, 'openQuestions', outcome.list),
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
      const outcome = removeCollectionItem(evidences, op.index)
      if (!outcome.invalid) evidences = outcome.list
      return
    }

    const outcome = applyEvidencesFieldOp(
      setFieldValue(input.inside, 'evidences', evidences),
      op
    )
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
      const outcome =
        op.field === 'facts'
          ? removeCollectionItem(nextInside.facts, op.index)
          : op.field === 'evidences'
            ? removeCollectionItem(nextInside.evidences, op.index)
            : removeCollectionItem(nextInside.openQuestions, op.index)
      if (outcome.invalid) {
        hasInvalidOp = true
        return
      }
      nextInside =
        op.field === 'facts'
          ? setFieldValue(nextInside, 'facts', outcome.list)
          : op.field === 'evidences'
            ? setFieldValue(nextInside, 'evidences', outcome.list)
            : setFieldValue(nextInside, 'openQuestions', outcome.list)
      return
    }

    const outcome =
      op.field === 'facts'
        ? applyFactsFieldOp(nextInside, op, finalEvidenceIds)
        : op.field === 'evidences'
          ? applyEvidencesFieldOp(nextInside, op)
          : applyOpenQuestionsFieldOp(nextInside, op)

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
