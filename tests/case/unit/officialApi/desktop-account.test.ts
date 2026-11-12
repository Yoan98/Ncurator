import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HumanMessage, ToolMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import { afterEach, expect, it, vi } from 'vitest'
import { createDomesticDesktopAccount, DesktopAccount, DesktopAccountError } from '../../../../src/main/services/officialApi/desktopAccount'
import { resolveManagedRuntimeConfig } from '../../../../src/main/services/officialApi/managedModel'
import { createAiLlmExecutor } from '../../../../src/main/services/ai/llmExecutor'
import { desktopProtocolLink, registerDesktopAccount } from '../../../../src/main/ipc/desktopAccount'

const electron = vi.hoisted(() => ({
  safeStorage: { isEncryptionAvailable: vi.fn(), getSelectedStorageBackend: vi.fn(() => 'synthetic'), encryptString: vi.fn(), decryptString: vi.fn() },
  shell: { openExternal: vi.fn() }, ipcMain: { handle: vi.fn() }
}))
vi.mock('electron', () => electron)
const filesystem = vi.hoisted(() => ({ denyCredentialDeletion: false }))
vi.mock('node:fs', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs')>()
  return { ...real, rmSync: (...args: Parameters<typeof real.rmSync>) => {
    if (filesystem.denyCredentialDeletion && String(args[0]).endsWith('credentials.enc')) throw new Error('synthetic removal failure')
    return real.rmSync(...args)
  } }
})
const userNo = randomUUID()
const value = (suffix: string) => ({ userNo, accessToken: 'access.part.' + suffix, refreshToken: 'refresh.part.' + suffix, expiresIn: 3600 })
const secret = () => randomBytes(32).toString('base64url')
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  filesystem.denyCredentialDeletion = false
})

type ManagedDirectFixture = {
  apiOrigin: string
  controlOrigin: string
  appSecret: string
  modelId: string
  primary: { userNo: string; access: string }
  secondary: { userNo: string; access: string }
}

