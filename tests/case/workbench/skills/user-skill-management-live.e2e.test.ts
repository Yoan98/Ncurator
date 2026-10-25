import fs from 'node:fs/promises'
import path from 'node:path'
import type { AiRunEvent } from '../../../../src/shared/types'
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
          '聊天发布与更新目录，页面与伙伴配置同步，未保存草稿保留，连续工具及加载合并到 Activity，箭头与类别图标在实时和历史一致。',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty',
            workspaceName: '规范管理伙伴'
          })
          await selectWorkbenchModel(page, setup.env.modelName)
          await selectWorkbenchExecutionPermission(page, '完全访问', { confirmModal: true })
          const observed: AiRunEvent[] = []
          const wait = async (at: number) => {
            const done = await waitForWorkbenchAiRunCompletion(
              runtime,
              at,
              setup.env.modelName,
              240_000,
              { page, blockerPolicy: 'auto_approve' }
            )
            observed.push(...done.events)
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
          await page.getByTestId(`${selectors.editPrefix}-${skill.name}`).click()
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
          await page.getByTestId(`${selectors.editPrefix}-${skill.name}`).click()
          await fillSkillContent(page, '未保存的手动草稿')
          await wait(at)
          const draftPreserved = (await readSkillContent(page)).includes('未保存的手动草稿')
          const notice = await page.getByTestId(selectors.editor).getByRole('status').isVisible()
          const latest = await page.evaluate((id) => window.api.userSkillsGet(id), skill.name)
          await page.getByTestId(selectors.cancel).click()
          await page.getByRole('button', { name: '放弃修改', exact: true }).click()
          await page.getByTestId(selectors.editor).waitFor({ state: 'hidden' })
          await page.getByTestId(`${workbenchSelectors.partnerItemPrefix}-${partner.id}`).click()
          const snapshotActivities = async () => {
            const collapsed = page.locator(
              `button[data-testid^="${workbenchSelectors.assistantProcessTogglePrefix}-"][aria-expanded="false"]`
            )
            while (await collapsed.count()) await collapsed.first().click()
            return page.locator('[class~="group/execution"]').evaluateAll((elements) =>
              elements.map((element) => {
                const summary = element.querySelector('summary')!
                const icon = summary.querySelector('[data-process-icon-kind]')!
                return {
                  id: element.getAttribute('data-testid') || '',
                  kind: icon.getAttribute('data-process-icon-kind'),
                  color: getComputedStyle(icon).color,
                  text: summary.textContent || '',
                  items: [...element.querySelectorAll('[data-process-item-id]')].map((item) => ({
                    id: item.getAttribute('data-process-item-id')!,
                    text: item.textContent || ''
                  }))
                }
              })
            )
          }
          const activities = await snapshotActivities()
          const firstActivity = page.locator('[class~="group/execution"]').first()
          const summary = firstActivity.locator(':scope > summary')
          await summary.hover()
          const arrow = () =>
            summary.locator('svg').evaluateAll((elements) =>
              elements
                .filter(
                  (element) =>
                    element.getAttribute('class')?.includes('group-open/execution') &&
                    getComputedStyle(element).display !== 'none'
                )
                .map((element) => element.querySelector('path')?.getAttribute('d'))
                .join('|')
            )
          const closedArrow = await arrow()
          await summary.click()
          const expanded = await firstActivity.evaluate(
            (element) => (element as HTMLDetailsElement).open
          )
          const expandedArrow = await arrow()
          await page.reload()
          await page.getByTestId(`${workbenchSelectors.partnerItemPrefix}-${partner.id}`).click()
          const restored = await snapshotActivities()
          const groupByItem = new Map(
            activities.flatMap((activity) =>
              activity.items.map((item) => [item.id, activity.id] as const)
            )
          )
          const tools = new Map<string, string>()
          const expectedGroups = new Map<string, Set<string>>()
          const thoughts = new Set<string>()
          let boundary = 0
          for (const event of observed) {
            if (
              event.type === 'assistant_process_thought' &&
              event.text.trim() &&
              !thoughts.has(event.thoughtId)
            ) {
              thoughts.add(event.thoughtId)
              boundary++
            }
            if (
              event.type === 'assistant_process_group_started' &&
              ['compaction', 'retry'].includes(event.kind)
            )
              boundary++
            if (event.type !== 'tool_call_started') continue
            tools.set(event.toolCallId, event.toolName)
            const group = groupByItem.get(event.toolCallId)
            if (!group) continue
            const key = `${event.runId}:${boundary}`
            const groups = expectedGroups.get(key) ?? new Set<string>()
            groups.add(group)
            expectedGroups.set(key, groups)
          }
          const loadingIds = [...tools]
            .filter(([, name]) => ['load_toolset', 'load_skill'].includes(name))
            .map(([id]) => id)
          const loadingMerged =
            loadingIds.length >= 1 &&
            loadingIds.every((id) => groupByItem.has(id)) &&
            [...expectedGroups.values()].every((groups) => groups.size === 1)
          const categoryIconsCorrect = activities.every((activity) => {
            const names = activity.items.map((item) => tools.get(item.id)).filter(Boolean)
            if (names.every((name) => name === 'load_toolset'))
              return activity.kind === 'toolset_loading' && activity.color === 'rgb(47, 95, 143)'
            if (names.every((name) => name === 'load_skill'))
              return activity.kind === 'skill_loading' && activity.color === 'rgb(128, 100, 162)'
            if (names.some((name) => ['load_toolset', 'load_skill'].includes(name!)))
              return activity.kind === 'workflow'
            return true
          })
          at = Date.now()
          await sendWorkbenchMessage(page, '停用 workbench-note，保留内容及其他配置。')
          await wait(at)
          await choosePartner(page, '规范管理伙伴')
          const checked = await page
            .getByTestId(`${selectors.togglePrefix}-${skill.name}`)
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
            activities,
            restored,
            loadingMerged,
            categoryIconsCorrect,
            closedArrow,
            expandedArrow,
            expanded,
            checked,
            memo,
            name: skill.name
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.firstBody.includes('核对结论') &&
              result.resourceVisible &&
              result.draftPreserved &&
              result.notice &&
              result.latest.name === result.name &&
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
            result.loadingMerged &&
              result.categoryIconsCorrect &&
              result.expanded &&
              Boolean(result.closedArrow) &&
              result.closedArrow !== result.expandedArrow &&
              JSON.stringify(result.activities) === JSON.stringify(result.restored) &&
              result.activities.some((activity) =>
                activity.items.some(
                  (item) =>
                    item.text.includes('启用 workbench-note') ||
                    item.text.includes('停用 workbench-note')
                )
              ) &&
              result.activities.some((activity) =>
                activity.items.some((item) => item.text.includes('加载 workbench-note'))
              ),
            {
              name: 'activity-boundaries-arrows-and-restore',
              message: '两类加载按真实文本边界合并，类别图标和箭头正确，历史恢复一致。'
            }
          )
        }
      }),
    900_000
  )
})
