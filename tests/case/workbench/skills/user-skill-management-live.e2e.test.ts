import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  selectors,
  openSkills,
  findSkill,
  choosePartner,
  readSkillContent,
  fillSkillContent
} from '../../../harness/e2e/userSkills'
import {
  setupWorkbenchWithTempWorkspace,
  selectWorkbenchModel,
  selectWorkbenchExecutionPermission,
  sendWorkbenchMessage,
  waitForWorkbenchAiRunCompletion,
  recordWorkbenchAiEvidence,
  workbenchSelectors,
  assertNoWorkbenchFakeSignals
} from '../../../harness/e2e/workbench'

const CASE_ID = 'user-skill-management-live'
describe('skill management UI live', () => {
  it(
    CASE_ID,
    async () =>
      runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'skills',
        groups: ['live'],
        execution: 'live',
        knowledge: 'none',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        description:
          '聊天发布与更新目录，页面与伙伴配置同步，未保存草稿保留，两类加载图标在实时与历史一致。',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty',
            workspaceName: '规范管理伙伴'
          })
          await selectWorkbenchModel(page, setup.env.modelName)
          await selectWorkbenchExecutionPermission(page, '完全访问', { confirmModal: true })
          const wait = async (at: number) => {
            const done = await waitForWorkbenchAiRunCompletion(
              runtime,
              at,
              setup.env.modelName,
              240_000,
              { page, blockerPolicy: 'auto_approve' }
            )
            recordWorkbenchAiEvidence(runtime, done, 1)
            return done
          }
          let at = Date.now()
          await sendWorkbenchMessage(
            page,
            '请创建名为 workbench-note 的skill并给你启用：用于整理工作进展，输出标题必须是“核对结论”，只使用用户提供的事实。附带 references/rules.md，写明区分已完成和待确认，不编造验收。请实际保存完整目录，这轮不用生成业务报告。'
          )
          await wait(at)
          await openSkills(page)
          const skill = await findSkill(page, 'workbench-note')
          await page.getByTestId(`${selectors.editPrefix}-${skill.id}`).click()
          const firstBody = await readSkillContent(page)
          const resourceVisible = await page.getByTestId(selectors.resources).isVisible()
          await page.getByTestId(selectors.cancel).click()
          await page.getByTestId(selectors.editor).waitFor({ state: 'hidden' })
          const partners = await page.evaluate(() => window.api.partnerList())
          const partner = partners.find((item) => item.name === '规范管理伙伴')!
          await page.getByTestId(`${workbenchSelectors.partnerItemPrefix}-${partner.id}`).click()
          at = Date.now()
          await sendWorkbenchMessage(
            page,
            `请更新原有 workbench-note：标题改为“复核结论”，保留原有其他规则和附带文件。再实际加载更新后的规范，将“完成接口文档；尚未联调”整理为 ${path.join(setup.workspace.rootPath, 'memo.md')}。`
          )
          await openSkills(page)
          await page.getByTestId(`${selectors.editPrefix}-${skill.id}`).click()
          await fillSkillContent(page, '未保存的手动草稿')
          await wait(at)
          const draftPreserved = (await readSkillContent(page)).includes('未保存的手动草稿')
          const notice = await page.getByTestId(selectors.editor).getByRole('status').isVisible()
          const latest = await page.evaluate((id) => window.api.userSkillsGet(id), skill.id)
          await page.getByTestId(selectors.cancel).click()
          await page.getByRole('button', { name: '放弃修改', exact: true }).click()
          await page.getByTestId(selectors.editor).waitFor({ state: 'hidden' })
          await page.getByTestId(`${workbenchSelectors.partnerItemPrefix}-${partner.id}`).click()
          const icon = async (kind: string, name: string) =>
            page
              .locator('summary')
              .filter({ hasText: name })
              .locator(`[data-process-icon-kind="${kind}"]`)
              .first()
              .evaluate((element) => ({
                color: getComputedStyle(element).color,
                tag: element.tagName,
                text: element.closest('summary')?.textContent || ''
              }))
          const toolIcon = await icon('toolset_loading', 'skill 管理')
          const skillIcon = await icon('skill_loading', 'workbench-note')
          await page.reload()
          await page.getByTestId(`${workbenchSelectors.partnerItemPrefix}-${partner.id}`).click()
          const restoredTool = await icon('toolset_loading', 'skill 管理')
          const restoredSkill = await icon('skill_loading', 'workbench-note')
          at = Date.now()
          await sendWorkbenchMessage(page, '停用 workbench-note，保留共享内容及其他配置。')
          await wait(at)
          await choosePartner(page, '规范管理伙伴')
          const checked = await page
            .getByTestId(`${selectors.togglePrefix}-${skill.id}`)
            .getByRole('checkbox')
            .isChecked()
          const memo = await fs.readFile(path.join(setup.workspace.rootPath, 'memo.md'), 'utf8')
          await assertNoWorkbenchFakeSignals(runtime)
          return {
            firstBody,
            resourceVisible,
            draftPreserved,
            notice,
            latest,
            toolIcon,
            skillIcon,
            restoredTool,
            restoredSkill,
            checked,
            memo,
            id: skill.id
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.firstBody.includes('核对结论') &&
              result.resourceVisible &&
              result.draftPreserved &&
              result.notice &&
              result.latest.id === result.id &&
              result.latest.body.includes('复核结论') &&
              result.latest.resources.includes('references/rules.md') &&
              !result.checked &&
              result.memo.includes('复核结论'),
            {
              name: 'chat-management-ui-roundtrip',
              message: '真实聊天管理后目录与配置同步，未保存草稿保留，交付采用最新规则。',
              data: result
            }
          )
          await runtime.assertThat(
            result.toolIcon.color === 'rgb(47, 95, 143)' &&
              result.skillIcon.color === 'rgb(128, 100, 162)' &&
              result.restoredTool.color === result.toolIcon.color &&
              result.restoredSkill.color === result.skillIcon.color &&
              result.restoredTool.text.includes('加载 ') &&
              result.restoredTool.text.includes('skill 管理') &&
              result.restoredSkill.text.includes('加载 workbench-note'),
            {
              name: 'loading-icons-live-and-restored',
              message: '两类加载图标颜色在实时与历史一致。'
            }
          )
        }
      }),
    900_000
  )
})
