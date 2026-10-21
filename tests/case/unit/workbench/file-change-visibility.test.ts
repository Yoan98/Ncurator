import { describe, expect, it } from 'vitest'
import type { AiFileChangeRecord } from '../../../../src/shared/types'
import {
  filterVisibleFileChangeRecords,
  isInternalRuntimePath
} from '../../../../src/shared/fileChangeVisibility'

const record = (input: Partial<AiFileChangeRecord>): AiFileChangeRecord => ({
  id: input.id || 'change-1',
  partnerId: 'partner-1',
  runId: 'run-1',
  status: 'applied',
  capability: 'ppt',
  path: input.path || '/workspace/report.pptx',
  fileName: input.fileName || 'report.pptx',
  operation: 'updated',
  changeCount: 1,
  insertCount: 1,
  deleteCount: 0,
  createdAt: 1,
  updatedAt: 1,
  ...input
})

describe('workbench file change visibility', () => {
  it('hides runtime resources and scripts while retaining user files on both path styles', () => {
    const records = [
      record({ id: 'ppt', path: '/workspace/report.pptx', fileName: 'report.pptx' }),
      record({
        id: 'runtime-image',
        path: '/userData/partners/partner-1/runtime/assets/ppt-images/slide1.png',
        fileName: 'slide1.png'
      }),
      record({
        id: 'runtime-windows',
        path: 'C:\\userData\\partners\\partner-1\\runtime\\assets\\ppt-images\\slide2.png',
        fileName: 'slide2.png'
      }),
      record({
        id: 'runtime-script',
        path: '/userData/partners/partner-1/runtime/scripts/verify_ppt.py',
        fileName: 'verify_ppt.py'
      }),
      record({
        id: 'runtime-script-windows',
        path: 'C:\\userData\\partners\\partner-1\\runtime\\scripts\\verify_ppt.py',
        fileName: 'verify_ppt.py'
      }),
      record({
        id: 'user-script',
        path: '/workspace/scripts/verify_ppt.py',
        fileName: 'verify_ppt.py'
      }),
      record({
        id: 'legacy-runtime',
        path: '/workspace/.ncurator/runtime/assets/preview.png',
        fileName: 'preview.png'
      })
    ]

    expect(isInternalRuntimePath('/userData/partners/partner-1/runtime/assets/preview.png')).toBe(
      true
    )
    expect(isInternalRuntimePath('/workspace/.ncurator/runtime/assets/preview.png')).toBe(true)
    expect(isInternalRuntimePath('/userData/partners/partner-1/runtime-assets/preview.png')).toBe(
      false
    )
    expect(isInternalRuntimePath('/workspace/.ncurator/runtime-assets/preview.png')).toBe(false)
    expect(
      isInternalRuntimePath('/userData/partners/partner-1/runtime/scripts-copy/check.py')
    ).toBe(false)
    expect(filterVisibleFileChangeRecords(records).map((item) => item.id)).toEqual([
      'ppt',
      'user-script'
    ])
  })

  it('retains runtime files when they are attachments the user submitted', () => {
    const attachmentPath =
      '/userData/partners/partner-1/runtime/assets/attachment-bucket/input.docx'
    const scriptAttachmentPath = '/userData/partners/partner-1/runtime/scripts/attached-check.py'
    const records = [
      record({ id: 'attachment', path: attachmentPath, fileName: 'input.docx' }),
      record({
        id: 'script-attachment',
        path: scriptAttachmentPath,
        fileName: 'attached-check.py'
      }),
      record({
        id: 'generated-preview',
        path: '/userData/partners/partner-1/runtime/assets/previews/page-1.png',
        fileName: 'page-1.png'
      })
    ]

    expect(
      filterVisibleFileChangeRecords(records, [attachmentPath, scriptAttachmentPath]).map(
        (item) => item.id
      )
    ).toEqual(['attachment', 'script-attachment'])
  })
})
