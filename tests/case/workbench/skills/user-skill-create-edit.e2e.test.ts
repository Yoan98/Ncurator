import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  selectors,
  setupSkillPartners,
  createSkill,
  findSkill,
  choosePartner,
  enableSkill,
  fillSkill,
  saveSkill,
  openSkills,
  listSkills
} from '../../../harness/e2e/userSkills'

const CASE_ID = 'user-skill-create-edit'
describe('workbench skills', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'skills',
        groups: [],
        description: '真实弹窗创建编辑与重命名保留伙伴绑定，取消、冲突、持久性与删除确认。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await setupSkillPartners(page)
          await createSkill(page, {
            name: 'weekly-report',
            description: '周报规范',
            body: '# 周报\n先写结论。'
          })
          await createSkill(page, {
            name: 'reserved-name',
            description: '名称冲突对象',
            body: '保留。'
          })
          const original = await findSkill(page, 'weekly-report')
          const partnerId = await choosePartner(page, '技能伙伴 A')
          await enableSkill(page, original.id, partnerId)
          await page.getByTestId(`${selectors.editPrefix}-${original.id}`).click()
          await fillSkill(page, {
            name: 'reserved-name',
            description: '更新规范',
            body: '正文草稿'
          })
          await page
            .getByTestId(selectors.editor)
            .locator('.ant-modal-footer .ant-btn-primary')
            .click()
          await page.locator('.ant-message-notice').filter({ hasText: '已存在同名技能' }).waitFor()
          const failureKeptInput =
            (await page.getByTestId(selectors.content).inputValue()) === '正文草稿'
          await fillSkill(page, {
            name: 'report-guide',
            description: '更新规范',
            body: '# 更新规范\n风险注明影响。'
          })
          await saveSkill(page)
          const renamed = await findSkill(page, 'report-guide')
          const binding = await page.evaluate(
            (id) => window.api.userSkillsGetEnabled(id),
            partnerId
          )
          await page.getByTestId(`${selectors.editPrefix}-${renamed.id}`).click()
          await page.getByTestId(selectors.content).fill('未保存正文')
          await page.keyboard.press('Escape')
          await page.getByRole('button', { name: '放弃修改', exact: true }).click()
          await page.getByTestId(selectors.editor).waitFor({ state: 'hidden' })
          const saved = await page.evaluate((id) => window.api.userSkillsGet(id), renamed.id)
          const restarted = await runtime.restartApp()
          await openSkills(restarted.page)
          const persisted = await findSkill(restarted.page, 'report-guide')
          await restarted.page.getByTestId(`${selectors.deletePrefix}-${persisted.id}`).click()
          await restarted.page
            .locator('.ant-modal-confirm')
            .getByRole('button', { name: /取\s*消/ })
            .click()
          const cancelledDeletion = (await listSkills(restarted.page)).some(
            (item) => item.id === persisted.id
          )
          await restarted.page.getByTestId(`${selectors.deletePrefix}-${persisted.id}`).click()
          await restarted.page
            .locator('.ant-modal-confirm')
            .getByRole('button', { name: /删\s*除/ })
            .click()
          await restarted.page.waitForFunction(
            async (id) => !(await window.api.userSkillsList()).some((item) => item.id === id),
            persisted.id
          )
          return {
            failureKeptInput,
            stableId: original.id === renamed.id && renamed.id === persisted.id,
            bindingKept: binding.skillIds.includes(original.id),
            savedBody: saved.body,
            cancelledDeletion
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.failureKeptInput &&
              result.stableId &&
              result.bindingKept &&
              result.savedBody.includes('风险注明影响') &&
              !result.savedBody.includes('未保存') &&
              result.cancelledDeletion,
            {
              name: 'skill-editor-lifecycle',
              message: '创建编辑、冲突、取消、重开和删除应保持正确状态与伙伴绑定。',
              data: result
            }
          )
        }
      })
    },
    240_000
  )
})
