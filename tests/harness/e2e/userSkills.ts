import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
import type { UserSkillDraft } from '../../../src/shared/userSkills'
import { userSkillsSelectors as selectors } from '../../../src/renderer/src/testing/selectors'
import type { E2ETestRuntime } from './run-e2e-case'
import { createPartnerThroughWorkbenchUi, selectDirectoryInNativeDialog } from './workbench'

export { selectors }
export const openSkills = async (page: Page): Promise<void> => {
  await page.getByTestId(selectors.button).click()
  await page.getByTestId(selectors.view).waitFor({ state: 'visible' })
  await page.getByTestId(selectors.create).waitFor({ state: 'visible' })
}
export const listSkills = (page: Page) => page.evaluate(() => window.api.userSkillsList())
export const findSkill = async (page: Page, name: string) => {
  const skill = (await listSkills(page)).find((item) => item.name === name)
  if (!skill) throw new Error(`Skill missing: ${name}`)
  return skill
}
export const fillSkill = async (page: Page, draft: UserSkillDraft): Promise<void> => {
  await page.getByTestId(selectors.name).fill(draft.name)
  await page.getByTestId(selectors.description).fill(draft.description)
  await page.getByTestId(selectors.content).fill(draft.body)
}
export const saveSkill = async (page: Page): Promise<void> => {
  await page.getByTestId(selectors.editor).locator('.ant-modal-footer .ant-btn-primary').click()
  await page.getByTestId(selectors.editor).waitFor({ state: 'hidden' })
}
export const createSkill = async (page: Page, draft: UserSkillDraft): Promise<void> => {
  await page.getByTestId(selectors.create).click()
  await fillSkill(page, draft)
  await saveSkill(page)
}
export const choosePartner = async (page: Page, name: string): Promise<string> => {
  await page.getByTestId(selectors.partner).click()
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .getByText(name, { exact: true })
    .click()
  await page.getByTestId(selectors.budget).waitFor({ state: 'visible' })
  const partner = await page.evaluate(
    async (partnerName) =>
      (await window.api.partnerList()).find((item) => item.name === partnerName),
    name
  )
  if (!partner) throw new Error('Partner missing')
  return partner.id
}
export const enableSkill = async (
  page: Page,
  id: string,
  partnerId: string,
  enabled = true
): Promise<void> => {
  await page.getByTestId(`${selectors.togglePrefix}-${id}`).click()
  await page.waitForFunction(
    async ({ partnerId, id, enabled }) =>
      (await window.api.userSkillsGetEnabled(partnerId)).skillIds.includes(id) === enabled,
    { partnerId, id, enabled }
  )
  await page.getByTestId(selectors.budget).waitFor({ state: 'visible' })
}
export const setupSkillPartners = async (page: Page): Promise<void> => {
  await createPartnerThroughWorkbenchUi(page, '技能伙伴 A')
  await createPartnerThroughWorkbenchUi(page, '技能伙伴 B')
  await openSkills(page)
}
export const copySkillFixture = async (runtime: E2ETestRuntime): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-skill-input-'))
  runtime.registerResource({
    name: 'skill-input',
    phase: 'after-app-close',
    dispose: () => fs.rm(root, { recursive: true, force: true })
  })
  const source = path.join(root, 'weekly-report')
  await fs.cp(path.resolve('tests/fixtures/workspace/skills/weekly-report'), source, {
    recursive: true
  })
  return source
}
export const importSkillFolder = async (runtime: E2ETestRuntime, source: string): Promise<void> => {
  const { page } = runtime
  await page.bringToFront()
  await page.getByTestId(selectors.import).click()
  // Native panels appear after the renderer's click has completed.
  await page.waitForTimeout(1_000)
  const strategies =
    process.platform === 'win32'
      ? (['windows-keyboard'] as const)
      : (['applescript-paste', 'applescript-type', 'swift'] as const)
  const diagnostics: string[] = []
  for (const strategy of strategies) {
    try {
      const result = await selectDirectoryInNativeDialog(
        source,
        runtime.electronApp.process().pid ?? null,
        strategy
      )
      diagnostics.push(`${strategy}: ${result.stdout} ${result.stderr}`)
      runtime.signal({
        name: 'skill-native-directory-selection',
        message: '通过系统原生目录选择器选择 Skill 文件夹。',
        data: { strategy, stdout: result.stdout, stderr: result.stderr }
      })
      await page.waitForFunction(
        ({ create, replace }) => {
          const button = document.querySelector<HTMLButtonElement>(`[data-testid="${create}"]`)
          const confirmation = document.querySelector<HTMLElement>(
            `[data-testid="${replace}"] [role="dialog"]`
          )
          const bounds = confirmation?.getBoundingClientRect()
          return (
            button?.disabled === false ||
            Boolean(
              bounds?.width &&
              bounds.height &&
              confirmation &&
              getComputedStyle(confirmation).visibility === 'visible'
            )
          )
        },
        { create: selectors.create, replace: selectors.replace },
        { timeout: 8_000 }
      )
      return
    } catch (error) {
      diagnostics.push(String(error))
    }
  }
  throw new Error(`Native skill folder selection did not finish: ${diagnostics.join(' | ')}`)
}
