import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { safeStorage, shell } from 'electron'
import { officialUrl } from '../../../shared/appPreferences'
import type { DesktopAccountSnapshot, DesktopWallet } from '../../../shared/desktopAccount'
import { getUserDataPath } from '../../utils/userDataPath'
import { getAppRuntime } from '../app/AppRuntime'
import { buildDesktopAppGatewayHeaders } from './appClient'

const callbackUrl = 'ncurator://auth/callback'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const instanceUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const randomProof = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const siteOrigin = officialUrl('domestic', '')
type Route = 'start' | 'cancel' | 'exchange' | 'refresh' | 'logout' | 'receipt' | 'abandon'
type Receipt = 'saved' | 'storage_unavailable'
type Credentials = { userNo: string; refreshToken: string }
type CredentialStore = {
  read(): Credentials | null
  readForLogout(): Credentials | null
  block(): void
  save(value: Credentials): void
  clear(): void
}
type Dependencies = {
  store: CredentialStore
  post(route: Route, body?: object, bearer?: string): Promise<Record<string, unknown>>
  wallet(accessToken: string): Promise<Record<string, unknown>>
  profile(accessToken: string): Promise<Record<string, unknown>>
  managedCall(requestId: string, accessToken: string, signal?: AbortSignal): Promise<Record<string, unknown>>
  openBrowser(url: string): Promise<void>
  changed?(snapshot: DesktopAccountSnapshot): void
}
type Pending = { state: string; verifier: string; id?: string; url?: string; exchange?: Promise<string>; timeout?: ReturnType<typeof setTimeout> }

export class DesktopAccountError extends Error {
  constructor(readonly code: 'invalid_grant' | 'unavailable' | 'cancelled' | 'restart_authorization' |
    'storage_unavailable' | 'recovery_unavailable' | 'logout_incomplete') {
    super(code)
  }
}

function validCredentials(value: unknown): value is Credentials {
  if (!value || typeof value !== 'object') return false
  const { userNo, refreshToken } = value as Partial<Credentials>
  return typeof userNo === 'string' && uuid.test(userNo) && typeof refreshToken === 'string' &&
    refreshToken.length <= 4096 && jwt.test(refreshToken)
}

function validSessionResponse(value: Record<string, unknown>) {
  const { accessToken, expiresIn } = value
  if (!validCredentials(value) || typeof accessToken !== 'string' ||
    accessToken.length > 4096 || !jwt.test(accessToken) || expiresIn !== 3600)
    throw new DesktopAccountError('unavailable')
  return {
    stored: { userNo: value.userNo, refreshToken: value.refreshToken },
    access: { token: accessToken, expiresAt: Date.now() + 3600000 }
  }
}

function parseWallet(value: unknown): DesktopWallet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DesktopAccountError('unavailable')
  const { currency, version, available, balance, usageFrozen, refundFrozen, debt, settlementPending } = value as Record<string, unknown>
  const integer = (item: unknown): item is string =>
    typeof item === 'string' && /^(0|-?[1-9][0-9]{0,18})$/.test(item)
  const unsigned = (item: unknown): item is string => integer(item) && !item.startsWith('-')
  if (currency !== 'CNY' || !unsigned(version) || !integer(available) || !integer(balance) ||
    !unsigned(usageFrozen) || !unsigned(refundFrozen) || !unsigned(debt) || typeof settlementPending !== 'boolean')
    throw new DesktopAccountError('unavailable')
  return { currency, version, available, balance, usageFrozen, refundFrozen, debt, settlementPending }
}

export class DesktopAccount {
  private pending?: Pending
  private access?: { token: string; expiresAt: number }
  private refresh?: Promise<string>
  private generation = 0
  private walletRead?: Promise<DesktopAccountSnapshot>
  private walletReadAt = 0
  private restoreBlocked = false
  private snapshot: DesktopAccountSnapshot = { status: 'signed_out' }

