import { describe, it } from 'vitest'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import JSZip from 'jszip'
import { WorkspaceFileService } from '../../../../../src/main/services/workspace/WorkspaceFileService'
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

          const files = new WorkspaceFileService()
          const fileInput = {
            workspaceId: 'file-contract',
            rootPath: parent,
            parentRelativePath: 'docs'
          }
          const docx = await files.createFile({ ...fileInput, fileName: '空白文档.docx' })
          const xlsx = await files.createFile({ ...fileInput, fileName: '空白工作簿.xlsx' })
          const pptx = await files.createFile({ ...fileInput, fileName: '空白演示.pptx' })
          const other = await files.createFile({ ...fileInput, fileName: '自定义.md' })
          const beforeBytes = await readFile(docx.absolute_path)
          const docxZip = await JSZip.loadAsync(beforeBytes)
          const xlsxZip = await JSZip.loadAsync(await readFile(xlsx.absolute_path))
          const pptxZip = await JSZip.loadAsync(await readFile(pptx.absolute_path))
          const workbookXml = await xlsxZip.file('xl/workbook.xml')?.async('string')
          const duplicate = await files.createFile({ ...fileInput, fileName: docx.name }).then(
            () => false,
            () => true
          )
          const concurrent = await Promise.allSettled([
            files.createFile({ ...fileInput, fileName: '并发.txt' }),
            files.createFile({ ...fileInput, fileName: '并发.txt' })
          ])
          const invalidNames = await Promise.all(
            ['../逃逸.txt', 'bad:name.txt', '.hidden.txt', 'CON.txt'].map((fileName) =>
              files.createFile({ ...fileInput, fileName }).then(
                () => false,
                () => true
              )
            )
          )
          const outside = await files
            .createFile({ ...fileInput, parentRelativePath: sibling, fileName: 'outside.txt' })
            .then(
              () => false,
              () => true
            )
          await symlink(
            sibling,
            path.join(parent, 'escape'),
            process.platform === 'win32' ? 'junction' : 'dir'
          )
          const symlinkEscape = await files
            .createFile({ ...fileInput, parentRelativePath: 'escape', fileName: 'outside.txt' })
            .then(
              () => false,
              () => true
            )
          let trashCalls = 0
          const directoryDeleteRejected = await files
            .trashFile({ rootPath: parent, relativePath: 'docs' }, async () => {
              trashCalls += 1
            })
            .then(
              () => false,
              () => true
            )
          const trashFailed = await files
            .trashFile({ rootPath: parent, relativePath: docx.relative_path }, async () => {
              trashCalls += 1
              throw new Error('回收站不可用')
            })
            .then(
              () => false,
              () => true
            )
          const fileOperations = {
            blankOfficeFilesValid:
              Boolean(docxZip.file('word/document.xml')) &&
              Boolean(workbookXml?.includes('name="Sheet1"')) &&
              Object.keys(pptxZip.files).filter((name) =>
                /^ppt\/slides\/slide\d+\.xml$/u.test(name)
              ).length === 1,
            customSuffixEmpty: (await readFile(other.absolute_path)).length === 0,
            duplicateDidNotOverwrite:
              duplicate && beforeBytes.equals(await readFile(docx.absolute_path)),
            concurrentCreateExclusive:
              concurrent.filter((result) => result.status === 'fulfilled').length === 1 &&
              concurrent.filter((result) => result.status === 'rejected').length === 1,
            invalidNamesRejected: invalidNames.every(Boolean),
            outsideRejected: outside && symlinkEscape,
            failedTrashPreservedFile:
              directoryDeleteRejected &&
              trashFailed &&
              trashCalls === 1 &&
              beforeBytes.equals(await readFile(docx.absolute_path)),
            childLocationCorrect: docx.relative_path === 'docs/空白文档.docx'
          }

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
            parentReal,
            fileOperations
          }
        } finally {
          await rm(parent, { recursive: true, force: true })
          await rm(sibling, { recursive: true, force: true })
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(Object.values(result.fileOperations).every(Boolean), {
          name: 'workspace-file-create-and-trash-boundaries',
          message:
            '空白 Office 文件有效；自定义后缀为空文件；重名/并发不覆盖；非法名称、目录外与符号链接逃逸被拒绝；回收站失败不得删除文件。',
          data: result.fileOperations
        })
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
