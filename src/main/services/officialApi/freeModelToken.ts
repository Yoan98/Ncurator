import { officialApiUrl, routeForOfficialUrl } from '../../../shared/appPreferences'
import { getAppRuntime } from '../app/AppRuntime'
import { buildDesktopAppGatewayHeaders, getDesktopAppSecret } from './appClient'

const REFRESH_SKEW_MS = 5 * 60_000

type CachedToken = {
  token: string
  expiresAt: number
}

const cached = new Map<string, CachedToken>()
const refreshPromises = new Map<string, Promise<string>>()

export const readJwtExpiryMs = (token: string): number | null => {
  const parts = String(token || '')
    .trim()
    .split('.')
  if (parts.length < 2) return null
  try {
    const padded =
      parts[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((parts[1].length + 3) % 4)
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { exp?: unknown }
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null
    return payload.exp * 1000
  } catch {
    return null
  }
}

const isFresh = (entry: CachedToken | null | undefined, now = Date.now()): entry is CachedToken => {
  if (!entry?.token) return false
  return entry.expiresAt - now > REFRESH_SKEW_MS
}

const remember = (origin: string, token: string, expiresAt?: number): string => {
  const expiry =
    expiresAt && expiresAt > 0 ? expiresAt : readJwtExpiryMs(token) || Date.now() + 60 * 60_000
  cached.set(origin, { token, expiresAt: expiry })
  return token
}

export const seedFreeModelToken = (
  token: string,
  origin = officialApiUrl(getAppRuntime().distribution, '')
): void => {
  const value = String(token || '').trim()
  if (!value) return
  if (isFresh(cached.get(origin))) return
  const expiresAt = readJwtExpiryMs(value)
  if (!expiresAt || expiresAt - Date.now() <= REFRESH_SKEW_MS) return
  remember(origin, value, expiresAt)
}

export const refreshFreeModelToken = async (
  origin = officialApiUrl(getAppRuntime().distribution, '')
): Promise<string> => {
  if (routeForOfficialUrl(origin) !== getAppRuntime().distribution || new URL(origin).origin !== origin)
    throw new Error('免费模型取票地址无效')
  const pending = refreshPromises.get(origin)
  if (pending) return await pending
  const tokenUrl = new URL('/api/v1/free/token', origin).href
  const refreshPromise = (async () => {
    const secret = getDesktopAppSecret()
    if (!secret) {
      throw new Error('缺少桌面网关密钥，无法续期免费模型凭证')
    }
    const body = ''
    const headers = {
      Accept: 'application/json',
      ...buildDesktopAppGatewayHeaders({
        method: 'POST',
        url: tokenUrl,
        body
      })
    }
    const response = await fetch(tokenUrl, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) {
      throw new Error(`免费模型取票失败（HTTP ${response.status}）`)
    }
    const payload = (await response.json()) as { token?: unknown; expiresAt?: unknown }
    const token = String(payload.token || '').trim()
    if (!token) throw new Error('免费模型取票失败：响应无效')
    const expiresAt =
      typeof payload.expiresAt === 'string' ? Date.parse(payload.expiresAt) : readJwtExpiryMs(token)
    return remember(origin, token, Number.isFinite(expiresAt) ? Number(expiresAt) : undefined)
  })()
  refreshPromises.set(origin, refreshPromise)
  try {
    return await refreshPromise
  } finally {
    refreshPromises.delete(origin)
  }
}

export const ensureFreeModelToken = async (
  seedToken?: string,
  origin = officialApiUrl(getAppRuntime().distribution, '')
): Promise<string> => {
  if (seedToken) seedFreeModelToken(seedToken, origin)
  const entry = cached.get(origin)
  if (isFresh(entry)) return entry.token
  return await refreshFreeModelToken(origin)
}
