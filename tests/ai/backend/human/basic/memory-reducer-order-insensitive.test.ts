import { describe, expect, it } from 'vitest'
import { reduceBrainMemory } from '../../../../../src/main/services/ai/human/node/brainNode/memoryReducer'
import type { HumanState } from '../../../../../src/main/services/ai/human/types'

const baseInside: HumanState['brainMemory']['inside'] = {
  facts: [],
  evidences: [],
  openQuestions: ['当前缺少直接依据。']
}

const referencedInside: HumanState['brainMemory']['inside'] = {
  facts: [
    {
      id: 'fact-1',
      summary: '项目上线前需要复核。',
      evidenceIds: ['evidence-1']
    }
  ],
  evidences: [
    {
      id: 'evidence-1',
      toolName: 'kb_hybrid_search_chunks',
      summary: '知识库显示上线前需要复核。',
      sourceType: 'tool_result'
    }
  ],
  openQuestions: []
}

describe('reduceBrainMemory', () => {
  it('treats same-round fact to new evidence references as order-insensitive', () => {
    const factThenEvidence = reduceBrainMemory({
      inside: baseInside,
      memoryOps: [
        {
          op: 'add',
          field: 'facts',
          value: {
            id: 'fact-1',
            summary: '项目上线前需要复核。',
            evidenceIds: ['evidence-1']
          }
        },
        {
          op: 'add',
          field: 'evidences',
          value: {
            id: 'evidence-1',
            toolName: 'kb_hybrid_search_chunks',
            summary: '知识库显示上线前需要复核。',
            sourceType: 'tool_result'
          }
        }
      ]
    })

    const evidenceThenFact = reduceBrainMemory({
      inside: baseInside,
      memoryOps: [
        {
          op: 'add',
          field: 'evidences',
          value: {
            id: 'evidence-1',
            toolName: 'kb_hybrid_search_chunks',
            summary: '知识库显示上线前需要复核。',
            sourceType: 'tool_result'
          }
        },
        {
          op: 'add',
          field: 'facts',
          value: {
            id: 'fact-1',
            summary: '项目上线前需要复核。',
            evidenceIds: ['evidence-1']
          }
        }
      ]
    })

    expect(factThenEvidence.watchHint).toBeUndefined()
    expect(evidenceThenFact.watchHint).toBeUndefined()
    expect(factThenEvidence.inside).toEqual(evidenceThenFact.inside)
    expect(factThenEvidence.inside.facts).toHaveLength(1)
    expect(factThenEvidence.inside.evidences).toHaveLength(1)
  })

  it('still rejects facts that reference evidences missing from the final same-round evidence set', () => {
    const result = reduceBrainMemory({
      inside: baseInside,
      memoryOps: [
        {
          op: 'add',
          field: 'evidences',
          value: {
            id: 'evidence-1',
            toolName: 'kb_hybrid_search_chunks',
            summary: '知识库显示上线前需要复核。',
            sourceType: 'tool_result'
          }
        },
        {
          op: 'remove',
          field: 'evidences',
          index: 0
        },
        {
          op: 'add',
          field: 'facts',
          value: {
            id: 'fact-1',
            summary: '项目上线前需要复核。',
            evidenceIds: ['evidence-1']
          }
        }
      ]
    })

    expect(result.watchHint).toContain('memoryReducer')
    expect(result.inside.evidences).toEqual([])
    expect(result.inside.facts).toEqual([])
  })

  it('rejects an evidence removal when an existing fact would become dangling', () => {
    const result = reduceBrainMemory({
      inside: referencedInside,
      memoryOps: [
        {
          op: 'remove',
          field: 'evidences',
          index: 0
        }
      ]
    })

    expect(result.watchHint).toContain('memoryReducer')
    expect(result.inside).toEqual(referencedInside)
  })

  it('rejects an evidence id edit when an existing fact is not updated in the same round', () => {
    const result = reduceBrainMemory({
      inside: referencedInside,
      memoryOps: [
        {
          op: 'edit',
          field: 'evidences',
          index: 0,
          value: {
            id: 'evidence-2',
            toolName: 'kb_hybrid_search_chunks',
            summary: '知识库显示上线前需要复核。',
            sourceType: 'tool_result'
          }
        }
      ]
    })

    expect(result.watchHint).toContain('memoryReducer')
    expect(result.inside).toEqual(referencedInside)
  })

  it('allows same-round evidence replacement when facts are updated to the final evidence ids', () => {
    const result = reduceBrainMemory({
      inside: referencedInside,
      memoryOps: [
        {
          op: 'edit',
          field: 'facts',
          index: 0,
          value: {
            id: 'fact-1',
            summary: '项目上线前需要复核。',
            evidenceIds: ['evidence-2']
          }
        },
        {
          op: 'edit',
          field: 'evidences',
          index: 0,
          value: {
            id: 'evidence-2',
            toolName: 'kb_hybrid_search_chunks',
            summary: '知识库显示上线前需要复核。',
            sourceType: 'tool_result'
          }
        }
      ]
    })

    expect(result.watchHint).toBeUndefined()
    expect(result.inside.facts[0]?.evidenceIds).toEqual(['evidence-2'])
    expect(result.inside.evidences[0]?.id).toBe('evidence-2')
  })
})
