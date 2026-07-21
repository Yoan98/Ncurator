import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import electronPath from 'electron'
import { _electron as electron } from 'playwright'
import { cliArgs, promoRoot, resolveEpisode } from './lib.mjs'

const [selector, requestedName = 'app-frame'] = cliArgs()
const { name, episodeDir } = await resolveEpisode(selector)
const fileName = requestedName.replace(/[^a-zA-Z0-9_-]+/g, '-')
const repoRoot = path.resolve(promoRoot, '..')
const mainEntry = path.join(repoRoot, 'out', 'main', 'index.js')
const outputDir = path.join(episodeDir, 'assets', 'captured')
const outputPath = path.join(outputDir, `${fileName}.png`)

await access(mainEntry).catch(() => {
  throw new Error('找不到 out/main/index.js，请先运行 pnpm build 或 pnpm dev:no-sidecar')
})
await mkdir(outputDir, { recursive: true })

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'guan-zhang-promo-'))
const debuggingPort = await allocateFreePort()
const app = await electron.launch({
  executablePath: electronPath,
  args: [repoRoot],
  cwd: repoRoot,
  env: {
    ...process.env,
    NCURATOR_E2E_MODE: '1',
    NCURATOR_E2E_OBSERVER: '1',
    NCURATOR_E2E_WINDOW_MODE: 'background',
    NCURATOR_USER_DATA_PATH: userDataDir,
    NCURATOR_EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT: String(debuggingPort)
  }
})

try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.setBounds({ x: 40, y: 40, width: 1440, height: 900 })
  })

  const targetHash = String(process.env.PROMO_CAPTURE_HASH || '').trim()
  if (targetHash) {
    await page.evaluate((hash) => {
      window.location.hash = hash
    }, targetHash)
  }

  await page.waitForTimeout(Number(process.env.PROMO_CAPTURE_WAIT_MS || 1200))
  await page.screenshot({ path: outputPath, animations: 'disabled' })
  console.log(`已采集 ${name}：${outputPath}`)
} finally {
  await app.close()
  await rm(userDataDir, { recursive: true, force: true })
}

async function allocateFreePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('无法分配 Electron 调试端口')
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  return address.port
}
