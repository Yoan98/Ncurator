import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const darwinAppCandidates = (): string[] => [
  '/Applications/wpsoffice.localized/wpsoffice.app',
  '/Applications/wpsoffice.app',
  '/Applications/WPS Office.app'
]

const uniqueExistingFiles = (candidates: readonly string[]): string[] => {
  const seen = new Set<string>()
  const files: string[] = []
  for (const candidate of candidates) {
    const value = String(candidate || '').trim()
    if (!value) continue
    const resolved = path.resolve(value)
    const key = resolved.toLowerCase()
    if (seen.has(key) || !fs.existsSync(resolved)) continue
    seen.add(key)
    files.push(resolved)
  }
  return files
}

const readWindowsRegistryValues = (key: string, valueName: string): string[] => {
  try {
    const raw = execFileSync('reg', ['query', key, '/v', valueName], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true
    })
    const pattern = new RegExp(`${valueName}\\s+REG_\\w+\\s+(.+)`, 'gi')
    return [...raw.matchAll(pattern)]
      .map((match) => match[1].trim().replace(/^"|"$/g, ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

const windowsInstallRoots = (): string[] => {
  const keys = [
    'HKLM\\Software\\Kingsoft\\Office\\6.0\\Common',
    'HKLM\\Software\\WOW6432Node\\Kingsoft\\Office\\6.0\\Common',
    'HKCU\\Software\\Kingsoft\\Office\\6.0\\Common'
  ]
  const roots: string[] = []
  const seen = new Set<string>()
  for (const key of keys) {
    for (const root of readWindowsRegistryValues(key, 'InstallRoot')) {
      const resolved = path.resolve(root)
      const normalized = resolved.toLowerCase()
      if (seen.has(normalized) || !fs.existsSync(resolved)) continue
      seen.add(normalized)
      roots.push(resolved)
    }
  }
  return roots
}

const windowsLauncherCandidates = (): string[] => {
  const localAppData = String(process.env.LOCALAPPDATA || '').trim()
  const programFiles = String(process.env.ProgramFiles || '').trim()
  const programFilesX86 = String(process.env['ProgramFiles(x86)'] || '').trim()
  const candidates = [
    localAppData ? path.join(localAppData, 'Kingsoft', 'WPS Office', 'ksolaunch.exe') : '',
    programFiles ? path.join(programFiles, 'Kingsoft', 'WPS Office', 'office6', 'wps.exe') : '',
    programFilesX86 ? path.join(programFilesX86, 'Kingsoft', 'WPS Office', 'office6', 'wps.exe') : ''
  ]
  for (const root of windowsInstallRoots()) {
    candidates.push(
      path.join(root, 'office6', 'ksolaunch.exe'),
      path.join(path.dirname(root), 'ksolaunch.exe'),
      path.join(root, 'office6', 'wps.exe')
    )
  }
  return uniqueExistingFiles(candidates)
}

const windowsOffice6Dirs = (): string[] => {
  const dirs: string[] = []
  const seen = new Set<string>()
  const addDir = (dir: string): void => {
    const resolved = path.resolve(dir)
    const key = resolved.toLowerCase()
    if (seen.has(key) || !fs.existsSync(path.join(resolved, 'wps.exe'))) return
    seen.add(key)
    dirs.push(resolved)
  }
  for (const root of windowsInstallRoots()) {
    addDir(path.join(root, 'office6'))
  }
  for (const launcher of windowsLauncherCandidates()) {
    const dir = path.dirname(launcher)
    if (path.basename(dir).toLowerCase() === 'office6') addDir(dir)
    else addDir(path.join(dir, 'office6'))
  }
  return dirs
}

const preferWindowsLauncher = (launchers: readonly string[]): string | undefined =>
  launchers.find((item) => path.basename(item).toLowerCase() === 'ksolaunch.exe') ?? launchers[0]

const exeNameForHost = (component: string, filePath = ''): string => {
  const host = component.toLowerCase()
  if (host === 'et') return 'et.exe'
  if (host === 'wpp') return 'wpp.exe'
  if (host === 'wps') return 'wps.exe'
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.xlsx' || ext === '.xlsm') return 'et.exe'
  if (ext === '.pptx' || ext === '.pptm') return 'wpp.exe'
  return 'wps.exe'
}

export const resolveWpsOfficeAppPath = (): string | undefined => {
  if (process.platform === 'darwin') {
    return darwinAppCandidates().find((candidate) => fs.existsSync(candidate))
  }
  if (process.platform === 'win32') {
    return preferWindowsLauncher(windowsLauncherCandidates())
  }
  return undefined
}

export const resolveWpsComponentExe = (component: string, filePath = ''): string | undefined => {
  if (process.platform !== 'win32') return undefined
  const exeName = exeNameForHost(component, filePath)
  for (const dir of windowsOffice6Dirs()) {
    const exe = path.join(dir, exeName)
    if (fs.existsSync(exe)) return exe
  }
  return undefined
}
