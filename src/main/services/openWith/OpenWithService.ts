import { app } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  ListOpenWithApplicationsResponse,
  OpenFileWithApplicationResponse,
  OpenWithApplication
} from '../../../shared/types'

const execFileAsync = promisify(execFile)
const OPEN_WITH_CACHE_TTL_MS = 5 * 60 * 1_000

export type NativeOpenWithApplication = {
  id: string
  name: string
  path?: string
  isDefault: boolean
}

export type NativeOpenWithListResponse = {
  applications?: NativeOpenWithApplication[]
  defaultApplicationId?: string
  error?: string
}

export type NativeOpenWithResponse = { success: boolean; error?: string }

export type OpenWithServiceOptions = {
  runNativeList?: (filePath: string) => Promise<NativeOpenWithListResponse>
  runNativeOpen?: (
    filePath: string,
    application: NativeOpenWithApplication
  ) => Promise<NativeOpenWithResponse>
  getIconDataUrl?: (applicationPath: string) => Promise<string | undefined>
  now?: () => number
}

export const MACOS_LIST_SCRIPT = String.raw`
ObjC['im' + 'port']('AppKit')
function run(argv) {
  const filePath = argv[0]
  if (!filePath) return JSON.stringify({ applications: [], error: 'filePath is required' })
  const workspace = $.NSWorkspace.sharedWorkspace
  const fileURL = $.NSURL.fileURLWithPath(filePath)
  const defaultURL = workspace.URLForApplicationToOpenURL(fileURL)
  const urls = workspace.URLsForApplicationsToOpenURL(fileURL)
  const defaultPath = defaultURL ? ObjC.unwrap(defaultURL.path) : ''
  const applications = []
  const seen = {}
  for (let index = 0; index < urls.count; index += 1) {
    const url = urls.objectAtIndex(index)
    const appPath = ObjC.unwrap(url.path)
    const bundle = $.NSBundle.bundleWithURL(url)
    const bundleId = bundle && bundle.bundleIdentifier ? ObjC.unwrap(bundle.bundleIdentifier) : appPath
    if (seen[bundleId]) continue
    seen[bundleId] = true
    const name = ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(url.path))
    applications.push({
      id: bundleId,
      name,
      path: appPath,
      isDefault: appPath === defaultPath
    })
  }
  return JSON.stringify({
    defaultApplicationId: applications.find((item) => item.isDefault)?.id,
    applications
  })
}
`

const WINDOWS_HELPER = 'windows-open-with.txt'

const getResourcePath = (fileName: string): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'open-with', fileName)
    : path.join(process.cwd(), 'resources', 'open-with', fileName)

const parseJson = <T>(raw: string): T => JSON.parse(raw.trim()) as T

export class OpenWithService {
  private readonly handlerCache = new Map<
    string,
    { applications: NativeOpenWithApplication[]; expiresAt: number }
  >()

  constructor(private readonly options: OpenWithServiceOptions = {}) {}

