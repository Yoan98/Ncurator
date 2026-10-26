import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  selectors,
  fillSkillContent,
  openSkills,
  copySkillFixture,
  importSkillFolder,
  findSkill,
  choosePartner,
  enableSkill,
  saveSkill
} from '../../../harness/e2e/userSkills'
import {
  setupWorkbenchWithTempWorkspace,
  createPartnerThroughWorkbenchUi,
  selectWorkbenchModel,
  workbenchSelectors,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion,
  recordWorkbenchAiEvidence,
  collectWorkbenchLlmIoRecords,
  assertNoWorkbenchFakeSignals
} from '../../../harness/e2e/workbench'

const CASE_ID = 'user-skill-use-live'
type Report = {
  ruleVersion: string
  status: string
  progress: string[]
  risks: string[]
  nextSteps: string[]
}
describe('workbench skills live', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'skills',
        groups: [],
        description: '真实 UI 配置规范，AI 使用相对资源，编辑后下一轮使用新规则。',
        fixtures: ['tests/fixtures/workspace/skills/weekly-report'],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await createPartnerThroughWorkbenchUi(page, '技能归档伙伴')
          await openSkills(page)
          const source = await copySkillFixture(runtime)
          await importSkillFolder(runtime, source)
          await page.waitForFunction(async () =>
            (await window.api.userSkillsList()).some((item) => item.name === 'weekly-report')
          )
          const skill = await findSkill(page, 'weekly-report')
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty',
            workspaceName: '技能归档伙伴',
            createPartner: false
          })
          await selectWorkbenchModel(page, setup.env.modelName)
          await openSkills(page)
          const partnerId = await choosePartner(page, '技能归档伙伴')
          await enableSkill(page, skill.name, partnerId)
          await fs.rm(source, { recursive: true })
          await page.getByTestId(`${workbenchSelectors.sessionItemPrefix}-${partnerId}`).click()
          const firstAt = Date.now()
          await sendWorkbenchMessage(
            page,
            `按已配置的周报归档规范整理进展，保存到 ${path.join(setup.workspace.rootPath, 'report-one.json')}。事实：完成客户访谈；接口联调因对方排期延后；下周继续联调并提交第一版方案。`
          )
          const first = await waitForWorkbenchAiRunCompletion(
            runtime,
            firstAt,
            setup.env.modelName,
            180_000,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, first, 1)
          const firstContent = await fs.readFile(
            path.join(setup.workspace.rootPath, 'report-one.json'),
            'utf8'
          )
          await openSkills(page)
          await page.getByTestId(`${selectors.editPrefix}-${skill.name}`).click()
          const { body } = await page.evaluate((id) => window.api.userSkillsGet(id), skill.name)
          await fillSkillContent(
            page,
            body +
              '\n本规范更新：输出的 ruleVersion 固定改为 NC-SKILL-REPORT-EDITED，其他字段仍遵循资源规则。\n'
          )
          await saveSkill(page)
          await page.getByTestId(`${workbenchSelectors.sessionItemPrefix}-${partnerId}`).click()
          const secondAt = Date.now()
          await sendWorkbenchMessage(
            page,
            `继续按周报归档规范另存 ${path.join(setup.workspace.rootPath, 'report-two.json')}，保留 report-one.json 原文件内容不变。事实：完成方案初稿；外部联调仍在等待；下周确认排期。`
          )
          const second = await waitForWorkbenchAiRunCompletion(
            runtime,
            secondAt,
            setup.env.modelName,
            180_000,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, second, 1)
          const reportOne = JSON.parse(
            await fs.readFile(path.join(setup.workspace.rootPath, 'report-one.json'), 'utf8')
          ) as Report
          const reportTwo = JSON.parse(
            await fs.readFile(path.join(setup.workspace.rootPath, 'report-two.json'), 'utf8')
          ) as Report
          const io = await collectWorkbenchLlmIoRecords(runtime)
          await assertNoWorkbenchFakeSignals(runtime)
          return {
            reportOne,
            reportTwo,
            firstContentPreserved:
              firstContent ===
              (await fs.readFile(path.join(setup.workspace.rootPath, 'report-one.json'), 'utf8')),
            loaded: first.events.some(
              (event) => event.type === 'tool_call_started' && event.toolName === 'load_skill'
            ),
            originalPrompt: io.some((record) =>
              record.requestWire?.messages.some(
                (message) =>
                  message.role === 'system' && String(message.content).includes('# 周报归档规范')
              )
            ),
            updatedPrompt: io.some((record) =>
              record.requestWire?.messages.some(
                (message) =>
                  message.role === 'system' && String(message.content).includes('本规范更新')
              )
            ),
            resourceRead: io.some((record) => record.user.includes('NC-SKILL-REPORT-314'))
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.firstContentPreserved &&
              result.loaded &&
              result.originalPrompt &&
              result.updatedPrompt &&
              result.resourceRead &&
              result.reportOne.ruleVersion === 'NC-SKILL-REPORT-314' &&
              result.reportTwo.ruleVersion === 'NC-SKILL-REPORT-EDITED' &&
              result.reportOne.status === 'waiting-external' &&
              result.reportTwo.status === 'waiting-external',
            {
              name: 'skill-ui-live-delivery',
              message: 'UI 配置与编辑的规范应进入真实模型，产物遵循原始和更新后的规则。',
              data: result
            }
          )
        }
      })
    },
    600_000
  )
})