function managedDesktopFixture(respond: (requestId: string, attempt: number) => Response, recover = { status: 'settlement_pending' },
  direct?: ManagedDirectFixture) {
  const dir = mkdtempSync(join(tmpdir(), 'ncurator-managed-call-'))
  vi.stubEnv('NCURATOR_USER_DATA_PATH', dir)
  vi.stubEnv('NCURATOR_APP_SECRET_DESKTOP', direct?.appSecret ?? 'synthetic-desktop-gateway-test-key')
  electron.safeStorage.isEncryptionAvailable.mockReturnValue(true)
  electron.safeStorage.encryptString.mockImplementation((plain: string) => Buffer.from(plain))
  electron.safeStorage.decryptString.mockImplementation((encrypted: Buffer) => encrypted.toString())
  let state = ''
  let owner = userNo
  let loginCount = 0
  const submitted: { requestId: string; access: string | null }[] = []
  const lookedUp: string[] = []
  const http = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input)
    const path = url.pathname
    if (direct && url.origin === direct.controlOrigin) return http(input, init)
    expect(url.origin).toBe('https://api.guanzhangai.cn')
    if (path.endsWith('/start')) {
      state = JSON.parse(String(init.body)).state
      return Response.json({ flowId: '10', expiresIn: 600, authorizationUrl: 'https://www.guanzhangai.cn/desktop/authorize#flow=10&state=' + state })
    }
    if (path.endsWith('/exchange') || path.endsWith('/refresh')) {
      const credentials = direct && [direct.primary, direct.secondary].find(item => item.userNo === owner)
      return Response.json({ ...value(String(++loginCount)), userNo: owner, ...(credentials && { accessToken: credentials.access }) })
    }
    if (path.endsWith('/receipt') || path.endsWith('/logout')) return Response.json({ ok: true })
    if (path.startsWith('/api/v2/managed/calls/')) {
      lookedUp.push(path.split('/').at(-1)!)
      if (direct) return http(direct.apiOrigin + path, init)
      return Response.json(recover)
    }
    if (path === '/api/v2/managed/chat/completions') {
      const { requestId } = JSON.parse(String(init.body))
      submitted.push({ requestId, access: new Headers(init.headers).get('authorization') })
      if (direct) {
        const response = await http(direct.apiOrigin + path, init)
        if (String(init.body).includes('isolated_disconnect')) {
          const raw = await response.text()
          expect(raw).toContain('event: ncurator.result')
          return new Response(raw.split('event: ncurator.result')[0], { status: response.status, headers: response.headers })
        }
        return response
      }
      return respond(requestId, submitted.length)
    }
    throw new Error('Unexpected request: ' + path)
  }))
  const account = createDomesticDesktopAccount(() => undefined)
  const login = async (newOwner = userNo) => {
    owner = newOwner
    await account.begin()
    await expect(account.acceptCallback('ncurator://auth/callback?code=' + secret() + '&state=' + state))
      .resolves.toBe(owner)
  }
  return { account, login, submitted, lookedUp, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const sampleWallet = { currency: 'CNY', available: '975', balance: '975', usageFrozen: '0', refundFrozen: '0',
  debt: '0', version: '3', settlementPending: false }

function managedSse(requestId: string, scenario: 'text' | 'tools' | 'incomplete' | 'pending' | 'disconnected') {
  const tools = scenario === 'tools' || scenario === 'incomplete' || scenario === 'pending'
  const frame = (delta: object, finish: string | null = null) => 'data: ' + JSON.stringify({ id: 'chat-synthetic',
    model: '9', object: 'chat.completion.chunk', created: 42, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n'
  let body = frame({ role: 'assistant', content: '测试内容' })
  if (tools) {
    body += frame({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"name":' } }] })
    if (scenario !== 'incomplete') body += frame({ tool_calls: [{ index: 0, function: { arguments: '"doc"}' } }] })
  }
  body += frame({}, tools ? 'tool_calls' : 'stop')
  if (scenario !== 'disconnected') body += 'event: ncurator.result\ndata: ' + JSON.stringify({ requestId, result: 'completed',
    billing: scenario === 'pending' ? { status: 'settlement_pending' } : { status: 'settled', wallet: sampleWallet }
  }) + '\n\ndata: [DONE]\n\n'
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

it.each(['same login', 'different account', 'same account after logging in again'])('keeps managed admission retry in the original session with %s', async (scenario) => {
  const fixture = managedDesktopFixture((requestId, attempt) => attempt === 1
    ? Response.json({ error: 'model_concurrency_limited' }, { status: 429 }) : managedSse(requestId, 'text'))
  try {
    await fixture.login()
    let startRetry!: () => void
    const retry = new Promise<void>(resolve => { startRetry = resolve })
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: event => {
      if (event.type === 'llm_request_state' && !event.requesting) startRetry()
    } }, getConfig: async () => resolveManagedRuntimeConfig('managed:9', '测试模型'), saveConfig: async () => {}, checkCancelled: () => {} })
    const pending = executor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: '输入', streamingMode: 'force_stream' })
    const observed = pending.then(output => ({ output }), error => ({ error }))
    await Promise.race([retry, observed])
    expect(fixture.submitted).toHaveLength(1)
    if (scenario !== 'same login') {
      await fixture.account.logout()
      await fixture.login(scenario === 'different account' ? randomUUID() : userNo)
      expect(await observed).toHaveProperty('error')
      expect(fixture.submitted).toHaveLength(1)
    } else {
      expect(await observed).toEqual({ output: '测试内容' })
      expect(fixture.submitted).toHaveLength(2)
      expect(fixture.submitted[1]).toEqual(fixture.submitted[0])
    }
    expect(fixture.submitted[0].access).toBe('Bearer access.part.1')
    expect(fixture.lookedUp).toEqual([])
  } finally { fixture.cleanup() }
}, 10_000)

it.each(['tools', 'pending', 'incomplete', 'disconnected'] as const)('returns a managed tool decision only after complete output and confirmed billing (%s)', async (scenario) => {
  const fixture = managedDesktopFixture(requestId => managedSse(requestId, scenario))
  try {
    await fixture.login()
    const onTextDelta = vi.fn()
    const executeTool = vi.fn(async () => 'found')
    const lookup = tool(executeTool, { name: 'lookup', description: 'Lookup a fixture', schema: z.object({ name: z.string() }) })
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => resolveManagedRuntimeConfig('managed:9', '测试模型'), saveConfig: async () => {}, checkCancelled: () => {} })
    const result = executor.chatTools({ caller: 'test', messages: [new HumanMessage('查资料')], tools: [lookup],
      streamingMode: 'force_stream', onTextDelta }).then(async output => {
      const [call] = output.message.tool_calls ?? []
      if (call) await lookup.invoke(call.args)
      return output
    })
    if (scenario === 'tools') {
      expect(await result).toMatchObject({ finishReason: 'tool_calls', message: { tool_calls: [{ name: 'lookup', args: { name: 'doc' } }] } })
      expect(executeTool).toHaveBeenCalledTimes(1)
    } else {
      await expect(result).rejects.toThrow()
      expect(executeTool).not.toHaveBeenCalled()
    }
    expect(onTextDelta).toHaveBeenCalledWith('测试内容')
    expect(fixture.submitted).toHaveLength(1)
    expect(fixture.lookedUp).toEqual(scenario === 'pending' || scenario === 'disconnected' ? [fixture.submitted[0].requestId] : [])
  } finally { fixture.cleanup() }
})

