import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, test } from 'vitest'
import {
  buildWebScopeSelection,
  shouldIncludeScopeInSearch
} from '../../../../src/main/services/sourceScope/selection'
import { validateSelectedScopesForRun } from '../../../../src/main/services/sourceScope/validation'
import type { AiRunEvent, SourceScopeSelection, WebSourceRecord } from '../../../../src/shared/types'
import { recordAssertion } from '../../harness/assertions'
import { runIntegrationCase } from '../../harness/capabilityCase'

describe('integration/runtime', () => {
  test('runtime scope validation should emit structured issues and keep web search scope strict', async () => {
    await runIntegrationCase({
      caseId: 'runtime-scope-validation',
      description: '验证运行时范围校验、网页范围搜索限制和结构化阻塞事件。',
      expectedOutcome: 'success',
      scenarioTags: ['runtime', 'scope-validation', 'web-scope'],
      requiredFixtures: [],
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'runtime scope validation completed'
      }),
      execute: async (runtime) => {
        const validFilePath = path.join(runtime.workspaceRoot, 'notes.docx')
        await fs.writeFile(validFilePath, 'workspace note', 'utf8')

        const validScope: SourceScopeSelection = {
          scopeType: 'file',
          sourceType: 'workspace',
          sourceId: 'workspace-1',
          nodeId: 'workspace-1:file:notes.docx',
          label: 'notes.docx',
          absolutePath: validFilePath,
          relativePath: 'notes.docx',
          documentIds: ['doc-note'],
          hasUnpreparedFiles: false,
          preparedDocumentCount: 1,
          unpreparedFileCount: 0,
          workspace: {
            workspaceId: 'workspace-1',
            rootPath: runtime.workspaceRoot
          }
        }

        const emittedEvents: AiRunEvent[] = []
        const workspaceStore = {
          getWorkspaceById: async (id: string) =>
            id === 'workspace-1' ? { id, root_path: runtime.workspaceRoot } : null
        }
        const webSourceStore = {
          getWebSourceById: async (id: string) =>
            id === 'web-ready'
              ? {
                  id,
                  import_status: 2,
                  document_id: 'doc-web'
                }
              : null
        }

        const okValidation = await validateSelectedScopesForRun({
          scopes: [validScope],
          workspaceStore,
          webSourceStore,
          sendEvent: (event) => emittedEvents.push(event),
          runId: runtime.runId
        })

        const missingWorkspaceValidation = await validateSelectedScopesForRun({
          scopes: [
            {
              ...validScope,
              sourceId: 'workspace-missing',
              workspace: {
                workspaceId: 'workspace-missing',
                rootPath: runtime.workspaceRoot
              }
            }
          ],
          workspaceStore,
          webSourceStore,
          sendEvent: (event) => emittedEvents.push(event),
          runId: runtime.runId
        })

        const missingBindingValidation = await validateSelectedScopesForRun({
          scopes: [
            {
              ...validScope,
              sourceId: '',
              workspace: undefined
            }
          ],
          workspaceStore,
          webSourceStore,
          sendEvent: (event) => emittedEvents.push(event),
          runId: runtime.runId
        })

        const unavailableWebValidation = await validateSelectedScopesForRun({
          scopes: [
            {
              scopeType: 'web',
              sourceType: 'web',
              sourceId: 'web-missing',
              label: 'missing web source',
              absolutePath: 'https://example.com/missing',
              documentIds: ['doc-missing'],
              hasUnpreparedFiles: false,
              preparedDocumentCount: 1,
              unpreparedFileCount: 0
            }
          ],
          workspaceStore,
          webSourceStore,
          sendEvent: (event) => emittedEvents.push(event),
          runId: runtime.runId
        })

        const readyWebSource: WebSourceRecord = {
          id: 'web-ready',
          identity_kind: 'normalized_url',
          normalized_url: 'https://example.com/article',
          url: 'https://example.com/article',
          title: 'Example Article',
          document_id: 'doc-web',
          import_status: 2,
          created_at: 10,
          updated_at: 20
        }

        const webScope = buildWebScopeSelection(readyWebSource)
        const localUnpreparedScope: SourceScopeSelection = {
          ...validScope,
          documentIds: [],
          hasUnpreparedFiles: true,
          preparedDocumentCount: 0,
          unpreparedFileCount: 1
        }

        return {
          okValidation,
          missingWorkspaceValidation,
          missingBindingValidation,
          unavailableWebValidation,
          emittedEvents,
          webScope,
          readyWebAllowedInSearch: webScope ? shouldIncludeScopeInSearch(webScope) : false,
          localUnpreparedAllowedInSearch: shouldIncludeScopeInSearch(localUnpreparedScope)
        }
      },
      assert: async (result, runtime) => {
        const runtimeIssues = result.emittedEvents.filter(
          (event): event is Extract<AiRunEvent, { type: 'runtime_issue' }> =>
            event.type === 'runtime_issue'
        )

        recordAssertion(runtime.assertions, {
          id: 'runtime.valid-scope-passes',
          pass: result.okValidation.ok === true,
          details: JSON.stringify(result.okValidation)
        })
        recordAssertion(runtime.assertions, {
          id: 'runtime.workspace-missing-event',
          pass:
            result.missingWorkspaceValidation.ok === false &&
            runtimeIssues.some((event) => event.code === 'workspace_missing'),
          details: JSON.stringify(runtimeIssues)
        })
        recordAssertion(runtime.assertions, {
          id: 'runtime.workspace-binding-missing-event',
          pass:
            result.missingBindingValidation.ok === false &&
            runtimeIssues.some((event) => event.code === 'workspace_binding_missing'),
          details: JSON.stringify(runtimeIssues)
        })
        recordAssertion(runtime.assertions, {
          id: 'runtime.web-scope-unavailable-event',
          pass:
            result.unavailableWebValidation.ok === false &&
            runtimeIssues.some(
              (event) =>
                event.code === 'scope_unavailable' && event.scopeSourceId === 'web-missing'
            ),
          details: JSON.stringify(runtimeIssues)
        })
        recordAssertion(runtime.assertions, {
          id: 'search.prepared-web-scope-allowed',
          pass:
            Boolean(result.webScope) &&
            result.readyWebAllowedInSearch === true &&
            result.webScope?.documentIds[0] === 'doc-web',
          details: JSON.stringify(result.webScope)
        })
        recordAssertion(runtime.assertions, {
          id: 'search.unprepared-local-scope-blocked',
          pass: result.localUnpreparedAllowedInSearch === false,
          details: `allowed=${String(result.localUnpreparedAllowedInSearch)}`
        })
      }
    })
  })
})
