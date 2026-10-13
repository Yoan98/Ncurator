type TextSaveControl = {
  save: () => Promise<void>
  pause: () => void
  resume: () => void
  discard: (reason: 'deleted' | 'renamed') => void
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

export async function withTextFileMutation<T>(
  filePath: string,
  reason: 'deleted' | 'renamed',
  mutateFile: () => Promise<T>
): Promise<T> {
  const control = saves.get(filePath)
  control?.pause()
  try {
    await control?.save()
    const result = await mutateFile()
    control?.discard(reason)
    if (saves.get(filePath) === control) saves.delete(filePath)
    return result
  } catch (error) {
    control?.resume()
    throw error
  }
}
