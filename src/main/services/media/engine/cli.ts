import { readFile, mkdir, writeFile, access, rm, realpath, stat, lstat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium, type Page, type Browser } from 'playwright'
import {
  drawingFormatSchema,
  sceneManifestSchema,
  type SceneManifest,
  type DrawingFormat
} from './protocol'
import { mediaBinaries, runMediaProcess } from '../MediaProcess'
import { renderSvgImage } from './svg'

const ORIGIN = 'http://ncurator-drawing.local'
const mime: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}

const safeLocal = async (root: string, relative: string): Promise<string> => {
  const file = await realpath(path.resolve(root, relative))
  const boundary = await realpath(root)
  if (file !== boundary && !file.startsWith(boundary + path.sep))
    throw new Error('Scene resource escapes source directory')
  return file
}

/** Range responses stream local media rather than buffering entire videos per seek. */
const createSceneResources = async () => {
  const files = new Map<string, string>(),
    urls = new Map<string, string>(),
    token = randomUUID()
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method || '')) {
        response.writeHead(405).end()
        return
      }
      const file = files.get((request.url || '').split('?')[0])
      if (!file) {
        response.writeHead(404).end()
        return
      }
      const info = await stat(file)
      let start = 0,
        end = info.size - 1,
        status = 200
      const headers: Record<string, string> = {
        'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
      if (request.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.range)
        if (!match || (!match[1] && !match[2])) {
          response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end()
          return
        }
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]))
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= info.size
        ) {
          response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end()
          return
        }
        status = 206
        headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
      }
      headers['Content-Length'] = String(Math.max(0, end - start + 1))
      response.writeHead(status, headers)
      if (request.method === 'HEAD' || !info.size) {
        response.end()
        return
      }
      const stream = createReadStream(file, { start, end })
      response.once('close', () => stream.destroy())
      stream.once('error', () => response.destroy())
      stream.pipe(response)
    } catch {
      if (!response.headersSent) response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Scene resource server unavailable')
  const origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    grant: (file: string): string => {
      const existing = urls.get(file)
      if (existing) return existing
      const key = `/${token}/${randomUUID()}`
      files.set(key, file)
      const url = origin + key
      urls.set(file, url)
      return url
    },
    close: async (): Promise<void> => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

const prepareScene = async (
  page: Page,
  entryPath: string,
  server: Awaited<ReturnType<typeof createSceneResources>>
): Promise<SceneManifest> => {
  const manifestPath =
    path.extname(entryPath) === '.json'
      ? entryPath
      : path.join(path.dirname(entryPath), 'scene.json')
  const root = path.dirname(manifestPath)
  const manifest = sceneManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
  const entry = await safeLocal(root, manifest.entry)
  const resources: Record<string, string> = {}
  for (const [key, file] of Object.entries(manifest.resources))
    resources[key] = server.grant(await realpath(path.resolve(root, file)))
  const entryUrl = `/source/${path.relative(root, entry).split(path.sep).map(encodeURIComponent).join('/')}`
  const data = {
    canvas: manifest.canvas,
    durationSeconds: manifest.durationSeconds,
    resources,
    seed: manifest.seed
  }
  const staticSvg =
    path.extname(entry).toLowerCase() === '.svg'
      ? await renderSvgImage({
          svg: await readFile(entry, 'utf8'),
          outputPath: 'scene.png',
          fontPath: path.join(path.dirname(process.argv[1]), 'scene-sans.otf')
        })
      : undefined
  const sceneImport = staticSvg
    ? `const image=new Image();image.src='data:image/png;base64,${staticSvg.toString('base64')}';await image.decode();const scene={initialize:async({container})=>{image.style.cssText='width:100%;height:100%;object-fit:contain';container.append(image)},renderAt:async()=>{},dispose:async()=>image.remove()};`
    : `const scene=await import(${JSON.stringify(entryUrl)});`

  const html = `<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"@ncurator/drawing":"/sdk.mjs"}}</script><style>@font-face{font-family:NcuratorSceneSans;src:url(/scene-sans.otf)}html,body{margin:0;overflow:hidden;background:transparent}#stage{position:relative;width:${manifest.canvas.width}px;height:${manifest.canvas.height}px;overflow:hidden;font-family:NcuratorSceneSans,sans-serif}canvas{display:block}</style><div id="stage"></div><script type="module">try{${sceneImport}for(const key of ['initialize','renderAt','dispose'])if(typeof scene[key]!=='function')throw Error('Missing scene export '+key);await document.fonts.load('24px NcuratorSceneSans');await scene.initialize({...${JSON.stringify(data)},container:document.getElementById('stage')});await document.fonts.ready;window.drawingScene=scene;window.drawingReady=true}catch(error){window.drawingError=String(error.stack||error)}</script>`
  await page.route('**/*', async (route) => {
    try {
      const url = new URL(route.request().url())
      if (url.origin === server.origin) {
        await route.continue()
        return
      }
      if (url.origin !== ORIGIN) {
        await route.abort('blockedbyclient')
        return
      }
      if (url.pathname === '/') {
        await route.fulfill({ contentType: 'text/html', body: html })
        return
      }
      const local =
        url.pathname === '/scene-sans.otf'
          ? path.join(path.dirname(process.argv[1]), 'scene-sans.otf')
          : url.pathname === '/sdk.mjs'
            ? path.join(path.dirname(process.argv[1]), 'drawing-sdk.mjs')
            : await safeLocal(root, decodeURIComponent(url.pathname.replace(/^\/source\//u, '')))
      if (/\.(mp4|webm|mov|m4v|mkv)$/iu.test(local)) {
        await route.continue({ url: server.grant(local) })
        return
      }
      const bytes = await readFile(local)
      const range = route
        .request()
        .headers()
        ['range']?.match(/^bytes=(\d+)-(\d*)$/u)
      if (range) {
        const start = Number(range[1])
        const end = Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1)
        await route.fulfill({
          status: 206,
          contentType: mime[path.extname(local)] || 'application/octet-stream',
          headers: {
            'content-range': `bytes ${start}-${end}/${bytes.length}`,
            'accept-ranges': 'bytes'
          },
          body: bytes.subarray(start, end + 1)
        })
      } else
        await route.fulfill({
          contentType: mime[path.extname(local)] || 'application/octet-stream',
          body: bytes
        })
    } catch {
      await route.fulfill({ status: 404, body: 'Scene resource unavailable' })
    }
  })
  await page.setViewportSize({ width: manifest.canvas.width, height: manifest.canvas.height })
  await page.goto(ORIGIN, { waitUntil: 'load' })
  await page.waitForFunction('window.drawingReady || window.drawingError', undefined, {
    timeout: 60000
  })
  const error = await page.evaluate<string | undefined>('window.drawingError')
  if (error) throw new Error(error)
  return manifest
}

const capture = async (page: Page, seconds: number, opaque = false): Promise<Buffer> => {
  // This code executes in a different realm; keep it independent of Main obfuscation closures.
  await page.evaluate(
    `(async () => {
    await window.drawingScene.renderAt(${JSON.stringify(seconds)})
    await document.fonts.ready
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  })()`
  )
  return page.screenshot({ type: 'png', omitBackground: !opaque, animations: 'allow' })
}

export const runDrawingCli = async (argv = process.argv.slice(2)): Promise<void> => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      scene: { type: 'string' },
      media: { type: 'string' },
      times: { type: 'string' },
      out: { type: 'string' },
      format: { type: 'string' },
      at: { type: 'string' }
    }
  })
  const operation = positionals[0]
  if (
    !['frames', 'render'].includes(operation) ||
    !values.out ||
    Boolean(values.scene) === Boolean(values.media)
  )
    throw new Error(
      'Usage: frames (--scene entry | --media video) --times seconds --out directory; render --scene entry --format png|jpeg|webp|mp4|webm --out file [--at seconds]'
    )
  if (!path.isAbsolute(values.out)) throw new Error('Output must be an absolute path')
  if (!path.isAbsolute(values.scene || values.media || ''))
    throw new Error('Input must be an absolute path')
  if (operation === 'render' && !values.scene) throw new Error('Rendering requires --scene')
  const format = operation === 'render' ? drawingFormatSchema.parse(values.format) : undefined
  if (format) {
    const extension = path.extname(values.out).slice(1).toLowerCase()
    if (extension !== format && !(format === 'jpeg' && extension === 'jpg'))
      throw new Error('Output extension must match --format')
  }
  const binaries = mediaBinaries()
  if (operation === 'frames' && values.media) {
    const times = parseTimes(values.times)
    const info = JSON.parse(
      await runMediaProcess(binaries.ffprobe, [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        values.media
      ])
    ) as { format?: { duration?: string } }
    const duration = Number(info.format?.duration)
    if (!Number.isFinite(duration) || duration <= 0 || times.some((time) => time >= duration))
      throw new Error('Check time is outside media duration')
    const frames = await prepareFrames(values.out, times)
    for (const { timeSeconds: seconds, path: file } of frames) {
      await runMediaProcess(binaries.ffmpeg, [
        '-nostdin',
        '-v',
        'error',
        '-ss',
        String(seconds),
        '-i',
        values.media,
        '-frames:v',
        '1',
        '-n',
        file
      ])
      await access(file)
    }
    process.stdout.write(JSON.stringify({ frames }) + '\n')
    return
  }
  if (!values.scene) throw new Error('Rendering requires --scene')
  const endpoint = process.env.NCURATOR_DRAWING_CDP
  const marker = process.env.NCURATOR_DRAWING_MARKER
  if (!endpoint || !marker)
    throw new Error('Drawing CLI requires the running NCurator drawing host')
  const resourceServer = await createSceneResources()
  let browser: Browser | undefined
  let page: Page | undefined
  try {
    browser = await chromium.connectOverCDP(endpoint)
    const pages = browser.contexts().flatMap((context) => context.pages())
    page =
      pages.find((candidate) => candidate.url() === marker) ||
      (pages.length === 1 ? pages[0] : undefined)
    if (!page) throw new Error('Drawing target is unavailable')
    const manifest = await prepareScene(page, values.scene, resourceServer)
    if (operation === 'frames') {
      const times = parseTimes(values.times)
      if (times.some((time) => time >= manifest.durationSeconds))
        throw new Error('Check time is outside scene duration')
      const frames = await prepareFrames(values.out, times)
      for (const { timeSeconds: seconds, path: file } of frames) {
        await writeFile(file, await capture(page, seconds), { flag: 'wx' })
      }
      process.stdout.write(JSON.stringify({ frames }) + '\n')
    } else {
      await renderOutput(
        page,
        manifest,
        values.out,
        Number(values.at || 0),
        binaries.ffmpeg,
        format!
      )
      const scenePath =
        path.extname(values.scene) === '.json'
          ? values.scene
          : path.join(path.dirname(values.scene), 'scene.json')
      const result = { scenePath: await realpath(scenePath), outputPath: values.out }
      if (process.env.NCURATOR_DRAWING_RECEIPT) {
        const response = await fetch(process.env.NCURATOR_DRAWING_RECEIPT, {
          method: 'POST',
          body: JSON.stringify(result),
          signal: AbortSignal.timeout(10000)
        })
        if (!response.ok) throw new Error(`成品已生成，但文件登记失败：${await response.text()}`)
      }
      process.stdout.write(JSON.stringify(result) + '\n')
    }
  } finally {
    await page?.evaluate('(async () => { await window.drawingScene?.dispose() })()').catch(() => {})
    await page?.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
    await browser?.close().catch(() => {})
    await resourceServer.close()
  }
}

