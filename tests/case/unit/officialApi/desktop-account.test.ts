import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HumanMessage, ToolMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import { afterEach, expect, it, vi } from 'vitest'
import { createDomesticDesktopAccount, currentDomesticDesktopAccount, DesktopAccount, DesktopAccountError, readManagedModels } from '../../../../src/main/services/officialApi/desktopAccount'
import { listenForDesktopCallback, type DesktopCallbackListener } from '../../../../src/main/services/officialApi/desktopLoopback'
import { resolveManagedRuntimeConfig } from '../../../../src/main/services/officialApi/managedModel'
import { createAiLlmExecutor } from '../../../../src/main/services/ai/llmExecutor'
import { findLlmProviderError } from '../../../../src/main/services/ai/errors'
import { lookupCatalogModelContextTokens } from '../../../../src/main/services/ai/modelContextWindow'
import { managedModelConfigId } from '../../../../src/shared/managedModels'
import { desktopProtocolLink, registerDesktopAccount } from '../../../../src/main/ipc/desktopAccount'
import { ConfirmDialogWindowService } from '../../../../src/main/services/ConfirmDialogWindowService'
import type { ConfirmDialogResponse } from '../../../../src/shared/types'

const electron = vi.hoisted(() => ({
  shell: { openExternal: vi.fn() }, ipcMain: { handle: vi.fn() }
}))
vi.mock('../../../../src/main/services/app/ServiceEnvironment', () =>
  import('../../../harness/core/desktopGatewayEnvironment'))
vi.mock('electron', () => electron)
const filesystem = vi.hoisted(() => ({ denyCredentialDeletion: false }))
vi.mock('node:fs', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs')>()
  return { ...real, rmSync: (...args: Parameters<typeof real.rmSync>) => {
    if (filesystem.denyCredentialDeletion && String(args[0]).endsWith('credentials.json')) throw new Error('synthetic removal failure')
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

it('reads managed pricing with the active account and drops a response delivered after account change', async () => {
  const fixture = managedDesktopFixture(() => { throw new Error('unexpected model request') })
  const http = globalThis.fetch
  const late = Promise.withResolvers<Response>()
  const started = Promise.withResolvers<void>()
  const rates = { input: '2.000000000000', cachedInput: null, output: '4.000000000000' }
  const response = (discountRate: string, priceTier?: 'low' | null) => Response.json({ protocolVersion: 1, models: [{
    id: '9007199254740995', kind: 'managed', label: 'Fixture DeepSeek', description: 'Public description',
    capabilities: ['text'], contextWindowTokens: discountRate === '0.750000' ? 131_072 : 96_000,
    iconUrl: 'https://www.guanzhangai.cn/llm/guanzhang.png',
    priceTier,
    modelName: 'private-fixture-id', providerId: 'private-fixture-provider',
    pricing: { discountRate, referenceSource: 'private-fixture-reference', allDay: {
      reference: rates, sale: rates
    } }
  }] })
  let requests = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
    if (new URL(input).pathname !== '/api/v1/managed-models') return http(input, init)
    expect(input).toBe('https://api.guanzhangai.cn/api/v1/managed-models')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toMatch(/^Bearer access\.part\./)
    expect(headers.get('x-ncurator-signature')).toMatch(/^[0-9a-f]{64}$/)
    requests++
    if (requests === 1) return response('0.750000', 'low')
    if (requests === 2) return response('0.820000', null)
    started.resolve()
    return late.promise
  }))
  try {
    expect(await readManagedModels(fixture.account)).toEqual({ status: 'signed_out' })
    expect(requests).toBe(0)
    await fixture.login()
    const selection = { configId: managedModelConfigId('9007199254740995'), modelName: 'Fixture DeepSeek' }
    const coldWindow = lookupCatalogModelContextTokens(selection)
    const first = await readManagedModels(fixture.account)
    expect(await coldWindow).toBe(131_072)
    expect(requests).toBe(1)
    expect(first).toMatchObject({ status: 'ready', models: [{
      id: '9007199254740995', description: 'Public description', priceTier: 'low', contextWindowTokens: 131_072,
      pricing: { discountRate: '0.75' }
    }] })
    expect(JSON.stringify(first)).not.toContain('private-fixture')
    const refreshed = await readManagedModels(fixture.account)
    expect(refreshed).toMatchObject({ status: 'ready', models: [{ pricing: { discountRate: '0.82' } }] })
    expect(await lookupCatalogModelContextTokens(selection)).toBe(96_000)
    expect(await lookupCatalogModelContextTokens({ ...selection, configId: managedModelConfigId('42') })).toBe(475_000)
    expect(requests).toBe(2)
    if (refreshed.status === 'ready') expect(refreshed.models[0]).not.toHaveProperty('priceTier')
    const previous = readManagedModels(fixture.account)
    await started.promise
    await fixture.account.logout()
    await fixture.login(randomUUID())
    late.resolve(response('0.810000'))
    expect(await previous).toEqual({ status: 'unavailable' })
  } finally {
    late.resolve(response('0.75'))
    fixture.cleanup()
  }
})

