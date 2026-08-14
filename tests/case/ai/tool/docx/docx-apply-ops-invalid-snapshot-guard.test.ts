import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { describe, it, vi } from 'vitest'
import * as opExecutor from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/opExecutor'
import { validateDocxBuffer } from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/validator'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  type DocxFailureResult,
  type DocxMutationResult,
  type DocxReadResult,
  type DocxSearchResult
} from './testUtils'

const addLegacyRelationshipProblems = async (filePath: string): Promise<void> => {
  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  zip.file('customXml/item1.xml', '<root/>')
  zip.file(
    'word/_rels/document.xml.rels',
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '  <Relationship Id="rId998" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>',
      '  <Relationship Id="rId999" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../NULL"/>',
      '</Relationships>'
    ].join('')
  )
  const corrupted = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  })
  await fs.writeFile(filePath, corrupted)
}

const addMissingRelationshipProblem = async (buffer: Buffer): Promise<Buffer> => {
  const zip = await JSZip.loadAsync(buffer)
  const relationshipsPath = 'word/_rels/document.xml.rels'
  const relationships = await zip.file(relationshipsPath)?.async('text')
  if (!relationships) throw new Error(`${relationshipsPath} is required for this test`)
  zip.file(
    relationshipsPath,
    relationships.replace(
      '</Relationships>',
      '<Relationship Id="rId999" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../NULL"/></Relationships>'
    )
  )
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

describe('ai tool docx backend', () => {
  it('docx-apply-ops-invalid-snapshot-guard', async () => {
    await runBackendCase({
      caseId: 'docx-apply-ops-invalid-snapshot-guard',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证对象编辑产出无效 docx 时会失败，且不会推进当前草稿快照。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = path.join(runtime.workspaceRoot, 'invalid-snapshot-source.docx')
        await writeTestDocxFile(runtime.workspaceRoot, 'invalid-snapshot-source.docx', [
          {
            type: 'paragraph',
            text: 'Original invalid snapshot source.'
          }
        ])
        await addLegacyRelationshipProblems(sourcePath)
        const sourceProblems = await validateDocxBuffer(await fs.readFile(sourcePath))

        const harness = createDocxToolHarness(runtime)
        try {
          const initialSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath,
            query: 'Original invalid snapshot source.'
          })
          const initialRead = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath,
            range: { type: 'block_ids', blockIds: [initialSearch.matches[0]!.blockId] }
          })
          const edited = await harness.invoke<DocxMutationResult>('docx_edit', {
            sourcePath: initialRead.sourcePath,
            actions: [
              {
                type: 'replace_text',
                query: 'Original invalid snapshot source.',
                replace: 'Edited despite legacy relationship problems.'
              }
            ]
          })
          const readUpdatedSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath: initialRead.sourcePath,
            query: 'Edited despite legacy relationship problems.'
          })
          const readUpdated = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath: initialRead.sourcePath,
            range: { type: 'block_ids', blockIds: [readUpdatedSearch.matches[0]!.blockId] }
          })

          return {
            initialRead,
            edited,
            sourceProblems,
            readUpdatedSearch,
            readUpdated,
            activeRevisionRef:
              harness.state.replaySessionBySourcePath.get(initialRead.sourcePath)
                ?.activeRevisionRef || '',
            trackedSourcePaths: [...harness.state.replaySessionBySourcePath.keys()]
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.sourceProblems.length === 1 &&
            result.sourceProblems[0]?.message === 'missing relationship target: NULL' &&
            result.edited.changedBlocks.length === 1 &&
            result.readUpdatedSearch.matches.length === 1 &&
            result.readUpdated.blocks.length === 1,
          {
            name: 'edit-allows-existing-legacy-relationship-problems',
            message: '源文档已有 NULL 图片关系时，正常文本编辑应成功；合法 ../customXml 关系不得误报。',
            data: {
              sourceProblems: result.sourceProblems,
              edited: result.edited,
              readUpdatedSearch: result.readUpdatedSearch.matches,
              readUpdated: result.readUpdated
            }
          }
        )

        runtime.assertThat(
          result.activeRevisionRef === 'v2' &&
          result.trackedSourcePaths.length === 1 &&
          result.trackedSourcePaths[0] === result.initialRead.sourcePath,
          {
            name: 'legacy-source-problem-keeps-normal-draft-lineage',
            message: '兼容旧关系问题后，成功编辑仍应推进当前草稿且不新增来源文件。',
            data: {
              initialRead: result.initialRead,
              activeRevisionRef: result.activeRevisionRef,
              trackedSourcePaths: result.trackedSourcePaths
            }
          }
        )
      }
    })
  })

  it('docx-validation-detects-new-relationship-problems', async () => {
    await runBackendCase({
      caseId: 'docx-validation-detects-new-relationship-problems',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证编辑后新出现的缺失关系仍会被诊断出来。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, 'valid-source.docx', [
          { type: 'paragraph', text: 'Valid source.' }
        ])
        const harness = createDocxToolHarness(runtime)
        const originalApplyDocxOps = opExecutor.applyDocxOps
        const applySpy = vi.spyOn(opExecutor, 'applyDocxOps').mockImplementation(async (input) => {
          const applied = await originalApplyDocxOps(input)
          return { ...applied, buffer: await addMissingRelationshipProblem(applied.buffer) }
        })
        try {
          const initialRead = await harness.invoke<DocxReadResult>('docx_read_blocks', {
            sourcePath,
            range: { type: 'block_index', fromBlockIndex: 0, toBlockIndex: 0 }
          })
          const failedEdit = await harness.invoke<DocxFailureResult | DocxMutationResult>('docx_edit', {
            sourcePath,
            actions: [
              {
                type: 'replace_text',
                query: 'Valid source.',
                replace: 'This invalid output must not become a draft.'
              }
            ]
          })
          const originalSearch = await harness.invoke<DocxSearchResult>('docx_search', {
            sourcePath,
            query: 'Valid source.'
          })
          return {
            failedEdit,
            originalSearch,
            activeRevisionRef:
              harness.state.replaySessionBySourcePath.get(sourcePath)?.activeRevisionRef || ''
          }
        } finally {
          applySpy.mockRestore()
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.failedEdit.error.includes('introduced invalid docx structure') &&
            result.failedEdit.error.includes('missing relationship target: NULL') &&
            result.originalSearch.matches.length === 1 &&
            result.activeRevisionRef === 'v1',
          {
            name: 'new-relationship-problem-is-rejected-without-advancing-draft',
            message: '编辑结果新增加的缺失关系必须被拦截，且不能推进当前草稿。',
            data: result
          }
        )
      }
    })
  })
})