it.runIf(Boolean(process.env.NCURATOR_TEST_MANAGED_DIRECT))('uses the real API from the managed desktop execution layer', async () => {
  const direct = JSON.parse(process.env.NCURATOR_TEST_MANAGED_DIRECT!) as ManagedDirectFixture
  for (const origin of [direct.apiOrigin, direct.controlOrigin]) expect(new URL(origin).hostname).toBe('127.0.0.1')
  const fixture = managedDesktopFixture(() => { throw new Error('Expected an isolated HTTP endpoint') }, undefined, direct)
  const release = async (step: string) => expect((await fetch(direct.controlOrigin + '/fixture/' + step, { method: 'POST' })).status).toBe(204)
  try {
    await fixture.login(direct.primary.userNo)
    const config = resolveManagedRuntimeConfig('managed:' + direct.modelId, '合成模型')
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => config, saveConfig: async () => {}, checkCancelled: () => {} })
    const invoked = vi.fn(async ({ name }: { name: string }) => 'found ' + name)
    const lookup = tool(invoked, { name: 'lookup', description: 'Lookup a fixture', schema: z.object({ name: z.string() }) })
    const prompt = new HumanMessage('isolated_tool')
    const firstDelta = Promise.withResolvers<void>()
    const first = executor.chatTools({ caller: 'test', messages: [prompt], tools: [lookup], streamingMode: 'force_stream',
      onTextDelta: () => firstDelta.resolve() }).then(async result => {
      const [call] = result.message.tool_calls ?? []
      expect(call?.args).toEqual({ name: 'doc' })
      const found = await lookup.invoke(call.args)
      return executor.chatTools({ caller: 'test', messages: [prompt, result.message,
        new ToolMessage({ content: String(found), tool_call_id: call.id! })], tools: [lookup], streamingMode: 'force_stream' })
    })
    void first.catch(() => undefined)
    await firstDelta.promise
    expect(fixture.submitted).toHaveLength(1)
    expect(invoked).not.toHaveBeenCalled()
    await release('tool')
    expect(await first).toMatchObject({ finishReason: 'stop', message: { content: '合成工具后的回复' } })
    expect(invoked).toHaveBeenCalledOnce()
    expect(fixture.submitted).toHaveLength(2)

    const switchDelta = Promise.withResolvers<void>()
    const deltas: string[] = []
    const switching = executor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: 'isolated_switch',
      streamingMode: 'force_stream', onTextDelta: text => { deltas.push(text); switchDelta.resolve() } })
    const observed = switching.then(output => ({ output }), error => ({ error }))
    await switchDelta.promise
    await fixture.account.logout()
    await fixture.login(direct.secondary.userNo)
    await release('switch')
    expect(await observed).toHaveProperty('error')
    expect(deltas.join('')).toBe('切换前首段')
    expect(fixture.account.getSnapshot()).toMatchObject({ status: 'signed_in', userNo: direct.secondary.userNo })
    expect(fixture.submitted).toHaveLength(3)

    await expect(executor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: 'isolated_disconnect',
      streamingMode: 'force_stream' })).resolves.toBe('合成查回回复')
    expect(fixture.submitted).toHaveLength(4)
    expect(new Set(fixture.submitted.map(item => item.requestId)).size).toBe(4)
    expect(fixture.lookedUp).toEqual([fixture.submitted[3].requestId])
    expect(fixture.submitted.slice(0, 3).map(item => item.access)).toEqual(Array(3).fill('Bearer ' + direct.primary.access))
    expect(fixture.submitted[3].access).toBe('Bearer ' + direct.secondary.access)
  } finally { fixture.cleanup() }
}, 25_000)

it.each(['expired', 'lookup', 'unknown-429', 'stream-recovered'] as const)('handles %s through the managed invocation without replaying an admitted call', async scenario => {
  const fixture = managedDesktopFixture((requestId, attempt) => {
    if (scenario === 'expired' && attempt === 1) return Response.json({ error: 'access_token_expired' }, { status: 401 })
    if (scenario === 'lookup') return Response.json({ status: 'lookup', requestId }, { status: 202 })
    if (scenario === 'unknown-429') return Response.json({ error: 'rate_limit_exceeded' }, { status: 429 })
    return managedSse(requestId, scenario === 'stream-recovered' ? 'disconnected' : 'text')
  }, { status: 'settled', executionStatus: 'completed', wallet: sampleWallet })
  try {
    await fixture.login()
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => resolveManagedRuntimeConfig('managed:9', '测试模型'), saveConfig: async () => {}, checkCancelled: () => {} })
    const pending = executor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: '输入', streamingMode: 'force_stream' })
    if (scenario === 'expired' || scenario === 'stream-recovered') await expect(pending).resolves.toBe('测试内容')
    else await expect(pending).rejects.toThrow()
    expect(fixture.submitted).toHaveLength(scenario === 'expired' ? 2 : 1)
    if (scenario === 'expired') expect(fixture.submitted[1]).toEqual({ requestId: fixture.submitted[0].requestId, access: 'Bearer access.part.2' })
    expect(fixture.lookedUp).toEqual(scenario === 'lookup' || scenario === 'stream-recovered' ? [fixture.submitted[0].requestId] : [])
  } finally { fixture.cleanup() }
})

