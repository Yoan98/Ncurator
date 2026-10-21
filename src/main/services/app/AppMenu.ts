import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { productName } from '../../../shared/appPreferences'
import { getAppRuntime } from './AppRuntime'
import { mainText } from './i18n'

export const initializeAppMenu = (): void => {
  app.setAboutPanelOptions({
    applicationName: productName(getAppRuntime().locale),
    applicationVersion: app.getVersion()
  })
  const template: MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin')
    template.push({
      label: productName(getAppRuntime().locale),
      submenu: [
        { role: 'about', label: mainText('appAbout') },
        { type: 'separator' },
        { role: 'services', label: mainText('appServices') },
        { type: 'separator' },
        { role: 'hide', label: mainText('appHide') },
        { role: 'hideOthers', label: mainText('appHideOthers') },
        { role: 'unhide', label: mainText('appShowAll') },
        { type: 'separator' },
        { role: 'quit', label: mainText('appQuit') }
      ]
    })
  template.push(
    {
      label: mainText('menuEdit'),
      submenu: [
        { role: 'undo', label: mainText('undo') },
        { role: 'redo', label: mainText('redo') },
        { type: 'separator' },
        { role: 'cut', label: mainText('cut') },
        { role: 'copy', label: mainText('copy') },
        { role: 'paste', label: mainText('paste') },
        { role: 'selectAll', label: mainText('selectAll') }
      ]
    },
    {
      label: mainText('menuView'),
      submenu: [{ role: 'togglefullscreen', label: mainText('toggleFullscreen') }]
    },
    {
      label: mainText('menuWindow'),
      submenu: [
        { role: 'minimize', label: mainText('minimize') },
        { role: 'close', label: mainText('closeWindow') }
      ]
    }
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
