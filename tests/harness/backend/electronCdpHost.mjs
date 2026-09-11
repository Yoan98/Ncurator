import { app, BrowserWindow, WebContentsView } from 'electron'

const userDataPath = String(process.env.NCURATOR_TEST_CDP_USER_DATA_PATH || '').trim()
if (!userDataPath) {
  throw new Error('NCURATOR_TEST_CDP_USER_DATA_PATH is required')
}

app.setPath('userData', userDataPath)
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
app.commandLine.appendSwitch('remote-debugging-port', '0')

let hostWindow
let crawlerView

app.whenReady().then(async () => {
  hostWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  await hostWindow.loadURL('about:blank')
  crawlerView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'ncurator-web-crawler-test',
      sandbox: true
    }
  })
  await crawlerView.webContents.loadURL('about:blank#ncurator-web-crawler-test')
})

const quit = () => app.quit()
process.on('SIGINT', quit)
process.on('SIGTERM', quit)

app.on('window-all-closed', (event) => {
  event.preventDefault()
})