type ManagedSseScenario = 'text' | 'tools' | 'stop-with-tools' | 'incomplete' | 'empty' | 'pending' | 'disconnected' | 'timeout' | 'timeout-empty' | 'charged-timeout' | 'interrupted'

function managedSse(requestId: string, scenario: ManagedSseScenario) {
  const tools = scenario === 'tools' || scenario === 'stop-with-tools' || scenario === 'incomplete' || scenario === 'pending'
  const frame = (delta: object, finish: string | null = null) => 'data: ' + JSON.stringify({ id: 'chat-synthetic',
    model: '9', object: 'chat.completion.chunk', created: 42, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n'
  if (scenario === 'timeout' || scenario === 'interrupted') {
    return new Response(frame({ role: 'assistant', content: '部分内容' }) +
      'event: ncurator.result\ndata: ' + JSON.stringify({ requestId, result: 'unconfirmed',
        error: scenario === 'timeout' ? 'upstream_timeout' : 'upstream_interrupted', retryable: true,
        billing: { status: 'settled', feeDecision: 'waive', wallet: sampleWallet } }) + '\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } })
  }
  if (scenario === 'timeout-empty' || scenario === 'charged-timeout') {
    return new Response('event: ncurator.result\ndata: ' + JSON.stringify({ requestId, result: 'unconfirmed',
      error: 'upstream_timeout', retryable: true,
      billing: { status: 'settled', feeDecision: scenario === 'charged-timeout' ? 'charge' : 'waive', wallet: sampleWallet } }) +
      '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  }
  if (scenario === 'empty') {
    return new Response(frame({}, 'stop') + 'event: ncurator.result\ndata: ' + JSON.stringify({ requestId, result: 'completed',
      billing: { status: 'settled', feeDecision: 'charge', wallet: sampleWallet } }) + '\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } })
  }
  let body = frame({ role: 'assistant', content: '测试内容' })
  if (tools) {
    body += frame({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"name":' } }] })
    if (scenario !== 'incomplete') body += frame({ tool_calls: [{ index: 0, function: { arguments: '"doc"}' } }] })
  }
  body += frame({}, tools ? (scenario === 'stop-with-tools' ? 'stop' : 'tool_calls') : 'stop')
  if (scenario !== 'disconnected') body += 'event: ncurator.result\ndata: ' + JSON.stringify({ requestId, result: 'completed',
    billing: scenario === 'pending' ? { status: 'settlement_pending' }
      : { status: 'settled', feeDecision: scenario === 'incomplete' ? 'waive' : 'charge', wallet: sampleWallet }
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

it.each(['tools', 'stop-with-tools', 'pending', 'incomplete', 'disconnected'] as const)(
  'passes managed tool responses to the client and rejects only unusable terminal states (%s)',
  async (scenario) => {
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
        if (call && scenario !== 'incomplete') await lookup.invoke(call.args)
        return output
      })
      if (scenario === 'tools' || scenario === 'stop-with-tools') {
        expect(await result).toMatchObject({
          finishReason: scenario === 'stop-with-tools' ? 'stop' : 'tool_calls',
          message: { tool_calls: [{ name: 'lookup', args: { name: 'doc' } }] }
        })
        expect(executeTool).toHaveBeenCalledTimes(1)
      } else if (scenario === 'incomplete') {
        // Incomplete tool arguments stay client-side and are handed to the brain;
        // the wrapper must not turn them into a retryable provider failure.
        const output = await result
        expect(
          (output.message.tool_calls?.length ?? 0) + (output.message.invalid_tool_calls?.length ?? 0)
        ).toBeGreaterThan(0)
        expect(executeTool).not.toHaveBeenCalled()
      } else {
        await expect(result).rejects.toThrow()
        expect(executeTool).not.toHaveBeenCalled()
      }
      expect(onTextDelta).toHaveBeenCalledWith('测试内容')
      expect(fixture.submitted).toHaveLength(1)
      expect(fixture.lookedUp).toEqual(scenario === 'pending' || scenario === 'disconnected' ? [fixture.submitted[0].requestId] : [])
    } finally { fixture.cleanup() }
  }
)

it('retries an empty managed timeout once with a fresh request id', async () => {
  const fixture = managedDesktopFixture((requestId, attempt) => attempt === 1
    ? managedSse(requestId, 'timeout-empty') : managedSse(requestId, 'text'))
  try {
    await fixture.login()
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => resolveManagedRuntimeConfig('managed:9', '测试模型'), saveConfig: async () => {},
      checkCancelled: () => {} })
    await expect(executor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: '输入',
      streamingMode: 'force_stream' })).resolves.toBe('测试内容')
    expect(fixture.submitted).toHaveLength(2)
    expect(fixture.submitted[1].requestId).not.toBe(fixture.submitted[0].requestId)
  } finally { fixture.cleanup() }
})

it('uses the unified client attempts for empty timeouts, including charged attempts', async () => {
  const retrying = managedDesktopFixture((requestId, attempt) => attempt <= 5
    ? managedSse(requestId, 'timeout-empty') : managedSse(requestId, 'text'))
  try {
    await retrying.login()
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => resolveManagedRuntimeConfig('managed:9', '测试模型'), saveConfig: async () => {},
      checkCancelled: () => {} })
    await expect(executor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: '输入',
      streamingMode: 'force_stream' })).resolves.toBe('测试内容')
    expect(retrying.submitted).toHaveLength(6)
    expect(new Set(retrying.submitted.map(entry => entry.requestId)).size).toBe(6)
  } finally { retrying.cleanup() }

  const charged = managedDesktopFixture((requestId, attempt) => attempt <= 5
    ? managedSse(requestId, 'charged-timeout') : managedSse(requestId, 'text'))
  try {
    await charged.login()
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => resolveManagedRuntimeConfig('managed:9', '测试模型'), saveConfig: async () => {},
      checkCancelled: () => {} })
    await expect(executor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: '输入',
      streamingMode: 'force_stream' })).resolves.toBe('测试内容')
    expect(charged.submitted).toHaveLength(6)
    expect(new Set(charged.submitted.map(entry => entry.requestId)).size).toBe(6)
  } finally { charged.cleanup() }
})

