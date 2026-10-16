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
import {
  normalizeOfficePath,
  officeWriteHostForPath
} from '../../../src/main/services/wps/officeFileWriteNotify'
import {
  resolveWpsComponentExe,
  resolveWpsOfficeAppPath
} from '../../../src/main/services/wps/wpsOfficeLaunch'
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
  prompt: (marker: string, fileName: string) => string
}

export const WPS_OFFICE_COVERAGE_TARGETS: WpsOfficeCoverageTarget[] = [
  {
    kind: 'docx',
    fileName: 'sample-edit.docx',
    component: 'wps',
    prompt: (marker, fileName) =>
      `请直接修改我刚选中的 ${fileName}，在文末新增一段：“${marker}”。完成后告诉我已写回。`
  },
  {
    kind: 'xlsx',
    fileName: '经营周报.xlsx',
    component: 'et',
    prompt: (marker, fileName) =>
      `请直接修改我刚选中的 ${fileName}，在第一个工作表的 H1 单元格写入纯文本“${marker}”，不要改现有数字、公式或其他单元格。完成后告诉我已写回。`
  },
  {
    kind: 'pptx',
    fileName: '品牌策略提案.pptx',
    component: 'wpp',
    prompt: (marker, fileName) =>
      `请直接修改我刚选中的 ${fileName}，在第一页包含“2026 秋季品牌升级方案”的文本框内的文字末尾追加“${marker}”，保留该文本框原有内容，其他对象不变。完成后告诉我已写回。`
  }
]

export const prepareWpsOfficeFixtures = async (
  rootPath: string
): Promise<WpsOfficeCoverageTarget[]> => {
  const suffix = path.basename(rootPath).slice(-6)
  return await Promise.all(
    WPS_OFFICE_COVERAGE_TARGETS.map(async (target) => {
      const parsed = path.parse(target.fileName)
      const fileName = `${parsed.name}-${suffix}${parsed.ext}`
      await fsp.rename(path.join(rootPath, target.fileName), path.join(rootPath, fileName))
      return { ...target, fileName }
    })
  )
}

export const isWpsAddonHostEnabled = (host: WpsAddonHost): boolean => {
  const jsAddonsDir = resolveWpsJsAddonsDir({
    platform: process.platform,
    homedir: os.homedir(),
    env: process.env
  })
  if (!jsAddonsDir) return false
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(jsAddonsDir, 'authaddin.json'), 'utf8')
    ) as Record<string, unknown>
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

const WPS_COMPONENT_IMAGES = ['wps.exe', 'et.exe', 'wpp.exe'] as const
const WPS_DARWIN_PROCESS_PATTERN = 'wpsoffice'
const WPS_EXIT_POLL_MS = 250

export type WpsEnvironmentReset = {
  running: boolean
  forced: boolean
}

const runQuietly = async (file: string, args: readonly string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(file, [...args], {
      timeout: 20_000,
      windowsHide: true
    })
    return stdout
  } catch {
    // 进程不存在时 tasklist / taskkill / pkill 都以非 0 退出，属正常结果。
    return ''
  }
}

const isWpsRunning = async (): Promise<boolean> => {
  if (process.platform === 'win32') {
    for (const image of WPS_COMPONENT_IMAGES) {
      const stdout = await runQuietly('tasklist', [
        '/FI',
        `IMAGENAME eq ${image}`,
        '/NH',
        '/FO',
        'CSV'
      ])
      if (stdout.toLowerCase().includes(image)) return true
    }
    return false
  }
  if (process.platform === 'darwin') {
    return (await runQuietly('pgrep', ['-f', WPS_DARWIN_PROCESS_PATTERN])).trim().length > 0
  }
  return false
}

const requestWpsShutdown = async (force: boolean): Promise<void> => {
  if (process.platform === 'win32') {
    for (const image of WPS_COMPONENT_IMAGES) {
      // 不带 /F 的 taskkill 只是请求关闭窗口，给 WPS 自己保存和退出的机会。
      await runQuietly('taskkill', force ? ['/IM', image, '/F', '/T'] : ['/IM', image])
    }
    return
  }
  if (process.platform === 'darwin') {
    await runQuietly('pkill', [
      force ? '-KILL' : '-TERM',
      '-f',
      // 先让主进程自行清理加载项；同时 TERM CEF 会制造崩溃恢复和下轮初始化失败。
      force ? WPS_DARWIN_PROCESS_PATTERN : '/Contents/MacOS/wpsoffice$'
    ])
  }
}

