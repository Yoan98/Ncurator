import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, test } from 'vitest'
import {
  buildWorkspaceScopeSelections,
  collectScopeDocumentIds,
  scopeMatchesQuery,
  shouldIncludeScopeInSearch
} from '../../../../src/main/services/sourceScope/selection'
import { WorkspaceSourceService } from '../../../../src/main/services/workspace/WorkspaceSourceService'
import type { WorkspaceNode } from '../../../../src/shared/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runWorkspaceServiceCase } from '../../../harness/main/capabilityCase'

describe('main/workspace/service', () => {
  test('workspace scan/diff/scope selection should honor supported files and range semantics', async () => {
    await runWorkspaceServiceCase({
      caseId: 'workspace-scan-diff-scope-selection',
      description: '验证工作空间扫描、差异模式和统一范围选择装配的主流程。',
      expectedOutcome: 'success',
      scenarioTags: ['workspace', 'scan', 'diff', 'source-scope'],
      requiredFixtures: [],
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'workspace scan, diff and scope selection completed'
      }),
      execute: async (runtime) => {
        const workspaceService = new WorkspaceSourceService()
        const workspaceId = 'workspace-case'
        const reportsDir = path.join(runtime.workspaceRoot, 'reports')
        const deepDir = path.join(reportsDir, 'deep')
        const draftsDir = path.join(runtime.workspaceRoot, 'drafts')

        await fs.mkdir(deepDir, { recursive: true })
        await fs.mkdir(draftsDir, { recursive: true })
        await fs.writeFile(path.join(reportsDir, 'alpha.docx'), 'alpha-v1', 'utf8')
        await fs.writeFile(path.join(reportsDir, 'beta.pdf'), 'beta-v1', 'utf8')
        await fs.writeFile(path.join(draftsDir, 'ignored.txt'), 'ignored', 'utf8')

        const firstScan = await workspaceService.scanWorkspace({
          workspaceId,
          rootPath: runtime.workspaceRoot,
          workspaceName: 'Workspace Fixture',
          now: 1_000
        })

        const preparedNodes = firstScan.nodes.map((node) => {
          if (node.kind !== 'file') return node
          if (node.relative_path === 'reports/alpha.docx') {
            return {
              ...node,
              document_id: 'doc-alpha',
              prepare_status: 'prepared'
            } satisfies WorkspaceNode
          }
          if (node.relative_path === 'reports/beta.pdf') {
            return {
              ...node,
              document_id: 'doc-beta',
              prepare_status: 'failed'
            } satisfies WorkspaceNode
          }
          return node
        })

        const scopes = buildWorkspaceScopeSelections(firstScan.workspace, preparedNodes)

        await fs.writeFile(
          path.join(reportsDir, 'alpha.docx'),
          'alpha-version-2-with-more-content',
          'utf8'
        )
        await fs.rm(path.join(reportsDir, 'beta.pdf'))
        await fs.writeFile(path.join(deepDir, 'gamma.docx'), 'gamma-v1', 'utf8')

        const secondScan = await workspaceService.scanWorkspace({
          workspaceId,
          rootPath: runtime.workspaceRoot,
          workspaceName: 'Workspace Fixture',
          now: 2_000
        })

        const fullDiff = await workspaceService.diffWorkspaceNodes({
          existingNodes: firstScan.nodes,
          nextNodes: secondScan.nodes,
          mode: 'full'
        })
        const presenceOnlyDiff = await workspaceService.diffWorkspaceNodes({
          existingNodes: firstScan.nodes,
          nextNodes: secondScan.nodes,
          mode: 'presence_only'
        })
        const changesOnlyDiff = await workspaceService.diffWorkspaceNodes({
          existingNodes: firstScan.nodes,
          nextNodes: secondScan.nodes,
          mode: 'changes_only'
        })

        return {
          firstScan,
          secondScan,
          scopes,
          fullDiff,
          presenceOnlyDiff,
          changesOnlyDiff
        }
      },
      assert: async (result, runtime) => {
        const filePaths = result.firstScan.nodes
          .filter((node) => node.kind === 'file')
          .map((node) => node.relative_path)
          .sort()
        const workspaceScope = result.scopes.find((scope) => scope.scopeType === 'workspace')
        const reportsDirectoryScope = result.scopes.find(
          (scope) => scope.scopeType === 'directory' && scope.relativePath === 'reports'
        )
        const alphaFileScope = result.scopes.find(
          (scope) => scope.scopeType === 'file' && scope.relativePath === 'reports/alpha.docx'
        )
        const searchableScopeKeys = result.scopes
          .filter((scope) => shouldIncludeScopeInSearch(scope))
          .map((scope) => [scope.scopeType, scope.relativePath || 'root'].join(':'))
        const reportsQueryMatches = result.scopes
          .filter((scope) => scopeMatchesQuery(scope, 'reports'))
          .map((scope) => scope.relativePath || scope.absolutePath || scope.label)
        const explicitDocIds =
          workspaceScope && alphaFileScope
            ? collectScopeDocumentIds([workspaceScope, alphaFileScope])
            : []

        recordAssertion(runtime.assertions, {
          id: 'scan.only-supported-files',
          pass:
            filePaths.length === 2 &&
            filePaths[0] === 'reports/alpha.docx' &&
            filePaths[1] === 'reports/beta.pdf',
          details: filePaths.join(', ')
        })
        recordAssertion(runtime.assertions, {
          id: 'scan.includes-directories',
          pass: result.firstScan.nodes.some((node) => node.kind === 'directory' && node.relative_path === 'reports'),
          details: `directories=${result.firstScan.nodes.filter((node) => node.kind === 'directory').length}`
        })
        recordAssertion(runtime.assertions, {
          id: 'scope.workspace-binding',
          pass:
            Boolean(workspaceScope?.workspace?.workspaceId) &&
            workspaceScope?.workspace?.rootPath === result.firstScan.workspace.root_path,
          details: workspaceScope?.workspace?.rootPath
        })
        recordAssertion(runtime.assertions, {
          id: 'scope.directory-aggregates-status',
          pass:
            reportsDirectoryScope?.preparedDocumentCount === 1 &&
            reportsDirectoryScope.unpreparedFileCount === 1 &&
            reportsDirectoryScope.hasUnpreparedFiles === true,
          details: JSON.stringify(reportsDirectoryScope)
        })
        recordAssertion(runtime.assertions, {
          id: 'scope.file-preserves-explicit-doc',
          pass:
            alphaFileScope?.documentIds.length === 1 && alphaFileScope.documentIds[0] === 'doc-alpha',
          details: JSON.stringify(alphaFileScope)
        })
        recordAssertion(runtime.assertions, {
          id: 'scope.search-mode-blocks-unprepared-workspace-scope',
          pass:
            Boolean(workspaceScope) &&
            shouldIncludeScopeInSearch(workspaceScope) === false &&
            workspaceScope?.hasUnpreparedFiles === true,
          details: JSON.stringify(workspaceScope)
        })
        recordAssertion(runtime.assertions, {
          id: 'scope.search-mode-allows-prepared-file-scope',
          pass:
            Boolean(alphaFileScope) &&
            shouldIncludeScopeInSearch(alphaFileScope) === true &&
            searchableScopeKeys.includes('file:reports/alpha.docx'),
          details: JSON.stringify({
            searchableScopeKeys,
            alphaFileScope
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'scope.query-filter-matches-label-or-path',
          pass:
            reportsQueryMatches.includes('reports') &&
            reportsQueryMatches.includes('reports/alpha.docx'),
          details: JSON.stringify(reportsQueryMatches)
        })
        recordAssertion(runtime.assertions, {
          id: 'scope.collect-document-ids-dedupes-parent-child-overlap',
          pass: explicitDocIds.length === 1 && explicitDocIds[0] === 'doc-alpha',
          details: JSON.stringify(explicitDocIds)
        })
        recordAssertion(runtime.assertions, {
          id: 'diff.full-detects-add-remove-change',
          pass:
            result.fullDiff.added.some((node) => node.relative_path === 'reports/deep/gamma.docx') &&
            result.fullDiff.removed.some((node) => node.relative_path === 'reports/beta.pdf') &&
            result.fullDiff.changed.some((node) => node.relative_path === 'reports/alpha.docx'),
          details: `added=${result.fullDiff.added.length}, removed=${result.fullDiff.removed.length}, changed=${result.fullDiff.changed.length}`
        })
        recordAssertion(runtime.assertions, {
          id: 'diff.presence-only-skips-content-change',
          pass:
            result.presenceOnlyDiff.changed.length === 0 &&
            result.presenceOnlyDiff.added.some((node) => node.relative_path === 'reports/deep/gamma.docx') &&
            result.presenceOnlyDiff.removed.some((node) => node.relative_path === 'reports/beta.pdf'),
          details: `added=${result.presenceOnlyDiff.added.length}, removed=${result.presenceOnlyDiff.removed.length}, changed=${result.presenceOnlyDiff.changed.length}`
        })
        recordAssertion(runtime.assertions, {
          id: 'diff.changes-only-skips-add-remove',
          pass:
            result.changesOnlyDiff.added.length === 0 &&
            result.changesOnlyDiff.removed.length === 0 &&
            result.changesOnlyDiff.changed.some((node) => node.relative_path === 'reports/alpha.docx'),
          details: `added=${result.changesOnlyDiff.added.length}, removed=${result.changesOnlyDiff.removed.length}, changed=${result.changesOnlyDiff.changed.length}`
        })
      }
    })
  })
})