it('retries a completed but empty charged response through the unified client attempts', async () => {
  const fixture = managedDesktopFixture((requestId, attempt) => attempt <= 5
    ? managedSse(requestId, 'empty') : managedSse(requestId, 'text'))
  try {
    await fixture.login()
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => resolveManagedRuntimeConfig('managed:9', '测试模型'), saveConfig: async () => {},
      checkCancelled: () => {} })
    await expect(executor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: '输入',
      streamingMode: 'force_stream' })).resolves.toBe('测试内容')
    expect(fixture.submitted).toHaveLength(6)
    expect(new Set(fixture.submitted.map(entry => entry.requestId)).size).toBe(6)
  } finally { fixture.cleanup() }
})

it('reports an exhausted empty completion as invalid_output with mechanism facts', async () => {
  const fixture = managedDesktopFixture(requestId => managedSse(requestId, 'empty'))
  try {
    await fixture.login()
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => resolveManagedRuntimeConfig('managed:9', '测试模型'), saveConfig: async () => {},
      checkCancelled: () => {} })
    const error = await executor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: '输入',
      streamingMode: 'force_stream' }).then(() => undefined, value => value)
    expect(findLlmProviderError(error)).toMatchObject({
      providerCode: 'invalid_output',
      billing: 'charged',
      retryable: true
    })
    expect(error.message).toContain('模型本次没有返回可用内容')
    expect(error.message).not.toMatch(/计费|费用/)
    expect(error.message).toContain('正文：无')
    expect(fixture.submitted).toHaveLength(6)
  } finally { fixture.cleanup() }
})

