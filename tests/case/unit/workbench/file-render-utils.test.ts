import { describe, expect, it } from 'vitest'
import { prepareFileRenderDocument } from '../../../../src/renderer/src/components/fileRenders/utils'

describe('file render utils', () => {
  it('renders an UTF-8 log file with the plain text renderer', async () => {
    const createdUrls: string[] = []
    const loaded = await prepareFileRenderDocument(
      {
        fileName: 'server.log',
        fileData: new Blob(['2026-07-15 INFO service ready\n'])
      },
      createdUrls
    )

    expect(loaded?.fileType).toBe('txt')
    createdUrls.forEach((url) => URL.revokeObjectURL(url))
  })

  it('does not send invalid UTF-8 binary data to the plain text renderer', async () => {
    const createdUrls: string[] = []
    const loaded = await prepareFileRenderDocument(
      {
        fileName: 'binary.log',
        fileData: new Blob([new Uint8Array([0xff, 0xfe, 0xfd])])
      },
      createdUrls
    )

    expect(loaded?.fileType).toBe('log')
    createdUrls.forEach((url) => URL.revokeObjectURL(url))
  })
})
