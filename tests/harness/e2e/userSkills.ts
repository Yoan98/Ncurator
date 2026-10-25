import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
import type { UserSkillDraft } from '../../../src/shared/userSkills'
import {
  userSkillsSelectors as selectors,
  workbenchSelectors
} from '../../../src/renderer/src/testing/selectors'
import type { E2ETestRuntime } from './run-e2e-case'
import { pasteTextThroughElectronClipboard } from './electronApp'
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
  await fillSkillContent(page, draft.body)
}
export const saveSkill = async (page: Page): Promise<void> => {
  await page.getByTestId(selectors.save).click()
  await page.getByTestId(selectors.editor).waitFor({ state: 'hidden' })
}
export const discardSkill = async (page: Page): Promise<void> => {
  await page.getByTestId(selectors.cancel).click()
  const discard = page.getByRole('button', { name: '放弃修改', exact: true })
  if (await discard.isVisible()) await discard.click()
  await page.getByTestId(selectors.editor).waitFor({ state: 'hidden' })
}
export const createSkill = async (page: Page, draft: UserSkillDraft): Promise<void> => {
  await page.getByTestId(selectors.create).click()
  await fillSkill(page, draft)
  await saveSkill(page)
}
export const fillSkillContent = async (page: Page, body: string): Promise<void> => {
  const input = page
    .getByTestId(selectors.content)
    .locator('.vditor-ir pre[contenteditable="true"]:visible')
  await input.waitFor({ state: 'visible' })
  await input.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  if (!(await pasteTextThroughElectronClipboard(page, body)))
    throw new Error('Native Markdown paste was unavailable')
  await page.waitForTimeout(250)
}
export const readSkillContent = async (page: Page): Promise<string> => {
  return await page
    .getByTestId(selectors.content)
    .locator('.vditor-ir > pre.vditor-reset')
    .innerText()
}
export const choosePartner = async (page: Page, name: string): Promise<string> => {
  const form = page.getByTestId(workbenchSelectors.createPartnerModal)
  if (await form.isVisible()) {
    await form.locator('.nc-config-footer .ant-btn-default').click()
    const discard = page.getByRole('button', { name: '放弃修改', exact: true })
    if (await discard.isVisible()) await discard.click()
    await form.waitFor({ state: 'hidden' })
  }
  const partner = await page.evaluate(
    async (name) => (await window.api.partnerList()).find((item) => item.name === name),
    name
  )
  if (!partner) throw new Error(`Partner missing: ${name}`)
  const row = page.getByTestId(`${workbenchSelectors.partnerItemPrefix}-${partner.id}`)
  await row.hover()
  await page.getByTestId(`${workbenchSelectors.partnerEditButtonPrefix}-${partner.id}`).click()
  await page.getByTestId(selectors.partner).waitFor({ state: 'visible' })
  await page.waitForFunction(
    (id) =>
      document.querySelector<HTMLButtonElement>(
        `[data-testid="${id}"] .nc-config-footer .ant-btn-primary`
      )?.disabled === false,
    workbenchSelectors.createPartnerModal
  )
  return partner.id
}
export const enableSkill = async (
  page: Page,
  id: string,
  partnerId: string,
  enabled = true
): Promise<void> => {
  const form = page.getByTestId(workbenchSelectors.createPartnerModal)
  if (!(await form.isVisible())) {
    const partner = await page.evaluate(
      async (id) => (await window.api.partnerList()).find((item) => item.id === id),
      partnerId
    )
    if (!partner) throw new Error('Partner missing')
    await choosePartner(page, partner.name)
  }
  const checkbox = page.getByTestId(`${selectors.togglePrefix}-${id}`).getByRole('checkbox')
  await checkbox.setChecked(enabled)
  await form.locator('.nc-config-footer .ant-btn-primary').click()
  await form.waitFor({ state: 'hidden' })
  await page.waitForFunction(
    async ({ partnerId, id, enabled }) =>
      (await window.api.userSkillsGetEnabled(partnerId)).skillNames.includes(id) === enabled,
    { partnerId, id, enabled }
  )
  await openSkills(page)
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
export const previewSkillFolder = async (
  runtime: E2ETestRuntime,
  source: string
): Promise<void> => {
  const { page } = runtime
  await page.bringToFront()
  await page.waitForFunction((id) => {
    const editor = document.querySelector(`[data-testid="${id}"]`)
    const drawer = editor?.closest('.ant-drawer')
    return !drawer || drawer.classList.contains('ant-drawer-open')
  }, selectors.editor)
  if (!(await page.getByTestId(selectors.editor).isVisible()))
    await page.getByTestId(selectors.create).click()
  await page.getByTestId(selectors.import).click()
  await page.waitForFunction(
    (id) =>
      document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.disabled ||
      [...document.querySelectorAll('.ant-modal-confirm-title')].some((element) =>
        element.textContent?.includes('替换当前草稿')
      ),
    selectors.import
  )
  const replaceDraft = page.locator('.ant-modal-confirm').filter({ hasText: '替换当前草稿' })
  if (await replaceDraft.isVisible())
    await replaceDraft.getByRole('button', { name: /导\s*入/ }).click()
  // Native panels appear after the renderer's click has completed.
  await page.waitForTimeout(1_000)
  const strategies =
    process.platform === 'win32' ? (['windows-keyboard'] as const) : (['swift'] as const)
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
      await page.getByTestId(selectors.resources).waitFor({ state: 'visible', timeout: 8_000 })
      await page.waitForFunction(
        (id) =>
          document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.disabled === false,
        selectors.import
      )
      return
    } catch (error) {
      diagnostics.push(String(error))
    }
  }
  throw new Error(`Native skill folder selection did not finish: ${diagnostics.join(' | ')}`)
}

export const importSkillFolder = async (runtime: E2ETestRuntime, source: string): Promise<void> => {
  await previewSkillFolder(runtime, source)
  const { page } = runtime
  await page.getByTestId(selectors.save).click()
  await page.waitForFunction(
    ({ editor, replace }) =>
      !document.querySelector(`[data-testid="${editor}"]`) ||
      Boolean(
        document
          .querySelector(`[data-testid="${replace}"] .ant-modal-content`)
          ?.getBoundingClientRect().width
      ),
    { editor: selectors.editor, replace: selectors.replace },
    { timeout: 8_000 }
  )
}