it('rejects tool calls from a text-only request without retrying', async () => {
  const fixture = managedDesktopFixture(requestId => managedSse(requestId, 'tools'))
  try {
    await fixture.login()
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => resolveManagedRuntimeConfig('managed:9', '测试模型'), saveConfig: async () => {},
      checkCancelled: () => {} })
    const error = await executor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: '输入',
      streamingMode: 'force_stream' }).then(() => undefined, value => value)
    expect(findLlmProviderError(error)).toMatchObject({
      providerCode: 'invalid_output',
      billing: 'charged',
      retryable: false
    })
    expect(error.message).not.toMatch(/计费|费用/)
    expect(fixture.submitted).toHaveLength(1)
  } finally { fixture.cleanup() }
})

it.each([['timeout', 'upstream_timeout'], ['interrupted', 'upstream_interrupted']] as const)(
  'maps a managed %s terminal to the unified provider failure',
  async (scenario, code) => {
    const fixture = managedDesktopFixture(requestId => managedSse(requestId, scenario))
    try {
      await fixture.login()
      const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
        getConfig: async () => resolveManagedRuntimeConfig('managed:9', '测试模型'), saveConfig: async () => {},
        checkCancelled: () => {} })
      const error = await executor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: '输入',
        streamingMode: 'force_stream' }).then(() => undefined, value => value)
      const provider = findLlmProviderError(error)
      expect(provider).toMatchObject({ providerCode: code, billing: 'waived' })
      expect(provider?.message).not.toMatch(/计费|费用/)
      expect(fixture.submitted).toHaveLength(6)
      expect(fixture.lookedUp).toEqual([])
    } finally { fixture.cleanup() }
  }
)

