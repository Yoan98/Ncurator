import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { runRuntimeCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const CASE_ID = 'runtime-missing-fixture-fail-fast'
const MISSING_FIXTURE = path.resolve(
  process.cwd(),
  'tests/fixtures/main/docx/not-exists-for-fail-fast.docx'
)

describe('main/ai/runtime/regression', () => {
  test('缺失 fixture 时应 fail-fast 且报告可定位', async () => {
    await expect(
      runRuntimeCase({
        caseId: CASE_ID,
        description: '验证 main ai runtime suite 在 fixture 缺失时 fail-fast，并输出可定位报告。',
        requiredFixtures: [MISSING_FIXTURE],
        fixtureCopies: [],
        execute: async () => {
          throw new Error('execute should not be called when fixture is missing')
        },
        assert: async () => {}
      })
    ).rejects.toThrow('缺少测试前置文件')

    const report = await readLatestCaseReportArtifacts('main-ai-runtime', CASE_ID)
    expect(report.assertions.caseStatus).toBe('failed')
    expect(report.metrics.caseErrorCode).toBe('fixture_missing')
    expect(report.metrics.executionStatus).toBe('not_run')
    expect(report.summary).toContain('缺少测试前置文件')
    expect(report.summary).toContain(MISSING_FIXTURE)
  })
})
