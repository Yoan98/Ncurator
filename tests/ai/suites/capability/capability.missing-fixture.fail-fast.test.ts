import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { runCapabilityCase } from '../../harness/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../harness/reportInspector'

const CASE_ID = 'capability-missing-fixture-fail-fast'
const MISSING_FIXTURE = path.resolve(
  process.cwd(),
  'tests/ai/fixtures/docx/not-exists-for-fail-fast.docx'
)

describe('capability/regression', () => {
  test('缺失 fixture 时应 fail-fast 且报告可定位', async () => {
    await expect(
      runCapabilityCase({
        caseId: CASE_ID,
        description: '验证 capability 在 fixture 缺失时 fail-fast，并输出可定位报告。',
        requiredFixtures: [MISSING_FIXTURE],
        fixtureCopies: [],
        execute: async () => {
          throw new Error('execute should not be called when fixture is missing')
        },
        assert: async () => {}
      })
    ).rejects.toThrow('缺少测试前置文件')

    const report = await readLatestCaseReportArtifacts('capability', CASE_ID)
    expect(report.assertions.caseStatus).toBe('failed')
    expect(report.metrics.caseErrorCode).toBe('fixture_missing')
    expect(report.metrics.executionStatus).toBe('not_run')
    expect(report.summary).toContain('缺少测试前置文件')
    expect(report.summary).toContain(MISSING_FIXTURE)
  })
})
