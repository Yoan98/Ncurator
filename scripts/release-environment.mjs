/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const loadReleaseEnvironment = async (root) => {
  const filePath = path.join(root, '.env')
  const content = await readFile(filePath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) throw new Error(`invalid release environment line: ${rawLine}`)
    const name = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[name]) process.env[name] = value
  }

  if (!process.env.AWS_ACCESS_KEY_ID && process.env.R2_ACCESS_KEY_ID) {
    process.env.AWS_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID
  }
  if (!process.env.AWS_SECRET_ACCESS_KEY && process.env.R2_SECRET_ACCESS_KEY) {
    process.env.AWS_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY
  }
}
