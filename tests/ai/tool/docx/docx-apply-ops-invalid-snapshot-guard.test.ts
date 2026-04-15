import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { describe, it } from 'vitest'
import {
  createDocxToolHarness,
  writeTestDocxFile
} from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import {
  type DocxFailureResult,
  type DocxMutationResult,
  type DocxReadResult
} from './testUtils'

const corruptDocumentRelationships = async (filePath: string): Promise<void> => {
  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  zip.file(
    'word/_rels/document.xml.rels',
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '  <Relationship Id="rId999" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing-image.png"/>',
      '</Relationships>'
    ].join('')
  )
  const corrupted = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  })
  await fs.writeFile(filePath, corrupted)
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
        await corruptDocumentRelationships(sourcePath)

        const harness = createDocxToolHarness(runtime)
        try {
          const initialRead = await harness.invoke<DocxReadResult>('docx_read', {
            sourcePath: 'invalid-snapshot-source.docx',
            query: 'Original invalid snapshot source.'
          })
          const failedEdit = await harness.invoke<DocxFailureResult | DocxMutationResult>(
            'docx_text_edit',
            {
              sourcePath: initialRead.sourcePath,
              query: 'Original invalid snapshot source.',
              replace: 'Should never become the latest draft.'
            }
          )
          const readOriginal = await harness.invoke<DocxReadResult>('docx_read', {
            sourcePath: initialRead.sourcePath,
            query: 'Original invalid snapshot source.'
          })

          return {
            initialRead,
            failedEdit,
            readOriginal,
            activeVersionRef:
              harness.state.documentSessionBySourcePath.get(initialRead.sourcePath)?.activeVersionRef || '',
            trackedSourcePaths: [...harness.state.documentSessionBySourcePath.keys()]
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.failedEdit.ok === false &&
            result.failedEdit.code === 'failed' &&
            result.failedEdit.error.includes('invalid docx') &&
            result.readOriginal.matches.length === 1,
          {
            name: 'edit-fails-when-generated-snapshot-is-invalid',
            message: '内部校验失败时，对象编辑应直接失败，并保留原快照可继续读取。',
            data: {
              failedEdit: result.failedEdit,
              readOriginal: result.readOriginal.matches
            }
          }
        )

        runtime.assertThat(
          result.activeVersionRef === result.initialRead.currentVersionRef &&
            result.trackedSourcePaths.length === 1 &&
            result.trackedSourcePaths[0] === result.initialRead.sourcePath,
          {
            name: 'invalid-edit-does-not-advance-current-draft',
            message: '无效版本不能成为当前草稿，也不能污染 run 内文档会话跟踪。',
            data: {
              initialRead: result.initialRead,
              activeVersionRef: result.activeVersionRef,
              trackedSourcePaths: result.trackedSourcePaths
            }
          }
        )
      }
    })
  })
})
