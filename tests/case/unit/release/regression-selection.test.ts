import { describe, expect, it } from 'vitest'
import {
  hasRegressionSelectionArgs,
  readRegressionSelection,
  validateReleaseArgs
} from '../../../../scripts/release/regression.mjs'
import {
  includeGateFiles,
  mergeE2ETestResults,
  passedPackageTest,
  readTestCaseIds,
  runE2EGates
} from '../../../../scripts/test/e2e-results.mjs'

describe('release regression selection', () => {
  it('includes gates outside the selected domain exactly once and rejects missing gates', () => {
    const settings = '/tests/case/settings/general/language.e2e.test.ts'
    const gate = '/tests/case/workbench/conversation/prefix-cache-retain-live.e2e.test.ts'
    expect(includeGateFiles([settings, gate], [gate], ['prefix-cache-retain-live'])).toEqual([
      settings,
      gate
    ])
    expect(() => includeGateFiles([settings], [], ['prefix-cache-retain-live'])).toThrow(
      'gate not found'
    )
  })

  it('stops after a failed cache gate without starting later work', async () => {
    const executed: string[] = []
    const failure = await runE2EGates(
      ['parent-cache', 'child-cache', 'other-regression'],
      async (task: string) => {
        executed.push(task)
        return { code: task === 'child-cache' ? 1 : 0 }
      }
    )
    expect(executed).toEqual(['parent-cache', 'child-cache'])
    expect(failure).toEqual({ task: 'child-cache', code: 1 })
  })

  it('retains completed cases across partial retests and rejects source, skipped or mismatched evidence', () => {
    const app = { target: 'package', isPackaged: true, artifactSha256: 'a'.repeat(64) }
    const previous = {
      file: 'case.e2e.test.ts',
      targetId: 'macos-arm64',
      status: 'failed',
      exitCode: 1,
      cases: [
        { caseId: 'first', status: 'passed', app },
        { caseId: 'second', status: 'failed', app }
      ]
    }
    const current = {
      ...previous,
      status: 'passed',
      exitCode: 0,
      cases: [{ caseId: 'second', status: 'passed', app }]
    }
    const merged = mergeE2ETestResults([previous], [current])[0]
    expect(merged.cases.map((item: { caseId: string }) => item.caseId)).toEqual(['first', 'second'])
    expect(passedPackageTest(merged, app.artifactSha256)).toBe(true)
    expect(passedPackageTest(merged, 'b'.repeat(64))).toBe(false)
    expect(
      passedPackageTest(
        { ...merged, cases: [{ caseId: 'first', status: 'skipped', app }] },
        app.artifactSha256
      )
    ).toBe(false)
    expect(
      passedPackageTest(
        {
          ...merged,
          cases: [{ caseId: 'first', status: 'passed', app: { ...app, target: 'source' } }]
        },
        app.artifactSha256
      )
    ).toBe(false)
    expect(passedPackageTest({ ...merged, cases: [] }, app.artifactSha256)).toBe(false)
    expect(
      readTestCaseIds(
        'case.e2e.test.ts',
        "const CASE_ID = 'first'\nrunE2ECase({caseId: CASE_ID})\nrunE2ECase({caseId: 'second'})"
      )
    ).toEqual(['first', 'second'])
  })
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

  it('rejects unknown release arguments and missing values', () => {
    expect(() => validateReleaseArgs(['--test-only', '--unknown'])).toThrow(
      'unknown argument: --unknown'
    )
    expect(() => validateReleaseArgs(['--test-only', '--case'])).toThrow('--case requires a value')
  })
})
