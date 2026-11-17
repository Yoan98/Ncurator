import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import {
  accountButton,
  labels,
  menuItem,
  newTestEmail,
  openAccountMenu,
  readDesktopUserNo,
  readWebsiteWallet,
  refreshWallet,
  withAccountFixture
} from '../../../harness/e2e/account'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import { workbenchSelectors } from '../../../harness/e2e/workbench'

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
        const modelNotice = runtime.page.getByTestId(
          workbenchSelectors.llmConfigMissingNotification
        )
        await expect.poll(() => modelNotice.isVisible()).toBe(true)
        let web = await service.browserPage()
        const email = newTestEmail('sessions')
        await service.authorize(runtime, web, email)
        await expect.poll(() => modelNotice.count()).toBe(0)
        web = await service.continueInBrowser(web)
        const userNo = await service.userNumber(web)
        const profile = await mkdtemp(join(dirname(runtime.userDataDir), 'ncurator-second-session-'))
        let second: Awaited<ReturnType<typeof service.launchSecondDesktop>> | undefined
        try {
          second = await service.launchSecondDesktop({ userDataDir: profile })
          await service.authorize(second, web, email, { signedIn: true })
          web = await service.continueInBrowser(web)
          await second.close({ preserveUserData: true })
          second = await service.launchSecondDesktop({ userDataDir: profile })
          await expect.poll(() => readDesktopUserNo(second!.page)).toBe(userNo)
          expect(
            (await service.evidence(email)).sessions.filter(
              (s) => s.clientType === 'desktop' && !s.revokedReason
            )
          ).toHaveLength(2)
          await accountButton(second.page).click()
          await menuItem(second.page, labels.signOut).click()
          await openAccountMenu(second.page)
          await menuItem(second.page, labels.login).waitFor()
          expect(await second.electronApp.evaluate(({ app }) => app.isReady())).toBe(true)
          await second.close({ preserveUserData: true })
          second = await service.launchSecondDesktop({ userDataDir: profile })
          await openAccountMenu(second.page)
          await menuItem(second.page, labels.login).waitFor()
          expect(await readDesktopUserNo(second.page)).toBeUndefined()
          expect(await readDesktopUserNo(runtime.page)).toBe(userNo)
          expect(await service.userNumber(web)).toBe(userNo)
          expect((await readWebsiteWallet(web)).settlementPending).toBe(false)
          expect(await web.getByText('费用结算中', { exact: true }).count()).toBe(0)
          await web.getByRole('button', { name: '账户菜单', exact: true }).click()
          const [logout] = await Promise.all([
            web.waitForResponse(
              (response) => new URL(response.url()).pathname === '/api/auth/logout'
            ),
            web.getByRole('menuitem', { name: '退出登录', exact: true }).click()
          ])
          expect(logout.status()).toBe(200)
          await web.waitForURL((url) => url.pathname === '/login', {
            waitUntil: 'domcontentloaded'
          })
          await refreshWallet(runtime.page)
          expect(await readDesktopUserNo(runtime.page)).toBe(userNo)
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
          try {
            await second?.close({ preserveUserData: true })
          } finally {
            await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
          }
        }
      },
      assert: async (result, runtime) =>
        runtime.assertThat(result.activeDesktopSessions === 1, {
          name: 'independent-session-scope',
          message: '重启恢复同一账号，退出仅作用于当前会话且重启后保持退出',
          data: result
        })
    })
  })
}, 180_000)
