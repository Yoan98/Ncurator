import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  WPS_ADDON_DIR_NAME,
  WPS_ADDON_LEGACY_NAMES,
  WPS_ADDON_NAME,
  WPS_ADDON_PORT_FILE,
  WPS_PREFERRED_SYNC_PORT
} from '../../../src/main/services/wps/constants'
import { normalizeOfficePath, officeWriteHostForPath } from '../../../src/main/services/wps/officeFileWriteNotify'
import { resolveWpsComponentExe, resolveWpsOfficeAppPath } from '../../../src/main/services/wps/wpsOfficeLaunch'
import { resolveWpsJsAddonsDir } from '../../../src/main/services/wps/WpsAddonInstaller'
import type {
  WpsReloadDispatch,
  WpsReloadResult,
  WpsSyncStatus
} from '../../../src/main/services/wps/WpsSyncService'

export type WpsAddonHost = 'wps' | 'et' | 'wpp'

export type WpsOfficeCoverageTarget = {
  kind: 'docx' | 'xlsx' | 'pptx'
  fileName: string
  component: WpsAddonHost
  prompt: (marker: string) => string
}

export const WPS_OFFICE_COVERAGE_TARGETS: WpsOfficeCoverageTarget[] = [
  {
    kind: 'docx',
    fileName: 'sample-edit.docx',
    component: 'wps',
    prompt: (marker) =>
      `请直接修改我刚选中的 sample-edit.docx，在文末新增一段：“${marker}”。完成后告诉我已写回。`
  },
  {
    kind: 'xlsx',
    fileName: '经营周报.xlsx',
    component: 'et',
    prompt: (marker) =>
      `请直接修改我刚选中的 经营周报.xlsx，在第一个工作表找一个空白单元格写入纯文本“${marker}”，不要改现有数字、公式或其他单元格。完成后告诉我已写回。`
  },
  {
    kind: 'pptx',
    fileName: '品牌策略提案.pptx',
    component: 'wpp',
    prompt: (marker) =>
      `请直接修改我刚选中的 品牌策略提案.pptx，在第一页已有正文末尾追加“${marker}”，不要删除原有内容。完成后告诉我已写回。`
  }
]

export const isWpsAddonHostEnabled = (host: WpsAddonHost): boolean => {
  const jsAddonsDir = resolveWpsJsAddonsDir({
    platform: process.platform,
    homedir: os.homedir(),
    env: process.env
  })
  if (!jsAddonsDir) return false
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(jsAddonsDir, 'authaddin.json'), 'utf8')) as Record<
      string,
      unknown
    >
    const section = parsed[host]
    if (!section || typeof section !== 'object' || Array.isArray(section)) return false
    const names = new Set<string>([WPS_ADDON_NAME, ...WPS_ADDON_LEGACY_NAMES])
    return Object.values(section).some((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const entry = value as { name?: string; enable?: boolean }
      return Boolean(entry.name && names.has(entry.name) && entry.enable === true)
    })
  } catch {
    return false
  }
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const execFileAsync = promisify(execFile)

const resolveWindowsOpenExe = (filePath: string): string | undefined => {
  const host = officeWriteHostForPath(filePath) || 'wps'
  return resolveWpsComponentExe(host, filePath) ?? resolveWpsOfficeAppPath()
}

const spawnWindowsDetached = async (exePath: string, args: readonly string[]): Promise<void> =>
  await new Promise((resolve, reject) => {
    const child = spawn(exePath, [...args], {
      detached: true,
      stdio: 'ignore'
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })

export { resolveWpsOfficeAppPath }

export const resolveInstalledWpsSyncPort = async (): Promise<number> => {
  const jsAddonsDir = resolveWpsJsAddonsDir({
    platform: process.platform,
    homedir: os.homedir(),
    env: process.env
  })
  if (!jsAddonsDir) return WPS_PREFERRED_SYNC_PORT
  const candidates = [
    path.join(jsAddonsDir, WPS_ADDON_PORT_FILE),
    path.join(jsAddonsDir, WPS_ADDON_DIR_NAME, 'port.json'),
    path.join(jsAddonsDir, WPS_ADDON_NAME, 'port.json')
  ]
  for (const filePath of candidates) {
    try {
      const parsed = JSON.parse(await fsp.readFile(filePath, 'utf8')) as { port?: number }
      if (typeof parsed.port === 'number' && Number.isInteger(parsed.port) && parsed.port > 0) {
        return parsed.port
      }
    } catch {
      // 尚未写出 port 文件时试下一个位置。
    }
  }
  return WPS_PREFERRED_SYNC_PORT
}

export const fetchWpsSyncStatus = async (port: number): Promise<WpsSyncStatus> => {
  const response = await fetch(`http://127.0.0.1:${port}/status`, {
    signal: AbortSignal.timeout(1_500)
  })
  if (!response.ok) {
    throw new Error(`WPS sync /status HTTP ${response.status}`)
  }
  return (await response.json()) as WpsSyncStatus
}

const matchesPath = (left: string | undefined, right: string): boolean =>
  Boolean(left) && normalizeOfficePath(left as string) === normalizeOfficePath(right)

export const countWpsDispatchesForPath = (
  dispatches: readonly WpsReloadDispatch[],
  filePath: string,
  afterAt = 0
): number =>
  dispatches.filter((item) => item.at >= afterAt && matchesPath(item.path, filePath)).length

export const waitForWpsSyncStatus = async (options?: {
  timeoutMs?: number
}): Promise<{ port: number; status: WpsSyncStatus }> => {
  const timeoutMs = options?.timeoutMs ?? 20_000
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const port = await resolveInstalledWpsSyncPort()
      const status = await fetchWpsSyncStatus(port)
      return { port, status }
    } catch (error) {
      lastError = error
      await sleep(150)
    }
  }
  throw new Error(
    `WPS sync /status not reachable${lastError instanceof Error ? `: ${lastError.message}` : ''}`
  )
}