it('uses a distinct request ID for consecutive calls and the follow-up after a tool result', async () => {
  const fixture = managedDesktopFixture((requestId, attempt) => managedSse(requestId, attempt === 3 ? 'tools' : 'text'))
  try {
    await fixture.login()
    const config = resolveManagedRuntimeConfig('managed:9', '测试模型')
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => config, saveConfig: async () => {}, checkCancelled: () => {} })
    const plain = { caller: 'test', schemaName: 'managed', system: '系统', user: '输入', streamingMode: 'force_stream' } as const
    await expect(executor.chatText(plain)).resolves.toBe('测试内容')
    await expect(executor.chatText(plain)).resolves.toBe('测试内容')
    const lookup = tool(async ({ name }) => 'found ' + name, { name: 'lookup', description: 'Lookup a fixture',
      schema: z.object({ name: z.string() }) })
    const prompt = new HumanMessage('查资料')
    const first = await executor.chatTools({ caller: 'test', messages: [prompt], tools: [lookup], streamingMode: 'force_stream' })
    const [call] = first.message.tool_calls ?? []
    expect(call?.id).toBe('call_1')
    const output = await lookup.invoke(call.args)
    const next = await executor.chatTools({ caller: 'test', messages: [prompt, first.message,
      new ToolMessage({ content: String(output), tool_call_id: call.id! })], tools: [lookup], streamingMode: 'force_stream' })
    expect(next).toMatchObject({ finishReason: 'stop', message: { content: '测试内容' } })
    const ids = fixture.submitted.map(request => request.requestId)
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    expect(fixture.lookedUp).toEqual([])
  } finally { fixture.cleanup() }
})

function fixture() {
  let stored: { userNo: string; refreshToken: string } | null = null
  let blocked = false
  let state = ''
  let openUrl = ''
  const store = {
    read: () => blocked ? null : stored,
    readForLogout: () => stored,
    block: vi.fn(() => { blocked = true }),
    save: vi.fn((next: NonNullable<typeof stored>) => { stored = next; blocked = false }),
    clear: vi.fn(() => { stored = null })
  }
  const post = vi.fn(async (route: string, input?: Record<string, unknown>, _token?: string): Promise<Record<string, unknown>> => {
    if (route === 'start') {
      state = String(input?.state)
      return { flowId: '23', expiresIn: 600, authorizationUrl: 'https://www.guanzhangai.cn/desktop/authorize#flow=23&state=' + state }
    }
    if (route === 'receipt' || route === 'abandon') return { ok: true }
    return value('first')
  })
  const openBrowser = vi.fn(async (url: string) => { openUrl = url })
  const changed = vi.fn()
  const profile = vi.fn(async (_token: string) => ({ userNo, maskedEmail: 's***@example.test' }))
  const wallet = vi.fn(async (_token: string) => ({
    currency: 'CNY', available: '1234000000', balance: '1234000000',
    usageFrozen: '0', refundFrozen: '0', debt: '0', version: '2', settlementPending: false
  }))
  const managedCall = vi.fn(async (_requestId: string, _token: string, _signal?: AbortSignal): Promise<Record<string, unknown>> =>
    ({ status: 'settlement_pending' }))
  const account = new DesktopAccount(randomUUID(), { store, post, profile, wallet, managedCall, openBrowser, changed })
  const callback = (code = secret(), overrideState = state) => 'ncurator://auth/callback?code=' + code + '&state=' + overrideState
  return { account, store, post, profile, wallet, managedCall, openBrowser, changed, callback, url: () => openUrl, blocked: () => blocked }
}

it('dispatches only the native account callback or the exact open link', () => {
  const { callback } = fixture()
  const valid = callback()
  expect(desktopProtocolLink(['app.exe', '--profile=synthetic', valid])).toBe(valid)
  expect(desktopProtocolLink(['ncurator://open'])).toBe('ncurator://open')
  expect(desktopProtocolLink([valid, 'ncurator://open'])).toBeUndefined()
  expect(desktopProtocolLink(['ncurator://ref?url=https://example.invalid'])).toBeUndefined()
  expect(desktopProtocolLink(['ncurator://open?anything=1'])).toBeUndefined()
})

it('publishes only display state across authorization expiry, offline restore and confirmed revocation', async () => {
  vi.useFakeTimers()
  const { account, store, post, callback, changed } = fixture()
  await account.begin()
  expect(changed).toHaveBeenLastCalledWith({ status: 'authorizing' })
  await vi.advanceTimersByTimeAsync(600_000)
  expect(changed).toHaveBeenLastCalledWith({ status: 'expired' })
  expect(await account.acceptCallback(callback())).toBeUndefined()
  store.save({ userNo, refreshToken: value('stored').refreshToken })
  post.mockRejectedValueOnce(new DesktopAccountError('unavailable'))
  expect(await account.restore()).toEqual({ status: 'unavailable', userNo })
  expect(store.read()?.userNo).toBe(userNo)
  post.mockRejectedValueOnce(new DesktopAccountError('invalid_grant'))
  expect(await account.restore()).toEqual({ status: 'expired' })
  expect(store.read()).toBeNull()
  expect(JSON.stringify(changed.mock.calls)).not.toMatch(/access\.part|refresh\.part|codeVerifier/)
})

