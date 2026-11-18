import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  backendEvidenceHash,
  backendEnvironmentHash,
  backendRuntimeHash,
  captureBackendIdentity,
  importLegacyBackendReport,
  importVitestBackendReport,
  planBackendResume
} from '../../../../scripts/test/backend-evidence.mjs'

const file = 'tests/case/unit/example.test.ts'
const identity = {
  commit: 'a'.repeat(40),
  files: {
    [file]: 'one',
    'src/main.ts': 'product',
    'pnpm-lock.yaml': 'lock',
    'tests/harness/x.ts': 'harness',
    'vitest.backend.config.mts': 'config'
  },
  runtime: { nodeVersion: 'v22', envSha256: 'env' }
}
const text = ` RUN  v4.0.18 /repo\n ✓ ${file} (3 tests | 1 skipped) 10ms\n Test Files  1 passed (1)\n      Tests  2 passed | 1 skipped (3)\n Duration  1s\n`
const input = (report = text) => ({
  text: report,
  expectedSha256: backendEvidenceHash(report),
  identity,
  expectedFiles: [file],
  provenance: {
    commit: identity.commit,
    cleanTree: true,
    statement: 'Verified clean checkout at start from saved release session.'
  }
})
const plan = (
  attempts: unknown[],
  currentIdentity = identity,
  files = [file],
  approvedSchedulingChanges: unknown[] = []
) => planBackendResume({ attempts, currentIdentity, files, approvedSchedulingChanges })

