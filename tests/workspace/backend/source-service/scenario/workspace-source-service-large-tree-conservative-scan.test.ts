import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'vitest'
import { WorkspaceSourceService } from '../../../../../src/main/services/workspace/WorkspaceSourceService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const toSortedPaths = (nodes: { relative_path: string }[]): string[] =>
  nodes.map((node) => node.relative_path).sort((left, right) => left.localeCompare(right))

test('workspace-source-service-large-tree-conservative-scan', async () => {
  await runBackendCase({
    caseId: 'workspace-source-service-large-tree-conservative-scan',
    caseType: 'scenario',
    domain: 'workspace',
    layer: 'backend',
    suite: 'source-service',
    groups: ['scenario'],
    description:
      'workspace source service should keep deep directory snapshots stable and continue to detect diffs in larger trees.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const service = new WorkspaceSourceService()
      const chapterCount = 12

      for (let chapterIndex = 0; chapterIndex < chapterCount; chapterIndex += 1) {
        const chapterDir = path.join(runtime.workspaceRoot, 'knowledge', `chapter-${chapterIndex + 1}`)
        const appendixDir = path.join(chapterDir, 'appendix')
        await fs.mkdir(appendixDir, { recursive: true })
        await fs.writeFile(
          path.join(chapterDir, `brief-${chapterIndex + 1}.docx`),
          Buffer.from(`docx-${chapterIndex + 1}-v1`)
        )
        await fs.writeFile(
          path.join(appendixDir, `evidence-${chapterIndex + 1}.pdf`),
          Buffer.from(`pdf-${chapterIndex + 1}-v1`)
        )
      }

      const firstScan = await service.scanWorkspace({
        workspaceId: 'workspace-large-tree',
        rootPath: runtime.workspaceRoot,
        workspaceName: 'Large Tree'
      })

      await fs.writeFile(
        path.join(runtime.workspaceRoot, 'knowledge', 'chapter-12', 'appendix', 'evidence-12.pdf'),
        Buffer.from('pdf-12-v2')
      )
      await fs.writeFile(
        path.join(runtime.workspaceRoot, 'knowledge', 'chapter-12', 'brief-12.docx'),
        Buffer.from('docx-12-v2')
      )
      await fs.mkdir(path.join(runtime.workspaceRoot, 'knowledge', 'chapter-13'), { recursive: true })
      await fs.writeFile(
        path.join(runtime.workspaceRoot, 'knowledge', 'chapter-13', 'brief-13.docx'),
        Buffer.from('docx-13-v1')
      )

      const secondScan = await service.scanWorkspace({
        workspaceId: 'workspace-large-tree',
        rootPath: runtime.workspaceRoot,
        workspaceName: 'Large Tree'
      })
      const diff = await service.diffWorkspaceNodes({
        existingNodes: firstScan.nodes,
        nextNodes: secondScan.nodes,
        mode: 'full'
      })

      return {
        firstNodePaths: toSortedPaths(firstScan.nodes),
        secondNodePaths: toSortedPaths(secondScan.nodes),
        diff: {
          added: toSortedPaths(diff.added),
          changed: toSortedPaths(diff.changed),
          removed: toSortedPaths(diff.removed)
        }
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(result.firstNodePaths.length === 49, {
        name: 'workspace-large-tree-first-scan-count',
        message: 'large tree scans should still return the full set of directory and supported file nodes',
        data: result.firstNodePaths
      })

      runtime.assertThat(
        result.firstNodePaths.includes('knowledge/chapter-12/appendix/evidence-12.pdf') &&
          result.firstNodePaths.includes('knowledge/chapter-1/brief-1.docx'),
        {
          name: 'workspace-large-tree-deep-paths',
          message: 'large tree scans should keep deep relative paths stable across the whole snapshot',
          data: {
            workspaceRoot: runtime.workspaceRoot,
            samplePaths: result.firstNodePaths.slice(-6)
          }
        }
      )

      runtime.assertThat(
        result.diff.added.join(',') === 'knowledge/chapter-13,knowledge/chapter-13/brief-13.docx' &&
          result.diff.changed.join(',') ===
            'knowledge/chapter-12/appendix/evidence-12.pdf,knowledge/chapter-12/brief-12.docx' &&
          result.diff.removed.length === 0,
        {
          name: 'workspace-large-tree-diff-stability',
          message: 'diffWorkspaceNodes should keep added and deep changed paths stable even in larger trees',
          data: result.diff
        }
      )
    }
  })
})
