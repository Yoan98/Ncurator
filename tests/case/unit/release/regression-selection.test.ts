import { describe, expect, it } from 'vitest'
import {
  hasRegressionSelectionArgs,
  readRegressionSelection
} from '../../../../scripts/release/regression.mjs'

describe('release regression selection', () => {
  it('uses the full package E2E scope when no filters are provided', () => {
    expect(readRegressionSelection(['--test-only'])).toEqual({
      workflowArgs: [],
      state: { mode: 'full' }
    })
  })

  it('forwards a selected package E2E scope and records it', () => {
    expect(
      readRegressionSelection([
        '--test-only',
        '--domain',
        'workbench',
        '--suite',
        'result',
        '--group',
        'apply',
        '--case',
        'WB-RESULT-001',
        '--fresh-knowledge-cache'
      ])
    ).toEqual({
      workflowArgs: [
        '--domain',
        'workbench',
        '--suite',
        'result',
        '--group',
        'apply',
        '--case',
        'WB-RESULT-001',
        '--fresh-knowledge-cache'
      ],
      state: {
        mode: 'selected',
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        caseId: 'WB-RESULT-001',
        freshKnowledgeCache: true
      }
    })
    expect(hasRegressionSelectionArgs(['--test-only', '--domain', 'workbench'])).toBe(true)
  })

  it('records an incremental retest with the unaffected baseline', () => {
    expect(
      readRegressionSelection([
        '--test-only',
        '--reused-from-tag',
        'windows-v0.1.48',
        '--case',
        'workspace-set-root-path',
        '--case',
        'user-message-actions'
      ])
    ).toEqual({
      workflowArgs: ['--case', 'workspace-set-root-path', '--case', 'user-message-actions'],
      state: {
        mode: 'incremental',
        caseIds: ['workspace-set-root-path', 'user-message-actions'],
        reusedFromTag: 'windows-v0.1.48'
      }
    })
    expect(() => readRegressionSelection(['--reused-from-tag', 'windows-v0.1.48'])).toThrow(
      '--reused-from-tag requires an explicit affected regression selection'
    )
  })

  it('rejects an incomplete hierarchy', () => {
    expect(() => readRegressionSelection(['--suite', 'result'])).toThrow(
      '--suite requires --domain'
    )
    expect(() => readRegressionSelection(['--domain', 'workbench', '--group', 'apply'])).toThrow(
      '--group requires --domain and --suite'
    )
  })
})
