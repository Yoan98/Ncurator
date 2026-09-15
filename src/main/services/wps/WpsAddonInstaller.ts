import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WPS_ADDON_FILES, WPS_ADDON_NAME } from './constants'
import { mergePublishXml, toAddonFileUrl } from './publishXml'

export type WpsAddonInstallResult = {
  installed: boolean
  addonDir?: string
  jsAddonsDir?: string
  reason?: string
}

export type WpsAddonInstallerLike = {
  install: () => Promise<WpsAddonInstallResult>
  writePort: (port: number) => Promise<void>
}

export type WpsAddonInstallerOptions = {
  platform?: NodeJS.Platform
  homedir?: string
  env?: NodeJS.ProcessEnv
  addonSourceDir: string
  jsAddonsDir?: string
}

const directoryExists = (value: string): boolean => {
  try {
    return fs.existsSync(value) && fs.statSync(value).isDirectory()
  } catch {
    return false
  }
}

export const resolveWpsJsAddonsDir = (options: {
  platform?: NodeJS.Platform
  homedir?: string
  env?: NodeJS.ProcessEnv
  jsAddonsDir?: string
}): string | undefined => {
  if (options.jsAddonsDir) return options.jsAddonsDir
  const platform = options.platform ?? process.platform
  const homedir = options.homedir ?? os.homedir()
  const env = options.env ?? process.env

  if (platform === 'darwin') {
    const sandbox = path.join(
      homedir,
      'Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons'
    )
    if (directoryExists(sandbox) || directoryExists(path.dirname(sandbox))) return sandbox
    const legacy = path.join(homedir, '.kingsoft/wps/jsaddons')
    if (directoryExists(legacy) || directoryExists(path.dirname(legacy))) return legacy
    return undefined
  }

  if (platform === 'win32') {
    const appData = String(env.APPDATA || '').trim()
    if (!appData) return undefined
    const dir = path.join(appData, 'kingsoft', 'wps', 'jsaddons')
    if (directoryExists(dir) || directoryExists(path.dirname(dir))) return dir
    return undefined
  }

  return undefined
}

export class WpsAddonInstaller implements WpsAddonInstallerLike {
  private addonDir: string | undefined

  public constructor(private readonly options: WpsAddonInstallerOptions) {}

  public async install(): Promise<WpsAddonInstallResult> {
    const jsAddonsDir = resolveWpsJsAddonsDir(this.options)
    if (!jsAddonsDir) {
      return { installed: false, reason: 'wps-jsaddons-missing' }
    }
    if (!directoryExists(this.options.addonSourceDir)) {
      return { installed: false, jsAddonsDir, reason: 'addon-source-missing' }
    }

    const addonDir = path.join(jsAddonsDir, WPS_ADDON_NAME)
    await fsp.mkdir(addonDir, { recursive: true })
    await fsp.mkdir(jsAddonsDir, { recursive: true })
    for (const fileName of WPS_ADDON_FILES) {
      await fsp.copyFile(
        path.join(this.options.addonSourceDir, fileName),
        path.join(addonDir, fileName)
      )
    }

    const publishPath = path.join(jsAddonsDir, 'publish.xml')
    const existing = await fsp.readFile(publishPath, 'utf8').catch(() => '')
    if (existing) {
      await fsp.writeFile(`${publishPath}.ncurator-backup`, existing, 'utf8').catch(() => undefined)
    }
    await fsp.writeFile(publishPath, mergePublishXml(existing, toAddonFileUrl(addonDir)), 'utf8')
    this.addonDir = addonDir
    return { installed: true, addonDir, jsAddonsDir }
  }

  public async writePort(port: number): Promise<void> {
    if (!this.addonDir) return
    await fsp.writeFile(
      path.join(this.addonDir, 'port.json'),
      `${JSON.stringify({ port })}\n`,
      'utf8'
    )
  }
}
