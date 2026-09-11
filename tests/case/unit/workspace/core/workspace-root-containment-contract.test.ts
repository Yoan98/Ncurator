import { describe, it } from 'vitest'
import path from 'node:path'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('unit workspace backend', () => {
  it('workspace-root-containment-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-root-containment-contract',
      harnessMode: 'tool-real',
      domain: 'unit',
      suite: 'workspace',
      groups: ['core'],
      description: '添加文件地址时正确识别已存在、子路径包含与父路径覆盖关系。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const parent = await mkdtemp(path.join(os.tmpdir(), 'workspace-root-parent-'))
        const sibling = await mkdtemp(path.join(os.tmpdir(), 'workspace-root-sibling-'))
        const child = path.join(parent, 'docs')
        await mkdir(child, { recursive: true })
        try {
          const parentReal = await realpath(parent)
          const nested = await runtime.workspaceSourceService.classifyCandidateRoot(child, [parent])
          const exists = await runtime.workspaceSourceService.classifyCandidateRoot(parentReal, [
            parent
          ])
          const contains = await runtime.workspaceSourceService.classifyCandidateRoot(parent, [
            child
          ])
          const independent = await runtime.workspaceSourceService.classifyCandidateRoot(sibling, [
            parent
          ])

          return {
            nested: {
              nestedUnderExisting: nested.nestedUnderExisting,
              sameAsExisting: nested.sameAsExisting,
              containedCount: nested.containedExistingRootPaths.length,
              parentPaths: nested.nestedUnderExistingRootPaths
            },
            exists: {
              sameAsExisting: exists.sameAsExisting,
              nestedUnderExisting: exists.nestedUnderExisting
            },
            contains: {
              nestedUnderExisting: contains.nestedUnderExisting,
              containedCount: contains.containedExistingRootPaths.length
            },
            independent: {
              nestedUnderExisting: independent.nestedUnderExisting,
              containedCount: independent.containedExistingRootPaths.length,
              sameAsExisting: independent.sameAsExisting
            },
            parentReal
          }
        } finally {
          await rm(parent, { recursive: true, force: true })
          await rm(sibling, { recursive: true, force: true })
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.nested.nestedUnderExisting &&
            !result.nested.sameAsExisting &&
            result.nested.containedCount === 0 &&
            result.nested.parentPaths.some((item) => item === result.parentReal),
          {
            name: 'child-under-parent-is-nested',
            message: '子目录相对已添加父目录应判定为 nested，对齐 SET-WORKSPACE-006-AC5。',
            data: result.nested
          }
        )
        await runtime.assertThat(
          result.exists.sameAsExisting && !result.exists.nestedUnderExisting,
          {
            name: 'same-path-is-exists',
            message: '完全相同路径应判定为 exists，对齐 SET-WORKSPACE-006-AC5。',
            data: result.exists
          }
        )
        await runtime.assertThat(
          !result.contains.nestedUnderExisting && result.contains.containedCount === 1,
          {
            name: 'parent-over-child-contains',
            message: '父目录相对已添加子目录应判定为 contains，对齐 SET-WORKSPACE-006-AC5。',
            data: result.contains
          }
        )
        await runtime.assertThat(
          !result.independent.nestedUnderExisting &&
            result.independent.containedCount === 0 &&
            !result.independent.sameAsExisting,
          {
            name: 'sibling-is-independent',
            message: '无关目录不应被判定为包含关系。',
            data: result.independent
          }
        )
      }
    })
  })
})
