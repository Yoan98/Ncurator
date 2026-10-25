import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { UserSkillService } from '../../../../../src/main/services/skills/UserSkillService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'

const CASE_ID = 'human-user-skill-live'
const SKILL_NAMES = ['customer-weekly', 'risk-actions', 'meeting-minutes']
const OUTPUTS = [
  '交付/客户周报.md',
  '交付/风险行动清单.csv',
  '交付/客户周报-更新版.md',
  '交付/风险行动清单-更新版.csv'
]
const UPDATED_RULE =
  '本团队的新版清单还须在末尾增加「复核人」「验收证据」两列。复核人按本轮补充事实填写；验收证据写明实际收到的材料或仍需取得的确认，不编造已经验收。'
const readCsv = async (filename: string): Promise<string[][]> => {
  const workbook = new ExcelJS.Workbook()
  const sheet = await workbook.csv.readFile(filename)
  const rows: string[][] = []
  sheet.eachRow((row) => {
    const cells: string[] = []
    row.eachCell({ includeEmpty: true }, (cell) => cells.push(cell.text))
    rows.push(cells)
  })
  return rows
}
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

describe('ai human user skill live', () => {
  it(
    CASE_ID,
    async () => {
      await runBackendCase({
        caseId: CASE_ID,
        harnessMode: 'live',
        knowledge: 'none',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '多源客户周报与风险行动清单：选择互补技能、核对冲突与责任、两轮恢复并采用更新规范；质量依实际产物评分。',
        fixtures: [
          'tests/fixtures/workspace/工作',
          ...SKILL_NAMES.map((name) => `tests/fixtures/skills/${name}`)
        ],
        outputFiles: OUTPUTS,
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          const partnerId = 'user-skill-live-partner'
          await runtime.partnerStore.savePartner({
            id: partnerId,
            name: '客户交付',
            avatar_shape: 'circle',
            avatar_color: 'blue',
            created_at: Date.now(),
            updated_at: Date.now(),
            last_viewed_at: Date.now(),
            pinned: false,
            pinned_at: null
          })
          const service = new UserSkillService(
            runtime.storageService.partnerSkills,
            path.join(runtime.workspaceRoot, '.ncurator-test', 'skill-assets')
          )
          const skills = SKILL_NAMES.map((name) => {
            const preview = service.prepareImport(path.join(runtime.workspaceRoot, 'skills', name))
            return service.commitImport({ ...preview, replaceName: null })
          })
          service.setEnabled(
            partnerId,
            skills.map((skill) => skill.name)
          )
          await fs.rm(path.join(runtime.workspaceRoot, 'skills'), { recursive: true })
          const sources = await Promise.all(
            runtime.fixtureBindings
              .filter((binding) => binding.workspacePath.includes(`${path.sep}工作${path.sep}`))
              .map(async (binding) => ({
                file: binding.workspacePath,
                hash: hash(await fs.readFile(binding.workspacePath))
              }))
          )
          const first = await createAiServiceTestRunner(runtime, {
            partnerId,
            runId: `${runtime.runId}-first`,
            userSkillService: service,
            userInput:
              '请基于工作目录里的资料，整理本周可供客户审阅的项目周报，同时给我一份内部跟进用的风险行动清单。参考上周外发稿的语气，核对资料里的不同说法，重点说明现在是否能收口、谁牵头、各方接下来做什么。周报存为交付/客户周报.md，清单存为交付/风险行动清单.csv。'
          })
          const firstResult = await first.run()
          const firstFiles = await Promise.all(
            OUTPUTS.slice(0, 2).map((file) => fs.readFile(path.join(runtime.workspaceRoot, file)))
          )
          const riskSkill = skills.find((skill) => skill.name === 'risk-actions')!
          const document = service.getDocument(riskSkill.name)
          service.update({
            originalName: riskSkill.name,
            name: document.name,
            description: document.description,
            body: `${document.body}\n${UPDATED_RULE}\n`
          })
          const second = await createAiServiceTestRunner(runtime, {
            partnerId,
            runId: `${runtime.runId}-second`,
            userSkillService: service,
            userInput:
              '补充最新进展：Bob 已补齐付款材料，附件已提交复核；Alice 已确认周四15点复核窗口，最终合规签署还未完成。本轮由 Carol 复核清单，已收到的付款回执编号是 FIN-2406。请结合原资料和这次进展更新两份交付，采用团队最新规范，分别另存交付/客户周报-更新版.md和交付/风险行动清单-更新版.csv，保留上版。'
          })
          const secondResult = await second.run()
          return {
            firstResult,
            secondResult,
            firstFiles,
            reports: await Promise.all(
              [OUTPUTS[0], OUTPUTS[2]].map((file) =>
                fs.readFile(path.join(runtime.workspaceRoot, file), 'utf8')
              )
            ),
            csv: await Promise.all(
              [OUTPUTS[1], OUTPUTS[3]].map((file) =>
                readCsv(path.join(runtime.workspaceRoot, file))
              )
            ),
            originalsPreserved: (
              await Promise.all(
                OUTPUTS.slice(0, 2).map(
                  async (file, index) =>
                    hash(await fs.readFile(path.join(runtime.workspaceRoot, file))) ===
                    hash(firstFiles[index])
                )
              )
            ).every(Boolean),
            sourcesPreserved: (
              await Promise.all(
                sources.map(async (source) => hash(await fs.readFile(source.file)) === source.hash)
              )
            ).every(Boolean),
            events: [...first.events, ...second.events],
            firstIo: first.io,
            secondIo: second.io
          }
        },
        assert: async (result, runtime) => {
          const loadCalls = result.events.filter(
            (event) => event.type === 'tool_call_started' && event.toolName === 'load_skill'
          )
          const loadedNames = loadCalls.flatMap((event) =>
            event.type === 'tool_call_started' && Array.isArray(event.input.skillNames)
              ? event.input.skillNames.map(String)
              : []
          )
          const firstWire = JSON.stringify(
            result.firstIo.map((record) => record.requestWire?.messages)
          )
          const restoredSystem = JSON.stringify(
            result.secondIo[0]?.requestWire?.messages.filter((message) => message.role === 'system')
          )
          runtime.assertThat(
            result.firstResult.status === 'completed' && result.secondResult.status === 'completed',
            {
              name: 'two-round-production-completion',
              message: '两轮均经生产 AI 入口完成。'
            }
          )
          runtime.assertThat(
            ['customer-weekly', 'risk-actions'].every((name) => loadedNames.includes(name)) &&
              firstWire.includes('# 客户周报规范') &&
              firstWire.includes('# 风险行动清单规范') &&
              firstWire.includes('客户同步稿 / CW-2026') &&
              firstWire.includes('列顺序：事项') &&
              restoredSystem.includes('# 客户周报规范') &&
              restoredSystem.includes(UPDATED_RULE),
            {
              name: 'name-loading-resources-and-current-rules',
              message: '按名称加载互补技能，资源真实进入模型；下一轮恢复状态并读取更新后的正文。',
              data: { loadedNames }
            }
          )
          runtime.assertThat(
            result.csv.every(
              (rows) =>
                rows.length > 1 &&
                rows[0].length >= 8 &&
                rows.every((row) => row.length === rows[0].length)
            ) && result.reports.every((report) => report.length > 100),
            {
              name: 'deliverables-readable',
              message: '两版 Markdown 与标准 CSV 均可读取，清单各行列数一致。'
            }
          )
          runtime.assertThat(result.sourcesPreserved && result.originalsPreserved, {
            name: 'source-and-first-delivery-preserved',
            message: '业务原件和首版交付的内容哈希保持不变。'
          })
          runtime.recordEvent({
            type: 'signal',
            name: 'skill-quality-evidence',
            status: 'info',
            message: '客观断言完成；按 ai-test 的十分制审阅实际产物后记录质量评分。',
            data: {
              reports: result.reports,
              csv: result.csv,
              loadedNames,
              usages: [...result.firstIo, ...result.secondIo].map((record) => ({
                runId: record.runId,
                usage: record.usage ?? null
              }))
            }
          })
        }
      })
    },
    900_000
  )
})
