import { isFreeModelApiUrl } from '../../../shared/freeModels'
import { createHmac, createHash, randomUUID } from 'node:crypto'

export const APP_CLIENT_HEADER = 'x-ncurator-client'
export const APP_TIMESTAMP_HEADER = 'x-ncurator-timestamp'
export const APP_NONCE_HEADER = 'x-ncurator-nonce'
export const APP_SIGNATURE_HEADER = 'x-ncurator-signature'

export const getDesktopAppSecret = (): string =>
  String(process.env.NCURATOR_APP_SECRET_DESKTOP || '').trim()

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')

export const buildAppGatewaySignaturePayload = (input: {
  method: string
  path: string
  timestamp: string
  nonce: string
  body: string
}): string =>
  [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    sha256Hex(input.body)
  ].join('\n')

export const buildDesktopAppGatewayHeaders = (input: {
  method: string
  url: string
  body?: string
}): Record<string, string> => {
  const secret = getDesktopAppSecret()
  if (!secret) return {}
  let path = '/'
  try {
    path = new URL(input.url).pathname
  } catch {
    return {}
  }
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomUUID()
  const body = input.body || ''
  const payload = buildAppGatewaySignaturePayload({
    method: input.method,
    path,
    timestamp,
    nonce,
    body
  })
  const signature = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
  return {
    [APP_CLIENT_HEADER]: 'desktop',
    [APP_TIMESTAMP_HEADER]: timestamp,
    [APP_NONCE_HEADER]: nonce,
    [APP_SIGNATURE_HEADER]: signature
  }
}

const readRequestBody = async (request: Request): Promise<string> => {
  if (request.method === 'GET' || request.method === 'HEAD') return ''
  const buffer = await request.clone().arrayBuffer()
  if (buffer.byteLength === 0) return ''
  return Buffer.from(buffer).toString('utf8')
}

export const createFreeModelFetch = (): typeof fetch => {
  const signedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = request.url
    if (!isFreeModelApiUrl(url)) throw new Error('免费模型调用地址无效')
    const method = request.method
    const body = await readRequestBody(request)
    const headers = new Headers(request.headers)
    headers.delete('content-length')
    headers.delete('host')

    const { ensureFreeModelToken } = await import('./freeModelToken')
    headers.set('Authorization', `Bearer ${await ensureFreeModelToken()}`)

    const signedHeaders = buildDesktopAppGatewayHeaders({ method, url, body })
    for (const [key, value] of Object.entries(signedHeaders)) {
      headers.set(key, value)
    }

    const execute = async (): Promise<Response> =>
      await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        signal: request.signal
      })

    let response = await execute()
    if (response.status === 401) {
      await response.body?.cancel()
      const { refreshFreeModelToken } = await import('./freeModelToken')
      const token = await refreshFreeModelToken()
      headers.set('Authorization', `Bearer ${token}`)
      const retryHeaders = buildDesktopAppGatewayHeaders({ method, url, body })
      for (const [key, value] of Object.entries(retryHeaders)) {
        headers.set(key, value)
      }
      response = await execute()
    }
    return response
  }
  return signedFetch
}
