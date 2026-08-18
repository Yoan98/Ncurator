const dirtyFilePaths = new Set<string>()

export const registerEditableFileDirty = (filePath: string, dirty: boolean): void => {
  if (dirty) {
    dirtyFilePaths.add(filePath)
  } else {
    dirtyFilePaths.delete(filePath)
  }
}

export const isEditableFileDirty = (filePath: string): boolean => dirtyFilePaths.has(filePath)