it('rejects a main frame that leaves the trusted entry and suppresses its account notifications', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ncurator-account-ipc-'))
  vi.stubEnv('NCURATOR_USER_DATA_PATH', dir)
  vi.stubEnv('NCURATOR_APP_SECRET_DESKTOP', 'synthetic-desktop-gateway-test-key')
  const trustedUrl = 'http://127.0.0.1:5173/'
  const frame = { url: trustedUrl, send: vi.fn() }
  const sender = { mainFrame: frame, isDestroyed: () => false }
  const send = { sender, senderFrame: frame }
  const fakeWindow = { webContents: sender } as unknown as Electron.BrowserWindow
  const deliver = registerDesktopAccount(() => fakeWindow, trustedUrl)
  const command = electron.ipcMain.handle.mock.calls.at(-1)![1]
  let state = ''
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/start')) {
      state = JSON.parse(String(init.body)).state
      return Response.json({ flowId: '10', expiresIn: 600, authorizationUrl: 'https://www.guanzhangai.cn/desktop/authorize#flow=10&state=' + state })
    }
    return Response.json(value('local'))
  }))
  electron.safeStorage.isEncryptionAvailable.mockReturnValue(true)
  electron.safeStorage.encryptString.mockReturnValue(Buffer.from('synthetic encrypted credential'))
  try {
    await expect(command({ sender, senderFrame: { ...frame } }, 'restore')).rejects.toThrow('desktop_account_forbidden')
    expect(await command(send, 'begin')).toEqual({ status: 'authorizing' })
    expect(frame.send).toHaveBeenCalledTimes(1)
    frame.url = 'https://example.invalid/'
    deliver('ncurator://auth/callback?code=' + secret() + '&state=' + state)
    await expect(command(send, 'restore')).rejects.toThrow('desktop_account_forbidden')
    await expect.poll(() => existsSync(join(dir, 'domestic-account', 'credentials.enc'))).toBe(true)
    frame.url = trustedUrl
    await expect.poll(() => command(send, 'restore')).toEqual({ status: 'signed_in', userNo })
    expect(frame.send.mock.calls).toEqual([['desktop-account:changed', { status: 'authorizing' }]])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('discards a late profile from a previous login and validates its owner', async () => {
  const { account, post, profile, callback } = fixture()
  await account.begin()
  await account.acceptCallback(callback())
  await expect(account.readProfile()).resolves.toEqual({ status: 'signed_in', userNo, maskedEmail: 's***@example.test' })
  let complete!: (data: { userNo: string; maskedEmail: string }) => void
  profile.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const old = account.readProfile()
  await expect.poll(() => typeof complete).toBe('function')
  await account.logout()
  await account.begin()
  const nextUser = randomUUID()
  post.mockResolvedValueOnce({ ...value('new'), userNo: nextUser })
  await account.acceptCallback(callback())
  complete({ userNo, maskedEmail: 'o***@example.test' })
  expect(await old).toEqual({ status: 'signed_in', userNo: nextUser })
  expect(await account.readProfile()).toEqual({ status: 'signed_in', userNo: nextUser })
})

it('keeps the verifier in Main and coalesces matching callbacks until secure storage succeeds', async () => {
  const { account, store, post, callback, url } = fixture()
  await account.begin()
  expect(url()).toMatch(/^https:\/\/www\.guanzhangai\.cn\/desktop\/authorize#flow=23&state=/)
  const start = post.mock.calls.find(call => call[0] === 'start')?.[1]
  expect(start).not.toHaveProperty('codeVerifier')
  expect(await account.acceptCallback(callback(secret(), secret()))).toBeUndefined()
  expect(await account.acceptCallback('https://example.invalid/?code=' + secret())).toBeUndefined()
  const approved = callback()
  expect(await Promise.all([account.acceptCallback(approved), account.acceptCallback(approved)])).toEqual([userNo, userNo])
  const exchanges = post.mock.calls.filter(call => call[0] === 'exchange')
  expect(exchanges).toHaveLength(1)
  expect(createHash('sha256').update(String(exchanges[0][1]?.codeVerifier)).digest('base64url')).toBe(start?.codeChallenge)
  expect(store.save).toHaveBeenCalledExactlyOnceWith({ userNo, refreshToken: value('first').refreshToken })
  expect(await account.acceptCallback(approved)).toBeUndefined()
})

it('does not replay an uncertain exchange or publish success on storage failure', async () => {
  const { account, store, post, callback } = fixture()
  await account.begin()
  post.mockRejectedValueOnce(new Error('synthetic offline'))
  const old = callback()
  await expect(account.acceptCallback(old)).rejects.toMatchObject({ code: 'restart_authorization' })
  expect(await account.acceptCallback(old)).toBeUndefined()
  expect(post.mock.calls.filter(call => call[0] === 'exchange')).toHaveLength(1)
  await account.begin()
  store.save.mockImplementationOnce(() => { throw new DesktopAccountError('storage_unavailable') })
  await expect(account.acceptCallback(callback())).rejects.toMatchObject({ code: 'storage_unavailable' })
  expect(store.read()).toBeNull()
})

it('discards an exchange response after cancellation and after a newer authorization', async () => {
  const { account, store, post, callback } = fixture()
  for (const cancel of [() => account.cancel(), () => account.begin()]) {
    await account.begin()
    let deliver!: (value: Record<string, unknown>) => void
    post.mockImplementationOnce(async () => await new Promise(resolve => { deliver = resolve }))
    const old = account.acceptCallback(callback())
    await cancel()
    deliver(value('stale'))
    await expect(old).rejects.toMatchObject({ code: 'cancelled' })
    expect(store.save).not.toHaveBeenCalled()
  }
})

it('coalesces refresh, preserves the previous protected credential on failure, and rejects stale results after logout', async () => {
  const { account, store, post } = fixture()
  store.save({ userNo, refreshToken: value('first').refreshToken })
  post.mockRejectedValueOnce(new DesktopAccountError('unavailable'))
  await expect(account.accessToken()).rejects.toMatchObject({ code: 'unavailable' })
  expect(store.read()?.refreshToken).toBe(value('first').refreshToken)
  post.mockResolvedValueOnce(value('second'))
  store.save.mockImplementationOnce(() => { throw new DesktopAccountError('storage_unavailable') })
  await expect(account.accessToken()).rejects.toMatchObject({ code: 'storage_unavailable' })
  expect(store.read()?.refreshToken).toBe(value('first').refreshToken)

  let deliver!: (value: Record<string, unknown>) => void
  post.mockImplementationOnce(async () => await new Promise(resolve => { deliver = resolve }))
  const first = account.accessToken()
  expect(account.accessToken()).toBe(first)
  account.clearLocalSession()
  deliver(value('third'))
  await expect(first).rejects.toMatchObject({ code: 'cancelled' })
  expect(store.read()).toBeNull()
})

it('blocks refresh even when local credential deletion fails', async () => {
  const { account, store, post, callback } = fixture()
  store.save({ userNo, refreshToken: value('old').refreshToken })
  store.clear.mockImplementationOnce(() => { throw new DesktopAccountError('storage_unavailable') })
  await expect(account.logout()).rejects.toMatchObject({ code: 'logout_incomplete' })
  await expect(account.accessToken()).rejects.toMatchObject({ code: 'invalid_grant' })
  expect(post.mock.calls.map(call => call[0])).toEqual(['logout'])
  await account.begin()
  await account.acceptCallback(callback())
  expect(await account.accessToken()).toBe(value('first').accessToken)
})

it('does not report logout success when the server rejects the supplied proof', async () => {
  const { account, store, post } = fixture()
  store.save({ userNo, refreshToken: value('old').refreshToken })
  post.mockRejectedValueOnce(new DesktopAccountError('invalid_grant'))
  await expect(account.logout()).rejects.toMatchObject({ code: 'logout_incomplete' })
  await expect(account.accessToken()).rejects.toMatchObject({ code: 'invalid_grant' })
  expect(store.clear).not.toHaveBeenCalled()
  expect(post.mock.calls.map(call => call[0])).toEqual(['logout'])
})

it.each([true, false])('preserves a new login when a delayed old logout succeeds=%s', async succeeds => {
  const { account, store, post, callback, blocked } = fixture()
  store.save({ userNo, refreshToken: value('old').refreshToken })
  let deliver!: () => void
  post.mockImplementationOnce(() => new Promise((resolve, reject) => {
    deliver = () => succeeds ? resolve({ ok: true }) : reject(new DesktopAccountError('unavailable'))
  }))
  const oldLogout = account.logout().then(() => 'ok', error => error.code)
  expect(blocked()).toBe(true)
  await account.begin()
  post.mockResolvedValueOnce(value('new'))
  await account.acceptCallback(callback())
  expect(blocked()).toBe(false)
  deliver()
  expect(await oldLogout).toBe(succeeds ? 'ok' : 'logout_incomplete')
  expect(store.read()?.refreshToken === value('new').refreshToken).toBe(true)
  expect(await account.accessToken() === value('new').accessToken).toBe(true)
  expect(blocked()).toBe(false)
  expect(store.clear).not.toHaveBeenCalled()
})

it('fails closed without system protection and writes only the encrypted result to disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ncurator-account-test-'))
  const path = join(dir, 'domestic-account', 'credentials.enc')
  vi.stubEnv('NCURATOR_USER_DATA_PATH', dir)
  vi.stubEnv('NCURATOR_APP_SECRET_DESKTOP', 'synthetic-desktop-gateway-test-key')
  let state = ''
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (url.endsWith('/start')) {
      state = body.state
      return Response.json({ flowId: '10', expiresIn: 600, authorizationUrl: 'https://www.guanzhangai.cn/desktop/authorize#flow=10&state=' + state })
    }
    return Response.json(value('stored'))
  }))
  const complete = async () => {
    const account = createDomesticDesktopAccount(() => {})
    await account.begin()
    return account.acceptCallback('ncurator://auth/callback?code=' + secret() + '&state=' + state)
  }
  try {
    electron.safeStorage.isEncryptionAvailable.mockReturnValue(false)
    await expect(complete()).rejects.toMatchObject({ code: 'storage_unavailable' })
    expect(existsSync(path)).toBe(false)
    expect(electron.safeStorage.encryptString).not.toHaveBeenCalled()
    electron.safeStorage.isEncryptionAvailable.mockReturnValue(true)
    const encrypted = randomBytes(64)
    electron.safeStorage.encryptString.mockReturnValue(encrypted)
    expect(await complete()).toBe(userNo)
    expect(readFileSync(path).equals(encrypted)).toBe(true)
    expect(readFileSync(path).includes(Buffer.from(value('stored').refreshToken))).toBe(false)
    electron.safeStorage.decryptString.mockReturnValue(JSON.stringify({ userNo, refreshToken: value('stored').refreshToken }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'recovery_unavailable' }, { status: 503 })))
    await expect(createDomesticDesktopAccount(() => {}).accessToken()).rejects.toMatchObject({ code: 'recovery_unavailable' })
    expect(readFileSync(path).equals(encrypted)).toBe(true)
    const fetchLogout = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchLogout)
    fetchLogout.mockRejectedValueOnce(new Error('synthetic network outage'))
    filesystem.denyCredentialDeletion = true
    await expect(createDomesticDesktopAccount(() => {}).logout()).rejects.toMatchObject({ code: 'logout_incomplete' })
    expect(readFileSync(path).equals(encrypted)).toBe(true)
    await expect(createDomesticDesktopAccount(() => {}).accessToken()).rejects.toMatchObject({ code: 'invalid_grant' })
    expect(fetchLogout).toHaveBeenCalledTimes(1)
    await expect(createDomesticDesktopAccount(() => {}).logout()).rejects.toMatchObject({ code: 'logout_incomplete' })
    await expect(createDomesticDesktopAccount(() => {}).accessToken()).rejects.toMatchObject({ code: 'invalid_grant' })
    expect(fetchLogout).toHaveBeenCalledTimes(2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('shares wallet reads, retains the last good amount offline, and ignores results from an older context', async () => {
  const { account, wallet, callback } = fixture()
  await account.begin()
  await account.acceptCallback(callback())
  const newer = await wallet('fixture')
  wallet.mockClear()
  const ordinary = await Promise.all([account.readWallet(), account.readWallet()])
  expect(wallet).toHaveBeenCalledTimes(1)
  expect(ordinary[0]).toMatchObject({ wallet: newer, walletStale: false })
  await account.readWallet()
  expect(wallet).toHaveBeenCalledTimes(1)
  wallet.mockRejectedValueOnce(new DesktopAccountError('unavailable'))
  await expect(account.readWallet(true)).resolves.toMatchObject({ wallet: newer, walletStale: true })
  wallet.mockResolvedValueOnce({ ...newer, version: '1', available: '0' })
  await expect(account.readWallet(true)).resolves.toMatchObject({ wallet: newer })

  let completeOld!: (value: typeof newer) => void
  wallet.mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve }))
  const old = account.readWallet(true)
  await vi.waitFor(() => expect(completeOld).toBeDefined())
  await account.logout()
  completeOld({ ...newer, version: '3' })
  await old
  expect(account.getSnapshot()).toEqual({ status: 'signed_out' })
})

