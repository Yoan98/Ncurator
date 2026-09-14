import fs from 'fs/promises'
import path from 'path'
import { getUserDataPath } from '../../utils/paths'

const ICON_DIR_NAME = 'llm-icons'
const FETCH_TIMEOUT_MS = 8_000
const MAX_ICON_BYTES = 512 * 1024
const ICON_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+\.(png|svg|webp|jpe?g|gif)$/i

const mimeFromFileName = (fileName: string): string => {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

export const modelIconFileNameFromUrl = (iconUrl: string): string | null => {
  try {
    const parsed = new URL(iconUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    const fileName = path.basename(parsed.pathname).trim()
    if (!ICON_FILE_NAME_PATTERN.test(fileName)) return null
    return fileName.toLowerCase()
  } catch {
    return null
  }
}

const iconCacheDir = (): string => path.join(getUserDataPath(), ICON_DIR_NAME)

const iconFilePath = (fileName: string): string => path.join(iconCacheDir(), fileName)

const downloadOne = async (iconUrl: string): Promise<void> => {
  const fileName = modelIconFileNameFromUrl(iconUrl)
  if (!fileName) return
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(iconUrl, { method: 'GET', signal: controller.signal })
    if (!response.ok) return
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) return
    await fs.mkdir(iconCacheDir(), { recursive: true })
    await fs.writeFile(iconFilePath(fileName), bytes)
  } catch {
    // Keep the remote URL if the icon cannot be cached.
  } finally {
    clearTimeout(timer)
  }
}

export const cacheModelIcons = async (iconUrls: readonly string[]): Promise<void> => {
  const unique = [...new Set(iconUrls.map((item) => String(item || '').trim()).filter(Boolean))]
  if (unique.length === 0) return
  await Promise.allSettled(unique.map((url) => downloadOne(url)))
}

export const resolveCachedIconUrl = async (iconUrl: string): Promise<string> => {
  const remoteUrl = String(iconUrl || '').trim()
  const fileName = modelIconFileNameFromUrl(remoteUrl)
  if (!fileName) return remoteUrl || iconUrl
  try {
    const bytes = await fs.readFile(iconFilePath(fileName))
    if (bytes.length === 0) return remoteUrl
    return `data:${mimeFromFileName(fileName)};base64,${bytes.toString('base64')}`
  } catch {
    return remoteUrl
  }
}

export const resolveCachedIconUrls = async (
  iconUrls: readonly string[]
): Promise<Map<string, string>> => {
  const resolved = new Map<string, string>()
  await Promise.all(
    iconUrls.map(async (iconUrl) => {
      resolved.set(iconUrl, await resolveCachedIconUrl(iconUrl))
    })
  )
  return resolved
}