const waitForWpsExit = async (timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await isWpsRunning())) return true
    await sleep(WPS_EXIT_POLL_MS)
  }
  return !(await isWpsRunning())
}

// WPS 打开的文档会一直锁着临时工作区，不归零就会把残留实例带进下一轮，
// 让 registry、dispatch 和断言全部对不上。先温和关，超时再强杀。
// 工作区仅由创建它的资源作用域回收，不能按前缀删除其他轮次仍在使用的目录。
export const resetWpsEnvironment = async (options?: {
  gracefulTimeoutMs?: number
}): Promise<WpsEnvironmentReset> => {
  const gracefulTimeoutMs = options?.gracefulTimeoutMs ?? 6_000
  const running = await isWpsRunning()
  let forced = false
  if (running) {
    await requestWpsShutdown(false)
    if (!(await waitForWpsExit(gracefulTimeoutMs))) {
      forced = true
      await requestWpsShutdown(true)
      await waitForWpsExit(5_000)
    }
  }
  return {
    running,
    forced
  }
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
      const count = countWpsDispatchesForPath(
        status.lastDispatches,
        options.filePath,
        options.afterAt
      )
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
    const deadline = Date.now() + 5_000
    for (;;) {
      try {
        await execFileAsync('open', ['-a', appPath, '--', filePath], { timeout: 20_000 })
        return
      } catch (error) {
        // TERM 已退出但 Launch Services 仍可能短暂指向旧 PID；仅重试该启动竞态。
        if (
          !(error instanceof Error) ||
          !/error -600\b/.test(error.message) ||
          Date.now() >= deadline
        )
          throw error
        await sleep(500)
      }
    }
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
  const activateAfter = Date.now() + 2_000
  let activationRetried = false
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
        !options.component ||
        status.clients.some((client) => client.component === options.component)
      if (status.clientCount >= 1 && documentOpen && componentReady) {
        return { port, status }
      }
      // 连续跨格式打开时，macOS WPS 可能只创建后台标签；同一文件再打开一次才激活组件。
      // 仅用于准备初始文档，后面的审核导航与写回仍完全走产品入口和真实回报。
      if (process.platform === 'darwin' && !activationRetried && Date.now() >= activateAfter) {
        activationRetried = true
        await openDocumentInWpsBackground(options.filePath)
      }
      lastError = new Error(
        `clients=${
          status.clients.map((item) => `${item.component}#${item.clientId}`).join(',') || '(none)'
        } fetches=${status.lastAddonFetches?.map((item) => item.path).join(',') || '(none)'} open=${
          status.openDocuments
            .map((item) => `${item.component}#${item.clientId}:${item.fullName}`)
            .join('|') || '(none)'
        }`
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

// 只认 ok:true 会把「别的实例抢答说打不开」整个藏掉，超时报错必须带上这些应答。
const describeRejectedResults = (status: WpsSyncStatus): string => {
  const rejected = [
    ...status.lastCloseResults
      .filter((item) => !item.ok)
      .map((item) => `close/${item.component}#${item.clientId}:${item.reason || 'unknown'}`),
    ...status.lastReloadResults
      .filter((item) => !item.ok)
      .map((item) => `open/${item.component}#${item.clientId}:${item.reason || 'unknown'}`)
  ]
  return rejected.length > 0 ? rejected.join('|') : '(none)'
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
        if (options.excerptIncludes && !result.excerpt.includes(options.excerptIncludes))
          return false
        if (options.excerptExcludes && result.excerpt.includes(options.excerptExcludes))
          return false
        return true
      })
      if (matched) return matched
      lastError = new Error(
        `reload-result count=${status.lastReloadResults.length} close-result=${
          status.lastCloseResults?.length ?? 0
        } dispatches=${status.lastDispatches.length} clients=${
          status.clients.map((item) => `${item.component}#${item.clientId}`).join(',') || '(none)'
        } open=${
          status.openDocuments
            .map((item) => `${item.component}#${item.clientId}:${item.fullName}`)
            .join('|') || '(none)'
        } rejected=${describeRejectedResults(status)} last=${JSON.stringify(
          status.lastReloadResults.at(-1) ?? null
        )}`
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
