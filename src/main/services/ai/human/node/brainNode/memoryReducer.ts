import type { HumanState, BrainMemoryOp } from '../../types'

const INVALID_MEMORY_OP_HINT =
  'memoryReducer 检测到非法记忆编辑，已忽略对应操作，请重新判断下一步。'

type BrainMemoryInside = HumanState['brainMemory']['inside']
type BrainMemoryField = keyof BrainMemoryInside
type NonRemoveBrainMemoryOp = Exclude<BrainMemoryOp, { op: 'remove' }>
type BrainMemoryFieldList<TField extends BrainMemoryField> = BrainMemoryInside[TField]
type BrainMemoryFieldValue<TField extends BrainMemoryField> = BrainMemoryFieldList<TField>[number]
type FactsMemoryOp = Extract<NonRemoveBrainMemoryOp, { field: 'facts' }>
type EvidencesMemoryOp = Extract<NonRemoveBrainMemoryOp, { field: 'evidences' }>
type OpenQuestionsMemoryOp = Extract<NonRemoveBrainMemoryOp, { field: 'openQuestions' }>
type BrainMemoryFieldStrategyContext = {
  validEvidenceIds: Set<string>
}

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

const applyCollectionFieldOp = <TField extends BrainMemoryField>(input: {
  inside: BrainMemoryInside
  field: TField
  list: BrainMemoryFieldList<TField>
  op: {
    op: 'add' | 'edit'
    index?: number
    value: BrainMemoryFieldValue<TField>
  }
  validate?: (value: BrainMemoryFieldValue<TField>) => boolean
}) => {
  const outcome = applyCollectionOp<BrainMemoryFieldValue<TField>>({
    list: input.list,
    op: input.op,
    validate: input.validate
  })
  return {
    inside: setFieldValue(input.inside, input.field, outcome.list as BrainMemoryFieldList<TField>),
    invalid: outcome.invalid
  }
}

const removeCollectionFieldOp = <TField extends BrainMemoryField>(input: {
  inside: BrainMemoryInside
  field: TField
  list: BrainMemoryFieldList<TField>
  index: number
}) => {
  const outcome = removeCollectionItem<BrainMemoryFieldValue<TField>>(input.list, input.index)
  return {
    inside: setFieldValue(input.inside, input.field, outcome.list as BrainMemoryFieldList<TField>),
    invalid: outcome.invalid
  }
}

const BRAIN_MEMORY_FIELD_STRATEGIES = {
  facts: {
    apply: (
      inside: BrainMemoryInside,
      op: FactsMemoryOp,
      context: BrainMemoryFieldStrategyContext
    ) =>
      applyCollectionFieldOp({
        inside,
        field: 'facts',
        list: inside.facts,
        op,
        validate: (value) => hasEvidenceIds(context.validEvidenceIds, value.evidenceIds)
      }),
    remove: (inside: BrainMemoryInside, index: number) =>
      removeCollectionFieldOp({
        inside,
        field: 'facts',
        list: inside.facts,
        index
      })
  },
  evidences: {
    apply: (
      inside: BrainMemoryInside,
      op: EvidencesMemoryOp
    ) =>
      applyCollectionFieldOp({
        inside,
        field: 'evidences',
        list: inside.evidences,
        op
      }),
    remove: (inside: BrainMemoryInside, index: number) =>
      removeCollectionFieldOp({
        inside,
        field: 'evidences',
        list: inside.evidences,
        index
      })
  },
  openQuestions: {
    apply: (
      inside: BrainMemoryInside,
      op: OpenQuestionsMemoryOp
    ) =>
      applyCollectionFieldOp({
        inside,
        field: 'openQuestions',
        list: inside.openQuestions,
        op
      }),
    remove: (inside: BrainMemoryInside, index: number) =>
      removeCollectionFieldOp({
        inside,
        field: 'openQuestions',
        list: inside.openQuestions,
        index
      })
  }
}

const applyFieldOp = (input: {
  inside: BrainMemoryInside
  op: NonRemoveBrainMemoryOp
  context: BrainMemoryFieldStrategyContext
}) => {
  if (input.op.field === 'facts') {
    return BRAIN_MEMORY_FIELD_STRATEGIES.facts.apply(input.inside, input.op, input.context)
  }
  if (input.op.field === 'evidences') {
    return BRAIN_MEMORY_FIELD_STRATEGIES.evidences.apply(input.inside, input.op)
  }
  return BRAIN_MEMORY_FIELD_STRATEGIES.openQuestions.apply(input.inside, input.op)
}

const removeFieldOp = (input: {
  inside: BrainMemoryInside
  field: BrainMemoryField
  index: number
}) => {
  if (input.field === 'facts') {
    return BRAIN_MEMORY_FIELD_STRATEGIES.facts.remove(input.inside, input.index)
  }
  if (input.field === 'evidences') {
    return BRAIN_MEMORY_FIELD_STRATEGIES.evidences.remove(input.inside, input.index)
  }
  return BRAIN_MEMORY_FIELD_STRATEGIES.openQuestions.remove(input.inside, input.index)
}

const computeFinalEvidenceIds = (input: {
  inside: BrainMemoryInside
  memoryOps: BrainMemoryOp[]
}): Set<string> => {
  let evidences = input.inside.evidences

  input.memoryOps.forEach((op) => {
    if (op.field !== 'evidences') return

    if (op.op === 'remove') {
      const outcome = removeFieldOp({
        inside: setFieldValue(input.inside, 'evidences', evidences),
        field: 'evidences',
        index: op.index
      })
      if (!outcome.invalid) evidences = outcome.inside.evidences
      return
    }

    const outcome = applyFieldOp({
      inside: setFieldValue(input.inside, 'evidences', evidences),
      op,
      context: {
        validEvidenceIds: new Set(evidences.map((item) => item.id))
      }
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
      const outcome = removeFieldOp({
        inside: nextInside,
        field: op.field,
        index: op.index
      })
      if (outcome.invalid) {
        hasInvalidOp = true
        return
      }
      nextInside = outcome.inside
      return
    }

    const outcome = applyFieldOp({
      inside: nextInside,
      op,
      context: {
        validEvidenceIds: finalEvidenceIds
      }
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
