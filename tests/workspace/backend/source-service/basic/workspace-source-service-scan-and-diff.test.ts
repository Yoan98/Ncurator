import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'
import { WorkspaceSourceService } from '../../../../../src/main/services/workspace/WorkspaceSourceService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const toSortedPaths = (values: { relative_path: string }[]): string[] =>
  values.map((item) => item.relative_path).sort((left, right) => left.localeCompare(right))

test('workspace-source-service-scan-and-diff', async () => {
  await runBackendCase({
    caseId: 'workspace-source-service-scan-and-diff',
    caseType: 'basic',
    domain: 'workspace',
    layer: 'backend',
    suite: 'source-service',
    groups: ['basic'],
    description:
      'workspace source service should scan supported files and keep full/presence_only/changes_only diff behavior stable.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const service = new WorkspaceSourceService()
      const docsDir = path.join(runtime.workspaceRoot, 'docs')
      const nestedDir = path.join(docsDir, 'nested')
      const notesDir = path.join(runtime.workspaceRoot, 'notes')
      await fs.mkdir(nestedDir, { recursive: true })
      await fs.mkdir(notesDir, { recursive: true })

      await fs.writeFile(path.join(docsDir, 'alpha.docx'), Buffer.from('alpha-v1'))
      await fs.writeFile(path.join(nestedDir, 'beta.pdf'), Buffer.from('beta-v1'))
      await fs.writeFile(path.join(notesDir, 'ignored.txt'), 'not-supported')

      const firstScan = await service.scanWorkspace({
        workspaceId: 'workspace-basic',
        rootPath: runtime.workspaceRoot,
        workspaceName: 'Workspace Basic'
      })

      await fs.unlink(path.join(docsDir, 'alpha.docx'))
      await fs.writeFile(path.join(nestedDir, 'beta.pdf'), Buffer.from('beta-version-two'))
      await fs.writeFile(path.join(docsDir, 'gamma.docx'), Buffer.from('gamma-v1'))
      await fs.writeFile(path.join(notesDir, 'still-ignored.md'), '# ignored')

      const secondScan = await service.scanWorkspace({
        workspaceId: 'workspace-basic',
        rootPath: runtime.workspaceRoot,
        workspaceName: 'Workspace Basic'
      })

      const fullDiff = await service.diffWorkspaceNodes({
        existingNodes: firstScan.nodes,
        nextNodes: secondScan.nodes,
        mode: 'full'
      })
      const presenceOnlyDiff = await service.diffWorkspaceNodes({
        existingNodes: firstScan.nodes,
        nextNodes: secondScan.nodes,
        mode: 'presence_only'
      })
      const changesOnlyDiff = await service.diffWorkspaceNodes({
        existingNodes: firstScan.nodes,
        nextNodes: secondScan.nodes,
        mode: 'changes_only'
      })

      return {
        workspace: firstScan.workspace,
        firstNodePaths: toSortedPaths(firstScan.nodes),
        secondNodePaths: toSortedPaths(secondScan.nodes),
        fullDiff: {
          added: toSortedPaths(fullDiff.added),
          removed: toSortedPaths(fullDiff.removed),
          changed: toSortedPaths(fullDiff.changed)
        },
        presenceOnlyDiff: {
          added: toSortedPaths(presenceOnlyDiff.added),
          removed: toSortedPaths(presenceOnlyDiff.removed),
          changed: toSortedPaths(presenceOnlyDiff.changed)
        },
        changesOnlyDiff: {
          added: toSortedPaths(changesOnlyDiff.added),
          removed: toSortedPaths(changesOnlyDiff.removed),
          changed: toSortedPaths(changesOnlyDiff.changed)
        }
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.workspace.name === 'Workspace Basic', {
        name: 'workspace-scan-name',
        message: 'scanWorkspace should keep the explicit workspace name',
        data: result.workspace
      })

      runtime.assertThat(
        result.firstNodePaths.join(',') ===
          ['docs', 'docs/alpha.docx', 'docs/nested', 'docs/nested/beta.pdf', 'notes'].join(','),
        {
          name: 'workspace-supported-scan',
          message:
            'scanWorkspace should keep all directories while filtering files down to supported docx/pdf types',
          data: result.firstNodePaths
        }
      )

      runtime.assertThat(
        result.fullDiff.added.join(',') === 'docs/gamma.docx' &&
          result.fullDiff.removed.join(',') === 'docs/alpha.docx' &&
          result.fullDiff.changed.join(',') === 'docs/nested/beta.pdf',
        {
          name: 'workspace-full-diff',
          message: 'full mode should keep added, removed, and changed paths together',
          data: result.fullDiff
        }
      )

      runtime.assertThat(
        result.presenceOnlyDiff.added.join(',') === 'docs/gamma.docx' &&
          result.presenceOnlyDiff.removed.join(',') === 'docs/alpha.docx' &&
          result.presenceOnlyDiff.changed.length === 0,
        {
          name: 'workspace-presence-only-diff',
          message: 'presence_only mode should ignore content-only changes',
          data: result.presenceOnlyDiff
        }
      )

      runtime.assertThat(
        result.changesOnlyDiff.added.length === 0 &&
          result.changesOnlyDiff.removed.length === 0 &&
          result.changesOnlyDiff.changed.join(',') === 'docs/nested/beta.pdf',
        {
          name: 'workspace-changes-only-diff',
          message: 'changes_only mode should keep only content changes',
          data: result.changesOnlyDiff
        }
      )
    }
  })
})
