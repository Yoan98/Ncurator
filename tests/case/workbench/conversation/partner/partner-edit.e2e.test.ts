import { describe, it } from 'vitest'
import { partnerMemorySelectors as memorySelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  getWorkbenchLocator,
  navigateToWorkbench,
  waitForPartnerMemory,
  waitForVisiblePartnerRow,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'partner-edit'
const ORIGINAL_NAME = '编辑前伙伴'
const UPDATED_NAME = '编辑后伙伴'

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['partner'],
        description: '验证侧栏编辑入口复用创建抽屉，保存后更新名称与形象且不新建伙伴。',
        fixtures: [],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          await navigateToWorkbench(page, { waitForSessionListText: false })
          await createPartnerThroughWorkbenchUi(page, ORIGINAL_NAME)
          const created = (await page.evaluate(() => window.api.partnerList())).find(
            (item) => item.name === ORIGINAL_NAME
          )
          if (!created) throw new Error('created partner missing')
          await waitForVisiblePartnerRow(page, ORIGINAL_NAME)
          const originalPlaceholder = page.getByText(
            `输入你想让${ORIGINAL_NAME}做的事情或者@文件`,
            { exact: true }
          )
          await originalPlaceholder.waitFor({ state: 'visible' })
          const placeholderBeforeRename = await originalPlaceholder.textContent()

          const partnerItem = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${created.id}`
          )
          const editButton = getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerEditButtonPrefix}-${created.id}`
          )
          await partnerItem.hover()
          await editButton.click({ force: true })

          const nameInput = getWorkbenchLocator(page, workbenchSelectors.createPartnerNameInput)
          await nameInput.waitFor({ state: 'visible' })
          const modal = page.getByRole('dialog').filter({ has: nameInput })
          const modalTitle = ((await modal.locator('.ant-drawer-title').textContent()) || '').trim()
          const prefilledName = await nameInput.inputValue()
          const nameLabelVisible = await modal
            .locator('.nc-configuration-field-label')
            .filter({ hasText: '名称' })
            .isVisible()
          const memoryToggle = modal.getByTestId(memorySelectors.configToggle)
          const memoryDefault = await memoryToggle.getAttribute('aria-checked')
          const memoryConfigLayout = await modal
            .getByTestId(memorySelectors.config)
            .evaluate((section) => {
              const label = section
                .querySelector('.nc-configuration-field-label')!
                .getBoundingClientRect()
              const help = section
                .querySelector('button[aria-label="查看说明"]')!
                .getBoundingClientRect()
              const toggle = section.querySelector('[role="switch"]')!.getBoundingClientRect()
              return {
                switches: section.querySelectorAll('[role="switch"]').length,
                helps: section.querySelectorAll('button[aria-label="查看说明"]').length,
                checkboxes: section.querySelectorAll('input[type="checkbox"]').length,
                centers: [label, help, toggle].map((rect) => rect.top + rect.height / 2),
                ordered: label.right <= help.left && help.right < toggle.left
              }
            })
          await modal
            .getByTestId(memorySelectors.config)
            .getByRole('button', { name: '查看说明', exact: true })
            .hover()
          await page
            .getByRole('tooltip')
            .filter({ hasText: '减少重复交代' })
            .waitFor({ state: 'visible' })
          await memoryToggle.click()
          await nameInput.fill(UPDATED_NAME)
          await modal.getByRole('button', { name: 'pill' }).click()
          await modal.locator('.nc-config-footer .ant-btn-primary').click()
          await waitForVisiblePartnerRow(page, UPDATED_NAME)
          const updatedPlaceholder = page.getByText(`输入你想让${UPDATED_NAME}做的事情或者@文件`, {
            exact: true
          })
          await updatedPlaceholder.waitFor({ state: 'visible' })
          const placeholderAfterRename = await updatedPlaceholder.textContent()
          const memoryDisabledSnapshot = await page.evaluate(
            (id) => window.api.partnerMemoryGet(id),
            created.id
          )
          await partnerItem.hover()
          await editButton.click({ force: true })
          await memoryToggle.waitFor({ state: 'visible' })
          await page.waitForFunction(
            (id) =>
              document.querySelector(`[data-testid="${id}"]`)?.getAttribute('aria-checked') ===
              'false',
            memorySelectors.configToggle
          )
          const memoryReopened = await memoryToggle.getAttribute('aria-checked')
          await memoryToggle.click()
          await runtime.captureScreenshot({
            name: 'partner-memory-single-switch',
            message: '长期记忆文案旁一个问号，右侧一个总开关。'
          })
          await modal.locator('.nc-config-footer .ant-btn-primary').click()
          await waitForPartnerMemory(page, created.id, (snapshot) =>
            snapshot.memories.every((memory) => memory.enabled)
          )

          const updated = await page.evaluate(async (partnerId) => {
            const partners = await window.api.partnerList()
            return {
              count: partners.length,
              partner:
                partners
                  .filter((item) => item.id === partnerId)
                  .map(({ id, name, avatar_shape }) => ({ id, name, avatar_shape }))[0] || null
            }
          }, created.id)
          const listText = (
            (await getWorkbenchLocator(page, workbenchSelectors.partnersList).textContent()) || ''
          ).trim()

          const trigger = page.getByTestId(memorySelectors.trigger)
          await trigger.click()
          const preferencePane = page.getByTestId(
            `${memorySelectors.panePrefix}-cooperation_preferences`
          )
          const preferenceInput = preferencePane.locator('.monaco-editor textarea').last()
          const emptyPlaceholder = preferencePane.locator('.editor.modified .editorPlaceholder')
          await emptyPlaceholder.waitFor({ state: 'visible' })
          const placeholderText = await emptyPlaceholder.innerText()
          const emptyHeight = await preferencePane
            .locator('.nc-memory-input')
            .evaluate((element) => element.getBoundingClientRect().height)
          const emptyRailHidden = !(await preferencePane.locator('.nc-memory-rail').isVisible())
          await runtime.captureScreenshot({
            name: 'partner-memory-empty',
            message: '紧凑的记忆空态、分类 placeholder，未溢出时隐藏滚动条。'
          })
          await preferenceInput.focus()
          const longMemory = Array.from(
            { length: 30 },
            (_, i) => `长期偏好${i + 1}：先给结论，再说明依据。`
          ).join('\n')
          await page.keyboard.insertText(longMemory)
          await waitForPartnerMemory(
            page,
            created.id,
            (snapshot) => snapshot.memories[0].confirmed === longMemory
          )
          await page.waitForFunction((id) => {
            const input = document.querySelector<HTMLElement>(
              `[data-testid="${id}"] .nc-memory-input`
            )
            return (
              input &&
              input.getBoundingClientRect().height > 300 &&
              input.getBoundingClientRect().height <= 361
            )
          }, `${memorySelectors.panePrefix}-cooperation_preferences`)
          const cappedHeight = await preferencePane
            .locator('.nc-memory-input')
            .evaluate((element) => element.getBoundingClientRect().height)
          const longRailVisible = await preferencePane.locator('.nc-memory-rail').isVisible()
          const normalRailStyle = await preferencePane
            .locator('.nc-memory-rail')
            .evaluate((element) => {
              const thumb = element.querySelector<HTMLElement>('.nc-memory-viewport')!
              return {
                width: element.getBoundingClientRect().width,
                radius: getComputedStyle(thumb).borderRadius,
                border: getComputedStyle(thumb).borderTopWidth
              }
            })

          await page.keyboard.press('ControlOrMeta+a')
          const mediumMemory = '第一行\n第二行\n第三行\n第四行'
          await page.keyboard.insertText(mediumMemory)
          await waitForPartnerMemory(
            page,
            created.id,
            (snapshot) => snapshot.memories[0].confirmed === mediumMemory
          )
          await page.waitForFunction((id) => {
            const input = document.querySelector<HTMLElement>(
              `[data-testid="${id}"] .nc-memory-input`
            )
            return (
              input &&
              input.getBoundingClientRect().height > 100 &&
              input.getBoundingClientRect().height < 200
            )
          }, `${memorySelectors.panePrefix}-cooperation_preferences`)
          const mediumHeight = await preferencePane
            .locator('.nc-memory-input')
            .evaluate((element) => element.getBoundingClientRect().height)
          await page.keyboard.press('ControlOrMeta+a')
          const memoryText = '简明表达，先给结论。'
          await page.keyboard.insertText(memoryText)
          await waitForPartnerMemory(
            page,
            created.id,
            (snapshot) => snapshot.memories[0].confirmed === memoryText
          )
          await page.keyboard.insertText('优先使用中文。')
          await waitForPartnerMemory(
            page,
            created.id,
            (snapshot) => snapshot.memories[0].confirmed === memoryText + '优先使用中文。'
          )
          await page.keyboard.press('ControlOrMeta+z')
          await waitForPartnerMemory(
            page,
            created.id,
            (snapshot) => snapshot.memories[0].confirmed !== memoryText + '优先使用中文。'
          )
          await page.keyboard.press('ControlOrMeta+Shift+z')
          await waitForPartnerMemory(
            page,
            created.id,
            (snapshot) => snapshot.memories[0].confirmed === memoryText + '优先使用中文。'
          )
          await page.keyboard.press('ControlOrMeta+a')
          await page.keyboard.insertText(memoryText)
          await waitForPartnerMemory(
            page,
            created.id,
            (snapshot) => snapshot.memories[0].confirmed === memoryText
          )
          await page.getByTestId(`${memorySelectors.tabPrefix}-project_background`).click()
          const backgroundPane = page.getByTestId(
            `${memorySelectors.panePrefix}-project_background`
          )
          const backgroundPlaceholder = await backgroundPane
            .locator('.editor.modified .editorPlaceholder')
            .innerText()
          await backgroundPane.locator('.monaco-editor textarea').last().focus()
          await page.keyboard.insertText('持续开发桌面端')
          await waitForPartnerMemory(
            page,
            created.id,
            (snapshot) => snapshot.memories[1].confirmed === '持续开发桌面端'
          )
          await trigger.click()
          await trigger.click()
          await page.getByTestId(`${memorySelectors.tabPrefix}-cooperation_preferences`).click()
          await page.waitForFunction(
            (paneId) =>
              document
                .querySelector(`[data-testid="${paneId}"] .editor.modified .view-lines`)
                ?.textContent?.includes('简明表达'),
            `${memorySelectors.panePrefix}-cooperation_preferences`
          )
          const reopenedText = await preferencePane
            .locator('.editor.modified .view-lines')
            .innerText()
          const plainEditor = await preferencePane
            .locator('.nc-memory-editor')
            .evaluate((element) => ({
              striped: [...element.querySelectorAll('.diagonal-fill')].some(
                (node) => getComputedStyle(node).backgroundImage !== 'none'
              )
            }))
          const memorySnapshot = await page.evaluate(
            (id) => window.api.partnerMemoryGet(id),
            created.id
          )
          const bottomLine = await preferencePane
            .locator('.nc-memory-input')
            .evaluate((element) => {
              const style = getComputedStyle(element)
              return style.borderBottomWidth === '1px' && style.borderLeftWidth === '0px'
            })
          await runtime.captureScreenshot({
            name: 'partner-memory-editing',
            message: '记忆气泡、两个 tab 与底边线输入。'
          })
          await trigger.click()
          return {
            plainEditor,
            normalRailStyle,
            emptyHeight,
            emptyRailHidden,
            cappedHeight,
            longRailVisible,
            mediumHeight,
            placeholderText,
            backgroundPlaceholder,
            memoryDefault,
            memoryConfigLayout,
            memoryDisabledSnapshot,
            memoryReopened,
            memorySnapshot,
            reopenedText,
            bottomLine,
            modalTitle,
            prefilledName,
            nameLabelVisible,
            placeholderBeforeRename,
            placeholderAfterRename,
            updated,
            listText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            !result.plainEditor.striped &&
              Math.abs(result.normalRailStyle.width - 8) <= 0.05 &&
              result.normalRailStyle.radius === '4px' &&
              result.normalRailStyle.border === '0px' &&
              result.emptyHeight <= 90 &&
              result.emptyRailHidden &&
              result.cappedHeight <= 361 &&
              result.longRailVisible &&
              result.mediumHeight > result.emptyHeight &&
              result.mediumHeight < result.cappedHeight &&
              result.placeholderText.includes('先给结论') &&
              result.backgroundPlaceholder.includes('项目目标') &&
              result.memoryDefault === 'true' &&
              result.memoryReopened === 'false' &&
              result.memoryConfigLayout.switches === 1 &&
              result.memoryConfigLayout.helps === 1 &&
              result.memoryConfigLayout.checkboxes === 0 &&
              result.memoryConfigLayout.ordered &&
              Math.max(...result.memoryConfigLayout.centers) -
                Math.min(...result.memoryConfigLayout.centers) <
                1 &&
              result.memoryDisabledSnapshot.memories.every((memory) => !memory.enabled) &&
              result.memorySnapshot.memories[0].confirmed === '简明表达，先给结论。' &&
              result.memorySnapshot.memories[1].confirmed === '持续开发桌面端' &&
              result.memorySnapshot.memories.every((memory) => memory.enabled) &&
              result.reopenedText.includes('简明表达') &&
              result.bottomLine &&
              result.modalTitle === '编辑伙伴' &&
              result.prefilledName === ORIGINAL_NAME &&
              result.nameLabelVisible &&
              result.placeholderBeforeRename?.includes(ORIGINAL_NAME) &&
              result.placeholderAfterRename?.includes(UPDATED_NAME) &&
              result.updated.count === 1 &&
              result.updated.partner?.name === UPDATED_NAME &&
              result.updated.partner.avatar_shape === 'pill' &&
              result.listText.includes(UPDATED_NAME) &&
              !result.listText.includes(ORIGINAL_NAME),
            {
              name: 'workbench-partner-edit',
              message: '编辑抽屉应预填原值，保存后仍是同一伙伴且侧栏显示新名称。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_E2E_TIMEOUT_MS
  )
})
