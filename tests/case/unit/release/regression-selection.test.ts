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
        cases: ['WB-RESULT-001'],
        freshKnowledgeCache: true
      }
    })
    expect(hasRegressionSelectionArgs(['--test-only', '--domain', 'workbench'])).toBe(true)
  })

  it('forwards multiple cases across domains and records them', () => {
    expect(
      readRegressionSelection([
        '--test-only',
        '--case',
        'web-read-direct-url',
        '--case',
        'workspace-interrupted-jobs-recovery'
      ])
    ).toEqual({
      workflowArgs: [
        '--case',
        'web-read-direct-url',
        '--case',
        'workspace-interrupted-jobs-recovery'
      ],
      state: {
        mode: 'selected',
        cases: ['web-read-direct-url', 'workspace-interrupted-jobs-recovery']
      }
    })
  })

  it('allows opt-in groups to be selected for release impact assessment', () => {
    expect(
      readRegressionSelection([
        '--test-only',
        '--domain',
        'workbench',
        '--suite',
        'conversation',
        '--group',
        'provider-matrix'
      ]).state
    ).toMatchObject({
      mode: 'selected',
      domain: 'workbench',
      suite: 'conversation',
      groups: ['provider-matrix']
    })
    expect(
      readRegressionSelection([
        '--test-only',
        '--domain',
        'workbench',
        '--suite',
        'result',
        '--group',
        'wps-office'
      ]).state
    ).toMatchObject({
      mode: 'selected',
      domain: 'workbench',
      suite: 'result',
      groups: ['wps-office']
    })
  })

  it('rejects the independent showcase suite and group at release command parsing', () => {
    expect(() =>
      readRegressionSelection(['--test-only', '--domain', 'workbench', '--suite', 'showcase'])
    ).toThrow('不允许选择 showcase')
    expect(() =>
      readRegressionSelection([
        '--test-only',
        '--domain',
        'workbench',
        '--suite',
        'conversation',
        '--group',
        'showcase'
      ])
    ).toThrow('不允许选择 showcase')
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