  constructor(private readonly instanceId: string, private readonly deps: Dependencies) {
    if (!instanceUuid.test(instanceId)) throw new DesktopAccountError('unavailable')
  }

  getSnapshot(): DesktopAccountSnapshot {
    return this.snapshot
  }

  private publish(snapshot: DesktopAccountSnapshot) {
    this.snapshot = snapshot
    this.deps.changed?.(snapshot)
  }

  private clearPending(pending = this.pending) {
    if (!pending || this.pending !== pending) return
    clearTimeout(pending.timeout)
    this.pending = undefined
  }

  async restore() {
    if (this.pending || this.restoreBlocked || this.snapshot.status === 'signed_in') return this.snapshot
    const generation = this.generation
    try {
      const stored = this.deps.store.read()
      if (!stored) return this.snapshot
      if (this.snapshot.status !== 'restoring') this.publish({ status: 'restoring' })
      await this.accessToken()
    } catch (error) {
      if (generation === this.generation && this.snapshot.status === 'restoring') {
        this.publish({ status: error instanceof DesktopAccountError && error.code === 'invalid_grant'
          ? 'expired' : 'storage_unavailable' })
      } else if (generation === this.generation && this.snapshot.status === 'signed_out') {
        this.publish({ status: 'storage_unavailable' })
      }
    }
    return this.snapshot
  }

  async readProfile() {
    if (this.snapshot.status !== 'signed_in' &&
      (this.snapshot.status !== 'unavailable' || !this.snapshot.userNo)) return this.snapshot
    const generation = this.generation
    try {
      const token = await this.accessToken()
      if (generation !== this.generation || this.snapshot.status !== 'signed_in') return this.snapshot
      const userNo = this.snapshot.userNo
      const response = await this.deps.profile(token)
      if (generation !== this.generation || this.snapshot.status !== 'signed_in') return this.snapshot
      const { maskedEmail } = response
      if (response.userNo === userNo && (maskedEmail === null ||
        (typeof maskedEmail === 'string' && /^[^\s@]\*{3}@[^\s@]+$/.test(maskedEmail)))) {
        this.publish({ ...this.snapshot, maskedEmail })
      }
    } catch (error) {
      if (generation === this.generation && error instanceof DesktopAccountError && error.code === 'invalid_grant') {
        try { this.clearLocalSession() } catch { /* The current login remains blocked. */ }
        this.publish({ status: 'expired' })
      }
    }
    return this.snapshot
  }

  async readWallet(force = false): Promise<DesktopAccountSnapshot> {
    if (this.snapshot.status !== 'signed_in') return this.snapshot
    if (!force) {
      if (this.walletRead) return this.walletRead
      if (this.snapshot.wallet && !this.snapshot.walletStale && Date.now() - this.walletReadAt < 30_000) return this.snapshot
    }
    const { userNo, wallet: walletAtStart } = this.snapshot
    const generation = this.generation
    const current = () => this.walletRead === request && this.generation === generation &&
      this.snapshot.status === 'signed_in' && this.snapshot.userNo === userNo
    const request = (async () => {
      try {
        const token = await this.accessToken()
        if (!current()) return this.snapshot
        const wallet = parseWallet(await this.deps.wallet(token))
        if (current()) this.publishWallet(wallet)
      } catch (error) {
        if (current() && this.snapshot.status === 'signed_in') {
          if (error instanceof DesktopAccountError && error.code === 'invalid_grant') {
            try { this.clearLocalSession() } finally { this.publish({ status: 'expired' }) }
          } else if (this.snapshot.wallet === walletAtStart) {
            this.publish({ ...this.snapshot, walletStale: true })
          }
        }
      }
      return this.snapshot
    })().finally(() => { if (this.walletRead === request) this.walletRead = undefined })
    this.walletRead = request
    return request
  }

