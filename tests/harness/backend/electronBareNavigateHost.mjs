import { app, BrowserWindow, WebContentsView } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const userDataPath = String(process.env.NCURATOR_TEST_NAV_USER_DATA_PATH || '').trim()
if (!userDataPath) {
  throw new Error('NCURATOR_TEST_NAV_USER_DATA_PATH is required')
}

app.setPath('userData', userDataPath)

const TARGET_HOST = 'epub.cnipa.gov.cn'
const PAGE_TOKEN = '中国专利公布公告'
const HTTP_URL = `http://${TARGET_HOST}/`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const emit = (payload) => {
  process.stdout.write(`NCURATOR_NAV_RESULT=${JSON.stringify(payload)}\n`)
}

const loadOnce = (contents, url, timeoutMs = 20_000) =>
  new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const cleanup = () => {
      clearTimeout(timer)
      contents.removeListener('did-fail-load', onFail)
      contents.removeListener('did-finish-load', onFinish)
    }
    const onFail = (_event, _code, description, _failedUrl, isMainFrame) => {
      if (!isMainFrame) return
      const text = String(description || '')
      if (text.includes('ERR_ABORTED')) return
      finish({ ok: false, code: text || 'ERR_FAILED', url: contents.getURL() })
    }
    const onFinish = () => {
      finish({ ok: true, code: '', url: contents.getURL(), title: contents.getTitle() })
    }
    const timer = setTimeout(
      () => finish({ ok: false, code: 'ERR_TIMED_OUT', url: contents.getURL() }),
      timeoutMs
    )
    contents.on('did-fail-load', onFail)
    contents.on('did-finish-load', onFinish)
    contents.loadURL(url).catch((error) => {
      finish({ ok: false, code: error instanceof Error ? error.message : String(error), url })
    })
  })

const waitForToken = async (contents, timeoutMs = 35_000) => {
  const deadline = Date.now() + timeoutMs
  let title = contents.getTitle()
  let bodyText = ''
  while (Date.now() < deadline) {
    title = contents.getTitle()
    try {
      bodyText = String(
        await contents.executeJavaScript(`((document.body && document.body.innerText) || '').slice(0, 800)`)
      )
    } catch {
      bodyText = ''
    }
    if (title.includes(PAGE_TOKEN) || bodyText.includes(PAGE_TOKEN)) {
      return { title, bodyText }
    }
    await sleep(300)
  }
  return { title, bodyText }
}

app.whenReady().then(async () => {
  const hostWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:ncurator-browser',
      sandbox: true
    }
  })
  hostWindow.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 1280, height: 800 })

  const last = await loadOnce(view.webContents, HTTP_URL)
  const document = last.ok ? await waitForToken(view.webContents) : { title: last.title || '', bodyText: '' }
  emit({
    ok: last.ok && (document.title.includes(PAGE_TOKEN) || document.bodyText.includes(PAGE_TOKEN)),
    url: view.webContents.getURL(),
    title: document.title || view.webContents.getTitle(),
    bodyText: document.bodyText.slice(0, 240),
    hasRemoteDebuggingPort: app.commandLine.hasSwitch('remote-debugging-port'),
    hasDevToolsActivePort: existsSync(join(app.getPath('userData'), 'DevToolsActivePort'))
  })
  app.quit()
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})