it('looks up the original managed call without a wallet round trip and applies only a newer snapshot', async () => {
  const { account, wallet, managedCall, callback } = fixture()
  expect(() => account.managedCallScope()).toThrow('invalid_grant')
  await account.begin()
  await account.acceptCallback(callback())
  const scope = account.managedCallScope()
  const requestId = randomUUID()
  await expect(scope.recover('../another-account')).rejects.toMatchObject({ code: 'unavailable' })
  expect(managedCall).not.toHaveBeenCalled()
  const signal = new AbortController().signal
  await expect(scope.recover(requestId, signal)).resolves.toEqual({ status: 'settlement_pending' })
  expect(managedCall).toHaveBeenCalledExactlyOnceWith(requestId, value('first').accessToken, signal)
  const snapshot = await wallet('fixture')
  wallet.mockClear()
  managedCall.mockResolvedValueOnce({ status: 'settled', executionStatus: 'completed', wallet: snapshot })
  await expect(scope.recover(requestId)).resolves.toEqual({ status: 'settled', executionStatus: 'completed' })
  scope.applyWallet({ ...snapshot, version: '1', available: '0' })
  await expect(account.readWallet()).resolves.toMatchObject({ wallet: snapshot, walletStale: false })
  expect(wallet).not.toHaveBeenCalled()
})