  private publishWallet(wallet: DesktopWallet) {
    if (this.snapshot.status !== 'signed_in') return
    const previous = this.snapshot.wallet
    if (previous && BigInt(wallet.version) < BigInt(previous.version)) return
    // Pending settlement can change before the wallet amounts and version change.
    if (previous?.version === wallet.version && (wallet.available !== previous.available ||
        wallet.balance !== previous.balance || wallet.usageFrozen !== previous.usageFrozen ||
        wallet.refundFrozen !== previous.refundFrozen || wallet.debt !== previous.debt)) return
    this.walletReadAt = Date.now()
    this.publish({ ...this.snapshot, wallet, walletStale: false })
  }

  managedCallScope() {
    if (this.snapshot.status !== 'signed_in') throw new DesktopAccountError('invalid_grant')
    const { userNo } = this.snapshot
    const generation = this.generation
    const assertCurrent = () => {
      if (this.generation !== generation || this.snapshot.status !== 'signed_in' || this.snapshot.userNo !== userNo)
        throw new DesktopAccountError('cancelled')
    }
    const accessToken = async (rejectedToken?: string) => {
      assertCurrent()
      if (rejectedToken && this.access?.token === rejectedToken) this.access = undefined
      const token = await this.accessToken()
      assertCurrent()
      return token
    }
    const applyWallet = (value: unknown) => {
      assertCurrent()
      this.publishWallet(parseWallet(value))
    }
    return {
      assertCurrent,
      accessToken,
      applyWallet,
      recover: async (requestId: string, signal?: AbortSignal) => {
        if (!instanceUuid.test(requestId)) throw new DesktopAccountError('unavailable')
        const token = await accessToken()
        const result = await this.deps.managedCall(requestId, token, signal)
        assertCurrent()
        const { status, executionStatus } = result
        if (status === 'settled') {
          if (executionStatus !== 'completed' && executionStatus !== 'cancelled' &&
              executionStatus !== 'failed' && executionStatus !== 'lost') throw new DesktopAccountError('unavailable')
          applyWallet(result.wallet)
          return { status, executionStatus } as const
        }
        if (status === 'accepted' || status === 'settlement_pending' || status === 'not_found') return { status } as const
        throw new DesktopAccountError('unavailable')
      }
    }
  }

  private context(pending: Pending) {
    return {
      flowId: pending.id,
      state: pending.state,
      instanceId: this.instanceId,
      redirectUri: callbackUrl,
      codeVerifier: pending.verifier
    }
  }

  async begin() {
    void this.cancel()
    this.generation++
    const pending = { state: randomBytes(32).toString('base64url'), verifier: randomBytes(32).toString('base64url') } as Pending
    this.pending = pending
    this.publish({ status: 'authorizing' })
    try {
      const response = await this.deps.post('start', {
        state: pending.state, instanceId: this.instanceId, redirectUri: callbackUrl,
        clientLabel: process.platform === 'darwin' ? '馆长桌面端 · macOS' : process.platform === 'win32' ? '馆长桌面端 · Windows' : '馆长桌面端',
        codeChallenge: createHash('sha256').update(pending.verifier, 'ascii').digest('base64url')
      })
      if (this.pending !== pending) throw new DesktopAccountError('cancelled')
      const { flowId, authorizationUrl, expiresIn } = response
      if (typeof flowId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(flowId) ||
        typeof authorizationUrl !== 'string' || expiresIn !== 600) throw new DesktopAccountError('unavailable')
      const url = new URL(authorizationUrl)
      const context = new URLSearchParams(url.hash.slice(1))
      if (url.origin !== siteOrigin || url.pathname !== '/desktop/authorize' || url.search || url.username || url.password ||
        context.get('flow') !== flowId || context.get('state') !== pending.state || [...context].length !== 2)
        throw new DesktopAccountError('unavailable')
      pending.id = flowId
      pending.url = url.href
      pending.timeout = setTimeout(() => {
        if (this.pending === pending && !pending.exchange) {
          this.clearPending(pending)
          this.publish({ status: 'expired' })
        }
      }, expiresIn * 1000)
      pending.timeout.unref()
      await this.deps.openBrowser(url.href)
      if (this.pending !== pending) throw new DesktopAccountError('cancelled')
    } catch (error) {
      if (this.pending === pending) {
        this.clearPending(pending)
        this.publish({ status: 'unavailable' })
      }
      if (error instanceof DesktopAccountError) throw error
      throw new DesktopAccountError('unavailable')
    }
  }

