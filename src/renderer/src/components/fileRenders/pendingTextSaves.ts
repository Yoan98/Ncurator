type TextSaveControl = {
  save: () => Promise<void>
  pause: () => void
  resume: () => void
  discard: (reason: 'deleted' | 'renamed') => void
}

// Keep failed, detached editors until their content can be flushed successfully.
const detached = new WeakSet<TextSaveControl>()
const saves = new Map<string, Set<TextSaveControl>>()
export function registerTextSave(filePath: string, control: TextSaveControl): () => void {
  let controls = saves.get(filePath)
  if (!controls) {
    controls = new Set()
    saves.set(filePath, controls)
  }
  controls.add(control)
  return () => {
    detached.add(control)
    void control
      .save()
      .then(() => {
        controls.delete(control)
        if (!controls.size && saves.get(filePath) === controls) saves.delete(filePath)
      })
      .catch(() => undefined)
  }
}
export async function flushReferencedTextFiles(filePaths: string[]): Promise<void> {
  await Promise.all(
    [...new Set(filePaths)].map(async (filePath) => {
      const controls = saves.get(filePath)
      for (const control of controls || []) {
        await control.save()
        if (detached.has(control)) {
          controls?.delete(control)
          detached.delete(control)
        }
      }
      if (controls && !controls.size && saves.get(filePath) === controls) saves.delete(filePath)
    })
  )
}
export async function flushAllTextFiles(): Promise<void> {
  await flushReferencedTextFiles([...saves.keys()])
}
export async function withTextFileMutation<T>(
  filePath: string,
  reason: 'deleted' | 'renamed',
  mutateFile: () => Promise<T>
): Promise<T> {
  const controls = saves.get(filePath)
  controls?.forEach((control) => control.pause())
  try {
    await flushReferencedTextFiles([filePath])
    const result = await mutateFile()
    controls?.forEach((control) => control.discard(reason))
    if (saves.get(filePath) === controls) saves.delete(filePath)
    return result
  } catch (error) {
    controls?.forEach((control) => control.resume())
    throw error
  }
}