export const waitForWpsDispatch = async (options: {
  filePath: string
  afterAt: number
  minCount?: number
  timeoutMs?: number
}): Promise<{ port: number; count: number; status: WpsSyncStatus }> => {
  const minCount = options.minCount ?? 1
  const timeoutMs = options.timeoutMs ?? 20_000
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const port = await resolveInstalledWpsSyncPort()
      const status = await fetchWpsSyncStatus(port)
      const count = countWpsDispatchesForPath(status.lastDispatches, options.filePath, options.afterAt)
      if (count >= minCount) return { port, count, status }
      lastError = new Error(`dispatch count ${count} < ${minCount}`)
    } catch (error) {
      lastError = error
    }
    await sleep(150)
  }
  throw new Error(
    `馆长未在 ${timeoutMs}ms 内向 WPS 通道 dispatch ${options.filePath}${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }`
  )
}

export const openDocumentInWpsBackground = async (filePath: string): Promise<void> => {
  const appPath = resolveWpsOfficeAppPath()
  if (!appPath) {
    throw new Error('本机未找到 WPS Office')
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-a', appPath, filePath], { timeout: 20_000 })
    return
  }
  if (process.platform === 'win32') {
    const exePath = resolveWindowsOpenExe(filePath)
    if (!exePath) {
      throw new Error('本机未找到 WPS Office')
    }
    await spawnWindowsDetached(exePath, [filePath])
    return
  }
  throw new Error(`WPS e2e 不支持当前平台 ${process.platform}`)
}

export const waitForWpsAddonReady = async (options: {
  filePath: string
  component?: WpsAddonHost
  timeoutMs?: number
}): Promise<{ port: number; status: WpsSyncStatus }> => {
  const timeoutMs = options.timeoutMs ?? 45_000
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const port = await resolveInstalledWpsSyncPort()
      const status = await fetchWpsSyncStatus(port)
      const documentOpen = status.openDocuments.some(
        (item) =>
          matchesPath(item.fullName, options.filePath) &&
          (!options.component || item.component === options.component)
      )
      const componentReady =
        !options.component || status.clients.some((client) => client.component === options.component)
      if (status.clientCount >= 1 && documentOpen && componentReady) {
        return { port, status }
      }
      lastError = new Error(
        `clients=${status.clients.map((item) => item.component).join(',') || '(none)'} fetches=${
          status.lastAddonFetches?.map((item) => item.path).join(',') || '(none)'
        } open=${status.openDocuments.map((item) => `${item.component}:${item.fullName}`).join('|') || '(none)'}`
      )
    } catch (error) {
      lastError = error
    }
    await sleep(400)
  }
  throw new Error(
    `WPS 加载项未在 ${timeoutMs}ms 内连上并打开目标文档${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }`
  )
}

export const waitForWpsReloadResult = async (options: {
  port: number
  filePath: string
  afterAt: number
  excerptIncludes?: string
  excerptExcludes?: string
  timeoutMs?: number
}): Promise<WpsReloadResult> => {
  const timeoutMs = options.timeoutMs ?? 45_000
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const status = await fetchWpsSyncStatus(options.port)
      const matched = [...status.lastReloadResults].reverse().find((result) => {
        if (result.at < options.afterAt) return false
        if (!result.ok) return false
        if (!matchesPath(result.fullName, options.filePath)) return false
        if (options.excerptIncludes && !result.excerpt.includes(options.excerptIncludes)) return false
        if (options.excerptExcludes && result.excerpt.includes(options.excerptExcludes)) return false
        return true
      })
      if (matched) return matched
      lastError = new Error(
        `reload-result count=${status.lastReloadResults.length} close-result=${
          status.lastCloseResults?.length ?? 0
        } dispatches=${status.lastDispatches.length} clients=${
          status.clients.map((item) => item.component).join(',') || '(none)'
        } open=${
          status.openDocuments.map((item) => `${item.component}:${item.fullName}`).join('|') || '(none)'
        } last=${JSON.stringify(status.lastReloadResults.at(-1) ?? null)}`
      )
    } catch (error) {
      lastError = error
    }
    await sleep(200)
  }
  throw new Error(
    `WPS 未在 ${timeoutMs}ms 内对 ${options.filePath} 完成 close+open${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }`
  )
}
