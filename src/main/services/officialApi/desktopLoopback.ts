import { createServer } from 'node:http'
import type { AppLocale } from '../../../shared/appPreferences'

const host = '127.0.0.1'
const path = '/auth/callback'

export type DesktopCallbackListener = (
  accept: (url: string) => Promise<string | undefined>
) => Promise<{ redirectUri: string; close: () => void }>

export async function listenForDesktopCallback(
  accept: Parameters<DesktopCallbackListener>[0],
  locale: AppLocale,
  onSuccess: () => void
) {
  let redirectUri = ''
  let authority = ''
  const server = createServer({ headersTimeout: 5_000, requestTimeout: 10_000, maxHeaderSize: 8_192 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    response.setHeader('Connection', 'close')
    const target = request.url
    if (request.method !== 'GET' || request.headers.host !== authority ||
        !target?.startsWith(path + '?') || target.length > 460) {
      response.writeHead(404).end()
      return
    }

    let success = false
    try {
      if (!await accept(redirectUri + target.slice(path.length))) {
        response.writeHead(400).end()
        return
      }
      success = true
    } catch {
      // Authorization and credential failures are already reflected in the desktop UI.
    }
    const title = locale === 'zh-CN'
      ? success ? '登录成功' : '未能完成登录'
      : success ? 'Signed in' : 'Could not complete sign-in'
    const detail = locale === 'zh-CN'
      ? success ? '可以返回馆长继续使用。' : '请返回馆长重新发起登录。'
      : success ? 'You can return to NCurator.' : 'Return to NCurator and try signing in again.'
    response.writeHead(success ? 200 : 409, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>${title}</title><h1>${title}</h1><p>${detail}</p></html>`)
    if (success) onSuccess()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('desktop_loopback_unavailable')
  }
  authority = host + ':' + address.port
  redirectUri = 'http://' + authority + path
  server.unref()
  return { redirectUri, close: () => { server.close() } }
}
