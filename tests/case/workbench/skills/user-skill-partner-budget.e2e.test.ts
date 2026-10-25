import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'
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
  importSkillFolder,
  discardSkill
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
            ['weekly-report', 40],
            ['second', 16],
            ['small', 6],
            ['excess', 12],
            ['search-alpha', 1],
            ['search-beta', 1]
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
          const search = page.getByPlaceholder('搜索 skill', { exact: true })
          await search.fill('search-alpha')
          const searchWorks =
            (await page
              .getByTestId(selectors.partner)
              .locator('[data-testid^="' + selectors.togglePrefix + '-"]')
              .count()) === 1
          await search.clear()
          for (const skill of [main, second, small]) await enableSkill(page, skill.name, a)
          await choosePartner(page, '技能伙伴 A')
          const ring = page.getByTestId(selectors.budgetRing)
          const usageShown =
            (await ring.getAttribute('aria-label'))?.includes('96.9%') &&
            (await ring.innerText()) === '' &&
            (await ring.locator('svg circle').count()) === 2
          const longContentStored =
            (await page.evaluate((id) => window.api.userSkillsGet(id), main.name)).body.length >
            32 * 1024
          const itemShareShown =
            (await page.getByTestId(`${selectors.percentPrefix}-${main.name}`).innerText()) ===
            '62.5%'
          await ring.hover()
          const tooltip = page.getByRole('tooltip')
          await tooltip.waitFor({ state: 'visible' })
          const budgetHelp = await tooltip.innerText()
          const budgetHelpShown =
            budgetHelp.includes('伙伴 skill 正文容量') &&
            budgetHelp.includes('已用 62.0 KB / 最大 64 KB') &&
            !budgetHelp.includes('32 KB')
          await page
            .getByTestId(`${selectors.togglePrefix}-${excess.name}`)
            .getByRole('checkbox')
            .check()
          await page.getByTestId(workbenchSelectors.createPartnerNameInput).fill('超限修改不应保存')
          await page
            .getByTestId(workbenchSelectors.createPartnerModal)
            .locator('.nc-config-footer .ant-btn-primary')
            .click()
          await page.locator('.ant-message-notice').filter({ hasText: '请取消部分选择' }).waitFor()
          const selected = await page.evaluate((id) => window.api.userSkillsGetEnabled(id), a)
          const oldNamePreserved = await page.evaluate(
            async (id) =>
              (await window.api.partnerList()).find((item) => item.id === id)?.name ===
              '技能伙伴 A',
            a
          )
          const b = await choosePartner(page, '技能伙伴 B')
          const isolated =
            (await page.evaluate((id) => window.api.userSkillsGetEnabled(id), b)).skillNames
              .length === 0
          for (const skill of [main, second, small]) await enableSkill(page, skill.name, b)
          await page.getByTestId(`${selectors.editPrefix}-${main.name}`).click()
          await fillSkill(page, {
            name: 'weekly-report',
            description: '预算规范',
            body: 'y'.repeat(43 * 1024)
          })
          await page
            .getByTestId(selectors.editor)
            .locator('.nc-config-footer .ant-btn-primary')
            .click()
          await page.locator('.ant-message-notice').filter({ hasText: '技能伙伴 A' }).waitFor()
          const affectedNotice = await page
            .locator('.ant-message-notice')
            .filter({ hasText: '技能伙伴 A' })
            .last()
            .innerText()
          const allPartnersReported = affectedNotice.includes('技能伙伴 B')
          const editKept = (
            await page.evaluate((id) => window.api.userSkillsGet(id), main.name)
          ).body.startsWith('x'.repeat(40 * 1024))
          await page.keyboard.press('Escape')
          await page.getByRole('button', { name: '放弃修改', exact: true }).click()
          await page.getByTestId(selectors.editor).waitFor({ state: 'hidden' })
          const source = await copySkillFixture(runtime)
          await fs.writeFile(
            path.join(source, 'SKILL.md'),
            `---\nname: weekly-report\ndescription: replacement\n---\n${'z'.repeat(43 * 1024)}`
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
          const replaceKept = (
            await page.evaluate((id) => window.api.userSkillsGet(id), main.name)
          ).body.startsWith('x'.repeat(40 * 1024))
          await page
            .getByTestId(selectors.replace)
            .getByRole('button', { name: /取\s*消/ })
            .click()
          await discardSkill(page)
          await choosePartner(page, '技能伙伴 A')
          await enableSkill(page, second.name, a, false)
          return {
            searchWorks,
            isolated,
            oldNamePreserved,
            allPartnersReported,
            usageShown,
            longContentStored,
            itemShareShown,
            budgetHelpShown,
            editKept,
            replaceKept,
            excessRejected: !selected.skillNames.includes(excess.name)
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