it('keeps trusted amounts on a same-version conflict and accepts matching amounts and a newer version', async () => {
  const { account, wallet, callback, changed } = fixture()
  await account.begin()
  await account.acceptCallback(callback())
  const scope = account.managedCallScope()
  const original = await wallet('fixture')
  scope.applyWallet(original)
  changed.mockClear()
  for (const field of ['available', 'balance', 'usageFrozen', 'refundFrozen', 'debt'] as const) {
    scope.applyWallet({ ...original, [field]: '888' })
  }
  wallet.mockResolvedValueOnce({ ...original, available: '888' })
  await expect(account.readWallet(true)).resolves.toMatchObject({ wallet: original })
  expect(changed).not.toHaveBeenCalled()

  const pending = { ...original, settlementPending: true }
  scope.applyWallet(pending)
  expect(account.getSnapshot()).toMatchObject({ wallet: pending })
  const newer = { ...original, version: '3', available: '900', balance: '900' }
  scope.applyWallet(newer)
  expect(account.getSnapshot()).toMatchObject({ wallet: newer })
})

it.each([false, true])('rejects old managed results after reauthorization (other account: %s)', async otherAccount => {
  const { account, wallet, managedCall, callback, post } = fixture()
  await account.begin()
  await account.acceptCallback(callback())
  const scope = account.managedCallScope()
  const snapshot = await wallet('fixture')
  let finishLookup!: (value: Record<string, unknown>) => void
  managedCall.mockImplementationOnce(() => new Promise(resolve => { finishLookup = resolve }))
  const lookup = scope.recover(randomUUID())
  const rejected = expect(lookup).rejects.toMatchObject({ code: 'cancelled' })
  await vi.waitFor(() => expect(finishLookup).toBeDefined())
  await account.logout()
  await account.begin()
  const newUserNo = otherAccount ? randomUUID() : userNo
  post.mockResolvedValueOnce({ ...value('new-session'), userNo: newUserNo })
  await account.acceptCallback(callback())
  finishLookup({ status: 'settled', executionStatus: 'completed', wallet: { ...snapshot, version: '10' } })
  await rejected
  expect(() => scope.applyWallet(snapshot)).toThrow('cancelled')
  await expect(scope.accessToken()).rejects.toMatchObject({ code: 'cancelled' })
  expect(account.getSnapshot()).toEqual({ status: 'signed_in', userNo: newUserNo })
})

