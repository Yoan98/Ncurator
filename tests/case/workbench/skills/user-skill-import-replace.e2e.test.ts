import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  selectors,
  setupSkillPartners,
  copySkillFixture,
  importSkillFolder,
  previewSkillFolder,
  discardSkill,
  saveSkill,
  listSkills,
  findSkill,
  choosePartner,
  enableSkill
} from '../../../harness/e2e/userSkills'

const CASE_ID = 'user-skill-import-replace'
describe('workbench skills', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'skills',
        groups: [],
        description: '原生目录导入与同名替换保留资源、YAML、执行位及伙伴绑定。',
        fixtures: ['tests/fixtures/workspace/skills/weekly-report'],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          await setupSkillPartners(runtime.page)
          const source = await copySkillFixture(runtime)
          await previewSkillFolder(runtime, source)
          const previewOnly = (await listSkills(runtime.page)).length === 0
          await runtime.page
            .getByTestId(selectors.resources)
            .getByRole('button', { name: /附带文件/ })
            .click()
          await runtime.page.getByRole('button', { name: /rules.json/ }).click()
          await runtime.page
            .getByTestId(selectors.resourcePreview)
            .locator('.ant-modal-content')
            .waitFor({ state: 'visible' })
          const resourcePreviewed = (
            await runtime.page.getByTestId(selectors.resourcePreview).innerText()
          ).includes('NC-SKILL-REPORT-314')
          await runtime.page
            .getByTestId(selectors.resourcePreview)
            .getByRole('button', { name: /关\s*闭/, exact: true })
            .last()
            .click()
          await discardSkill(runtime.page)
          const stagingCleared = !(await fs.readdir(path.join(runtime.userDataDir, 'skills'))).some(
            (name) => name.startsWith('.import-')
          )
          await previewSkillFolder(runtime, source)
          await runtime.page.getByTestId(selectors.description).fill('在同一表单编辑导入的规范。')
          await saveSkill(runtime.page)
          await runtime.page.waitForFunction(async () =>
            (await window.api.userSkillsList()).some((item) => item.name === 'weekly-report')
          )
          const original = await findSkill(runtime.page, 'weekly-report')
          const importedDraftEdited = original.description === '在同一表单编辑导入的规范。'
          const partnerId = await choosePartner(runtime.page, '技能伙伴 A')
          await enableSkill(runtime.page, original.name, partnerId)
          const managed = path.join(runtime.userDataDir, 'skills', 'weekly-report')
          const before = await fs.readFile(path.join(managed, 'SKILL.md'), 'utf8')
          await fs.appendFile(path.join(source, 'SKILL.md'), '\n新增替换规范。\n')
          await importSkillFolder(runtime, source)
          await runtime.page
            .getByTestId(selectors.replace)
            .getByRole('button', { name: /取\s*消/ })
            .click()
          await runtime.page
            .getByTestId(selectors.replace)
            .locator('.ant-modal-content')
            .waitFor({ state: 'hidden' })
          const cancelPreserved =
            (await fs.readFile(path.join(managed, 'SKILL.md'), 'utf8')) === before
          await importSkillFolder(runtime, source)
          await runtime.page
            .getByTestId(selectors.replace)
            .getByRole('button', { name: /替\s*换/ })
            .click()
          await runtime.page
            .getByTestId(selectors.replace)
            .locator('.ant-modal-content')
            .waitFor({ state: 'hidden' })
          await fs.rm(source, { recursive: true })
          const after = await findSkill(runtime.page, 'weekly-report')
          const binding = await runtime.page.evaluate(
            (id) => window.api.userSkillsGetEnabled(id),
            partnerId
          )
          const content = await fs.readFile(path.join(managed, 'SKILL.md'), 'utf8')
          const resource = await fs.readFile(path.join(managed, 'references', 'rules.json'), 'utf8')
          const mode = (await fs.stat(path.join(managed, 'scripts', 'check.sh'))).mode & 0o777
          return {
            previewOnly,
            resourcePreviewed,
            importedDraftEdited,
            stagingCleared,
            cancelPreserved,
            namePreserved: original.name === after.name,
            bound: binding.skillNames.includes(after.name),
            content,
            resource,
            executable: process.platform === 'win32' || (mode & 0o111) !== 0
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.previewOnly &&
              result.resourcePreviewed &&
              result.importedDraftEdited &&
              result.stagingCleared &&
              result.cancelPreserved &&
              result.namePreserved &&
              result.bound &&
              result.content.includes('新增替换规范') &&
              result.content.includes('preserve-this-field') &&
              result.resource.includes('NC-SKILL-REPORT-314') &&
              result.executable,
            {
              name: 'skill-import-replacement',
              message: '导入替换应保留资源和绑定，取消不得改变资产。',
              data: result
            }
          )
        }
      })
    },
    240_000
  )
})
