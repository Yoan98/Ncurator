import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AttachmentService } from '../../../../src/main/services/attachments/AttachmentService'

describe('attachment service runtime directories', () => {
  let workspaceRootPath = ''
  let sourceRootPath = ''
  let service: AttachmentService

  beforeEach(async () => {
    workspaceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-attachment-workspace-'))
    sourceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-attachment-source-'))
    service = new AttachmentService()
  })

  afterEach(async () => {
    await Promise.all(
      [workspaceRootPath, sourceRootPath]
        .filter(Boolean)
        .map((directoryPath) => fs.rm(directoryPath, { recursive: true, force: true }))
    )
  })

  it('rejects source attachment directories', async () => {
    await expect(
      service.createSourceAttachmentFromPath({ sourcePath: sourceRootPath })
    ).rejects.toThrow('附件必须是文件')
  })

  it('saves attachments under .ncurator/runtime and creates the scripts directory', async () => {
    const attachment = await service.saveAttachment({
      workspaceRootPath,
      assetBucketId: 'bucket-1',
      name: 'notes.md',
      bytes: Buffer.from('# runtime attachment')
    })

    const expectedPath = path.join(
      workspaceRootPath,
      '.ncurator',
      'runtime',
      'assets',
      'bucket-1',
      'notes.md'
    )
    expect(attachment.path).toBe(expectedPath)
    await expect(fs.readFile(expectedPath, 'utf8')).resolves.toBe('# runtime attachment')
    expect(
      (await fs.stat(path.join(workspaceRootPath, '.ncurator', 'runtime', 'scripts'))).isDirectory()
    ).toBe(true)
    await expect(fs.stat(path.join(workspaceRootPath, '.ncurator', 'assets'))).rejects.toThrow()
    await expect(fs.stat(path.join(workspaceRootPath, '.ncurator', 'scripts'))).rejects.toThrow()
  })

  it('creates source attachments without copying them into the runtime bucket', async () => {
    const sourcePath = path.join(sourceRootPath, 'reference.json')
    await fs.writeFile(sourcePath, '{"ready":true}')

    const attachment = await service.createSourceAttachmentFromPath({ sourcePath })

    expect(attachment.path).toBe(sourcePath)
    expect(attachment.name).toBe('reference.json')
    await expect(
      fs.stat(path.join(workspaceRootPath, '.ncurator', 'runtime', 'assets'))
    ).rejects.toThrow()
  })

  it('rejects source attachment directories', async () => {
    await expect(
      service.createSourceAttachmentFromPath({ sourcePath: sourceRootPath })
    ).rejects.toThrow('附件必须是文件')
  })

  it('accepts source attachments with any extension and falls back to octet-stream', async () => {
    const sourcePath = path.join(sourceRootPath, 'archive.zip')
    await fs.writeFile(sourcePath, 'binary-like-content')

    const attachment = await service.createSourceAttachmentFromPath({ sourcePath })

    expect(attachment.path).toBe(sourcePath)
    expect(attachment.name).toBe('archive.zip')
    expect(attachment.kind).toBe('file')
    expect(attachment.mimeType).toBe('application/octet-stream')
  })

  it('accepts PDF attachments and assigns application/pdf', async () => {
    const attachment = await service.saveAttachment({
      workspaceRootPath,
      assetBucketId: 'bucket-pdf',
      name: 'lecture.pdf',
      bytes: Buffer.from('%PDF-1.7\n')
    })

    expect(attachment.kind).toBe('file')
    expect(attachment.mimeType).toBe('application/pdf')
    expect(attachment.path).toBe(
      path.join(workspaceRootPath, '.ncurator', 'runtime', 'assets', 'bucket-pdf', 'lecture.pdf')
    )
  })

  it.each([
    ['legacy.doc', 'application/msword'],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
  ])('accepts %s attachments and assigns the expected MIME type', async (name, mimeType) => {
    const attachment = await service.saveAttachment({
      workspaceRootPath,
      assetBucketId: 'bucket-office',
      name,
      bytes: Buffer.from('office-attachment')
    })

    expect(attachment.kind).toBe('file')
    expect(attachment.mimeType).toBe(mimeType)
    await expect(fs.stat(attachment.path)).resolves.toBeDefined()
  })

  it.each([
    ['report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['macros.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
    ['template.xltx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.template'],
    ['macro-template.xltm', 'application/vnd.ms-excel.template.macroEnabled.12']
  ])('accepts spreadsheet attachment %s with the expected MIME type', async (name, mimeType) => {
    const attachment = await service.saveAttachment({
      workspaceRootPath,
      assetBucketId: 'bucket-spreadsheet',
      name,
      bytes: Buffer.from('spreadsheet-bytes')
    })

    expect(attachment.kind).toBe('file')
    expect(attachment.mimeType).toBe(mimeType)
    expect(attachment.name).toBe(name)
  })

  it('accepts attachments with unknown extensions without failing', async () => {
    const attachment = await service.saveAttachment({
      workspaceRootPath,
      assetBucketId: 'bucket-unknown',
      name: 'archive.zip',
      bytes: Buffer.from('unknown-extension-bytes')
    })

    expect(attachment.kind).toBe('file')
    expect(attachment.mimeType).toBe('application/octet-stream')
    expect(attachment.path).toBe(
      path.join(
        workspaceRootPath,
        '.ncurator',
        'runtime',
        'assets',
        'bucket-unknown',
        'archive.zip'
      )
    )
  })
})
