import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  createTemporaryWorkbenchWorkspace,
  createWorkbenchNewSession,
  getWorkbenchLocator,
  getWorkbenchLatestUserMessageReferenceTokenTexts,
  getWorkbenchReferenceTokenTexts,
  insertWorkbenchReferenceToken,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
  removeFirstWorkbenchReferenceToken,
  selectWorkbenchWorkspace,
  startLocalWorkbenchHttpServer,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForWorkbenchMentionPanelText,
  waitForWorkbenchSearchScopeEmptyThroughUi,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import { createFixtureWorkspace } from '../../../../harness/e2e/settings'

const CASE_ID = 'reference-token-lifecycle'

const setupScopeWorkspace = async (
  page: import('playwright').Page,
  input: {
    workspaceName: string
    webSourceUrl: string
  }
): Promise<{
  workspace: Awaited<ReturnType<typeof createTemporaryWorkbenchWorkspace>>
  workspaceName: string
}> => {
  const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
  await prepareWorkbenchWorkspaceThroughUi(page, {
    workspaceName: input.workspaceName,
    rootPath: workspace.rootPath,
    webSourceUrl: input.webSourceUrl
  })

  return {
    workspace,
    workspaceName: input.workspaceName
  }
}

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['scope'],
        description:
          '真实 workspace + 真实 web source 下验证 @ 候选、token 追加共存、同资料去重、删除和切工作区清理。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const server = await startLocalWorkbenchHttpServer(
            '<!doctype html><title>Workbench Web Fixture</title><main>Workbench web fixture unique fact: cedar-scope-731.</main>'
          )
          runtime.registerResource({
            name: 'reference-token-http-server',
            phase: 'before-app-close',
            dispose: server.close
          })
          const setup = await setupScopeWorkspace(page, {
            workspaceName: 'Workbench Scope Workspace',
            webSourceUrl: server.url
          })
          await writeFile(
            path.join(setup.workspace.rootPath, '工作', 'added-after-index.md'),
            '# Added after indexing',
            'utf8'
          )
          await navigateToWorkbench(page)
          await selectWorkbenchWorkspace(page, setup.workspaceName)
          await switchWorkbenchMode(page, '大聪明')
          await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
          const afterFile = await getWorkbenchReferenceTokenTexts(page)
          await insertWorkbenchReferenceToken(page, '工作')
          const afterDirectory = await getWorkbenchReferenceTokenTexts(page)

          await appendWorkbenchInputText(page, '@')
          const mentionPanel = getWorkbenchLocator(page, workbenchSelectors.mentionPanel)
          await waitForWorkbenchMentionPanelText(page)
          await page.waitForFunction(
            (testId: string) => {
              const panel = document.querySelector(`[data-testid="${testId}"]`)
              return Boolean(panel?.querySelector('button'))
            },
            workbenchSelectors.mentionPanel,
            { timeout: WORKBENCH_RESULT_E2E_TIMEOUT_MS }
          )
          const mentionPanelText = ((await mentionPanel.textContent()) || '').trim()
          const fileGroupVisible = await mentionPanel.getByText('文件').isVisible()
          const webGroupVisible = await mentionPanel.getByText('网页').isVisible()
          const legacyDirectoryGroupVisible = await mentionPanel
            .getByText('目录')
            .isVisible()
            .catch(() => false)
          const legacyTypeTagVisible = await mentionPanel
            .locator('.nc-tag')
            .filter({ hasText: /DOCX|PDF|文件|网页|目录/u })
            .first()
            .isVisible()
            .catch(() => false)
          const directoryIconVisible = await mentionPanel
            .locator('[data-reference-kind="directory"] [data-reference-icon-kind="directory"]')
            .first()
            .isVisible()
            .catch(() => false)
          const webIconVisible = await mentionPanel
            .locator('[data-reference-kind="web"] [data-reference-icon-kind="web"]')
            .first()
            .isVisible()
            .catch(() => false)
          const docxIconPresent =
            (await mentionPanel.locator('[data-reference-icon-kind="docx"]').count()) > 0
          const pdfIconPresent =
            (await mentionPanel.locator('[data-reference-icon-kind="pdf"]').count()) > 0
          const unexpectedMarkdownIconPresent =
            (await mentionPanel.locator('[data-reference-icon-kind="markdown"]').count()) > 0
          const genericFileIconPresent =
            (await mentionPanel
              .getByRole('button')
              .filter({ hasText: 'human-input.txt' })
              .locator('[data-reference-icon-kind="file"]')
              .count()) > 0
          const markdownUsesGenericFileIcon =
            (await mentionPanel
              .getByRole('button')
              .filter({ hasText: 'workbench-preview.md' })
              .locator('[data-reference-icon-kind="file"]')
              .count()) > 0
          const duplicateCandidateVisible = await getWorkbenchLocator(
            page,
            workbenchSelectors.mentionPanel
          )
            .getByText('sample-edit.docx')
            .isVisible()
            .catch(() => false)
          const textFileIndexedVisible = await mentionPanel
            .getByRole('button')
            .filter({ hasText: 'human-input.txt' })
            .filter({ hasText: '已索引' })
            .first()
            .isVisible()
            .catch(() => false)
          const markdownFileIndexedVisible = await mentionPanel
            .getByRole('button')
            .filter({ hasText: 'workbench-preview.md' })
            .filter({ hasText: '已索引' })
            .first()
            .isVisible()
            .catch(() => false)
          const addedAfterIndexVisible = await mentionPanel
            .getByRole('button')
            .filter({ hasText: 'added-after-index.md' })
            .first()
            .isVisible()
            .catch(() => false)
          const addedAfterIndexUnindexedVisible = await mentionPanel
            .getByRole('button')
            .filter({ hasText: 'added-after-index.md' })
            .filter({ hasText: '未索引' })
            .first()
            .isVisible()
            .catch(() => false)
          const localTextFileStillUnindexed = await mentionPanel
            .getByRole('button')
            .filter({ hasText: 'human-input.txt' })
            .filter({ hasText: '未索引' })
            .first()
            .isVisible()
            .catch(() => false)
          await mentionPanel
            .getByRole('button')
            .filter({ hasText: 'Workbench Web Fixture' })
            .click()
          const afterWeb = await getWorkbenchReferenceTokenTexts(page)
          const tokensBeforeSubmit = await getWorkbenchReferenceTokenTexts(page)
          const composerReferenceIconKinds = await getWorkbenchLocator(
            page,
            workbenchSelectors.input
          ).evaluate((element) => {
            if (!(element instanceof HTMLElement)) {
              throw new Error('workbench input is not an HTMLElement')
            }
            return Array.from(
              element.querySelectorAll('[data-role="scope-token"] [data-reference-icon-kind]')
            ).map((node) => node.getAttribute('data-reference-icon-kind') || '')
          })
          const composerTokenCloseButtonVisible = await getWorkbenchLocator(
            page,
            workbenchSelectors.input
          )
            .locator('[data-role="scope-token"] button')
            .first()
            .isVisible()
            .catch(() => false)
          const smartModeSearchWarningVisible = await getWorkbenchLocator(
            page,
            workbenchSelectors.referenceSearchWarning
          )
            .isVisible()
            .catch(() => false)
          await switchWorkbenchMode(page, '没头脑')
          const searchWarning = getWorkbenchLocator(page, workbenchSelectors.referenceSearchWarning)
          await searchWarning.waitFor({ state: 'visible' })
          const searchWarningText = ((await searchWarning.textContent()) || '').trim()
          await appendWorkbenchInputText(page, '请用一句话说明这些资料。')
          await submitWorkbenchCurrentDraft(page)
          const latestUserMessageReferenceTokens =
            await getWorkbenchLatestUserMessageReferenceTokenTexts(page)
          const latestUserMessageText = (
            (await getWorkbenchLocator(page, workbenchSelectors.userMessageReferences)
              .last()
              .textContent()) || ''
          ).trim()
          const latestUserMessageReferenceIconKinds = await getWorkbenchLocator(
            page,
            workbenchSelectors.userMessageReferences
          )
            .last()
            .evaluate((element) => {
              if (!(element instanceof HTMLElement)) {
                throw new Error('workbench user message references is not an HTMLElement')
              }
              return Array.from(
                element.querySelectorAll(
                  '[data-role="reference-inline-token"] [data-reference-icon-kind]'
                )
              ).map((node) => node.getAttribute('data-reference-icon-kind') || '')
            })
          await getWorkbenchLocator(page, workbenchSelectors.searchResults).waitFor({
            state: 'visible'
          })

          await switchWorkbenchMode(page, '大聪明')
          await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
          await insertWorkbenchReferenceToken(page, '工作')
          await insertWorkbenchReferenceToken(page, 'Workbench Web Fixture', server.url)
          const tokensBeforeDelete = await getWorkbenchReferenceTokenTexts(page)
          await removeFirstWorkbenchReferenceToken(page)
          const afterDelete = await getWorkbenchReferenceTokenTexts(page)

          await createFixtureWorkspace(page, { name: 'Workbench Empty Scope Workspace' })
          await navigateToWorkbench(page)
          await createWorkbenchNewSession(page)
          await selectWorkbenchWorkspace(page, 'Workbench Empty Scope Workspace')
          const afterWorkspaceSwitch = await getWorkbenchReferenceTokenTexts(page)
          const emptyPanelText = await waitForWorkbenchSearchScopeEmptyThroughUi(page)

          return {
            afterFile,
            afterDirectory,
            afterWeb,
            mentionPanelText,
            fileGroupVisible,
            webGroupVisible,
            legacyDirectoryGroupVisible,
            legacyTypeTagVisible,
            directoryIconVisible,
            webIconVisible,
            docxIconPresent,
            pdfIconPresent,
            unexpectedMarkdownIconPresent,
            genericFileIconPresent,
            markdownUsesGenericFileIcon,
            duplicateCandidateVisible,
            textFileIndexedVisible,
            markdownFileIndexedVisible,
            addedAfterIndexVisible,
            addedAfterIndexUnindexedVisible,
            localTextFileStillUnindexed,
            tokensBeforeSubmit,
            composerReferenceIconKinds,
            composerTokenCloseButtonVisible,
            smartModeSearchWarningVisible,
            searchWarningText,
            tokensBeforeDelete,
            latestUserMessageReferenceTokens,
            latestUserMessageText,
            latestUserMessageReferenceIconKinds,
            afterDelete,
            afterWorkspaceSwitch,
            emptyPanelText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.latestUserMessageText.indexOf('sample-edit.docx') >= 0 &&
              result.latestUserMessageText.indexOf('工作') >
                result.latestUserMessageText.indexOf('sample-edit.docx') &&
              result.latestUserMessageText.indexOf('请用一句话说明这些资料。') >
                result.latestUserMessageText.indexOf('工作') &&
              result.afterFile.some((text) => text.includes('sample-edit.docx')) &&
              result.afterDirectory.some((text) => text.includes('工作')) &&
              result.afterWeb.some((text) => text.includes('sample-edit.docx')) &&
              result.afterWeb.some((text) => text.includes('工作')) &&
              result.afterWeb.some(
                (text) => text.includes('Workbench Web Fixture') || text.includes('127.0.0.1')
              ) &&
              result.fileGroupVisible &&
              result.webGroupVisible &&
              !result.legacyDirectoryGroupVisible &&
              !result.legacyTypeTagVisible &&
              result.directoryIconVisible &&
              result.webIconVisible &&
              result.docxIconPresent &&
              result.pdfIconPresent &&
              !result.unexpectedMarkdownIconPresent &&
              result.genericFileIconPresent &&
              result.markdownUsesGenericFileIcon &&
              !result.duplicateCandidateVisible &&
              result.textFileIndexedVisible &&
              result.markdownFileIndexedVisible &&
              result.addedAfterIndexVisible &&
              result.addedAfterIndexUnindexedVisible &&
              !result.localTextFileStillUnindexed &&
              result.tokensBeforeSubmit.length === 3 &&
              result.composerReferenceIconKinds.includes('docx') &&
              result.composerReferenceIconKinds.includes('directory') &&
              result.composerReferenceIconKinds.includes('web') &&
              !result.composerTokenCloseButtonVisible &&
              !result.smartModeSearchWarningVisible &&
              result.searchWarningText.includes('搜索只会覆盖其已索引子文件') &&
              result.tokensBeforeDelete.length === 3 &&
              result.latestUserMessageReferenceTokens.length === 3 &&
              result.latestUserMessageReferenceIconKinds.includes('docx') &&
              result.latestUserMessageReferenceIconKinds.includes('directory') &&
              result.latestUserMessageReferenceIconKinds.includes('web') &&
              result.latestUserMessageReferenceTokens.some((text) =>
                text.includes('sample-edit.docx')
              ) &&
              result.latestUserMessageReferenceTokens.some((text) => text.includes('工作')) &&
              result.latestUserMessageReferenceTokens.some(
                (text) => text.includes('Workbench Web Fixture') || text.includes('127.0.0.1')
              ) &&
              result.afterDelete.length === 2 &&
              result.afterWorkspaceSwitch.length === 0 &&
              /没有匹配项|No data|请先选择工作区/u.test(result.emptyPanelText),
            {
              name: 'workbench-reference-token-real-lifecycle',
              message:
                '@ 参考资料应来自真实 workspace/web 资料；候选按文件/网页分组并覆盖当前目录，索引后直接新增的文件无需检查更新也应出现并显示未索引，目录、网页、PDF、DOCX、PPT 使用专属样式，Markdown、TXT 和其他文件使用普通文件样式；选择文件、目录、网页时应追加共存，发送后用户消息保留紧凑 token 和分型图标，同一资料不重复出现，删除后移除 token，切换工作区后清理旧 token，空候选给出提示，对齐 WB-SCOPE-001 至 WB-SCOPE-004。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_RESULT_E2E_TIMEOUT_MS
  )
})