describe('backend evidence', () => {
  it('captures commit blobs with binary streaming and ignores docs/generated files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'backend-evidence-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    try {
      git('init')
      git('config', 'user.email', 'fixture@example.test')
      git('config', 'user.name', 'Fixture')
      await mkdir(path.join(root, 'src'))
      await mkdir(path.join(root, 'doc'))
      const blob = Buffer.alloc(250_000, 10)
      blob[100] = 0
      blob[101] = 255
      await writeFile(path.join(root, 'src/binary.bin'), blob)
      await writeFile(path.join(root, 'src/empty.ts'), '')
      await writeFile(path.join(root, 'doc/notes.md'), 'ignored')
      await writeFile(path.join(root, '.gitignore'), 'generated/\n')
      git('add', '.')
      git('commit', '-m', 'fixture')
      const before = await captureBackendIdentity({ root, ref: 'HEAD' })
      expect(before.files['src/binary.bin']).toBe(backendEvidenceHash(blob))
      expect(before.files['src/empty.ts']).toBe(backendEvidenceHash(''))
      expect(before.files['doc/notes.md']).toBeUndefined()
      await mkdir(path.join(root, 'generated'))
      await writeFile(path.join(root, 'generated/large'), 'ignored')
      expect((await captureBackendIdentity({ root })).files).toEqual(before.files)
      await writeFile(path.join(root, 'src/empty.ts'), 'changed')
      expect((await captureBackendIdentity({ root, ref: 'HEAD' })).files).toEqual(before.files)
      expect((await captureBackendIdentity({ root })).files).not.toEqual(before.files)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it.each([
    '',
    '.',
    '../escape.test.ts',
    'tests/case/unit/../bad.test.ts',
    'src/main.ts',
    'tests/case/unit/missing.test.ts'
  ])('rejects invalid single-file selection %s', (candidate) => {
    expect(() => plan([], identity, [candidate])).toThrow()
  })
  it('preserves skips, source identity and hash; never invents individual passing tests', () => {
    const attempt = importLegacyBackendReport(input())
    expect(attempt.results[file]).toEqual({ status: 'passed', passed: 2, failed: 0, skipped: 1 })
    expect(plan([attempt]).complete).toBe(true)
  })
  it('rejects changed report, missing provenance, duplicate runs and incomplete summaries', () => {
    expect(() => importLegacyBackendReport({ ...input(), text: text + 'altered' })).toThrow('hash')
    expect(() => importLegacyBackendReport({ ...input(), provenance: {} })).toThrow('provenance')
    expect(() => importLegacyBackendReport(input(text + text))).toThrow()
    expect(() => importLegacyBackendReport(input(text + '\n Errors  1 error\n'))).toThrow(
      'unhandled'
    )
    expect(() =>
      importLegacyBackendReport(input(text.replace(' Test Files  1 passed (1)', '')))
    ).toThrow()
    expect(() =>
      importLegacyBackendReport(input(text.replace('2 passed | 1 skipped (3)', '3 passed (3)')))
    ).toThrow()
    expect(() =>
      importLegacyBackendReport({
        ...input(),
        expectedFiles: [file, 'tests/case/unit/missing.test.ts']
      })
    ).toThrow()
  })
  it.each(['src/main.ts', 'pnpm-lock.yaml', 'tests/harness/x.ts', 'vitest.backend.config.mts'])(
    'rejects changes to protected %s',
    (changed) => {
      const current = { ...identity, files: { ...identity.files, [changed]: 'changed' } }
      expect(() => plan([importLegacyBackendReport(input())], current)).toThrow(
        'protected source changed'
      )
    }
  )
  it('reruns only changed/new tests but fails closed on runtime changes', () => {
    const attempt = importLegacyBackendReport(input())
    const added = 'tests/case/unit/new.test.ts'
    const current = { ...identity, files: { ...identity.files, [added]: 'new' } }
    expect(plan([attempt], current, [file, added]).pending).toEqual([added])
    expect(
      plan([attempt], { ...current, files: { ...current.files, [file]: 'changed' } }, [file, added])
        .pending
    ).toEqual([file, added])
    expect(() =>
      plan([attempt], { ...identity, runtime: { ...identity.runtime, envSha256: 'changed' } })
    ).toThrow('runtime')
  })
  it('permits only exact reviewed scheduler transitions and records them', () => {
    const attempt = importLegacyBackendReport(input()),
      path = 'scripts/test/backend-evidence.mjs'
    const current = { ...identity, files: { ...identity.files, [path]: 'new' } }
    expect(() => plan([attempt], current)).toThrow()
    const approvals = [
      {
        path,
        from: null,
        to: 'new',
        impact: 'Adds evidence reader, no execution semantics changed.'
      }
    ]
    expect(plan([attempt], current, [file], approvals).approvedSchedulingChanges).toEqual(approvals)
    expect(() => plan([attempt], current, [file], [{ ...approvals[0], to: 'other' }])).toThrow()
  })
  it('keeps failed attempts and never falls back to an older pass', () => {
    const passed = importLegacyBackendReport(input())
    const failed = importLegacyBackendReport(
      input(
        text
          .replace('✓', '❯')
          .replace('3 tests | 1 skipped', '3 tests | 1 failed | 1 skipped')
          .replace('1 passed (1)', '1 failed (1)')
          .replace('2 passed | 1 skipped', '1 failed | 1 passed | 1 skipped')
      )
    )
    expect(plan([passed, failed]).pending).toEqual([file])
    expect(() => plan([{ ...passed, results: {} }])).toThrow('integrity')
  })
  it('requires independent complete legacy purity audits and exact runtime/source binding', () => {
    const old = {
      ...identity,
      files: {
        ...identity.files,
        [file]: backendEvidenceHash('test'),
        'src/main.ts': backendEvidenceHash('product')
      },
      runtime: {
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v22',
        environmentSha256: null,
        environmentEvidence: 'not-recorded'
      }
    }
    const attempt = importLegacyBackendReport({ ...input(), identity: old })
    const current = {
      ...old,
      runtime: {
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v22',
        environmentSha256: backendEvidenceHash('current-env')
      }
    }
    const audit = {
      attemptId: attempt.id,
      file,
      testHash: old.files[file],
      dependencyHashes: { [file]: old.files[file], 'src/main.ts': old.files['src/main.ts'] },
      currentRuntimeHash: backendRuntimeHash(current.runtime),
      review: {
        method: 'transitive-pure-dependency-audit',
        statement: 'External AST audit found no environment access in this complete closure.'
      }
    }
    const check = (audits: unknown[], target = current) =>
      planBackendResume({
        attempts: [attempt],
        currentIdentity: target,
        files: [file],
        legacyEnvironmentAudits: audits
      })
    expect(check([]).pending).toEqual([file])
    expect(check([audit]).reuse[0].environmentAudit).toEqual(audit)
    for (const invalid of [
      { ...audit, dependencyHashes: {} },
      { ...audit, dependencyHashes: { 'src/main.ts': old.files['src/main.ts'] } },
      {
        ...audit,
        dependencyHashes: { ...audit.dependencyHashes, unknown: backendEvidenceHash('x') }
      },
      {
        ...audit,
        dependencyHashes: { ...audit.dependencyHashes, 'src/main.ts': backendEvidenceHash('wrong') }
      },
      { ...audit, testHash: 'wrong' },
      { ...audit, currentRuntimeHash: 'wrong' },
      { ...audit, attemptId: 'wrong' },
      { ...audit, file: 'tests/case/unit/another.test.ts' },
      { ...audit, review: { method: 'trust-me', statement: 'pure' } },
      { ...audit, review: { method: 'transitive-pure-dependency-audit', statement: '' } }
    ])
      expect(check([invalid]).pending).toEqual([file])
    expect(check([audit, audit]).pending).toEqual([file])
    const second = 'tests/case/unit/another.test.ts'
    const bothText = text
      .replace(' Test Files  1 passed (1)', ` ✓ ${second} (1 test) 1ms\n Test Files  2 passed (2)`)
      .replace('2 passed | 1 skipped (3)', '3 passed | 1 skipped (4)')
    const bothIdentity = {
      ...old,
      files: { ...old.files, [second]: backendEvidenceHash('second-test') }
    }
    const both = importLegacyBackendReport({
      ...input(bothText),
      identity: bothIdentity,
      expectedFiles: [file, second]
    })
    const bothPlan = planBackendResume({
      attempts: [both],
      currentIdentity: { ...current, files: bothIdentity.files },
      files: [file, second],
      legacyEnvironmentAudits: [{ ...audit, attemptId: both.id }]
    })
    expect(bothPlan.reuse.map((entry: { file: string }) => entry.file)).toEqual([file])
    expect(bothPlan.pending).toEqual([second])

    expect(() =>
      check([audit], { ...current, runtime: { ...current.runtime, arch: 'x64' } })
    ).toThrow('base identity')
    expect(
      check([audit], {
        ...current,
        runtime: { ...current.runtime, environmentSha256: backendEvidenceHash('different-env') }
      }).pending
    ).toEqual([file])
    expect(() =>
      check([audit], {
        ...current,
        files: { ...current.files, 'src/main.ts': backendEvidenceHash('changed') }
      })
    ).toThrow('protected source')
  })
  it('binds semantic inherited environment and env file bytes without exposing values', () => {
    const env = {
      PATH: '/tools',
      MODEL: 'secret-model',
      PYTHONPATH: '/python',
      npm_config_registry: 'registry',
      TERM: 'xterm',
      npm_lifecycle_event: 'test',
      CODEX_TOOL_CALL_ID: 'call-1',
      CODEX_NETWORK_POLICY: 'restricted'
    }
    const original = backendEnvironmentHash(env, 'TOKEN=secret')
    expect(original).toMatch(/^[a-f0-9]{64}$/)
    expect(original).not.toContain('secret')
    expect(
      backendEnvironmentHash(
        { ...env, TERM: 'dumb', npm_lifecycle_event: 'release', CODEX_TOOL_CALL_ID: 'call-2' },
        'TOKEN=secret'
      )
    ).toBe(original)
    for (const key of [
      'PATH',
      'MODEL',
      'PYTHONPATH',
      'npm_config_registry',
      'CODEX_NETWORK_POLICY'
    ])
      expect(backendEnvironmentHash({ ...env, [key]: 'changed' }, 'TOKEN=secret')).not.toBe(
        original
      )
    expect(backendEnvironmentHash(env, 'TOKEN=changed')).not.toBe(original)
  })
  it('validates structured reports without masking suite failures', () => {
    const report = JSON.stringify({
      success: true,
      numTotalTestSuites: 1,
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: [
        { name: '/repo/' + file, status: 'passed', assertionResults: [{ status: 'passed' }] }
      ]
    })
    for (const [key, value] of Object.entries({
      numRuntimeErrorTestSuites: 1,
      numUnhandledErrors: 1,
      unhandledErrors: ['boom'],
      unhandledRejections: ['boom'],
      errors: ['boom'],
      testExecError: { message: 'boom' }
    })) {
      const unsafe = JSON.stringify({ ...JSON.parse(report), [key]: value })
      expect(() =>
        importVitestBackendReport({ ...input(unsafe), root: '/repo', processExitCode: 0 })
      ).toThrow('unhandled')
    }
    const attempt = importVitestBackendReport({
      ...input(report),
      root: '/repo',
      processExitCode: 0
    })
    expect(plan([attempt]).complete).toBe(true)
    expect(attempt.provenance).toMatchObject({
      sourceBinding: 'caller-bound-source',
      processExitCode: 0
    })
    expect(attempt.provenance).not.toHaveProperty('capturedAtRun')
    for (const code of [undefined, null, 1, 2])
      expect(() =>
        importVitestBackendReport({ ...input(report), root: '/repo', processExitCode: code })
      ).toThrow()
    expect(() =>
      importVitestBackendReport({
        ...input(report),
        root: '/repo',
        processExitCode: 0,
        processSignal: 'SIGTERM'
      })
    ).toThrow()
    const absentSuccess = JSON.parse(report)
    delete absentSuccess.success
    expect(() =>
      importVitestBackendReport({
        ...input(JSON.stringify(absentSuccess)),
        root: '/repo',
        processExitCode: 0
      })
    ).toThrow('success')
    const second = 'tests/case/unit/failed.test.ts'
    const partial = JSON.parse(report)
    partial.success = false
    partial.numTotalTestSuites = 2
    partial.numTotalTests = 2
    partial.numFailedTests = 1
    partial.testResults.push({
      name: '/repo/' + second,
      status: 'failed',
      assertionResults: [{ status: 'failed' }]
    })
    const partialInput = {
      ...input(JSON.stringify(partial)),
      identity: { ...identity, files: { ...identity.files, [second]: 'failed-source' } },
      expectedFiles: [file, second],
      root: '/repo',
      processExitCode: 1
    }
    const failedAttempt = importVitestBackendReport(partialInput)
    expect(failedAttempt.results[file].status).toBe('passed')
    expect(failedAttempt.results[second].status).toBe('failed')
    expect(() => importVitestBackendReport({ ...partialInput, processExitCode: 0 })).toThrow(
      'outcome'
    )

    expect(() =>
      importVitestBackendReport({
        ...input(report.replace('"numTotalTests":1', '"numTotalTests":2')),
        root: '/repo',
        processExitCode: 0
      })
    ).toThrow('summary')
  })
})