  async list(filePath: string): Promise<ListOpenWithApplicationsResponse> {
    const rawPath = String(filePath || '').trim()
    if (!rawPath) return { success: false, applications: [], error: 'path is required' }
    const resolvedPath = path.resolve(rawPath)
    try {
      const stat = await fs.stat(resolvedPath)
      if (!stat.isFile()) return { success: false, applications: [], error: 'path is not a file' }
      const native = await (this.options.runNativeList?.(resolvedPath) ??
        this.runNativeList(resolvedPath))
      if (native.error) return { success: false, applications: [], error: native.error }
      const applications = await Promise.all(
        (native.applications || []).map(
          async (item): Promise<OpenWithApplication> => ({
            id: item.id,
            name: item.name,
            iconDataUrl: item.path
              ? await (this.options.getIconDataUrl?.(item.path) ?? this.getIconDataUrl(item.path))
              : undefined,
            isDefault: Boolean(item.isDefault)
          })
        )
      )
      const normalized = applications
        .filter(
          (item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index
        )
        .sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
      this.handlerCache.set(resolvedPath, {
        applications: native.applications || [],
        expiresAt: (this.options.now?.() ?? Date.now()) + OPEN_WITH_CACHE_TTL_MS
      })
      return {
        success: true,
        applications: normalized,
        defaultApplicationId: native.defaultApplicationId
      }
    } catch (error) {
      return {
        success: false,
        applications: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async open(filePath: string, applicationId: string): Promise<OpenFileWithApplicationResponse> {
    const rawPath = String(filePath || '').trim()
    const id = String(applicationId || '').trim()
    if (!rawPath || !id) return { success: false, error: 'filePath and applicationId are required' }
    const resolvedPath = path.resolve(rawPath)
    try {
      const stat = await fs.stat(resolvedPath)
      if (!stat.isFile()) return { success: false, error: 'path is not a file' }
      const cached = this.handlerCache.get(resolvedPath)
      const applications =
        cached && cached.expiresAt > (this.options.now?.() ?? Date.now())
          ? cached.applications
          : (await (this.options.runNativeList?.(resolvedPath) ?? this.runNativeList(resolvedPath)))
              .applications || []
      const application = applications.find((item) => item.id === id)
      if (!application)
        return { success: false, error: 'application is not available for this file' }
      return await (this.options.runNativeOpen?.(resolvedPath, application) ??
        this.runNativeOpen(resolvedPath, application))
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async getIconDataUrl(applicationPath: string): Promise<string | undefined> {
    try {
      const icon = await app.getFileIcon(applicationPath, { size: 'small' })
      const png = icon.toPNG()
      return png.length > 0 ? `data:image/png;base64,${png.toString('base64')}` : undefined
    } catch {
      return undefined
    }
  }

  private async runNativeList(filePath: string): Promise<NativeOpenWithListResponse> {
    if (process.platform === 'darwin') {
      const result = await execFileAsync('/usr/bin/osascript', [
        '-l',
        'JavaScript',
        '-e',
        MACOS_LIST_SCRIPT,
        '--',
        filePath
      ])
      return parseJson<NativeOpenWithListResponse>(result.stdout)
    }
    if (process.platform === 'win32') {
      const result = await this.runWindowsHelper('list', filePath)
      return parseJson<NativeOpenWithListResponse>(result.stdout)
    }
    return { applications: [], error: `open with is unsupported on ${os.platform()}` }
  }

  private async runNativeOpen(
    filePath: string,
    application: NativeOpenWithApplication
  ): Promise<NativeOpenWithResponse> {
    if (process.platform === 'darwin') {
      const result = await execFileAsync('/usr/bin/osascript', [
        '-l',
        'JavaScript',
        '-e',
        `ObjC['im' + 'port']('AppKit'); function run(argv) { const fileURL = $.NSURL.fileURLWithPath(argv[0]); const urls = $.NSArray.arrayWithObject(fileURL); const ok = $.NSWorkspace.sharedWorkspace.openURLsWithAppBundleIdentifierOptionsAdditionalEventParamDescriptorLaunchIdentifiers(urls, argv[2], $.NSWorkspaceLaunchDefault, null, null); return JSON.stringify({ success: Boolean(ok) }); }`,
        '--',
        filePath,
        application.path || '',
        application.id
      ])
      return parseJson<NativeOpenWithResponse>(result.stdout)
    }
    if (process.platform === 'win32') {
      const result = await this.runWindowsHelper('open', filePath, application.id)
      return parseJson<NativeOpenWithResponse>(result.stdout)
    }
    return { success: false, error: `open with is unsupported on ${os.platform()}` }
  }

  private async runWindowsHelper(
    mode: 'list' | 'open',
    filePath: string,
    applicationId = ''
  ): Promise<{ stdout: string; stderr: string }> {
    const env = {
      ...process.env,
      NCURATOR_OPEN_WITH_SCRIPT: getResourcePath(WINDOWS_HELPER),
      NCURATOR_OPEN_WITH_MODE: mode,
      NCURATOR_OPEN_WITH_FILE: filePath,
      NCURATOR_OPEN_WITH_APPLICATION: applicationId
    }
    const command =
      '& ([scriptblock]::Create([IO.File]::ReadAllText($env:NCURATOR_OPEN_WITH_SCRIPT))) -Mode $env:NCURATOR_OPEN_WITH_MODE -FilePath $env:NCURATOR_OPEN_WITH_FILE -ApplicationId $env:NCURATOR_OPEN_WITH_APPLICATION'
    return execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { env }
    )
  }
}
