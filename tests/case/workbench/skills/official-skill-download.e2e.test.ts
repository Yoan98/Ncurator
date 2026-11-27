import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  findSkill,
  setupSkillPartners,
  enableSkill,
  choosePartner,
  openSkills
} from '../../../harness/e2e/userSkills'

const CASE_ID = 'official-skill-download'
describe('official Skill', () => {
  it(
    CASE_ID,
    async () => {
      const origin = process.env.OFFICIAL_SKILL_TEST_API_ORIGIN,
        id = process.env.OFFICIAL_SKILL_TEST_ID,
        adminCookie = process.env.OFFICIAL_SKILL_TEST_ADMIN_COOKIE
      if (!origin || !id || !adminCookie)
        throw new Error(
          'Official Skill E2E requires a real configured test API and OFFICIAL_SKILL_TEST_ID'
        )
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'skills',
        groups: [],
        description: '真实官方目录、下载、覆盖确认及身份绑定。',
        fixtures: [],
        knowledge: 'none',
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        extraEnv: {
          NCURATOR_SERVICE_ENV: 'local',
          NCURATOR_LOCAL_API_ORIGIN: origin,
          NCURATOR_LOCAL_WEB_ORIGIN: origin
        },
        execute: async (runtime) => {
          const { page } = runtime
          await setupSkillPartners(page)
          const row = page.getByTestId(`official-skill-${id}`)
          await row.waitFor({ timeout: 30000 })
          const firstName = await row
            .locator('button[aria-label^="下载"]')
            .getAttribute('aria-label')
          await row.getByRole('button', { name: /^下载 v/ }).click()
          await row.getByRole('button', { name: /^重新下载 v/ }).waitFor({ timeout: 30000 })
          const local = (await page.evaluate(() => window.api.userSkillsList())).find(
            (item) => item.officialId === id
          )!
          const partnerId = await choosePartner(page, '技能伙伴 A')
          await enableSkill(page, local.name, partnerId)
          const markdown = path.join(runtime.userDataDir, 'skills', local.name, 'SKILL.md')
          const original = await fs.readFile(markdown, 'utf8')
          await fs.appendFile(markdown, '\n本地修改的个人偏好。\n')
          await row.getByRole('button', { name: /^重新下载 v/ }).click()
          const dialog = page.getByRole('dialog').filter({ hasText: '覆盖「' })
          await dialog.getByText(/本地 Skill 已修改/).waitFor()
          await dialog.getByRole('button', { name: /^取\s*消$/u }).click()
          const cancelled = (await fs.readFile(markdown, 'utf8')).includes('本地修改的个人偏好')
          await row.getByRole('button', { name: /^重新下载 v/ }).click()
          await dialog.getByRole('button', { name: '覆盖并下载', exact: true }).click()
          await expect.poll(async () => fs.readFile(markdown, 'utf8')).toBe(original)
          const after = await findSkill(page, local.name),
            selection = await page.evaluate(
              (partner) => window.api.userSkillsGetEnabled(partner),
              partnerId
            )
          const bindingPreserved = selection.skillNames.includes(local.name)
          const request = async (url: string, body?: object, method = 'POST') => {
            const response = await fetch(origin + url, {
              method: body ? method : 'GET',
              headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
              body: body ? JSON.stringify(body) : undefined
            })
            if (!response.ok) throw new Error(`Official Skill test API failed (${response.status})`)
            return response.json()
          }
          const metadata = (await request('/api/ops/skills')).items.find(
            (item: { id: string }) => item.id === id
          )
          const bytes = Buffer.from(await (await fetch(metadata.release.downloadUrl)).arrayBuffer())
          const targetVersion = `1.1.${Math.floor(Date.now() / 1000)}`
          const published = await request(`/api/ops/skills/${id}/releases`, {
            revision: metadata.revision,
            version: targetVersion,
            minClientVersion: '2.0.2',
            releaseNotes: '更新并改名',
            packageBase64: bytes.toString('base64')
          })
          const renamedName = `video-update-${Date.now()}`
          await request(
            `/api/ops/skills/${id}`,
            { revision: published.revision, name: renamedName, displayName: '视频制作' },
            'PATCH'
          )
          await page.reload()
          await openSkills(page)
          await row.getByRole('button', { name: `更新到 v${targetVersion}`, exact: true }).click()
          await dialog.getByRole('button', { name: '覆盖并下载', exact: true }).click()
          await row
            .getByRole('button', { name: `重新下载 v${targetVersion}`, exact: true })
            .waitFor({ timeout: 30000 })
          const renamed = await findSkill(page, renamedName),
            renamedBinding = await page.evaluate(
              (partner) => window.api.userSkillsGetEnabled(partner),
              partnerId
            )
          const renamedBody = await fs.readFile(
            path.join(runtime.userDataDir, 'skills', renamedName, 'SKILL.md'),
            'utf8'
          )
          const renamePreserved =
            renamed.id === local.id &&
            renamedBinding.skillNames.includes(renamedName) &&
            !renamedBinding.skillNames.includes(local.name) &&
            renamedBody.includes(`name: ${renamedName}`)
          await dialog.waitFor({ state: 'hidden' })
          await runtime.captureScreenshot({
            name: 'official-skill-installed',
            message: '官方分组、左侧下载状态与直接操作图标。'
          })
          return {
            firstName,
            cancelled,
            identityPreserved: after.id === local.id,
            bindingPreserved,
            renamePreserved
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.cancelled &&
              result.identityPreserved &&
              result.bindingPreserved &&
              result.renamePreserved,
            {
              name: 'official-skill-update',
              message: '取消保留本地内容，覆盖保留身份和伙伴绑定。',
              data: result
            }
          )
        }
      })
    },
    240000
  )
})
