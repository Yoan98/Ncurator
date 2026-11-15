import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import {
  NodeOneBudget,
  readNodeOneStream,
  safeNodeOneEvidence,
  startNodeOneProxy,
  type NodeOneEvidence
} from '../../../harness/e2e/nodeOneAcceptance'

const frame = (delta: object, finish_reason: string | null = null) =>
  'data: ' +
  JSON.stringify({
    choices: [{ index: 0, delta, finish_reason }]
  }) +
  '\n\n'
const normal = frame({ content: 'Synthetic output.' }) + frame({}, 'stop') + 'data: [DONE]\n\n'
const encode = (value: string) => new TextEncoder().encode(value)
const stream = (value: string) => new Response(value).body!

it('allows exactly eight sends per family, rejects repeats and revokes all future permits', () => {
  const records: NodeOneEvidence[] = []
  const budget = new NodeOneBudget((record) => records.push(record))
  for (let stage = 1; stage <= 8; stage++) {
    for (const family of ['F', 'C'] as const) {
      const id = `${family}0${stage}` as Parameters<typeof budget.grant>[0]
      budget.grant(id)
      const work = budget.consume(family)
      expect(work.id).toBe(id)
      budget.finish(work.id)
    }
  }
  expect(budget.state).toMatchObject({ sends: 16, active: 0, closed: false })
  expect(() => budget.grant('C08')).toThrow('node-one:permit')
  expect(budget.state.closed).toBe(true)
  expect(records.filter((r) => r.status === 'started')).toHaveLength(16)
})

it('permits overlap only for the running signout pair and aborts both on violation', () => {
  const budget = new NodeOneBudget()
  for (const stage of [1, 2, 3])
    for (const family of ['F', 'C'] as const) {
      budget.grant(`${family}0${stage}` as Parameters<typeof budget.grant>[0])
      budget.finish(budget.consume(family).id)
    }
  budget.grant('F04')
  const free = budget.consume('F')
  budget.grant('C04')
  const custom = budget.consume('C')
  expect(budget.state.active).toBe(2)
  expect(() => budget.consume('C')).toThrow('node-one:permit')
  expect(free.abort.signal.aborted && custom.abort.signal.aborted).toBe(true)
  expect(() => budget.grant('F05')).toThrow('node-one:permit')
})

it('aborts at the cumulative 16 KiB threshold before the stream finishes', async () => {
  let reads = 0
  let cancelled = false
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads++
        controller.enqueue(new Uint8Array(8192))
      },
      cancel() {
        cancelled = true
      }
    },
    { highWaterMark: 0 }
  )
  const abort = new AbortController()
  const counts: number[] = []
  await expect(readNodeOneStream(body, abort, { onBytes: (n) => counts.push(n) })).rejects.toThrow(
    'node-one:output'
  )
  expect(reads).toBe(2)
  expect(counts).toEqual([8192, 16384])
  expect(cancelled && abort.signal.aborted).toBe(true)
})

it.each([
  [
    frame({ tool_calls: [{ index: 0, id: 'test', function: { name: 'synthetic_tool' } }] }) +
      'data: [DONE]\n\n',
    'tool'
  ],
  [frame({ function_call: { name: 'synthetic_tool' } }) + 'data: [DONE]\n\n', 'tool'],
  [frame({ content: 'SYNTHETIC_PRIVATE_CANARY' }) + 'data: [DONE]\n\n', 'credential'],
  ['data: {broken}\n\n', 'format'],
  [frame({ content: 'truncated' }), 'format']
])('rejects unsafe or incomplete responses without returning them (%#)', async (value, code) => {
  const abort = new AbortController()
  await expect(
    readNodeOneStream(stream(value), abort, { secrets: ['SYNTHETIC_PRIVATE_CANARY'] })
  ).rejects.toThrow('node-one:' + code)
  expect(abort.signal.aborted).toBe(true)
})

it('uses a strict evidence schema, rejecting unapproved payload and error fields', () => {
  const event = { scenarioId: 'C01', status: 'started' } as const
  expect(safeNodeOneEvidence(event)).toEqual(event)
  for (const extra of [
    { body: 'SYNTHETIC_PRIVATE_CANARY' },
    { headers: {} },
    { error: 'raw' },
    { cause: 'raw' }
  ]) {
    expect(() => safeNodeOneEvidence({ ...event, ...extra })).toThrow('node-one:evidence')
  }
  expect(() => safeNodeOneEvidence({ ...event, durationMs: NaN })).toThrow('node-one:evidence')
  const budget = new NodeOneBudget(() => {
    throw new Error('synthetic sink exception')
  })
  expect(() => budget.grant('C01')).toThrow('node-one:evidence')
  expect(budget.state).toMatchObject({ closed: true, code: 'evidence' })
})