  async reopenBrowser() {
    if (this.pending?.url && !this.pending.exchange) await this.deps.openBrowser(this.pending.url)
  }

  acceptCallback(raw: string): Promise<string | undefined> {
    const pending = this.pending
    if (!pending?.id || raw.length > 512 || !raw.startsWith(callbackUrl + '?')) return Promise.resolve(undefined)
    let url: URL
    try { url = new URL(raw) } catch { return Promise.resolve(undefined) }
    const code = url.searchParams.get('code')
    if (!code || !randomProof.test(code) || url.searchParams.get('state') !== pending.state ||
      [...url.searchParams].length !== 2 || url.hash) return Promise.resolve(undefined)
    pending.exchange ??= this.exchange(pending, code)
    return pending.exchange
  }

  private async exchange(pending: Pending, code: string) {
    let session: ReturnType<typeof validSessionResponse>
    try {
      const response = await this.deps.post('exchange', { ...this.context(pending), code })
      if (this.pending !== pending) throw new DesktopAccountError('cancelled')
      session = validSessionResponse(response)
    } catch {
      void this.abandonExchange(pending)
      if (this.pending !== pending) throw new DesktopAccountError('cancelled')
      this.clearPending(pending)
      this.publish({ status: 'restart_authorization' })
      throw new DesktopAccountError('restart_authorization')
    }

    try {
      // Keep restoration blocked until the first credential is fully installed.
      this.deps.store.block()
      this.deps.store.save(session.stored)
    } catch {
      this.restoreBlocked = true
      try { this.deps.store.block() } catch { /* Local deletion and server revocation still follow. */ }
      try { this.deps.store.clear() } catch { /* The restore marker and server revocation protect a partial write. */ }
      this.clearPending(pending)
      this.publish({ status: 'storage_unavailable' })
      void this.reportReceipt(pending, session.access.token, 'storage_unavailable', this.generation, session.stored.refreshToken)
      throw new DesktopAccountError('storage_unavailable')
    }

    this.clearPending(pending)
    this.restoreBlocked = false
    const generation = ++this.generation
    this.refresh = undefined
    this.access = session.access
    this.publish({ status: 'signed_in', userNo: session.stored.userNo })
    void this.reportReceipt(pending, session.access.token, 'saved', generation)
    return session.stored.userNo
  }

  private async reportReceipt(pending: Pending, token: string, result: Receipt, generation: number, failedSessionToken?: string) {
    for (let attempt = 0; attempt < 2 && this.generation === generation; attempt++) {
      try {
        const response = await this.deps.post('receipt', { flowId: pending.id, result }, token)
        if (response.ok === true) return
      } catch {
        // A receipt response can be lost after the server records it. Retry only the receipt.
      }
    }
    if (failedSessionToken) {
      // The receipt window may have ended. This credential can revoke only the failed exchange's session.
      await this.deps.post('logout', undefined, failedSessionToken).catch(() => this.abandonExchange(pending))
    }
  }

  private async abandonExchange(pending: Pending) {
    if (pending.id) await this.deps.post('abandon', this.context(pending)).catch(() => {})
  }

  async cancel() {
    const pending = this.pending
    this.clearPending(pending)
    if (pending && this.snapshot.status === 'authorizing') this.publish({ status: 'signed_out' })
    if (pending?.id && !pending.exchange) {
      await this.deps.post('cancel', this.context(pending)).catch(() => {})
    }
  }

