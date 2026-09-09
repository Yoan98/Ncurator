import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_RESULT_E2E_TIMEOUT_MS,
  appendWorkbenchInputText,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  createTemporaryWorkbenchWorkspace,
  createWorkbenchNewSession,
  getWorkbenchLocator,
  getWorkbenchReferenceTokenTexts,
  insertWorkbenchReferenceToken,
  navigateToWorkbench,
  prepareWorkbenchWorkspaceThroughUi,
  removeFirstWorkbenchReferenceToken,
  startLocalWorkbenchHttpServer,
  waitForWorkbenchMentionPanelText,
  waitForWorkbenchSearchScopeEmptyThroughUi,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

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
          '真实文件地址 + 全局网页下验证 @ 候选、token 追加共存、同资料去重、删除和新伙伴草稿为空。',
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
          await createPartnerThroughWorkbenchUi(page, setup.workspaceName)
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
          const duplicateCandidateVisible = await mentionPanel
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

          await createWorkbenchNewSession(page)
          await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
          await insertWorkbenchReferenceToken(page, '工作')
          await insertWorkbenchReferenceToken(page, 'Workbench Web Fixture', server.url)
          const tokensBeforeDelete = await getWorkbenchReferenceTokenTexts(page)
          await removeFirstWorkbenchReferenceToken(page)
          const afterDelete = await getWorkbenchReferenceTokenTexts(page)

          await createWorkbenchNewSession(page)
          const afterNewPartner = await getWorkbenchReferenceTokenTexts(page)
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
            tokensBeforeDelete,
            afterDelete,
            afterNewPartner,
            emptyPanelText
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
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
              result.tokensBeforeDelete.length === 3 &&
              result.afterDelete.length === 2 &&
              result.afterNewPartner.length === 0 &&
              /没有匹配项|No data/u.test(result.emptyPanelText),
            {
              name: 'workbench-reference-token-real-lifecycle',
              message:
                '@ 参考资料应来自真实文件地址和全局网页；候选按文件/网页分组，索引后直接新增的文件无需检查更新也应出现并显示未索引；选择文件、目录、网页时应追加共存，同一资料不重复出现，删除后移除 token，新伙伴草稿为空，空候选给出提示，对齐 WB-SCOPE-001 至 WB-SCOPE-004。',
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
