import { ipcMain, type BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import {
  DESKTOP_ACCOUNT_CHANGED, DESKTOP_ACCOUNT_COMMAND, type DesktopAccountSnapshot
} from '../../shared/desktopAccount'
import { getAppRuntime } from '../services/app/AppRuntime'
import { createDomesticDesktopAccount, type DesktopAccount } from '../services/officialApi/desktopAccount'

export function desktopProtocolLink(args: string[]) {
  const links = args.filter(value => /^ncurator:/i.test(value))
  if (links.length !== 1) return undefined
  const [link] = links
  return link === 'ncurator://open' || (link.startsWith('ncurator://auth/callback?') && link.length <= 512)
    ? link : undefined
}

export function registerDesktopAccount(currentWindow: () => BrowserWindow | undefined, rendererUrl?: string) {
  const entry = new URL(rendererUrl || pathToFileURL(join(__dirname, '../renderer/index.html')).href)
  function isAccountPage(value: string) {
    try {
      const url = new URL(value)
      return url.protocol === entry.protocol && url.host === entry.host && url.pathname === entry.pathname
    } catch { return false }
  }
  let account: DesktopAccount | undefined
  ipcMain.handle(DESKTOP_ACCOUNT_COMMAND, async (event, command: string): Promise<DesktopAccountSnapshot> => {
    const window = currentWindow()
    if (window?.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('desktop_account_forbidden')
    }
    if (!isAccountPage(event.senderFrame.url)) throw new Error('desktop_account_forbidden')
    if (getAppRuntime().distribution !== 'domestic') return { status: 'unsupported' }
    if (!['restore', 'begin', 'cancel', 'logout', 'profile', 'wallet', 'refresh-wallet'].includes(command)) throw new Error('desktop_account_invalid_command')
    try {
      account ??= createDomesticDesktopAccount(snapshot => {
        const contents = currentWindow()?.webContents
        if (!contents || contents.isDestroyed()) return
        const frame = contents.mainFrame
        if (isAccountPage(frame.url)) frame.send(DESKTOP_ACCOUNT_CHANGED, snapshot)
      })
    } catch {
      return { status: 'storage_unavailable' }
    }
    if (command === 'restore') return account.restore()
    if (command === 'profile') return account.readProfile()
    if (command === 'wallet' || command === 'refresh-wallet') return account.readWallet(command === 'refresh-wallet')
    if (command === 'cancel') void account.cancel()
    if (command === 'begin') {
      const snapshot = account.getSnapshot()
      const { status } = snapshot
      if (status === 'unavailable' && snapshot.userNo) return account.restore()
      if (status === 'authorizing') await account.reopenBrowser()
      else if (status !== 'signed_in' && status !== 'restoring' && status !== 'logout_incomplete') await account.begin().catch(() => {})
    }
    if (command === 'logout') await account.logout().catch(() => {})
    return account.getSnapshot()
  })
  return (link: string) => {
    if (link === 'ncurator://open') return
    void account?.acceptCallback(link).catch(() => {})
  }
}
