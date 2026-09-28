import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AttachmentService } from '../../../../src/main/services/attachments/AttachmentService'
import {
  getPartnerAssetBucketDir,
  getPartnerScriptsRootDir
} from '../../../../src/main/services/assets/WorkspaceAssetService'

describe('attachment service runtime directories', () => {
  let userDataPath = ''
  let sourceRootPath = ''
  let originalUserDataPath = ''
  let service: AttachmentService
  const partnerId = 'partner-attachment-1'

  beforeEach(async () => {
    originalUserDataPath = process.env.NCURATOR_USER_DATA_PATH || ''
    userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-attachment-userdata-'))
    sourceRootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-attachment-source-'))
    process.env.NCURATOR_USER_DATA_PATH = userDataPath
    service = new AttachmentService()
  })

  afterEach(async () => {
    if (originalUserDataPath) {
      process.env.NCURATOR_USER_DATA_PATH = originalUserDataPath
    } else {
      delete process.env.NCURATOR_USER_DATA_PATH
    }
    await Promise.all(
      [userDataPath, sourceRootPath]
        .filter(Boolean)
        .map((directoryPath) => fs.rm(directoryPath, { recursive: true, force: true }))
    )
  })

  it('accepts source directories as path-only attachments', async () => {
    const attachment = await service.createSourceAttachmentFromPath({ sourcePath: sourceRootPath })

    expect(attachment.path).toBe(sourceRootPath)
    expect(attachment.name).toBe(path.basename(sourceRootPath))
    expect(attachment.kind).toBe('directory')
    expect(attachment.size).toBeUndefined()
    expect(attachment.mimeType).toBeUndefined()
    await expect(fs.stat(getPartnerAssetBucketDir(partnerId, 'bucket-1'))).rejects.toThrow()
  })

  it('rejects empty source paths instead of resolving the current working directory', async () => {
    await expect(service.createSourceAttachmentFromPath({ sourcePath: '  ' })).rejects.toThrow(
      '附件路径不存在'
    )
  })

  it('saves attachments under partner runtime and creates the scripts directory', async () => {
    const attachment = await service.saveAttachment({
      partnerId,
      assetBucketId: 'bucket-1',
      name: 'notes.md',
      bytes: Buffer.from('# runtime attachment')
    })

    const expectedPath = getPartnerAssetBucketDir(partnerId, 'bucket-1')
    const filePath = path.join(expectedPath, 'notes.md')
    expect(attachment.path).toBe(filePath)
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('# runtime attachment')
    expect((await fs.stat(getPartnerScriptsRootDir(partnerId))).isDirectory()).toBe(true)
  })

  it('creates source attachments without copying them into the runtime bucket', async () => {
    const sourcePath = path.join(sourceRootPath, 'reference.json')
    await fs.writeFile(sourcePath, '{"ready":true}')

    const attachment = await service.createSourceAttachmentFromPath({ sourcePath })

    expect(attachment.path).toBe(sourcePath)
    expect(attachment.name).toBe('reference.json')
    await expect(fs.stat(getPartnerAssetBucketDir(partnerId, 'bucket-1'))).rejects.toThrow()
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
      partnerId,
      assetBucketId: 'bucket-pdf',
      name: 'lecture.pdf',
      bytes: Buffer.from('%PDF-1.7\n')
    })

    expect(attachment.kind).toBe('file')
    expect(attachment.mimeType).toBe('application/pdf')
    expect(attachment.path).toBe(
      path.join(getPartnerAssetBucketDir(partnerId, 'bucket-pdf'), 'lecture.pdf')
    )
  })

  it.each([
    ['legacy.doc', 'application/msword'],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
  ])('accepts %s attachments and assigns the expected MIME type', async (name, mimeType) => {
    const attachment = await service.saveAttachment({
      partnerId,
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
      partnerId,
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
      partnerId,
      assetBucketId: 'bucket-unknown',
      name: 'archive.zip',
      bytes: Buffer.from('unknown-extension-bytes')
    })

    expect(attachment.kind).toBe('file')
    expect(attachment.mimeType).toBe('application/octet-stream')
    expect(attachment.path).toBe(
      path.join(getPartnerAssetBucketDir(partnerId, 'bucket-unknown'), 'archive.zip')
    )
  })
})
