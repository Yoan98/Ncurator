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

  it('imports attachments into the runtime bucket and keeps names unique', async () => {
    const sourcePath = path.join(sourceRootPath, 'reference.json')
    await fs.writeFile(sourcePath, '{"ready":true}')

    const first = await service.importAttachmentFromPath({
      workspaceRootPath,
      assetBucketId: 'bucket-2',
      sourcePath
    })
    const second = await service.importAttachmentFromPath({
      workspaceRootPath,
      assetBucketId: 'bucket-2',
      sourcePath
    })

    const bucketPath = path.join(workspaceRootPath, '.ncurator', 'runtime', 'assets', 'bucket-2')
    expect(first.path).toBe(path.join(bucketPath, 'reference.json'))
    expect(second.path).toBe(path.join(bucketPath, 'reference-1.json'))
    await expect(fs.readFile(second.path, 'utf8')).resolves.toBe('{"ready":true}')
  })
})