  accessToken(): Promise<string> {
    if (this.restoreBlocked) return Promise.reject(new DesktopAccountError('invalid_grant'))
    if (this.access && this.access.expiresAt > Date.now() + 30_000) return Promise.resolve(this.access.token)
    if (this.refresh) return this.refresh
    const generation = this.generation
    const refresh = this.rotate(generation).finally(() => {
      if (this.refresh === refresh) this.refresh = undefined
    })
    this.refresh = refresh
    return refresh
  }

  private async rotate(generation: number) {
    const stored = this.deps.store.read()
    if (!stored) throw new DesktopAccountError('invalid_grant')
    try {
      const response = await this.deps.post('refresh', undefined, stored.refreshToken)
      if (generation !== this.generation) throw new DesktopAccountError('cancelled')
      const session = validSessionResponse(response)
      if (session.stored.userNo !== stored.userNo) throw new DesktopAccountError('unavailable')
      this.deps.store.save(session.stored)
      this.access = session.access
      this.publish(this.snapshot.status === 'signed_in' && this.snapshot.userNo === session.stored.userNo
        ? this.snapshot : { status: 'signed_in', userNo: session.stored.userNo })
      return session.access.token
    } catch (error) {
      if (generation !== this.generation) throw new DesktopAccountError('cancelled')
      if (error instanceof DesktopAccountError && error.code === 'invalid_grant') {
        try { this.clearLocalSession() } finally { this.publish({ status: 'expired' }) }
      } else if (error instanceof DesktopAccountError && error.code === 'storage_unavailable') {
        this.publish({ status: 'storage_unavailable' })
      } else {
        if (this.snapshot.status !== 'signed_in') this.publish({ status: 'unavailable', userNo: stored.userNo })
      }
      throw error
    }
  }

  private blockLocalSession() {
    this.generation++
    this.restoreBlocked = true
    this.clearPending()
    this.walletRead = undefined
    this.walletReadAt = 0
    this.refresh = undefined
    this.access = undefined
    let durable = false
    try { this.deps.store.block(); durable = true } catch { /* Explicit logout still attempts server revocation and local deletion. */ }
    return { generation: this.generation, durable }
  }

  clearLocalSession() {
    this.blockLocalSession()
    this.deps.store.clear()
  }

  async logout() {
    const { generation, durable } = this.blockLocalSession()
    this.publish({ status: 'signed_out' })
    try {
      let stored: Credentials | null
      try { stored = this.deps.store.readForLogout() } catch (error) {
        this.deps.store.clear()
        throw error
      }
      if (stored) {
        try { await this.deps.post('logout', undefined, stored.refreshToken) } catch (error) {
          if (!durable && generation === this.generation) this.deps.store.clear()
          throw error
        }
      }
      if (generation === this.generation) this.deps.store.clear()
    } catch {
      if (generation === this.generation) this.publish({ status: 'logout_incomplete' })
      throw new DesktopAccountError('logout_incomplete')
    }
  }
}

function systemStore(): CredentialStore {
  const file = join(getUserDataPath(), 'domestic-account', 'credentials.enc')
  const blocked = join(dirname(file), 'restore-blocked')
  function available() {
    if (!safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())))
      throw new DesktopAccountError('storage_unavailable')
  }
  function readEncrypted() {
    try {
      const encrypted = readFileSync(file)
      available()
      const value: unknown = JSON.parse(safeStorage.decryptString(encrypted))
      if (!validCredentials(value)) throw new Error()
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new DesktopAccountError('storage_unavailable')
    }
  }
  return {
    read() {
      try { statSync(blocked); return null } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new DesktopAccountError('storage_unavailable')
      }
      return readEncrypted()
    },
    readForLogout: readEncrypted,
    block() {
      try {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
        writeFileSync(blocked, '', { flag: 'a', mode: 0o600, flush: true })
      } catch { throw new DesktopAccountError('storage_unavailable') }
    },
    save(value) {
      const temp = file + '.' + randomBytes(12).toString('hex')
      try {
        available()
        const encrypted = safeStorage.encryptString(JSON.stringify(value))
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
        writeFileSync(temp, encrypted, { flag: 'wx', mode: 0o600, flush: true })
        renameSync(temp, file)
        rmSync(blocked, { force: true })
      } catch {
        try { rmSync(temp, { force: true }) } catch { /* The temporary file contains encrypted data only. */ }
        throw new DesktopAccountError('storage_unavailable')
      }
    },
    clear() {
      try { rmSync(file, { force: true }) } catch { throw new DesktopAccountError('storage_unavailable') }
    }
  }
}

