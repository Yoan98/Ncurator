import { MYSTERY_TOKEN_URL } from '../../../shared/constants'
import { buildDesktopAppGatewayHeaders, getDesktopAppSecret } from './appClient'

const REFRESH_SKEW_MS = 5 * 60_000

type CachedToken = {
  token: string
  expiresAt: number
}

let cached: CachedToken | null = null
let refreshPromise: Promise<string> | null = null

export const readJwtExpiryMs = (token: string): number | null => {
  const parts = String(token || '').trim().split('.')
  if (parts.length < 2) return null
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((parts[1].length + 3) % 4)
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { exp?: unknown }
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null
    return payload.exp * 1000
  } catch {
    return null
  }
}

const isFresh = (entry: CachedToken | null, now = Date.now()): entry is CachedToken => {
  if (!entry?.token) return false
  return entry.expiresAt - now > REFRESH_SKEW_MS
}

const remember = (token: string, expiresAt?: number): string => {
  const expiry = expiresAt && expiresAt > 0 ? expiresAt : readJwtExpiryMs(token) || Date.now() + 60 * 60_000
  cached = { token, expiresAt: expiry }
  return token
}

export const seedMysteryToken = (token: string): void => {
  const value = String(token || '').trim()
  if (!value) return
  if (isFresh(cached)) return
  const expiresAt = readJwtExpiryMs(value)
  if (!expiresAt || expiresAt - Date.now() <= REFRESH_SKEW_MS) return
  remember(value, expiresAt)
}

export const refreshMysteryToken = async (): Promise<string> => {
  if (refreshPromise) return await refreshPromise
  refreshPromise = (async () => {
    const secret = getDesktopAppSecret()
    if (!secret) {
      throw new Error('缺少桌面网关密钥，无法续期神秘模型凭证')
    }
    const body = ''
    const headers = {
      Accept: 'application/json',
      ...buildDesktopAppGatewayHeaders({
        method: 'POST',
        url: MYSTERY_TOKEN_URL,
        body
      })
    }
    const response = await fetch(MYSTERY_TOKEN_URL, {
      method: 'POST',
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) {
      throw new Error(`神秘模型取票失败（HTTP ${response.status}）`)
    }
    const payload = (await response.json()) as { token?: unknown; expiresAt?: unknown }
    const token = String(payload.token || '').trim()
    if (!token) throw new Error('神秘模型取票失败：响应无效')
    const expiresAt =
      typeof payload.expiresAt === 'string' ? Date.parse(payload.expiresAt) : readJwtExpiryMs(token)
    return remember(token, Number.isFinite(expiresAt) ? Number(expiresAt) : undefined)
  })()
  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

export const ensureMysteryToken = async (seedToken?: string): Promise<string> => {
  if (seedToken) seedMysteryToken(seedToken)
  if (isFresh(cached)) return cached.token
  return await refreshMysteryToken()
}
