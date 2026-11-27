import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod/v4'

const schema = z.object({
  outputPath: z.string(),
  originalPath: z.string().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  editPath: z.string().optional(),
  sourcePath: z.string().optional()
})
/** A snapshot has its own sidecar; asset directories keep their regular origin.json. */
export const readMediaOrigin = async (
  file: string
): Promise<z.infer<typeof schema> | undefined> => {
  for (const candidate of [`${file}.origin.json`, path.join(path.dirname(file), 'origin.json')]) {
    const origin = await fs
      .readFile(candidate, 'utf8')
      .then((text) => schema.safeParse(JSON.parse(text)).data)
      .catch(() => undefined)
    if (origin?.outputPath === file) return origin
  }
  return undefined
}
