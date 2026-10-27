import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  selectors,
  fillSkillContent,
  readSkillContent,
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
        description: '真实抽屉创建编辑与重命名保留伙伴绑定，取消、冲突、持久性与删除确认。',
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
          await enableSkill(page, original.name, partnerId)
          const toolbar = await page.getByTestId(selectors.topbar).evaluate((element) => ({
            height: element.getBoundingClientRect().height,
            drag: getComputedStyle(element).getPropertyValue('-webkit-app-region'),
            buttons: element.querySelectorAll('button').length
          }))
          await page.getByTestId(`${selectors.editPrefix}-${original.name}`).click()
          await page.getByTestId(selectors.content).locator('.vditor-ir pre').waitFor()
          await page.getByTestId(selectors.name).focus()
          await page.waitForFunction(
            (id) =>
              getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!)
                .borderBottomColor === 'rgb(11, 107, 203)',
            selectors.name
          )
          const documentStyle = await page.getByTestId(selectors.name).evaluate((input) => {
            const style = getComputedStyle(input)
            return {
              fontSize: style.fontSize,
              top: style.borderTopWidth,
              left: style.borderLeftWidth,
              bottom: style.borderBottomColor
            }
          })
          const formatToolbar = await page
            .getByTestId(selectors.content)
            .locator('.vditor-toolbar')
            .isVisible()
          const noTabs =
            (await page.getByTestId(selectors.editor).locator('.ant-segmented').count()) === 0
          await fillSkillContent(page, '')
          await page.keyboard.type('/')
          const slashMenu = page
            .getByTestId(selectors.content)
            .locator('.vditor-content > .vditor-hint')
          await slashMenu.waitFor({ state: 'visible' })
          await slashMenu.locator('button').first().click()
          await page.keyboard.type('Slash heading')
          const slashWorked =
            (await page.getByTestId(selectors.content).locator('.vditor-ir h1').count()) > 0
          const noSourceSwitch =
            (await page
              .getByTestId(selectors.editor)
              .getByRole('button', { name: '源码', exact: true })
              .count()) === 0
          const fieldLabels = await page
            .getByTestId(selectors.editor)
            .locator('.nc-configuration-field-label')
            .evaluateAll((labels) =>
              labels.map((label) => ({
                text: label.textContent?.replace('*', '').trim(),
                visible: label.getBoundingClientRect().height > 0,
                font: getComputedStyle(label).fontSize,
                color: getComputedStyle(label).color
              }))
            )
          const drawer = page.locator('.nc-configuration-drawer .ant-drawer-content-wrapper')
          runtime.signal({
            name: 'skill-editor-drawer-layout',
            message: '记录配置表单的实际 CSS 尺寸与视口。',
            data: await drawer.evaluate((element) => ({
              width: element.getBoundingClientRect().width,
              right: element.getBoundingClientRect().right,
              viewport: window.innerWidth
            }))
          })
          await page.waitForFunction(() =>
            (() => {
              const rect = document
                .querySelector('.nc-configuration-drawer .ant-drawer-content-wrapper')
                ?.getBoundingClientRect()
              return Boolean(
                rect &&
                Math.abs(rect.width - 720) < 0.05 &&
                Math.abs(rect.right - window.innerWidth) < 1
              )
            })()
          )
          await runtime.captureScreenshot({
            name: 'skill-editor',
            message: 'skill 编辑抽屉与 Markdown 编辑区。'
          })
          const windowHandle = await runtime.electronApp.browserWindow(page)
          const originalBounds = await windowHandle.evaluate((window) => ({
            size: window.getSize(),
            minimum: window.getMinimumSize()
          }))
          await windowHandle.evaluate((window) => {
            window.setMinimumSize(0, 0)
            window.setSize(680, 800)
          })
          await page.waitForFunction(() => window.innerWidth <= 760)
          await page.waitForFunction(
            () =>
              Math.abs(
                (document
                  .querySelector('.nc-configuration-drawer .ant-drawer-content-wrapper')
                  ?.getBoundingClientRect().width ?? 0) - window.innerWidth
              ) < 1
          )
          const narrowLayout = await drawer.evaluate((element) => ({
            width: element.getBoundingClientRect().width,
            viewport: window.innerWidth,
            overflow: element.scrollWidth > element.clientWidth
          }))
          await runtime.captureScreenshot({
            name: 'skill-editor-narrow',
            message: '窄窗口中的 skill 编辑抽屉。'
          })
          await windowHandle.evaluate((window, bounds) => {
            window.setSize(bounds.size[0], bounds.size[1])
            window.setMinimumSize(bounds.minimum[0], bounds.minimum[1])
          }, originalBounds)
          await fillSkill(page, {
            name: 'reserved-name',
            description: '更新规范',
            body: '正文草稿'
          })
          await page
            .getByTestId(selectors.editor)
            .locator('.nc-config-footer .ant-btn-primary')
            .click()
          await page
            .locator('.ant-message-notice')
            .filter({ hasText: '已存在同名 skill' })
            .waitFor()
          const failureKeptInput = (await readSkillContent(page)).includes('正文草稿')
          await fillSkill(page, {
            name: 'report-guide',
            description: '更新规范',
            body: '# 更新规范\n\n- 风险注明影响。\n\n```text\n保留代码示例\n```\n'
          })
          await saveSkill(page)
          const renamed = await findSkill(page, 'report-guide')
          const binding = await page.evaluate(
            (id) => window.api.userSkillsGetEnabled(id),
            partnerId
          )
          const richBody = await page.evaluate(
            async (name) => (await window.api.userSkillsGet(name)).body,
            renamed.name
          )
          await page.getByTestId(`${selectors.editPrefix}-${renamed.name}`).click()
          await fillSkillContent(page, '替换后的纯文本正文')
          await saveSkill(page)
          const fullReplacementBody = await page.evaluate(
            async (name) => (await window.api.userSkillsGet(name)).body,
            renamed.name
          )
          await page.getByTestId(`${selectors.editPrefix}-${renamed.name}`).click()
          await fillSkillContent(page, richBody)
          await saveSkill(page)
          await page.getByTestId(`${selectors.editPrefix}-${renamed.name}`).click()
          await fillSkillContent(page, '未保存正文')
          await page.keyboard.press('Escape')
          await page.getByRole('button', { name: '放弃修改', exact: true }).click()
          await page.getByTestId(selectors.editor).waitFor({ state: 'hidden' })
          const saved = await page.evaluate((id) => window.api.userSkillsGet(id), renamed.name)
          const restarted = await runtime.restartApp()
          await openSkills(restarted.page)
          const persisted = await findSkill(restarted.page, 'report-guide')
          const reserved = await findSkill(restarted.page, 'reserved-name')
          const reopenedEditors: {
            name: string
            body: string
            toolbar: boolean
            editable: boolean
          }[] = []
          // The first Markdown editor in the new renderer is an existing skill,
          // followed by closing and opening different skills without a warm-up editor.
          for (const skill of [persisted, reserved, persisted]) {
            await restarted.page.getByTestId(`${selectors.editPrefix}-${skill.name}`).click()
            const content = restarted.page.getByTestId(selectors.content)
            const input = content.locator('.vditor-ir pre[contenteditable="true"]:visible')
            await input.waitFor()
            const name = await restarted.page.getByTestId(selectors.name).inputValue()
            const body = await readSkillContent(restarted.page)
            await input.locator('h1, p').first().click()
            await restarted.page.keyboard.press('End')
            await restarted.page.keyboard.type('temporary-edit')
            await restarted.page.getByTestId(selectors.description).click()
            await restarted.page.waitForFunction(
              (id) =>
                document
                  .querySelector(`[data-testid="${id}"] .vditor-ir > pre.vditor-reset`)
                  ?.textContent?.includes('temporary-edit'),
              selectors.content
            )
            const editable = (await readSkillContent(restarted.page)).includes('temporary-edit')
            reopenedEditors.push({
              name,
              body,
              toolbar: await content.locator('.vditor-toolbar').isVisible(),
              editable
            })
            await restarted.page.getByTestId(selectors.cancel).click()
            await restarted.page.getByRole('button', { name: '放弃修改', exact: true }).click()
            await restarted.page.getByTestId(selectors.editor).waitFor({ state: 'hidden' })
          }
          await restarted.page.getByTestId(`${selectors.deletePrefix}-${persisted.name}`).click()
          await restarted.page
            .locator('.ant-modal-confirm')
            .getByRole('button', { name: /取\s*消/ })
            .click()
          const cancelledDeletion = (await listSkills(restarted.page)).some(
            (item) => item.name === persisted.name
          )
          await restarted.page.getByTestId(`${selectors.deletePrefix}-${persisted.name}`).click()
          await restarted.page
            .locator('.ant-modal-confirm')
            .getByRole('button', { name: /删\s*除/ })
            .click()
          await restarted.page.waitForFunction(
            async (id) => !(await window.api.userSkillsList()).some((item) => item.name === id),
            persisted.name
          )
          return {
            toolbar,
            documentStyle,
            formatToolbar,
            noTabs,
            slashWorked,
            noSourceSwitch,
            fieldLabels,
            narrowLayout,
            failureKeptInput,
            namePreserved: renamed.name === 'report-guide' && renamed.name === persisted.name,
            bindingKept: binding.skillNames.includes(renamed.name),
            fullReplacementBody,
            savedBody: saved.body,
            reopenedEditors,
            cancelledDeletion
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            Math.abs(result.toolbar.height - 44) < 0.05 &&
              result.toolbar.drag === 'drag' &&
              result.toolbar.buttons === 1 &&
              result.documentStyle.fontSize === '25px' &&
              result.documentStyle.top === '0px' &&
              result.documentStyle.left === '0px' &&
              result.formatToolbar &&
              result.noTabs &&
              result.slashWorked &&
              result.noSourceSwitch &&
              ['名称', '描述', '内容'].every((text) =>
                result.fieldLabels.some(
                  (label) =>
                    label.text === text &&
                    label.visible &&
                    label.font === '13px' &&
                    label.color === 'rgb(55, 53, 47)'
                )
              ) &&
              Math.abs(result.narrowLayout.width - result.narrowLayout.viewport) < 1 &&
              !result.narrowLayout.overflow &&
              result.failureKeptInput &&
              result.namePreserved &&
              result.bindingKept &&
              result.fullReplacementBody.trim() === '替换后的纯文本正文' &&
              result.savedBody.includes('# 更新规范') &&
              result.savedBody.includes('- 风险注明影响') &&
              result.savedBody.includes('```text') &&
              !result.savedBody.includes('未保存') &&
              result.reopenedEditors.every(
                (editor, index) =>
                  editor.toolbar &&
                  editor.editable &&
                  editor.name === (index === 1 ? 'reserved-name' : 'report-guide') &&
                  editor.body.includes(index === 1 ? '保留。' : '保留代码示例') &&
                  !editor.body.includes('temporary-edit')
              ) &&
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
