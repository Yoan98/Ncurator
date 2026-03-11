import { describe, test } from 'vitest'
import {
  buildWorkspaceScopeSelections,
  collectScopeDocumentIds
} from '../../../../src/main/services/sourceScope/selection'
import type { WorkspaceNode, WorkspaceSource } from '../../../../src/shared/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runRuntimeCase } from '../../../harness/main/capabilityCase'

describe('main/ai/runtime/source-scope', () => {
  test('explicit parent-child selections should be preserved while document ids are deduped', async () => {
    await runRuntimeCase({
      caseId: 'source-scope-explicit-preserve',
      description: '验证 workspace 与子文件同时被选中时，显式范围保留，底层 document ids 去重。',
      expectedOutcome: 'success',
      scenarioTags: ['source-scope', 'explicit-selection', 'dedupe'],
      requiredFixtures: [],
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'explicit source scope preservation completed'
      }),
      execute: async () => {
        const workspace: WorkspaceSource = {
          id: 'workspace-1',
          name: 'Workspace One',
          root_path: '/workspace-one',
          status: 'prepared',
          created_at: 1,
          updated_at: 1
        }
        const nodes: WorkspaceNode[] = [
          {
            id: 'workspace-1:directory:docs',
            workspace_id: 'workspace-1',
            kind: 'directory',
            name: 'docs',
            relative_path: 'docs',
            absolute_path: '/workspace-one/docs',
            exists: true,
            prepare_status: 'not_prepared',
            created_at: 1,
            updated_at: 1
          },
          {
            id: 'workspace-1:file:docs/spec.docx',
            workspace_id: 'workspace-1',
            parent_id: 'workspace-1:directory:docs',
            kind: 'file',
            name: 'spec.docx',
            relative_path: 'docs/spec.docx',
            absolute_path: '/workspace-one/docs/spec.docx',
            exists: true,
            prepare_status: 'prepared',
            document_id: 'doc-spec',
            created_at: 1,
            updated_at: 1
          }
        ]

        const scopes = buildWorkspaceScopeSelections(workspace, nodes)
        const workspaceScope = scopes.find((scope) => scope.scopeType === 'workspace')
        const fileScope = scopes.find(
          (scope) => scope.scopeType === 'file' && scope.relativePath === 'docs/spec.docx'
        )
        if (!workspaceScope || !fileScope) {
          throw new Error('expected workspace and file scopes')
        }

        const explicitSelections = [workspaceScope, fileScope]
        const dedupedDocumentIds = collectScopeDocumentIds(explicitSelections)

        return {
          explicitSelections,
          dedupedDocumentIds
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'source-scope.keeps-explicit-parent-child-selections',
          pass:
            result.explicitSelections.length === 2 &&
            result.explicitSelections[0].scopeType === 'workspace' &&
            result.explicitSelections[1].scopeType === 'file',
          details: JSON.stringify(result.explicitSelections)
        })
        recordAssertion(runtime.assertions, {
          id: 'source-scope.dedupes-underlying-document-ids',
          pass:
            result.dedupedDocumentIds.length === 1 &&
            result.dedupedDocumentIds[0] === 'doc-spec',
          details: JSON.stringify(result.dedupedDocumentIds)
        })
      }
    })
  })
})
