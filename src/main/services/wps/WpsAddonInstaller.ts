import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { authAddinNeedsRewrite, mergeAuthAddin } from './authAddin'
import {
  WPS_ADDON_DIR_NAME,
  WPS_ADDON_NAME,
  WPS_ADDON_PORT_FILE,
  WPS_PREFERRED_SYNC_PORT
} from './constants'
import { mergePublishXml, publishXmlHasAddonUrl, toAddonLoopbackUrl } from './publishXml'

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
  public constructor(private readonly options: WpsAddonInstallerOptions) {}

  public async install(): Promise<WpsAddonInstallResult> {
    const jsAddonsDir = resolveWpsJsAddonsDir(this.options)
    if (!jsAddonsDir) {
      return { installed: false, reason: 'wps-jsaddons-missing' }
    }
    if (!directoryExists(this.options.addonSourceDir)) {
      return { installed: false, jsAddonsDir, reason: 'addon-source-missing' }
    }

    await fsp.mkdir(jsAddonsDir, { recursive: true })
    await this.removeOfflineAddonDirs(jsAddonsDir)
    await this.writeLoopbackRegistration(jsAddonsDir, WPS_PREFERRED_SYNC_PORT)
    return { installed: true, jsAddonsDir }
  }

  public async writePort(port: number): Promise<void> {
    const jsAddonsDir = resolveWpsJsAddonsDir(this.options)
    if (!jsAddonsDir) return
    await fsp.mkdir(jsAddonsDir, { recursive: true })
    await this.removeOfflineAddonDirs(jsAddonsDir)
    await this.writeLoopbackRegistration(jsAddonsDir, port)
  }

  private async writeLoopbackRegistration(jsAddonsDir: string, listenPort: number): Promise<void> {
    const addonUrl = toAddonLoopbackUrl(WPS_PREFERRED_SYNC_PORT)
    const publishPath = path.join(jsAddonsDir, 'publish.xml')
    const existingPublish = await fsp.readFile(publishPath, 'utf8').catch(() => '')
    if (!publishXmlHasAddonUrl(existingPublish, addonUrl)) {
      if (existingPublish) {
        await fsp.writeFile(`${publishPath}.ncurator-backup`, existingPublish, 'utf8').catch(() => undefined)
      }
      await fsp.writeFile(publishPath, mergePublishXml(existingPublish, addonUrl), 'utf8')
    }

    const authPath = path.join(jsAddonsDir, 'authaddin.json')
    const existingAuth = await fsp.readFile(authPath, 'utf8').catch(() => '')
    if (existingAuth && authAddinNeedsRewrite(existingAuth, addonUrl)) {
      await fsp.writeFile(`${authPath}.ncurator-backup`, existingAuth, 'utf8').catch(() => undefined)
      await fsp.writeFile(authPath, mergeAuthAddin(existingAuth, addonUrl), 'utf8')
    }

    await fsp.writeFile(
      path.join(jsAddonsDir, WPS_ADDON_PORT_FILE),
      `${JSON.stringify({ port: listenPort })}\n`,
      'utf8'
    )
    await fsp.rm(path.join(jsAddonsDir, 'jsaddinblockhost.ini'), { force: true })
  }

  private async removeOfflineAddonDirs(jsAddonsDir: string): Promise<void> {
    await Promise.all(
      [WPS_ADDON_DIR_NAME, WPS_ADDON_NAME].map((dirName) =>
        fsp.rm(path.join(jsAddonsDir, dirName), { recursive: true, force: true })
      )
    )
  }
}
