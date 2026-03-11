import React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SearchPage from '../../../../src/renderer/src/pages/SearchPage'
import { searchSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { SourceScopeSelection } from '../../../../src/shared/types'
import { createDesktopApiMock } from '../../../harness/renderer/apiMock'
import type { UiAssertion } from '../../../harness/e2e/reporter'
import { runRendererCase } from '../../../harness/renderer/case'
import { renderWithDesktopApi } from '../../../harness/renderer/renderPage'

const getScopeKey = (scope: SourceScopeSelection): string =>
  [scope.sourceType, scope.sourceId, scope.scopeType, scope.nodeId || 'root'].join(':')

const workspaceScope: SourceScopeSelection = {
  scopeType: 'workspace',
  sourceType: 'workspace',
  sourceId: 'workspace-1',
  label: '测试工作空间',
  absolutePath: '/tmp/workspace',
  documentIds: ['doc-a', 'doc-b'],
  hasUnpreparedFiles: false,
  preparedDocumentCount: 2,
  unpreparedFileCount: 0,
  workspace: {
    workspaceId: 'workspace-1',
    rootPath: '/tmp/workspace'
  }
}

const webScope: SourceScopeSelection = {
  scopeType: 'web',
  sourceType: 'web',
  sourceId: 'web-1',
  label: '测试网页资料',
  absolutePath: 'https://example.com/article',
  documentIds: ['doc-b'],
  hasUnpreparedFiles: false,
  preparedDocumentCount: 1,
  unpreparedFileCount: 0
}

describe('search.scope-selection', () => {
  it('loads search-mode scopes and submits deduped document ids', async () => {
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const apiMock = createDesktopApiMock({
      sourceScopes: [workspaceScope, webScope],
      searchResponse: { results: [], tokens: [] }
    })
    const user = userEvent.setup()
    renderWithDesktopApi({
      apiMock,
      ui: <SearchPage />
    })

    await runRendererCase({
      suite: 'renderer-search-contract',
      caseId: 'search-scope-selection-deduped-documents',
      apiMock,
      userActionSequence,
      selectorFailures,
      assertions,
      notes,
      route: '#/',
      expectedOutcome: 'success',
      scenarioTags: ['renderer', 'search', 'scope-selection'],
      taskGoal: 'Load search scope candidates and verify selected scope documentIds are deduped before search invoke.',
      body: async () => {
        await waitFor(() => {
          expect(apiMock.calls.sourceScopeList.length).toBeGreaterThan(0)
        })
        expect(apiMock.calls.sourceScopeList[0]).toEqual({ mode: 'search' })

        const scopeField = screen.getByTestId(searchSelectors.sourceScopeField)
        const scopeSelect = scopeField.querySelector('select')
        expect(scopeSelect).not.toBeNull()
        await user.selectOptions(scopeSelect as HTMLSelectElement, [
          getScopeKey(workspaceScope),
          getScopeKey(webScope)
        ])
        userActionSequence.push('select:search-scopes-workspace-and-web')

        fireEvent.change(screen.getByTestId(searchSelectors.input), {
          target: { value: '范围过滤查询' }
        })
        await user.click(screen.getByTestId(searchSelectors.submitButton))
        userActionSequence.push('click:search-submit-button')

        await waitFor(() => {
          expect(apiMock.calls.search).toHaveLength(1)
        })

        expect(apiMock.calls.search[0]).toMatchObject({
          query: '范围过滤查询',
          sourceType: 'all'
        })
        const dedupedDocumentIds = apiMock.calls.search[0].documentIds || []
        expect(dedupedDocumentIds).toHaveLength(2)
        expect(dedupedDocumentIds).toEqual(expect.arrayContaining(['doc-a', 'doc-b']))

        assertions.push({ id: 'search-scope-list-called-with-search-mode', pass: true })
        assertions.push({ id: 'search-call-uses-deduped-document-ids', pass: true })
      }
    })
  })

  it('submits search without documentIds when no scope is selected', async () => {
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    const apiMock = createDesktopApiMock({
      sourceScopes: [workspaceScope],
      searchResponse: { results: [], tokens: [] }
    })
    const user = userEvent.setup()
    renderWithDesktopApi({
      apiMock,
      ui: <SearchPage />
    })

    await runRendererCase({
      suite: 'renderer-search-contract',
      caseId: 'search-scope-selection-empty-documents',
      apiMock,
      userActionSequence,
      selectorFailures,
      assertions,
      notes,
      route: '#/',
      expectedOutcome: 'success',
      scenarioTags: ['renderer', 'search', 'scope-selection'],
      taskGoal: 'Submit search without selecting scope and verify documentIds are omitted.',
      body: async () => {
        await waitFor(() => {
          expect(apiMock.calls.sourceScopeList.length).toBeGreaterThan(0)
        })
        expect(apiMock.calls.sourceScopeList[0]).toEqual({ mode: 'search' })

        fireEvent.change(screen.getByTestId(searchSelectors.input), {
          target: { value: '无范围查询' }
        })
        await user.click(screen.getByTestId(searchSelectors.submitButton))
        userActionSequence.push('click:search-submit-button')

        await waitFor(() => {
          expect(apiMock.calls.search).toHaveLength(1)
        })

        expect(apiMock.calls.search[0]).toEqual({
          query: '无范围查询',
          sourceType: 'all',
          documentIds: undefined
        })
        assertions.push({ id: 'search-call-omits-document-ids-with-empty-scope', pass: true })
      }
    })
  })
})
