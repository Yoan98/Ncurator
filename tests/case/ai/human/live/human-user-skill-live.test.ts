import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { UserSkillService } from '../../../../../src/main/services/skills/UserSkillService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'

const CASE_ID = 'human-user-skill-live'
type Report = {
  ruleVersion: string
  status: string
  progress: string[]
  risks: string[]
  nextSteps: string[]
}
describe('ai human user skill live', () => {
  it(
    CASE_ID,
    async () => {
      await runBackendCase({
        caseId: CASE_ID,
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '真实 AI 按名称使用技能、相对资源和业务规则，第二轮恢复说明。',
        fixtures: ['tests/fixtures/workspace/skills/weekly-report'],
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          await runtime.seedLlmConfig(loadLiveLlmConfigFromEnv())
          const partnerId = 'user-skill-live-partner'
          await runtime.partnerStore.savePartner({
            id: partnerId,
            name: '周报规范伙伴',
            avatar_shape: 'circle',
            avatar_color: 'blue',
            created_at: Date.now(),
            updated_at: Date.now(),
            last_viewed_at: Date.now(),
            pinned: false,
            pinned_at: null
          })
          const service = new UserSkillService(
            runtime.storageService.userSkill,
            path.join(runtime.workspaceRoot, '.ncurator-test', 'skill-assets')
          )
          const source = path.join(runtime.workspaceRoot, 'skills', 'weekly-report')
          const preview = service.prepareImport(source)
          const skill = service.commitImport({ token: preview.token, replaceExisting: false })
          service.setEnabled(partnerId, [skill.id])
          await fs.rm(source, { recursive: true })
          const first = await createAiServiceTestRunner(runtime, {
            partnerId,
            runId: `${runtime.runId}-first`,
            userSkillService: service,
            userInput: `请按照已配置的周报归档规范整理本周进展，保存为 ${path.join(runtime.workspaceRoot, 'report-one.json')}。事实：完成客户访谈；接口联调因外部排期延后；下周继续联调并提交第一版方案。`
          })
          const firstResult = await first.run()
          const second = await createAiServiceTestRunner(runtime, {
            partnerId,
            runId: `${runtime.runId}-second`,
            userSkillService: service,
            userInput: `继续沿用周报归档规范，另存为 ${path.join(runtime.workspaceRoot, 'report-two.json')}。事实：完成方案初稿；仍等待外部联调窗口；下周确认窗口。`
          })
          const secondResult = await second.run()
          const reportOne = JSON.parse(
            await fs.readFile(path.join(runtime.workspaceRoot, 'report-one.json'), 'utf8')
          ) as Report
          const reportTwo = JSON.parse(
            await fs.readFile(path.join(runtime.workspaceRoot, 'report-two.json'), 'utf8')
          ) as Report
          return {
            firstResult,
            secondResult,
            reportOne,
            reportTwo,
            events: [...first.events, ...second.events],
            firstIo: first.io,
            secondIo: second.io
          }
        },
        assert: async (result, runtime) => {
          const loadedByName = result.events.some(
            (event) =>
              event.type === 'tool_call_started' &&
              event.toolName === 'load_skill' &&
              Array.isArray(event.input.skillNames) &&
              event.input.skillNames.includes('weekly-report')
          )
          const validReport = (report: Report) =>
            report.ruleVersion === 'NC-SKILL-REPORT-314' &&
            report.status === 'waiting-external' &&
            Array.isArray(report.progress) &&
            report.progress.length > 0 &&
            Array.isArray(report.risks) &&
            report.risks.length > 0 &&
            Array.isArray(report.nextSteps) &&
            report.nextSteps.length > 0
          runtime.assertThat(
            result.firstResult.status === 'completed' &&
              result.secondResult.status === 'completed' &&
              loadedByName &&
              validReport(result.reportOne) &&
              validReport(result.reportTwo) &&
              result.firstIo.some((record) =>
                record.requestWire?.messages.some(
                  (message) =>
                    message.role === 'system' && String(message.content).includes('# 周报归档规范')
                )
              ) &&
              result.firstIo.some((record) => record.user.includes('NC-SKILL-REPORT-314')) &&
              result.secondIo[0]?.requestWire?.messages.some(
                (message) =>
                  message.role === 'system' && String(message.content).includes('# 周报归档规范')
              ) === true,
            {
              name: 'user-skill-live-delivery',
              message: '真实模型应按名称加载技能、读取资源，生成符合独有规则的两份产物并恢复说明。',
              data: {
                loadedByName,
                firstStatus: result.firstResult.status,
                secondStatus: result.secondResult.status,
                reportOne: result.reportOne,
                reportTwo: result.reportTwo,
                usages: [...result.firstIo, ...result.secondIo].map((record) => ({
                  runId: record.runId,
                  usage: record.usage ?? null
                }))
              }
            }
          )
        }
      })
    },
    600_000
  )
})