function installationId() {
  const directory = join(getUserDataPath(), 'domestic-account')
  const file = join(directory, 'instance-id')
  try {
    const saved = readFileSync(file, 'utf8')
    if (!instanceUuid.test(saved)) throw new DesktopAccountError('storage_unavailable')
    return saved
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const id = randomUUID()
  const temporary = file + '.' + id
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(temporary, id, { flag: 'wx', mode: 0o600, flush: true })
    renameSync(temporary, file)
    return id
  } catch {
    try { rmSync(temporary, { force: true }) } catch { /* The installation identifier is not a credential. */ }
    throw new DesktopAccountError('storage_unavailable')
  }
}

let activeDomesticAccount: DesktopAccount | undefined

export function currentDomesticDesktopAccount() {
  if (!activeDomesticAccount || getAppRuntime().distribution !== 'domestic') throw new DesktopAccountError('invalid_grant')
  return activeDomesticAccount
}

export function createDomesticDesktopAccount(changed: (snapshot: DesktopAccountSnapshot) => void) {
  if (getAppRuntime().distribution !== 'domestic') throw new DesktopAccountError('unavailable')
  async function request(route: Route | 'profile' | 'wallet' | { requestId: string }, method: 'GET' | 'POST', input?: object,
    bearer?: string, signal?: AbortSignal) {
    const lookup = typeof route !== 'string'
    const url = officialUrl('domestic', lookup ? '/api/v2/managed/calls/' + route.requestId : '/api/auth/desktop/' + route)
    const body = input && JSON.stringify(input)
    try {
      const headers = new Headers(buildDesktopAppGatewayHeaders({ method, url, body }))
      if (body) headers.set('content-type', 'application/json')
      if (bearer) headers.set('authorization', 'Bearer ' + bearer)
      const timeout = AbortSignal.timeout(route === 'receipt' || route === 'abandon' ? 4_000 : 15_000)
      const response = await fetch(url, { method, body, headers, redirect: 'error',
        cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
      const result = await response.json()
      if (lookup && response.status === 404 && result?.error === 'not_found') return { status: 'not_found' }
      if (response.status === 401 && result?.error === 'invalid_grant')
        throw new DesktopAccountError('invalid_grant')
      if (response.status === 503 && result?.error === 'recovery_unavailable')
        throw new DesktopAccountError('recovery_unavailable')
      if (!response.ok || !result || typeof result !== 'object' || Array.isArray(result)) throw new Error()
      return result
    } catch (error) {
      if (error instanceof DesktopAccountError) throw error
      throw new DesktopAccountError('unavailable')
    }
  }
  activeDomesticAccount = new DesktopAccount(installationId(), {
    store: systemStore(),
    changed,
    openBrowser: url => shell.openExternal(url),
    post: (route, input, refreshToken) => request(route, 'POST', input, refreshToken),
    profile: token => request('profile', 'GET', undefined, token),
    wallet: token => request('wallet', 'GET', undefined, token),
    managedCall: (requestId, token, signal) => request({ requestId }, 'GET', undefined, token, signal)
  })
  return activeDomesticAccount
}
