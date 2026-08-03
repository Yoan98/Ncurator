import { describe, expect, it } from 'vitest'
import type { AiFileChangeRecord } from '../../../../src/shared/types'
import {
  filterVisibleFileChangeRecords,
  isRuntimeAssetPath
} from '../../../../src/shared/fileChangeVisibility'

const record = (input: Partial<AiFileChangeRecord>): AiFileChangeRecord => ({
  id: input.id || 'change-1',
  sessionId: 'session-1',
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
  it('hides runtime assets while retaining user files and supports Windows paths', () => {
    const records = [
      record({ id: 'ppt', path: '/workspace/report.pptx', fileName: 'report.pptx' }),
      record({
        id: 'runtime-image',
        path: '/workspace/.ncurator/runtime/assets/ppt-images/slide1.png',
        fileName: 'slide1.png'
      }),
      record({
        id: 'runtime-windows',
        path: 'C:\\workspace\\.ncurator\\runtime\\assets\\ppt-images\\slide2.png',
        fileName: 'slide2.png'
      })
    ]

    expect(isRuntimeAssetPath('/workspace/.ncurator/runtime/assets/preview.png')).toBe(true)
    expect(isRuntimeAssetPath('/workspace/.ncurator/runtime-assets/preview.png')).toBe(false)
    expect(filterVisibleFileChangeRecords(records).map((item) => item.id)).toEqual(['ppt'])
  })
})
