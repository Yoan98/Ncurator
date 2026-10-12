import fs from 'node:fs/promises'
import path from 'node:path'
import { Document, Packer, Paragraph } from 'docx'
import ExcelJS from 'exceljs'
import { addBlankSlide, createPresentation, savePresentation } from 'pptx-kit'
import type { WorkspaceTreeEntry } from '../../../shared/types'
import { isSupportedLocalFilePath } from '../ingestion/loader'

const assertInsideRoot = (rootPath: string, targetPath: string): void => {
  const relative = path.relative(rootPath, targetPath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('文件操作必须在当前工作目录内')
  }
}

const normalizeFileName = (value: string): string => {
  const name = value.trim()
  if (!name || name.startsWith('.') || name.endsWith('.')) {
    throw new Error('请输入有效文件名，不能以点开头或结尾')
  }
  if (
    /[<>:"/\\|?*]/u.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
  ) {
    throw new Error('文件名包含不允许使用的字符或名称')
  }
  return name
}

const createBlankFileBytes = async (extension: string): Promise<Uint8Array> => {
  if (extension === '.docx') {
    return Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('')] }] }))
  }
  if (extension === '.xlsx') {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Sheet1')
    return new Uint8Array(await workbook.xlsx.writeBuffer())
  }
  if (extension === '.pptx') {
    const presentation = createPresentation()
    addBlankSlide(presentation)
    return savePresentation(presentation)
  }
  return new Uint8Array()
}

export class WorkspaceFileService {
  private async resolveDirectory(rootPath: string, relativePath: string): Promise<string> {
    const root = await fs.realpath(rootPath)
    if (!(await fs.stat(root)).isDirectory()) throw new Error('当前文件地址不是目录')
    const target = path.resolve(root, relativePath.replace(/\\/g, '/'))
    assertInsideRoot(root, target)
    const directory = await fs.realpath(target)
    assertInsideRoot(root, directory)
    if (!(await fs.stat(directory)).isDirectory()) throw new Error('新建位置不是目录')
    return directory
  }

  async createFile(input: {
    workspaceId: string
    rootPath: string
    parentRelativePath: string
    fileName: string
  }): Promise<WorkspaceTreeEntry> {
    const fileName = normalizeFileName(input.fileName)
    const directory = await this.resolveDirectory(input.rootPath, input.parentRelativePath)
    const absolutePath = path.join(directory, fileName)
    const bytes = await createBlankFileBytes(path.extname(fileName).toLowerCase())
    try {
      await fs.writeFile(absolutePath, bytes, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('同名文件或文件夹已存在，请修改名称')
      }
      throw error
    }
    const root = await fs.realpath(input.rootPath)
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/')
    const parentPath = path.posix.dirname(relativePath)
    return {
      id: `${input.workspaceId}:file:${relativePath}`,
      workspace_id: input.workspaceId,
      parent_id: parentPath === '.' ? undefined : `${input.workspaceId}:directory:${parentPath}`,
      kind: 'file',
      name: fileName,
      relative_path: relativePath,
      absolute_path: absolutePath,
      file_ext: path.extname(fileName).slice(1).toLowerCase() || undefined,
      supported_for_index: isSupportedLocalFilePath(absolutePath),
      size: bytes.byteLength
    }
  }

  async trashFile(
    input: { rootPath: string; relativePath: string },
    moveToTrash: (filePath: string) => Promise<void>
  ): Promise<void> {
    const root = await fs.realpath(input.rootPath)
    const requestedPath = path.resolve(root, input.relativePath.replace(/\\/g, '/'))
    assertInsideRoot(root, requestedPath)
    const filePath = await fs.realpath(requestedPath)
    assertInsideRoot(root, filePath)
    if (!(await fs.lstat(requestedPath)).isFile()) throw new Error('只能删除文件')
    await moveToTrash(filePath)
  }
}
