import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  accountButton,
  accountPanel,
  labels,
  menuItem,
  newTestEmail,
  withAccountFixture
} from '../../../harness/e2e/account'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'

it('independent-sessions-and-restart', async () => {
  await withAccountFixture(async (setup, service) => {
    await runE2ECase({
      ...setup,
      caseId: 'independent-sessions-and-restart',
      domain: 'account',
      suite: 'authorization',
      description: '网页与两个真实桌面会话相互独立，重启恢复后仅退出当前桌面。',
      fixtures: [],
      serviceMode: 'real',
      execution: 'exclusive',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        await accountButton(runtime.page).click()
        await menuItem(runtime.page, labels.login).click()
        let web = await service.browserPage()
        const email = newTestEmail('sessions')
        await service.authorize(runtime, web, email)
        web = await service.continueInBrowser(web)
        const userNo = await service.userNumber(web)
        const profile = await mkdtemp(join(tmpdir(), 'ncurator-second-session-'))
        let second: Awaited<ReturnType<typeof service.launchSecondDesktop>> | undefined
        try {
          second = await service.launchSecondDesktop({ userDataDir: profile })
          await accountButton(second.page).click()
          await menuItem(second.page, labels.login).click()
          await service.authorize(second, web, email, true)
          web = await service.continueInBrowser(web)
          await second.close({ preserveUserData: true })
          second = await service.launchSecondDesktop({ userDataDir: profile })
          await accountButton(second.page).click()
          await menuItem(second.page, labels.balance).click()
          await accountPanel(second.page).getByText(userNo, { exact: true }).waitFor()
          expect(
            (await service.evidence(email)).sessions.filter(
              (s) => s.clientType === 'desktop' && !s.revokedReason
            )
          ).toHaveLength(2)
          await accountButton(second.page).click()
          await menuItem(second.page, labels.signOut).click()
          await accountPanel(second.page).getByText(labels.original).waitFor()
          expect(await second.electronApp.evaluate(({ app }) => app.isReady())).toBe(true)
          await accountPanel(runtime.page).getByText(userNo, { exact: true }).waitFor()
          expect(await service.userNumber(web)).toBe(userNo)
          await web.getByText('无待结算费用', { exact: true }).waitFor()
          const [logout] = await Promise.all([
            web.waitForResponse(
              (response) => new URL(response.url()).pathname === '/api/auth/logout'
            ),
            web.getByRole('button', { name: '退出当前网页', exact: true }).click()
          ])
          expect(logout.status()).toBe(200)
          await web.waitForURL((url) => url.pathname === '/login', {
            waitUntil: 'domcontentloaded'
          })
          await accountPanel(runtime.page).getByRole('button', { name: labels.refresh }).click()
          await accountPanel(runtime.page).getByText(userNo, { exact: true }).waitFor()
          const sessions = (await service.evidence(email)).sessions
          expect(
            sessions.filter((s) => s.clientType === 'desktop' && !s.revokedReason)
          ).toHaveLength(1)
          await runtime.captureScreenshot({
            name: 'independent-primary-session',
            message: '另一桌面和网页退出后，本桌面仍有效'
          })
          return { activeDesktopSessions: 1, userNo }
        } finally {
          await second?.close().catch(() => {})
          await rm(profile, { recursive: true, force: true })
        }
      },
      assert: async (result, runtime) =>
        runtime.assertThat(result.activeDesktopSessions === 1, {
          name: 'independent-session-scope',
          message: '重启恢复同一账号，退出作用范围只限当前会话',
          data: result
        })
    })
  })
}, 180_000)
