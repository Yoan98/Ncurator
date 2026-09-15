import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  WPS_ADDON_DIR_NAME,
  WPS_ADDON_NAME,
  WPS_ADDON_PORT_FILE,
  WPS_PREFERRED_SYNC_PORT
} from '../../../src/main/services/wps/constants'
import { normalizeOfficePath } from '../../../src/main/services/wps/officeFileWriteNotify'
import { resolveWpsJsAddonsDir } from '../../../src/main/services/wps/WpsAddonInstaller'
import type {
  WpsReloadDispatch,
  WpsReloadResult,
  WpsSyncStatus
} from '../../../src/main/services/wps/WpsSyncService'

const execFileAsync = promisify(execFile)

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const darwinAppCandidates = (): string[] => [
  '/Applications/wpsoffice.localized/wpsoffice.app',
  '/Applications/wpsoffice.app',
  '/Applications/WPS Office.app'
]

const windowsExeCandidates = (): string[] => {
  const localAppData = String(process.env.LOCALAPPDATA || '').trim()
  const programFiles = String(process.env.ProgramFiles || '').trim()
  const programFilesX86 = String(process.env['ProgramFiles(x86)'] || '').trim()
  return [
    localAppData ? path.join(localAppData, 'Kingsoft', 'WPS Office', 'ksolaunch.exe') : '',
    programFiles ? path.join(programFiles, 'Kingsoft', 'WPS Office', 'office6', 'wps.exe') : '',
    programFilesX86 ? path.join(programFilesX86, 'Kingsoft', 'WPS Office', 'office6', 'wps.exe') : ''
  ].filter(Boolean)
}

export const resolveWpsOfficeAppPath = (): string | undefined => {
  if (process.platform === 'darwin') {
    return darwinAppCandidates().find((candidate) => fs.existsSync(candidate))
  }
  if (process.platform === 'win32') {
    return windowsExeCandidates().find((candidate) => fs.existsSync(candidate))
  }
  return undefined
}

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
  const response = await fetch(`http://127.0.0.1:${port}/status`)
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
    await execFileAsync(appPath, [filePath], { timeout: 20_000, windowsHide: true })
    return
  }
  throw new Error(`WPS e2e 不支持当前平台 ${process.platform}`)
}

export const waitForWpsAddonReady = async (options: {
  filePath: string
  timeoutMs?: number
}): Promise<{ port: number; status: WpsSyncStatus }> => {
  const timeoutMs = options.timeoutMs ?? 45_000
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const port = await resolveInstalledWpsSyncPort()
      const status = await fetchWpsSyncStatus(port)
      const documentOpen = status.openDocuments.some((item) => matchesPath(item.fullName, options.filePath))
      if (status.clientCount >= 1 && documentOpen) {
        return { port, status }
      }
      lastError = new Error(
        `clients=${status.clientCount} fetches=${
          status.lastAddonFetches?.map((item) => item.path).join(',') || '(none)'
        } open=${status.openDocuments.map((item) => item.fullName).join('|') || '(none)'}`
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
  const timeoutMs = options.timeoutMs ?? 20_000
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
      lastError = new Error(`reload-result count=${status.lastReloadResults.length}`)
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