it('strips tools before the custom hop, never forwards upstream errors and denies retry', async () => {
  const evidence: NodeOneEvidence[] = []
  let hits = 0
  const proxy = await startNodeOneProxy({
    freeTarget: 'http://127.0.0.1:1/free',
    customTarget: 'http://127.0.0.1:1/custom',
    customModel: 'gpt-6-luna',
    customKey: 'SYNTHETIC_PRIVATE_CANARY',
    freeId: '1',
    evidence: (r) => evidence.push(r),
    fetchUpstream: async (_target, init) => {
      hits++
      const body = JSON.parse(String(init?.body))
      expect(
        Object.hasOwn(body, 'tools') ||
          Object.hasOwn(body, 'functions') ||
          Object.hasOwn(body, 'tool_choice')
      ).toBe(false)
      expect(body.max_tokens).toBe(256)
      return new Response('SYNTHETIC_PRIVATE_CANARY', { status: 401 })
    }
  })
  try {
    proxy.budget.grant('C01')
    const response = await fetch(proxy.origin + '/custom/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-6-luna',
        stream: true,
        tools: [{ type: 'function' }],
        functions: [],
        tool_choice: 'auto'
      })
    })
    expect(response.status).toBe(502)
    expect(await response.text()).toBe('{"error":"node_one_guard"}')
    expect(() => proxy.budget.grant('C02')).toThrow('node-one:permit')
    expect(hits).toBe(1)
    expect(JSON.stringify(evidence).includes('SYNTHETIC_PRIVATE_CANARY')).toBe(false)
  } finally {
    await proxy.close()
  }
})

it('closes subsequent egress on timeout, malformed input and shutdown', async () => {
  const upstream = createServer(() => {})
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('synthetic port missing')
  const target = 'http://127.0.0.1:' + address.port
  const proxy = await startNodeOneProxy({
    freeTarget: target,
    customTarget: target,
    customKey: 'synthetic',
    customModel: 'gpt-6-luna',
    freeId: '1',
    requestMs: 30
  })
  try {
    proxy.budget.grant('C01')
    await fetch(proxy.origin + '/custom/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-6-luna', stream: true })
    }).catch(() => {})
    expect(proxy.budget.state).toMatchObject({ closed: true, code: 'timeout' })
    expect(() => proxy.budget.grant('F01')).toThrow('node-one:permit')
  } finally {
    await proxy.close()
    upstream.closeAllConnections()
    await new Promise<void>((done) => upstream.close(() => done()))
  }
  const stopped = new NodeOneBudget()
  stopped.grant('C01')
  stopped.revoke('closed')
  expect(() => stopped.consume('C')).toThrow('node-one:permit')
})

it('accepts valid SSE bytes unchanged without claiming a generated token cap', async () => {
  const result = await readNodeOneStream(stream(normal), new AbortController())
  expect(result.buffer).toEqual(Buffer.from(encode(normal)))
})

it('revokes every later permit when the consumer disconnects during a request', async () => {
  let hits = 0
  const proxy = await startNodeOneProxy({
    freeTarget: 'http://127.0.0.1:1/free',
    customTarget: 'http://127.0.0.1:1/custom',
    customModel: 'gpt-6-luna',
    customKey: 'synthetic',
    freeId: '1',
    fetchUpstream: async (_url, init) => {
      hits++
      return new Promise<Response>((_done, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('synthetic abort')), {
          once: true
        })
      })
    }
  })
  try {
    proxy.budget.grant('C01')
    const consumer = new AbortController()
    const request = fetch(proxy.origin + '/custom/chat/completions', {
      method: 'POST',
      signal: consumer.signal,
      body: JSON.stringify({ model: 'gpt-6-luna', stream: true })
    }).catch(() => {})
    await expect.poll(() => hits).toBe(1)
    consumer.abort()
    await request
    await expect.poll(() => proxy.budget.state.closed).toBe(true)
    expect(() => proxy.budget.grant('F01')).toThrow('node-one:permit')
    expect(hits).toBe(1)
  } finally {
    await proxy.close()
  }
})

it('rejects an oversized input before any upstream request', async () => {
  let hits = 0
  const proxy = await startNodeOneProxy({
    freeTarget: 'http://127.0.0.1:1/free',
    customTarget: 'http://127.0.0.1:1/custom',
    customModel: 'gpt-6-luna',
    customKey: 'synthetic',
    freeId: '1',
    fetchUpstream: async () => {
      hits++
      return new Response(normal)
    }
  })
  try {
    proxy.budget.grant('C01')
    const response = await fetch(proxy.origin + '/custom/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-6-luna',
        stream: true,
        messages: [{ role: 'user', content: 'x'.repeat(65536) }]
      })
    })
    expect(response.status).toBe(502)
    expect(proxy.budget.state).toMatchObject({ closed: true, code: 'input' })
    expect(hits).toBe(0)
  } finally {
    await proxy.close()
  }
})
