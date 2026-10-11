const saves = new Map<string, () => Promise<void>>()
export function registerTextSave(filePath: string, save: () => Promise<void>): () => void {
  saves.set(filePath, save)
  return () => {
    // A failed save remains retryable after its tab closes.
    void save()
      .then(() => {
        if (saves.get(filePath) === save) saves.delete(filePath)
      })
      .catch(() => undefined)
  }
}
export async function flushReferencedTextFiles(filePaths: string[]): Promise<void> {
  await Promise.all([...new Set(filePaths)].map((filePath) => saves.get(filePath)?.()))
}
