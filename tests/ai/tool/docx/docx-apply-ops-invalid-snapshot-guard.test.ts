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
  type DocxApplyOpsResult,
  type DocxFailureResult,
  type DocxOpenResult,
  type DocxSearchResult
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
      description: '验证 apply_ops 产出无效 docx 时会失败，且不会推进当前草稿快照。',
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
          const opened = await harness.invoke<DocxOpenResult>('docx_open', {
            sourcePath: 'invalid-snapshot-source.docx'
          })
          const failedApply = await harness.invoke<DocxFailureResult>('docx_apply_ops', {
            docId: opened.docId,
            ops: [
              {
                type: 'replace_text',
                query: 'Original invalid snapshot source.',
                replace: 'Should never become the latest draft.'
              }
            ]
          })
          const searchOriginal = await harness.invoke<DocxSearchResult>('docx_search', {
            docId: opened.docId,
            query: 'Original invalid snapshot source.',
            mode: 'literal'
          })

          return {
            opened,
            failedApply,
            searchOriginal,
            lastDocId: harness.state.lastDocId,
            trackedDocIds: [...harness.state.sourcePathByDocId.keys()]
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.failedApply.ok === false &&
            result.failedApply.code === 'failed' &&
            result.failedApply.error.includes('invalid docx') &&
            result.searchOriginal.matches.length === 1,
          {
            name: 'apply-ops-fails-when-generated-snapshot-is-invalid',
            message: '内部校验失败时，apply_ops 应直接失败，并保留原快照可继续读取。',
            data: {
              failedApply: result.failedApply,
              searchOriginal: result.searchOriginal.matches
            }
          }
        )

        runtime.assertThat(
          result.lastDocId === result.opened.docId &&
            result.trackedDocIds.length === 1 &&
            result.trackedDocIds[0] === result.opened.docId,
          {
            name: 'invalid-apply-does-not-advance-current-draft',
            message: '无效快照不能成为当前草稿，也不能污染 run 内 docId 跟踪。',
            data: {
              opened: result.opened,
              lastDocId: result.lastDocId,
              trackedDocIds: result.trackedDocIds
            }
          }
        )
      }
    })
  })
})
