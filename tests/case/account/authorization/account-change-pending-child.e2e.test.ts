import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { chatSelectors } from '../../../../src/renderer/src/testing/selectors'
import {
  labels,
  menuItem,
  newTestEmail,
  openAccountMenu,
  readDesktopUserNo,
  withAccountFixture
} from '../../../harness/e2e/account'
import {
  dismissNativeConfirmation,
  openNativeConfirmation
} from '../../../harness/e2e/nativeConfirm'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  createPartnerThroughWorkbenchUi,
  dismissWorkbenchLlmConfigMissingNotification,
  getWorkbenchLocator,
  selectWorkbenchExecutionPermission,
  sendWorkbenchMessage,
  waitForWorkbenchAiEvent,
  workbenchSelectors
} from '../../../harness/e2e/workbench'

it('account-change-pending-child', async () => {
  await withAccountFixture(async (setup, service) => {
    const model = service.model
    if (!model) throw new Error('Configure the isolated managed model fixture')
    await runE2ECase({
      ...setup,
      caseId: 'account-change-pending-child',
      domain: 'account',
      suite: 'authorization',
      description: '换号停止待人工审批的馆长子任务并清除待审批入口。',
      fixtures: [],
      serviceMode: 'real',
      execution: 'exclusive',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const originalEmail = newTestEmail('approval-original')
        let browser = await service.browserPage()
        await service.authorize(runtime, browser, originalEmail)
        browser = await service.continueInBrowser(browser)
        const original = await service.userNumber(browser)
        await service.recharge(browser)
        await createPartnerThroughWorkbenchUi(page, '换号前待审批')
        await dismissWorkbenchLlmConfigMissingNotification(page)
        await getWorkbenchLocator(page, workbenchSelectors.modelSelect).getByRole('button').click()
        await page
          .getByTestId(`${workbenchSelectors.modelSelectManagedOptionPrefix}-${model.id}`)
          .click()
        await selectWorkbenchExecutionPermission(page, '审核')

        const directory = await mkdtemp(join(tmpdir(), 'ncurator-account-review-'))
        runtime.registerResource({
          name: 'approval-test-files',
          phase: 'after-app-close',
          dispose: () => rm(directory, { force: true, recursive: true })
        })
        const sentinel = join(directory, 'sentinel.txt')
        await writeFile(sentinel, 'keep on cancellation')
        const command =
          process.platform === 'win32'
            ? `Remove-Item -LiteralPath '${directory.replaceAll("'", "''")}' -Recurse -Force`
            : `rm -rf '${directory.replaceAll("'", "'\\''")}'`
        await sendWorkbenchMessage(
          page,
          'NCURATOR_E2E_DELEGATE_ONCE ' + Buffer.from(command).toString('base64url')
        )
        const approval = await waitForWorkbenchAiEvent(runtime, {
          name: 'managed-child-pending-approval',
          matches: (event) => event.type === 'approval_batch_required' && Boolean(event.source),
          timeoutMs: 40_000
        })
        if (approval.type !== 'approval_batch_required' || !approval.source) {
          throw new Error('Missing child approval')
        }
        const card = page
          .getByTestId(chatSelectors.approvalBatchCard)
          .filter({ hasText: /待审核子任务|ncurator-account-review/u })
        await card.waitFor({ state: 'visible' })
        const logout = async (choice: 'cancel' | 'confirm') => {
          await openAccountMenu(page)
          const title = '退出当前桌面'
          const dialog = await openNativeConfirmation(
            runtime,
            menuItem(page, labels.signOut),
            title
          )
          await dialog.getByText('退出将停止这些任务', { exact: true }).waitFor()
          await dismissNativeConfirmation(dialog, choice, title)
        }
        await logout('cancel')
        await card.waitFor({ state: 'visible' })
        expect(await readDesktopUserNo(page)).toBe(original)
        await logout('confirm')
        await waitForWorkbenchAiEvent(runtime, {
          name: 'managed-child-approval-cancelled',
          matches: (event) =>
            event.type === 'approval_batch_cancelled' && event.batchId === approval.batchId
        })
        await waitForWorkbenchAiEvent(runtime, {
          name: 'managed-child-cancelled',
          matches: (event) =>
            event.type === 'subagent_updated' &&
            event.update.childRunId === approval.source?.childRunId &&
            event.update.status === 'cancelled'
        })
        const next = await service.browserPage()
        const nextEmail = newTestEmail('approval-next')
        await service.authorize(runtime, next, nextEmail)
        expect(await readDesktopUserNo(page)).not.toBe(original)
        await card.waitFor({ state: 'hidden' })
        expect((await service.evidence(nextEmail)).calls).toHaveLength(0)
        expect(await readFile(sentinel, 'utf8')).toBe('keep on cancellation')
        return true
      },
      assert: async (result, runtime) =>
        runtime.assertThat(result, {
          name: 'managed-child-does-not-survive-account-change',
          message: '未审批命令和子任务随原账号停止，新账号没有继承调用。'
        })
    })
  })
}, 155_000)
