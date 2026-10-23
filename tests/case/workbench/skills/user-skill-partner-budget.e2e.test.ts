import fs from 'node:fs/promises'
import path from 'node:path'
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
  copySkillFixture,
  importSkillFolder
} from '../../../harness/e2e/userSkills'

const CASE_ID = 'user-skill-partner-budget'
describe('workbench skills', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'skills',
        groups: [],
        description: '伙伴隔离，启用、编辑和替换超限拒绝且保留原资产。',
        fixtures: ['tests/fixtures/workspace/skills/weekly-report'],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await setupSkillPartners(page)
          for (const [name, size] of [
            ['weekly-report', 28],
            ['second', 28],
            ['small', 6],
            ['excess', 12]
          ] as const)
            await createSkill(page, {
              name,
              description: '预算规范',
              body: 'x'.repeat(size * 1024)
            })
          const main = await findSkill(page, 'weekly-report'),
            second = await findSkill(page, 'second'),
            small = await findSkill(page, 'small'),
            excess = await findSkill(page, 'excess')
          const a = await choosePartner(page, '技能伙伴 A')
          for (const skill of [main, second, small]) await enableSkill(page, skill.id, a)
          await page.getByTestId(`${selectors.togglePrefix}-${excess.id}`).click()
          await page.locator('.ant-message-notice').filter({ hasText: '64 KiB' }).waitFor()
          const selected = await page.evaluate((id) => window.api.userSkillsGetEnabled(id), a)
          const usageShown = (await page.getByTestId(selectors.budget).innerText()).includes('62.0')
          const b = await choosePartner(page, '技能伙伴 B')
          const isolated =
            (await page.evaluate((id) => window.api.userSkillsGetEnabled(id), b)).skillIds
              .length === 0
          for (const skill of [main, second, small]) await enableSkill(page, skill.id, b)
          await page.getByTestId(`${selectors.editPrefix}-${main.id}`).click()
          await fillSkill(page, {
            name: 'weekly-report',
            description: '预算规范',
            body: 'y'.repeat(31 * 1024)
          })
          await page
            .getByTestId(selectors.editor)
            .locator('.ant-modal-footer .ant-btn-primary')
            .click()
          await page.locator('.ant-message-notice').filter({ hasText: '技能伙伴 A' }).waitFor()
          const affectedNotice = await page
            .locator('.ant-message-notice')
            .filter({ hasText: '技能伙伴 A' })
            .last()
            .innerText()
          const allPartnersReported = affectedNotice.includes('技能伙伴 B')
          const editKept =
            (await page.evaluate((id) => window.api.userSkillsGet(id), main.id)).body.length ===
            28 * 1024
          await page.keyboard.press('Escape')
          await page.getByRole('button', { name: '放弃修改', exact: true }).click()
          const source = await copySkillFixture(runtime)
          await fs.writeFile(
            path.join(source, 'SKILL.md'),
            `---\nname: weekly-report\ndescription: replacement\n---\n${'z'.repeat(31 * 1024)}`
          )
          await importSkillFolder(runtime, source)
          await page
            .getByTestId(selectors.replace)
            .getByRole('button', { name: /替\s*换/ })
            .click()
          await page
            .locator('.ant-message-notice')
            .filter({ hasText: '技能伙伴 A' })
            .last()
            .waitFor()
          const replaceKept =
            (await page.evaluate((id) => window.api.userSkillsGet(id), main.id)).body.length ===
            28 * 1024
          await page
            .getByTestId(selectors.replace)
            .getByRole('button', { name: /取\s*消/ })
            .click()
          await choosePartner(page, '技能伙伴 A')
          await enableSkill(page, second.id, a, false)
          return {
            isolated,
            allPartnersReported,
            usageShown,
            editKept,
            replaceKept,
            excessRejected: !selected.skillIds.includes(excess.id)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(Object.values(result).every(Boolean), {
            name: 'skill-partner-budget',
            message: '伙伴配置独立，所有超限操作保留原状态并能停用释放额度。',
            data: result
          })
        }
      })
    },
    300_000
  )
})
