import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { runHumanLiveCase } from '../../harness/humanLiveCase'
import { readLatestCaseReportArtifacts } from '../../harness/reportInspector'

const CASE_ID = 'human-missing-live-config-fail-fast'
const FIXTURE_SOURCE = path.resolve(process.cwd(), 'tests/ai/fixtures/workspace/human-input.txt')

const withClearedLiveEnv = async (run: () => Promise<void>): Promise<void> => {
  const backup = {
    AI_TEST_DISABLE_DOTENV: process.env.AI_TEST_DISABLE_DOTENV,
    AI_LIVE_BASE_URL: process.env.AI_LIVE_BASE_URL,
    AI_LIVE_MODEL_NAME: process.env.AI_LIVE_MODEL_NAME,
    AI_LIVE_API_KEY: process.env.AI_LIVE_API_KEY
  }

  process.env.AI_TEST_DISABLE_DOTENV = '1'
  delete process.env.AI_LIVE_BASE_URL
  delete process.env.AI_LIVE_MODEL_NAME
  delete process.env.AI_LIVE_API_KEY

  try {
    await run()
  } finally {
    if (backup.AI_TEST_DISABLE_DOTENV === undefined) delete process.env.AI_TEST_DISABLE_DOTENV
    else process.env.AI_TEST_DISABLE_DOTENV = backup.AI_TEST_DISABLE_DOTENV
    if (backup.AI_LIVE_BASE_URL === undefined) delete process.env.AI_LIVE_BASE_URL
    else process.env.AI_LIVE_BASE_URL = backup.AI_LIVE_BASE_URL
    if (backup.AI_LIVE_MODEL_NAME === undefined) delete process.env.AI_LIVE_MODEL_NAME
    else process.env.AI_LIVE_MODEL_NAME = backup.AI_LIVE_MODEL_NAME
    if (backup.AI_LIVE_API_KEY === undefined) delete process.env.AI_LIVE_API_KEY
    else process.env.AI_LIVE_API_KEY = backup.AI_LIVE_API_KEY
  }
}

describe('human-live/regression', () => {
  test('缺失 live 配置时应 fail-fast 且报告可定位', async () => {
    await withClearedLiveEnv(async () => {
      await expect(
        runHumanLiveCase({
          caseId: CASE_ID,
          description: '验证 human-live 缺失模型配置时 fail-fast 并输出可定位报告。',
          objective: '读取 input.txt 第一行并完成任务。',
          requiredFixtures: [FIXTURE_SOURCE],
          fixtureCopies: [{ from: FIXTURE_SOURCE, to: 'input.txt' }],
          approvalPolicy: 'auto-approve',
          assert: async () => {}
        })
      ).rejects.toThrow('human-live 缺少模型配置')
    })

    const report = await readLatestCaseReportArtifacts('human-live', CASE_ID)
    expect(report.assertions.status).toBe('failed')
    expect(report.metrics.failure_category).toBe('human_live_execution_error')
    expect(report.summary).toContain('AI_LIVE_BASE_URL')
    expect(report.summary).toContain('AI_LIVE_MODEL_NAME')
    expect(report.summary).toContain('AI_LIVE_API_KEY')
  })
})
