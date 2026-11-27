import { app, ipcMain, protocol, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { brotliDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import ffmpeg from 'ffmpeg-static'
import ffprobe from '@ffprobe-installer/ffprobe'
import { z } from 'zod'
import { PREVIEW_SCHEME } from '../../shared/preview'
import { PreviewResourceService } from '../services/preview/PreviewResourceService'
import { VideoPreviewService } from '../services/preview/VideoPreviewService'

/** Registers before app.ready so child frames and media use standard URL semantics. */
export const registerPreviewScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'ncurator-editor',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    },
    {
      scheme: PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}

export const registerPreviewHandlers = (
  getWindow: () => BrowserWindow | undefined
): (() => void) => {
  const resources = new PreviewResourceService()
  const unpack = (file: string): string => file.replace(/app\.asar([\\/])/u, 'app.asar.unpacked$1')
  const video = new VideoPreviewService({
    resources,
    cacheDirectory: path.join(app.getPath('userData'), 'preview-cache', 'video'),
    ffmpegPath: unpack(ffmpeg || ''),
    ffprobePath: unpack(ffprobe.path)
  })
  void video
    .pruneCache()
    .catch((error) => console.error('[VIDEO-PREVIEW] cache cleanup failed:', error))
  protocol.handle(PREVIEW_SCHEME, (request) => resources.handle(request))
  const editorDir = path.join(
    app.getAppPath(),
    process.env.ELECTRON_RENDERER_URL && !app.isPackaged ? 'src/renderer/public' : 'out/renderer',
    'superdoc'
  )
  const decompress = promisify(brotliDecompress)
  protocol.handle('ncurator-editor', async (request) => {
    const url = new URL(request.url)
    if (
      url.hostname !== 'superdoc' ||
      !/^\/(?:editor|assets\/[a-zA-Z0-9_.-]+)\.js$/.test(url.pathname)
    )
      return new Response(null, { status: 404 })
    try {
      const bytes = await decompress(
        await readFile(path.join(editorDir, url.pathname.slice(1) + '.br'))
      )
      return new Response(Uint8Array.from(bytes), {
        headers: { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' }
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
  const channels = [
    'preview-html-open',
    'preview-resource-release',
    'preview-video-open',
    'preview-video-get',
    'preview-video-convert',
    'preview-video-frames',
    'preview-video-freeze'
  ]
  const assertSender = (event: IpcMainInvokeEvent): void => {
    const window = getWindow()
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new Error('Preview requests require the application main frame')
    }
  }
  ipcMain.handle(channels[0], async (event, source: string) => {
    assertSender(event)
    return resources.openHtml(z.string().min(1).parse(source))
  })
  ipcMain.handle(channels[1], (event, id: string) => {
    assertSender(event)
    const resourceId = z.string().uuid().parse(id)
    video.release(resourceId)
    resources.release(resourceId)
  })
  ipcMain.handle(channels[2], async (event, request: { source: string }) => {
    assertSender(event)
    const payload = z.object({ source: z.string().min(1) }).parse(request)
    return video.open(payload.source)
  })
  ipcMain.handle(channels[3], (event, id: string) => {
    assertSender(event)
    return video.get(z.string().uuid().parse(id))
  })
  ipcMain.handle('preview-video-frames', async (event, id: string) => {
    assertSender(event)
    return video.frames(z.string().uuid().parse(id))
  })
  ipcMain.handle(
    'preview-video-freeze',
    async (event, request: { id: string; partnerId: string }) => {
      assertSender(event)
      const input = z
        .object({ id: z.string().uuid(), partnerId: z.string().regex(/^[a-zA-Z0-9_-]+$/) })
        .strict()
        .parse(request)
      return video.freezeVersion(input.id, input.partnerId)
    }
  )
  ipcMain.handle(channels[4], (event, request: { id: string; forceTranscode?: boolean }) => {
    assertSender(event)
    const payload = z
      .object({ id: z.string().uuid(), forceTranscode: z.boolean().optional() })
      .parse(request)
    return video.convert(payload.id, payload.forceTranscode)
  })
  return () => {
    channels.forEach((channel) => ipcMain.removeHandler(channel))
    protocol.unhandle(PREVIEW_SCHEME)
    protocol.unhandle('ncurator-editor')
    video.dispose()
    resources.dispose()
  }
}