it('reopens the active browser authorization without creating a second flow', async () => {
  const { account, openBrowser, post, url } = fixture()
  await account.begin()
  await account.reopenBrowser()
  expect(openBrowser.mock.calls).toEqual([[url()], [url()]])
  expect(post.mock.calls.filter(([action]) => action === 'start')).toHaveLength(1)
  await account.cancel()
  await account.reopenBrowser()
  expect(openBrowser).toHaveBeenCalledTimes(2)
})

it('reports successful persistence once per authorization and keeps the login when both receipt responses are lost', async () => {
  const { account, store, post, callback } = fixture()
  const realPost = post.getMockImplementation()!
  post.mockImplementation(async (route, body, token) => {
    if (route === 'receipt') {
      expect(store.read()).toMatchObject({ userNo })
      expect(body).toEqual({ flowId: '23', result: 'saved' })
      expect(token).toBe(value('first').accessToken)
      throw new Error('synthetic receipt response loss')
    }
    return realPost(route, body, token)
  })
  await account.begin()
  await account.acceptCallback(callback())
  await vi.waitFor(() => expect(post.mock.calls.filter(call => call[0] === 'receipt')).toHaveLength(2))
  expect(post.mock.calls.filter(call => ['logout', 'abandon'].includes(call[0]))).toHaveLength(0)
  expect(account.getSnapshot()).toMatchObject({ status: 'signed_in', userNo })
  expect(store.read()).toMatchObject({ userNo })
})

it('blocks restoration after a partial save and retires only the failed session if the receipt window closes', async () => {
  const { account, store, post, callback, blocked } = fixture()
  const realSave = store.save.getMockImplementation()!
  store.save.mockImplementationOnce(next => {
    realSave(next)
    throw new DesktopAccountError('storage_unavailable')
  })
  store.clear.mockImplementationOnce(() => { throw new Error('synthetic file deletion failure') })
  const realPost = post.getMockImplementation()!
  let reportExpired!: () => void
  post.mockImplementation(async (route, body, token) => {
    if (route === 'receipt' && body?.result === 'storage_unavailable') {
      expect(blocked()).toBe(true)
      expect(store.read()).toBeNull()
      await new Promise<void>(resolve => { reportExpired = resolve })
      throw new Error('synthetic receipt deadline elapsed')
    }
    if (route === 'exchange' && reportExpired) return value('new-session')
    return realPost(route, body, token)
  })
  await account.begin()
  await expect(account.acceptCallback(callback())).rejects.toMatchObject({ code: 'storage_unavailable' })
  expect(blocked()).toBe(true)

  await account.begin()
  await account.acceptCallback(callback())
  reportExpired()
  await vi.waitFor(() => expect(post.mock.calls.filter(call => call[0] === 'logout')).toEqual([
    ['logout', undefined, value('first').refreshToken]
  ]))
  expect(store.read()?.refreshToken).toBe(value('new-session').refreshToken)
  expect(account.getSnapshot()).toMatchObject({ status: 'signed_in' })
})
