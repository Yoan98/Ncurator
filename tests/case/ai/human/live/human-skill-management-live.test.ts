import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { describe, it } from 'vitest'
import { UserSkillService } from '../../../../../src/main/services/skills/UserSkillService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { loadLiveLlmConfigFromEnv } from '../../../../harness/backend/llmConfig'
import { createAiServiceTestRunner } from '../../../../harness/backend/aiServiceHarness'

const CASE_ID = 'human-skill-management-live'
const OUTPUTS = [
  '交付/客户周报-v1.md',
  '交付/行动清单-v1.csv',
  '交付/客户周报-v2.md',
  '交付/行动清单-v2.csv'
]
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const csv = async (file: string) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = await workbook.csv.readFile(file)
  const rows: string[][] = []
  sheet.eachRow((row) => {
    const cells: string[] = []
    row.eachCell({ includeEmpty: true }, (cell) => cells.push(cell.text))
    rows.push(cells)
  })
  return rows
}

describe('skill management quality live', () => {
  it(
    CASE_ID,
    async () =>
      runBackendCase({
        caseId: CASE_ID,
        harnessMode: 'live',
        knowledge: 'none',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description:
          '真实模型沉淀客户周报规范和可复用资源，实际交付、修改续做并停用；按真实产物十分制评审。',
        fixtures: ['tests/fixtures/workspace/工作'],
        outputFiles: OUTPUTS,
        runMode: 'single',
        runtimeModelName: loadLiveLlmConfigFromEnv().model_name,
        execute: async (runtime) => {
          for (const id of ['skill-manager', 'unrelated-partner'])
            await runtime.partnerStore.savePartner({
              id,
              name: id,
              avatar_shape: 'circle',
              avatar_color: 'blue',
              created_at: 1,
              updated_at: 1,
              last_viewed_at: 1,
              pinned: false,
              pinned_at: null
            })
          const service = new UserSkillService(
            runtime.storageService.partnerSkills,
            path.join(runtime.workspaceRoot, '.managed-skills')
          )
          const snapshot = async (name: string) => {
            const directory = service.resourceDirectory({ name })
            const document = service.getDocument(name)
            return Promise.all(
              ['SKILL.md', ...document.resources].map(async (file) => {
                const filename = path.join(directory, file)
                const bytes = await fs.readFile(filename)
                return {
                  file,
                  hash: hash(bytes),
                  mode: (await fs.stat(filename)).mode & 0o777,
                  content: /\.(md|py|js|sh|json|csv|txt)$/.test(file)
                    ? bytes.toString('utf8')
                    : undefined
                }
              })
            )
          }
          const other = service.create({
            name: 'meeting-only',
            description: '仅用于会议纪要',
            body: '# 会议纪要\n只在整理会议纪要时使用。'
          })
          service.setEnabled('skill-manager', [other.name])
          service.setEnabled('unrelated-partner', [other.name])
          const notes = path.join(runtime.workspaceRoot, '客户周报要求.md')
          await fs.writeFile(
            notes,
            '客户周报须区分已完成、待确认与阻塞，不把内部判断写成客户承诺。客户版本不披露内部报价、回款金额和个人联系方式；内部行动清单保留责任人、风险、下一步及依据。遵循资料的日期和适用范围处理冲突，不确定的验收明确写待确认。每次周报标注统计口径，CSV须能被表格软件读取。请把这些原则写入可复用规范；模板须包含结论、进展、风险、下周行动；汇总脚本读取CSV，按责任人和风险等级统计数量，支持不同数据而非写死本周内容。'
          )
          const facts = path.join(runtime.workspaceRoot, '本周事实.csv')
          await fs.writeFile(
            facts,
            '事项,责任人,风险等级,状态,客户可见\n需求清单核对,产品组,低,已完成,是\n接口文档,研发组,低,已完成,是\n外部联调,交付组,高,等待对方排期,是\n业务验收,客户接口人,高,待确认,是\n内部报价复核,财务组,中,进行中,否\n客户培训,交付组,中,待排期,是\n法务条款,法务组,中,待确认,否\n'
          )
          const sourcePaths = [
            ...runtime.fixtureBindings.map((item) => item.workspacePath),
            notes,
            facts
          ]
          const sources = await Promise.all(
            sourcePaths.map(async (file) => ({ file, hash: hash(await fs.readFile(file)) }))
          )
          const run = async (index: number, userInput: string) => {
            const runner = await createAiServiceTestRunner(runtime, {
              partnerId: 'skill-manager',
              runId: `${runtime.runId}-${index}`,
              userSkillService: service,
              userInput
            })
            const output = await runner.run()
            runtime.recordEvent({
              type: 'signal',
              name: `skill-management-round-${index}`,
              status: 'info',
              message: '真实业务轮次结束。',
              data: {
                status: output.status,
                usage: JSON.parse(JSON.stringify(runner.io.map((record) => record.usage ?? null)))
              }
            })
            return { output, events: runner.events, io: runner.io }
          }
          const first = await run(
            1,
            '请参考工作目录中的真实客户项目资料和客户周报要求.md，先核对已有 skill 的启用情况，再整理一个可复用的客户周报 skill，并为你自己启用。需要包含规范、参考资料、周报模板，以及能按责任人和风险等级汇总CSV事项数量的脚本。请实际保存规范及资源，保留业务原件；这轮先完成规范沉淀，不生成本周正式交付。'
          )
          const managed = service.list().filter((item) => item.name !== other.name)
          if (managed.length !== 1)
            throw new Error(`Expected one newly authored skill, received ${managed.length}`)
          const skill = managed[0]
          const initialDocument = service.getDocument(skill.name)
          const initialFiles = await snapshot(skill.name)
          const second = await run(
            2,
            '请按刚建立的客户周报规范，结合工作目录项目资料及本周事实.csv，生成可对外审阅的交付/客户周报-v1.md和内部跟进用的交付/行动清单-v1.csv。实际使用规范的模板、参考资料及汇总脚本核对统计，不把未验收写成已验收，内部事项不要混入客户版本。'
          )
          const originals = await Promise.all(
            OUTPUTS.slice(0, 2).map((file) => fs.readFile(path.join(runtime.workspaceRoot, file)))
          )
          const newer = path.join(runtime.workspaceRoot, '本周补充事实.csv')
          await fs.writeFile(
            newer,
            '事项,责任人,风险等级,状态,客户可见,复核人,验收证据\n外部联调,交付组,中,接口测试通过但业务验收待确认,是,客户接口人,接口测试记录已收到；业务确认邮件待取得\n客户培训,交付组,低,排期已确认但尚未开展,是,培训负责人,培训排期邮件\n内部报价复核,财务组,中,仍在复核,否,财务负责人,复核结论尚未收到\n'
          )
          const newerHash = hash(await fs.readFile(newer))
          const third = await run(
            3,
            '请修改刚才的原有周报skill：内部行动清单增加复核人、验收证据两列，证据缺失必须标明待取得，其他规范保持。再结合本周补充事实.csv更新本周交付，另存交付/客户周报-v2.md和交付/行动清单-v2.csv，保留v1和业务原件。复核人及证据按补充事实填写，仍要实际使用资源和汇总脚本。'
          )
          const updated = service.getDocument(skill.name)
          const updatedFiles = await snapshot(skill.name)
          const fourth = await run(
            4,
            '暂停你对刚建立的客户周报skill的启用，保留该 skill 及其内容，不修改其他skill和其他伙伴的配置。查询确认已停用。'
          )
          const events = [...first.events, ...second.events, ...third.events, ...fourth.events]
          const finalFiles = await snapshot(skill.name)
          const reports = await Promise.all(
            [OUTPUTS[0], OUTPUTS[2]].map((file) =>
              fs.readFile(path.join(runtime.workspaceRoot, file), 'utf8')
            )
          )
          const tables = await Promise.all(
            [OUTPUTS[1], OUTPUTS[3]].map((file) => csv(path.join(runtime.workspaceRoot, file)))
          )
          return {
            statuses: [first, second, third, fourth].map((round) => round.output.status),
            skill,
            initialDocument,
            updated,
            initialFiles,
            updatedFiles,
            assetPreserved: JSON.stringify(updatedFiles) === JSON.stringify(finalFiles),
            deliveryEvents: [...second.events, ...third.events],
            reports,
            tables,
            events,
            enabled: service.listEnabled('skill-manager').map((item) => item.name),
            otherPartner: service.listEnabled('unrelated-partner').map((item) => item.name),
            other: other.name,
            sourcePreserved:
              (
                await Promise.all(
                  sources.map(
                    async (source) => hash(await fs.readFile(source.file)) === source.hash
                  )
                )
              ).every(Boolean) && hash(await fs.readFile(newer)) === newerHash,
            oldPreserved: (
              await Promise.all(
                OUTPUTS.slice(0, 2).map(
                  async (file, index) =>
                    hash(await fs.readFile(path.join(runtime.workspaceRoot, file))) ===
                    hash(originals[index])
                )
              )
            ).every(Boolean),
            usages: [first, second, third, fourth].flatMap((round) =>
              round.io.map((record) => record.usage ?? null)
            )
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.statuses.every((status) => status === 'completed'),
            {
              name: 'four-round-completion',
              message: '四轮均由生产 AI 入口完成。',
              data: { statuses: result.statuses }
            }
          )
          runtime.assertThat(
            result.initialDocument.resources.some((file) => file.startsWith('scripts/')) &&
              result.initialDocument.resources.some((file) => file.startsWith('references/')) &&
              result.initialDocument.resources.some((file) => file.startsWith('assets/')) &&
              result.updated.name === result.skill.name &&
              result.updatedFiles.some((file) => file.content?.includes('复核人')) &&
              result.updatedFiles.some((file) => file.content?.includes('验收证据')),
            {
              name: 'authored-and-updated-resources',
              message: 'AI 创建完整可复用目录，并按原名称更新规则。'
            }
          )
          runtime.assertThat(
            result.events.some(
              (event) =>
                event.type === 'tool_call_started' &&
                event.toolName === 'load_toolset' &&
                JSON.stringify(event.input).includes('skill-management')
            ) &&
              result.events.some(
                (event) =>
                  event.type === 'tool_call_started' &&
                  event.toolName === 'skill_config' &&
                  event.input?.action === 'list'
              ) &&
              result.events.some(
                (event) =>
                  event.type === 'tool_call_started' &&
                  event.toolName === 'skill_config' &&
                  event.input?.action === 'update' &&
                  Array.isArray(event.input.skills)
              ),
            {
              name: 'on-demand-skill-management',
              message: '模型自主加载管理工具包，使用列表与批量更新契约。'
            }
          )
          const scripts = result.initialDocument.resources.filter((file) =>
            /\.(py|sh|js)$/.test(file)
          )
          const scriptUsed = result.deliveryEvents.some(
            (event) =>
              event.type === 'tool_call_started' &&
              event.toolName === 'terminal_run' &&
              scripts.some((file) => JSON.stringify(event.input).includes(path.basename(file))) &&
              result.deliveryEvents.some(
                (outcome) =>
                  outcome.type === 'tool_call_result' &&
                  outcome.toolCallId === event.toolCallId &&
                  outcome.result?.ok === true &&
                  outcome.result.data &&
                  typeof outcome.result.data === 'object' &&
                  !Array.isArray(outcome.result.data) &&
                  outcome.result.data.status === 'succeeded'
              )
          )
          runtime.assertThat(
            scriptUsed &&
              result.events.some(
                (event) => event.type === 'tool_call_started' && event.toolName === 'load_skill'
              ) &&
              result.reports.every((report) => report.length > 100) &&
              result.tables.every(
                (rows) => rows.length > 1 && rows.every((row) => row.length === rows[0].length)
              ) &&
              result.tables[1][0].includes('复核人') &&
              result.tables[1][0].includes('验收证据'),
            {
              name: 'real-business-delivery',
              message: '规范加载、真实脚本执行、两版 Markdown 和可解析 CSV 交付有效。'
            }
          )
          runtime.assertThat(
            result.enabled.join() === result.other &&
              result.otherPartner.join() === result.other &&
              result.sourcePreserved &&
              result.oldPreserved &&
              result.assetPreserved,
            {
              name: 'preserved-sources-and-bindings',
              message: '只停用当前伙伴的新规范，其他绑定、原件及首版交付保持。'
            }
          )
          runtime.recordEvent({
            type: 'signal',
            name: 'skill-management-quality-evidence',
            status: 'info',
            message: '依据真实规范、资源、交付与工具记录按测试计划人工评分。',
            data: JSON.parse(
              JSON.stringify({
                skill: result.skill,
                initialDocument: result.initialDocument,
                updated: result.updated,
                initialFiles: result.initialFiles,
                updatedFiles: result.updatedFiles,
                reports: result.reports,
                tables: result.tables,
                usages: result.usages
              })
            )
          })
        }
      }),
    1_200_000
  )
})
