type TextSaveControl = {
  save: () => Promise<void>
  pause: () => void
  resume: () => void
  discard: () => void
}

const saves = new Map<string, TextSaveControl>()
export function registerTextSave(filePath: string, control: TextSaveControl): () => void {
  saves.set(filePath, control)
  return () => {
    // A failed save remains retryable after its tab closes.
    void control
      .save()
      .then(() => {
        if (saves.get(filePath) === control) saves.delete(filePath)
      })
      .catch(() => undefined)
  }
}
export async function flushReferencedTextFiles(filePaths: string[]): Promise<void> {
  await Promise.all([...new Set(filePaths)].map((filePath) => saves.get(filePath)?.save()))
}

export async function withTextFileDeletion(
  filePath: string,
  deleteFile: () => Promise<void>
): Promise<void> {
  const control = saves.get(filePath)
  control?.pause()
  try {
    await control?.save()
    await deleteFile()
    control?.discard()
    if (saves.get(filePath) === control) saves.delete(filePath)
  } catch (error) {
    control?.resume()
    throw error
  }
}
