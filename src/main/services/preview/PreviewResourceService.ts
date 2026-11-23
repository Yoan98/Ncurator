import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { PREVIEW_SCHEME, type PreviewResource } from '../../../shared/preview'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska'
}

type Grant = { filePath: string; htmlRoot?: string; mimeType?: string }

/** Opaque, revocable grants keep sandboxed documents inside their resource directory. */
export class PreviewResourceService {
  private readonly grants = new Map<string, Grant>()

  grantFile(filePath: string, mimeType?: string): PreviewResource {
    return this.grant({ filePath, mimeType })
  }

  async openHtml(filePath: string): Promise<PreviewResource> {
    const source = await realpath(filePath)
    if (!['.html', '.htm'].includes(path.extname(source).toLowerCase()))
      throw new Error('Unsupported HTML document')
    if (!(await stat(source)).isFile()) throw new Error('HTML document is unavailable')
    return this.grant({ filePath: source, htmlRoot: path.dirname(source) })
  }

  release(id: string): void {
    this.grants.delete(id)
  }
  dispose(): void {
    this.grants.clear()
  }

  private grant(grant: Grant): PreviewResource {
    const id = randomUUID()
    this.grants.set(id, grant)
    return {
      id,
      url: `${PREVIEW_SCHEME}://${id}/${encodeURIComponent(path.basename(grant.filePath))}`
    }
  }

  async handle(request: Request): Promise<Response> {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
      const url = new URL(request.url)
      const grant = this.grants.get(url.hostname)
      if (!grant) return new Response(null, { status: 404 })
      const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const filePath = grant.htmlRoot
        ? await realpath(path.resolve(grant.htmlRoot, requestedPath))
        : grant.filePath
      if (grant.htmlRoot) {
        const relative = path.relative(grant.htmlRoot, filePath)
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          return new Response(null, { status: 403 })
      } else if (requestedPath !== path.basename(filePath))
        return new Response(null, { status: 404 })

      const info = await stat(filePath)
      if (!info.isFile()) return new Response(null, { status: 404 })
      const headers = new Headers({
        'Content-Type':
          grant.mimeType ||
          CONTENT_TYPES[path.extname(filePath).toLowerCase()] ||
          'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff'
      })
      if (grant.htmlRoot) {
        headers.set(
          'Content-Security-Policy',
          `default-src 'self' ${PREVIEW_SCHEME}: https: data: blob:; script-src 'self' ${PREVIEW_SCHEME}: https: 'unsafe-inline' 'unsafe-eval'; style-src 'self' ${PREVIEW_SCHEME}: https: 'unsafe-inline'; connect-src 'self' ${PREVIEW_SCHEME}: https:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'`
        )
      }
      let start = 0
      let end = info.size - 1
      let status = 200
      const range = request.headers.get('range')
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match || (!match[1] && !match[2])) {
          headers.set('Content-Range', `bytes */${info.size}`)
          return new Response(null, { status: 416, headers })
        }
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]))
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= info.size
        ) {
          headers.set('Content-Range', `bytes */${info.size}`)
          return new Response(null, { status: 416, headers })
        }
        status = 206
        headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`)
      }
      headers.set('Content-Length', String(Math.max(0, end - start + 1)))
      if (request.method === 'HEAD' || info.size === 0)
        return new Response(null, { status, headers })
      const stream = createReadStream(filePath, { start, end })
      const abort = (): void => {
        stream.destroy()
      }
      request.signal.addEventListener('abort', abort, { once: true })
      stream.once('close', () => request.signal.removeEventListener('abort', abort))
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
    } catch {
      return new Response(null, { status: 404 })
    }
  }
}