const prepareFrames = async (directory: string, times: number[]) => {
  const frames = times.map((timeSeconds, index) => ({
    timeSeconds,
    path: path.join(directory, `${index}-${timeSeconds.toFixed(3)}.png`)
  }))
  for (const { path: file } of frames) {
    const exists = await lstat(file).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      }
    )
    if (exists) throw new Error(`Output already exists: ${file}`)
  }
  await mkdir(directory, { recursive: true })
  return frames
}

const parseTimes = (raw?: string): number[] => {
  if (!raw) throw new Error('--times requires a comma-separated list of seconds')
  const parts = raw.split(',')
  if (parts.some((part) => !part.trim())) throw new Error('Invalid check time')
  const times = parts.map(Number)
  if (times.some((time) => !Number.isFinite(time) || time < 0))
    throw new Error('Invalid check time')
  return times
}

const renderOutput = async (
  page: Page,
  manifest: SceneManifest,
  output: string,
  at: number,
  ffmpeg: string,
  format: DrawingFormat
): Promise<void> => {
  if (!Number.isFinite(at) || at < 0 || at >= manifest.durationSeconds)
    throw new Error('Invalid still time')
  if (
    await access(output).then(
      () => true,
      () => false
    )
  )
    throw new Error('Output already exists; choose a new version path')
  const extension = '.' + format
  await mkdir(path.dirname(output), { recursive: true })
  const temporary = path.join(path.dirname(output), `.${randomUUID()}.part${extension}`)
  try {
    if (extension === '.png') await writeFile(temporary, await capture(page, at))
    else {
      const movie = extension === '.mp4' || extension === '.webm'
      const encoder = spawn(
        ffmpeg,
        [
          '-nostdin',
          '-v',
          'error',
          '-f',
          'image2pipe',
          '-framerate',
          String(manifest.canvas.fps),
          '-i',
          'pipe:0',
          ...(movie
            ? extension === '.webm'
              ? [
                  '-c:v',
                  'libvpx-vp9',
                  '-pix_fmt',
                  'yuva420p',
                  '-auto-alt-ref',
                  '0',
                  '-lossless',
                  '1'
                ]
              : [
                  '-vf',
                  'pad=ceil(iw/2)*2:ceil(ih/2)*2:color=white',
                  '-c:v',
                  'libx264',
                  '-pix_fmt',
                  'yuv420p',
                  '-crf',
                  '18',
                  '-movflags',
                  '+faststart'
                ]
            : ['-frames:v', '1']),
          '-threads',
          '2',
          '-y',
          temporary
        ],
        { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }
      )
      let stderr = ''
      encoder.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk).slice(-8000)
      })
      const completed = new Promise<void>((resolve, reject) => {
        encoder.once('error', reject)
        encoder.once('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`Drawing encoder ${code}: ${stderr}`))
        )
      })
      // Observe encoder failures even while waiting on browser rendering/backpressure.
      void completed.catch(() => {})
      encoder.stdin.on('error', () => {})
      try {
        const frames = movie ? Math.ceil(manifest.durationSeconds * manifest.canvas.fps) : 1
        for (let frame = 0; frame < frames; frame++) {
          if (encoder.exitCode !== null) throw new Error(`Drawing encoder exited: ${stderr}`)
          if (
            !encoder.stdin.write(
              await capture(
                page,
                movie ? frame / manifest.canvas.fps : at,
                ['.jpg', '.jpeg', '.mp4'].includes(extension)
              )
            )
          )
            await once(encoder.stdin, 'drain')
        }
        encoder.stdin.end()
        await completed
      } finally {
        if (encoder.exitCode === null) encoder.kill('SIGKILL')
      }
    }
    // link publishes without overwriting a concurrent creator, even on POSIX.
    const { link } = await import('node:fs/promises')
    await link(temporary, output)
  } finally {
    await rm(temporary, { force: true })
  }
}

void runDrawingCli().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
