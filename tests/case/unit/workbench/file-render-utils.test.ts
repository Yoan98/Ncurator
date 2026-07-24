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

    expect(loaded).toMatchObject({ status: 'ready', document: { fileType: 'txt' } })
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

    expect(loaded).toMatchObject({
      status: 'unsupported',
      fileName: 'binary.log',
      fileType: 'log'
    })
    createdUrls.forEach((url) => URL.revokeObjectURL(url))
  })

  it('rejects legacy Word documents before reading preview data', async () => {
    const loaded = await prepareFileRenderDocument(
      {
        fileName: 'legacy.doc',
        filePath: '/not-read/legacy.doc'
      },
      []
    )

    expect(loaded).toEqual({
      status: 'unsupported',
      fileName: 'legacy.doc',
      fileType: 'doc'
    })
  })

  it('registers common image types explicitly', async () => {
    const createdUrls: string[] = []
    const loaded = await prepareFileRenderDocument(
      {
        fileName: 'diagram.png',
        fileData: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
      },
      createdUrls
    )

    expect(loaded).toMatchObject({ status: 'ready', document: { fileType: 'png' } })
    createdUrls.forEach((url) => URL.revokeObjectURL(url))
  })
})
