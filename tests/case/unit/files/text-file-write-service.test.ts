import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { writeTextFileAtomically } from '../../../../src/main/services/files/TextFileWriteService'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const hashOf = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

describe('unit text-file-write-service', () => {
  it('text-file-write-service', async () => {
    await runBackendCase({
      caseId: 'text-file-write-service',
      harnessMode: 'tool-real',
      domain: 'unit',
      suite: 'files',
      groups: ['write'],
      description: 'write-text-file 原子写入的 UTF-8 校验、冲突检测与字节保真。',
      fixtures: ['tests/fixtures/workspace'],
      runMode: 'single',
      execute: async (runtime) => {
        const workspaceRoot = runtime.workspaceRoot
        const newFilePath = path.join(workspaceRoot, 'write-new.txt')
        const existingPath = path.join(workspaceRoot, 'write-existing.txt')
        const crlfPath = path.join(workspaceRoot, 'write-crlf.txt')

        const created = writeTextFileAtomically(newFilePath, 'hello\nworld\n')
        const createdBytes = await fs.readFile(newFilePath, 'utf8')
        const tempFilesLeft = (await fs.readdir(workspaceRoot)).filter((name) =>
          name.startsWith('.ncurator-write-')
        )

        await fs.writeFile(existingPath, 'original')
        const matchedHash = writeTextFileAtomically(existingPath, 'updated', 'no-hash-match')
        const matchedHashWriteSkipped = (await fs.readFile(existingPath, 'utf8')) === 'original'
        const currentHash = hashOf(await fs.readFile(existingPath))
        const overwriteOk = writeTextFileAtomically(existingPath, 'updated', currentHash)
        const overwriteApplied = (await fs.readFile(existingPath, 'utf8')) === 'updated'
        const missingFileConflict = writeTextFileAtomically(
          path.join(workspaceRoot, 'never-created.txt'),
          'x',
          'some-hash'
        )

        const crlfContent = 'line one\r\nline two\r\n'
        const crlfOk = writeTextFileAtomically(crlfPath, crlfContent)
        const crlfBytes = await fs.readFile(crlfPath)
        const crlfPreserved = crlfBytes.equals(Buffer.from(crlfContent, 'utf8'))

        const loneSurrogate = `bad\uD800chars`
        const invalid = writeTextFileAtomically(path.join(workspaceRoot, 'invalid.txt'), loneSurrogate)
        const invalidFileNotCreated = !(await pathExists(path.join(workspaceRoot, 'invalid.txt')))

        return {
          created: created.ok && createdBytes === 'hello\nworld\n' && Boolean(created.hash),
          noTempLeftovers: tempFilesLeft.length === 0,
          matchedHashRejected: !matchedHash.ok && Boolean(matchedHash.conflict) && matchedHashWriteSkipped,
          overwriteOk: overwriteOk.ok && overwriteApplied,
          missingFileConflict: !missingFileConflict.ok && Boolean(missingFileConflict.error),
          crlfOk: crlfOk.ok && crlfPreserved,
          invalidRejected: !invalid.ok && Boolean(invalid.error) && invalidFileNotCreated
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.created &&
            result.noTempLeftovers &&
            result.matchedHashRejected &&
            result.overwriteOk &&
            result.missingFileConflict &&
            result.crlfOk &&
            result.invalidRejected,
          {
            name: 'text-file-write-service',
            message:
              'write-text-file 原子写入应创建/覆盖文件且不残留临时文件；expectedHash 不匹配拒绝覆盖；缺失文件带 expectedHash 报冲突；CRLF 字节保真；孤立代理对内容拒绝写入。\n' +
              JSON.stringify(result),
            data: result
          }
        )
      }
    })
  })
})
