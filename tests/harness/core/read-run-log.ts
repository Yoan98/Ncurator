import fs from 'node:fs'
import { createReadStream } from 'node:fs'
import readline from 'node:readline'

const parseJsonLine = <T>(line: string): T => JSON.parse(line) as T

export const readJsonLinesSync = <T>(filePath: string): T[] => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    if (!raw.trim()) return []
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseJsonLine<T>(line))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

export const iterateJsonLines = async function* <T>(filePath: string): AsyncGenerator<T> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }

  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  })

  try {
    for await (const rawLine of lineReader) {
      const line = rawLine.trim()
      if (!line) continue
      yield parseJsonLine<T>(line)
    }
  } finally {
    lineReader.close()
    stream.close()
  }
}