it('retries a partial timeout and resets the visible attempt before the retry', async () => {
  const fixture = managedDesktopFixture((requestId, attempt) => attempt === 1
    ? managedSse(requestId, 'timeout') : managedSse(requestId, 'tools'))
  try {
    await fixture.login()
    const onTextDelta = vi.fn()
    const onTextReset = vi.fn()
    const executeTool = vi.fn(async () => 'found')
    const lookup = tool(executeTool, { name: 'lookup', description: 'Lookup a fixture', schema: z.object({ name: z.string() }) })
    const executor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => resolveManagedRuntimeConfig('managed:9', '测试模型'), saveConfig: async () => {}, checkCancelled: () => {} })
    const result = await executor.chatTools({ caller: 'test', messages: [new HumanMessage('查资料')], tools: [lookup],
      streamingMode: 'force_stream', onTextDelta, onTextReset })
    expect(result).toMatchObject({ finishReason: 'tool_calls', message: { tool_calls: [{ name: 'lookup', args: { name: 'doc' } }] } })
    expect(onTextReset).toHaveBeenCalledTimes(1)
    expect(fixture.submitted).toHaveLength(2)
    expect(fixture.submitted[1].requestId).not.toBe(fixture.submitted[0].requestId)
    expect(fixture.lookedUp).toEqual([])
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

    const nextInput = { caller: 'test', schemaName: 'managed', system: '系统', user: 'isolated_disconnect',
      streamingMode: 'force_stream' } as const
    await expect(executor.chatText(nextInput)).rejects.toThrow()
    expect(fixture.submitted).toHaveLength(3)
    const nextExecutor = createAiLlmExecutor({ eventCtx: { runId: randomUUID(), sendEvent: () => {} },
      getConfig: async () => resolveManagedRuntimeConfig('managed:' + direct.modelId, '合成模型'),
      saveConfig: async () => {}, checkCancelled: () => {} })
    await expect(nextExecutor.chatText({ caller: 'test', schemaName: 'managed', system: '系统', user: 'isolated_disconnect',
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

function fixture(listenForCallback?: DesktopCallbackListener) {
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
  const post = vi.fn<(route: string, input?: Record<string, unknown>, token?: string) =>
    Promise<Record<string, unknown>>>(async (route, input) => {
    if (route === 'start') {
      state = String(input?.state)
      return { flowId: '23', expiresIn: 600, authorizationUrl: 'https://www.guanzhangai.cn/desktop/authorize#flow=23&state=' + state }
    }
    if (route === 'receipt' || route === 'abandon') return { ok: true }
    return value('first')
  })
  const openBrowser = vi.fn(async (url: string) => { openUrl = url })
  const changed = vi.fn()
  const profile = vi.fn<(token: string) => Promise<Record<string, unknown>>>(async () =>
    ({ userNo, maskedEmail: 's***@example.test' }))
  const wallet = vi.fn<(token: string) => Promise<Record<string, unknown>>>(async () => ({
    currency: 'CNY', available: '1234000000', balance: '1234000000',
    usageFrozen: '0', refundFrozen: '0', debt: '0', version: '2', settlementPending: false
  }))
  const managedCall = vi.fn<(requestId: string, token: string, signal?: AbortSignal) =>
    Promise<Record<string, unknown>>>(async () =>
    ({ status: 'settlement_pending' }))
  const account = new DesktopAccount(randomUUID(), { store, post, profile, wallet, managedCall, openBrowser, changed, listenForCallback })
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
  const deliver = registerDesktopAccount(() => fakeWindow, trustedUrl, {
    hasManagedSessionWork: () => false, stopManagedSession: async () => {}
  }, new ConfirmDialogWindowService())
  const command = electron.ipcMain.handle.mock.calls.at(-1)![1]
  let state = ''
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/start')) {
      state = JSON.parse(String(init.body)).state
      return Response.json({ flowId: '10', expiresIn: 600, authorizationUrl: 'https://www.guanzhangai.cn/desktop/authorize#flow=10&state=' + state })
    }
    return Response.json(value('local'))
  }))
  try {
    await expect(command({ sender, senderFrame: { ...frame } }, 'restore')).rejects.toThrow('desktop_account_forbidden')
    expect(await command(send, 'begin')).toEqual({ status: 'authorizing' })
    expect(frame.send).toHaveBeenCalledTimes(1)
    frame.url = 'https://example.invalid/'
    deliver('ncurator://auth/callback?code=' + secret() + '&state=' + state)
    await expect(command(send, 'restore')).rejects.toThrow('desktop_account_forbidden')
    await expect.poll(() => existsSync(join(dir, 'domestic-account', 'credentials.json'))).toBe(true)
    frame.url = trustedUrl
    await expect.poll(() => command(send, 'restore')).toEqual({ status: 'signed_in', userNo })
    expect(frame.send.mock.calls).toEqual([['desktop-account:changed', { status: 'authorizing' }]])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('shares one logout prompt, preserves work on cancellation and ignores a late confirmation for another login', async () => {
  const fixture = managedDesktopFixture(() => { throw new Error('unexpected model request') })
  const url = 'http://127.0.0.1:5173/'
  const frame = { url, send: vi.fn() }
  const sender = { mainFrame: frame, isDestroyed: () => false }
  const event = { sender, senderFrame: frame }
  const window = { webContents: sender, isDestroyed: () => false } as unknown as Electron.BrowserWindow
  let decision = Promise.withResolvers<ConfirmDialogResponse>()
  const show = vi.fn(() => decision.promise)
  const close = vi.fn()
  const dialogs = { show, close } as unknown as ConfirmDialogWindowService
  const stop = vi.fn<(session: AbortSignal) => Promise<void>>(async () => {})
  registerDesktopAccount(() => window, url, {
    hasManagedSessionWork: () => true, stopManagedSession: stop
  }, dialogs)
  const command = electron.ipcMain.handle.mock.calls.at(-1)![1]
  await command(event, 'restore')
  const account = currentDomesticDesktopAccount()
  const login = async () => {
    await command(event, 'begin')
    const target = electron.shell.openExternal.mock.calls.at(-1)![0] as string
    const state = new URLSearchParams(new URL(target).hash.slice(1)).get('state')
    await account.acceptCallback('ncurator://auth/callback?code=' + secret() + '&state=' + state)
    return account.getSessionSignal()
  }
  try {
    const firstSession = await login()
    stop.mockClear()
    const first = command(event, 'logout')
    const duplicate = command(event, 'logout')
    expect(show).toHaveBeenCalledTimes(1)
    decision.resolve({ success: true, action: 'cancel' })
    expect(await Promise.all([first, duplicate])).toEqual(Array(2).fill({ status: 'signed_in', userNo }))
    expect(firstSession.aborted).toBe(false)
    expect(stop).not.toHaveBeenCalled()

    decision = Promise.withResolvers()
    const stale = command(event, 'logout')
    account.clearLocalSession()
    const secondSession = await login()
    decision.resolve({ success: true, action: 'confirm' })
    expect(await stale).toEqual({ status: 'signed_in', userNo })
    expect(firstSession.aborted).toBe(true)
    expect(secondSession.aborted).toBe(false)
    expect(stop.mock.calls.map(([signal]) => signal)).toContain(firstSession)
    expect(stop.mock.calls.map(([signal]) => signal)).not.toContain(secondSession)

    decision = Promise.withResolvers()
    const confirmed = command(event, 'logout')
    decision.resolve({ success: true, action: 'confirm' })
    expect(await confirmed).toEqual({ status: 'signed_out' })
    expect(secondSession.aborted).toBe(true)
    expect(stop.mock.calls.filter(([signal]) => signal === secondSession)).toHaveLength(1)
  } finally { fixture.cleanup() }
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
  expect(start?.redirectUri).toBe('ncurator://auth/callback')
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

it('binds development callbacks to the active loopback listener', async () => {
  const focusWindow = vi.fn()
  const { account, post, callback, store, url } = fixture(accept => listenForDesktopCallback(accept, 'zh-CN', focusWindow))
  try {
    await account.begin()
    const start = post.mock.calls[0][1]!
    const target = String(start.redirectUri)
    expect(target).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]*\/auth\/callback$/)
    expect(new URL(url()).origin).toBe('https://www.guanzhangai.cn')
    const approved = callback()
    expect(await account.acceptCallback(approved)).toBeUndefined()
    const bad = await fetch(target + '?code=' + secret() + '&state=' + secret())
    expect(bad.status).toBe(400)
    expect(store.save).not.toHaveBeenCalled()
    const delivered = target + new URL(approved).search
    const result = await fetch(delivered)
    expect(result.status).toBe(200)
    expect(result.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(await result.text()).toContain('登录成功')
    expect(account.getSnapshot()).toEqual({ status: 'signed_in', userNo })
    expect(focusWindow).toHaveBeenCalledOnce()
    expect(post.mock.calls.find(call => call[0] === 'exchange')?.[1]?.redirectUri).toBe(target)
    await expect(fetch(delivered)).rejects.toThrow()
  } finally {
    await account.cancel()
  }
})

it('closes the development listener on cancellation, expiry and start failure', async () => {
  const { account, post } = fixture(accept => listenForDesktopCallback(accept, 'zh-CN', () => {}))
  const lastStart = () => String(post.mock.calls.findLast(call => call[0] === 'start')?.[1]?.redirectUri)
  try {
    await account.begin()
    const cancelled = lastStart()
    await account.cancel()
    expect(post).toHaveBeenLastCalledWith('cancel', expect.objectContaining({ redirectUri: cancelled }))
    await expect(fetch(cancelled)).rejects.toThrow()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await account.begin()
    const expired = lastStart()
    vi.advanceTimersByTime(600_000)
    vi.useRealTimers()
    expect(account.getSnapshot()).toEqual({ status: 'expired' })
    await expect(fetch(expired)).rejects.toThrow()

    post.mockRejectedValueOnce(new Error('synthetic offline'))
    await expect(account.begin()).rejects.toMatchObject({ code: 'unavailable' })
    await expect(fetch(lastStart())).rejects.toThrow()
  } finally {
    await account.cancel()
  }
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

it('restores and revokes a file-backed session and keeps failed saves and logouts recoverable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ncurator-account-test-'))
  const directory = join(dir, 'domestic-account')
  const path = join(directory, 'credentials.json')
  vi.stubEnv('NCURATOR_USER_DATA_PATH', dir)
  vi.stubEnv('NCURATOR_APP_SECRET_DESKTOP', 'synthetic-desktop-gateway-test-key')
  let state = ''
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/start')) {
      state = JSON.parse(String(init.body)).state
      return Response.json({ flowId: '10', expiresIn: 600, authorizationUrl: 'https://www.guanzhangai.cn/desktop/authorize#flow=10&state=' + state })
    }
    if (url.endsWith('/receipt')) return Response.json({ ok: true })
    return Response.json(value('stored'))
  }))
  const complete = async () => {
    const account = createDomesticDesktopAccount(() => {})
    await account.begin()
    return account.acceptCallback('ncurator://auth/callback?code=' + secret() + '&state=' + state)
  }
  try {
    await expect(createDomesticDesktopAccount(() => {}).restore()).resolves.toEqual({ status: 'signed_out' })
    mkdirSync(path, { recursive: true })
    await expect(complete()).rejects.toMatchObject({ code: 'storage_unavailable' })
    expect(readdirSync(directory).sort()).toEqual(['credentials.json', 'instance-id', 'restore-blocked'])
    rmSync(path, { recursive: true })

    expect(await complete()).toBe(userNo)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ userNo, refreshToken: value('stored').refreshToken })
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)

    const refresh = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toMatch(/\/refresh$/u)
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer ' + value('stored').refreshToken)
      return Response.json(value('rotated'))
    })
    vi.stubGlobal('fetch', refresh)
    await expect(createDomesticDesktopAccount(() => {}).restore()).resolves.toEqual({ status: 'signed_in', userNo })
    expect(refresh).toHaveBeenCalledTimes(1)
    const rotated = readFileSync(path, 'utf8')
    expect(JSON.parse(rotated)).toEqual({ userNo, refreshToken: value('rotated').refreshToken })

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'recovery_unavailable' }, { status: 503 })))
    await expect(createDomesticDesktopAccount(() => {}).accessToken()).rejects.toMatchObject({ code: 'recovery_unavailable' })
    expect(readFileSync(path, 'utf8')).toBe(rotated)
    const fetchLogout = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toMatch(/\/logout$/u)
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer ' + value('rotated').refreshToken)
      return Response.json({ ok: true })
    })
    vi.stubGlobal('fetch', fetchLogout)
    fetchLogout.mockRejectedValueOnce(new Error('synthetic network outage'))
    filesystem.denyCredentialDeletion = true
    await expect(createDomesticDesktopAccount(() => {}).logout()).rejects.toMatchObject({ code: 'logout_incomplete' })
    expect(readFileSync(path, 'utf8')).toBe(rotated)
    await expect(createDomesticDesktopAccount(() => {}).accessToken()).rejects.toMatchObject({ code: 'invalid_grant' })
    expect(fetchLogout).toHaveBeenCalledTimes(1)
    await expect(createDomesticDesktopAccount(() => {}).logout()).rejects.toMatchObject({ code: 'logout_incomplete' })
    await expect(createDomesticDesktopAccount(() => {}).accessToken()).rejects.toMatchObject({ code: 'invalid_grant' })
    expect(fetchLogout).toHaveBeenCalledTimes(2)
    filesystem.denyCredentialDeletion = false
    await expect(createDomesticDesktopAccount(() => {}).logout()).resolves.toBeUndefined()
    expect(existsSync(path)).toBe(false)
    await expect(createDomesticDesktopAccount(() => {}).restore()).resolves.toEqual({ status: 'signed_out' })
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
  managedCall.mockResolvedValueOnce({ status: 'settled', executionStatus: 'completed', feeDecision: 'charge', wallet: snapshot })
  await expect(scope.recover(requestId)).resolves.toEqual({
    status: 'settled',
    executionStatus: 'completed',
    feeDecision: 'charge'
  })
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
