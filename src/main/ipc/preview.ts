import { app, ipcMain, protocol, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
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
  const channels = [
    'preview-html-open',
    'preview-resource-release',
    'preview-video-open',
    'preview-video-get',
    'preview-video-convert'
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
    video.dispose()
    resources.dispose()
  }
}
