import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  hasRegressionSelectionArgs,
  readRegressionSelection,
  validateReleaseArgs
} from '../../../../scripts/release/regression.mjs'
import {
  mergeE2ETestResults,
  passedPackageTest,
  readTestCaseIds,
  runE2EGates
} from '../../../../scripts/test/e2e-results.mjs'
import { findTestFiles } from '../../../../scripts/test/workflow.mjs'

const providerMatrixFile = path.resolve(
  'tests/case/workbench/conversation/provider-matrix/live-preset-provider-smoke.e2e.test.ts'
)

const defaultScope = {
  domain: '',
  suite: '',
  groups: [] as string[],
  excludeGroups: [] as string[],
  caseIds: [] as string[],
  type: 'e2e',
  target: 'source'
}

describe('release regression selection', () => {
  it.each([
    { name: 'full workflow', scope: { type: '' } },
    { name: 'source E2E', scope: {} },
    { name: 'package E2E', scope: { target: 'package' } },
    { name: 'Workbench', scope: { domain: 'workbench' } },
    { name: 'conversation suite', scope: { domain: 'workbench', suite: 'conversation' } }
  ])('excludes the provider matrix from $name discovery', async ({ scope }) => {
    const files = await findTestFiles({ ...defaultScope, ...scope })
    expect(files.length).toBeGreaterThan(0)
    expect(files).not.toContain(providerMatrixFile)
  })

  it('does not enable the provider matrix through a group filter', async () => {
    expect(
      await findTestFiles({
        ...defaultScope,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['provider-matrix']
      })
    ).toEqual([])
  })

  it.each(['source', 'package'])(
    'enables the provider matrix by exact case for %s',
    async (target) => {
      expect(
        await findTestFiles({
          ...defaultScope,
          target,
          caseIds: ['live-preset-provider-smoke']
        })
      ).toEqual([providerMatrixFile])
      expect(await findTestFiles({ ...defaultScope, target, caseIds: ['live-preset'] })).toEqual([])
    }
  )

  it('keeps other explicitly selected cases alongside the provider matrix', async () => {
    const caseIds = ['live-preset-provider-smoke', 'model-selector-and-provider-error']
    const selection = readRegressionSelection([
      '--test-only',
      '--case',
      caseIds[0],
      '--case',
      caseIds[1]
    ])
    const files = await findTestFiles({ ...defaultScope, caseIds: selection.state.cases })
    expect(files).toEqual(
      [
        providerMatrixFile,
        path.resolve(
          'tests/case/workbench/conversation/composer/model-selector-and-provider-error.e2e.test.ts'
        )
      ].sort()
    )
    expect(
      await findTestFiles({
        ...defaultScope,
        domain: 'workbench',
        suite: 'conversation',
        excludeGroups: ['provider-matrix'],
        caseIds: [caseIds[0]]
      })
    ).toEqual([])
  })

  it('executes CLI entry points through a directory alias instead of silently exiting', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ncurator-release-entry-'))
    const alias = path.join(root, 'repository')
    try {
      await symlink(process.cwd(), alias, process.platform === 'win32' ? 'junction' : 'dir')
      const help = execFileSync(
        process.execPath,
        [path.join(alias, 'scripts/test/workflow.mjs'), '--help'],
        { encoding: 'utf8' }
      )
      expect(help).toContain('--target <source|package>')
      try {
        execFileSync(process.execPath, [path.join(alias, 'scripts/release/regression.mjs')], {
          stdio: 'pipe'
        })
        throw new Error('release regression entry point was not executed')
      } catch (error) {
        expect(String((error as { stderr?: Buffer }).stderr)).toContain(
          'requires bundle and result paths'
        )
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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

  it('preserves group filters without opting in to the provider matrix', () => {
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
