import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'

export const nodeOneMatrix = [
  'anonymous',
  'restart',
  'account-a-zero',
  'running-signout',
  'signed-out',
  'account-b-zero',
  'all-devices-revoked',
  'account-b-blocked'
] as const
export type NodeOneSendId = `${'F' | 'C'}0${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
export type NodeOneFailure =
  | 'closed'
  | 'permit'
  | 'input'
  | 'target'
  | 'upstream'
  | 'output'
  | 'format'
  | 'tool'
  | 'credential'
  | 'timeout'
  | 'disconnect'
  | 'evidence'

// No user-controlled text, header, URL or error enters the evidence sink.
export type NodeOneEvidence = {
  scenarioId: NodeOneSendId
  status: 'granted' | 'started' | 'completed' | 'rejected'
  code?: NodeOneFailure
  inputBytes?: number
  outputBytes?: number
  durationMs?: number
  invariant?: boolean
}
const evidenceKeys = new Set([
  'scenarioId',
  'status',
  'code',
  'inputBytes',
  'outputBytes',
  'durationMs',
  'invariant'
])
const failures = new Set<NodeOneFailure>([
  'closed',
  'permit',
  'input',
  'target',
  'upstream',
  'output',
  'format',
  'tool',
  'credential',
  'timeout',
  'disconnect',
  'evidence'
])
const diagnostics = new Set([
  'local-partners',
  'local-config',
  'local-selection',
  'local-workspaces',
  'local-file',
  'local-messages',
  'local-setup',
  'platform-delta',
  'formal-billing-delta',
  'nonempty-funds-baseline',
  'independent-web-session',
  'matrix-budget',
  'tools-executed'
])
export function nodeOneError(error: object | string): string {
  const message = error instanceof Error ? error.message : ''
  const value = message.replace(/^node-one:/u, '')
  return message.startsWith('node-one:') &&
    (failures.has(value as NodeOneFailure) || diagnostics.has(value))
    ? message
    : 'node-one:execution-failed'
}
export function safeNodeOneEvidence(value: NodeOneEvidence): NodeOneEvidence {
  if (
    Object.keys(value).some((key) => !evidenceKeys.has(key)) ||
    !/^[FC]0[1-8]$/u.test(value.scenarioId) ||
    !['granted', 'started', 'completed', 'rejected'].includes(value.status) ||
    (value.code !== undefined && !failures.has(value.code)) ||
    [value.inputBytes, value.outputBytes, value.durationMs].some(
      (n) => n !== undefined && (!Number.isSafeInteger(n) || n < 0)
    ) ||
    (value.invariant !== undefined && typeof value.invariant !== 'boolean')
  )
    throw new Error('node-one:evidence')
  return { ...value }
}

export class NodeOneBudget {
  private available = new Map<'F' | 'C', NodeOneSendId>()
  private used = new Set<NodeOneSendId>()
  private active = new Map<NodeOneSendId, AbortController>()
  private failure?: NodeOneFailure
  private timer: ReturnType<typeof setTimeout>
  constructor(
    private emit: (event: NodeOneEvidence) => void = () => {},
    caseMs = 600_000
  ) {
    this.timer = setTimeout(() => this.revoke('timeout'), caseMs)
    this.timer.unref()
  }
  observe(emit: (event: NodeOneEvidence) => void) {
    this.emit = emit
  }
  record(event: NodeOneEvidence) {
    try {
      this.emit(safeNodeOneEvidence(event))
    } catch {
      this.revoke('evidence')
      throw new Error('node-one:evidence')
    }
  }
  grant(id: NodeOneSendId) {
    const family = id[0] as 'F' | 'C'
    const index = Number(id.slice(1))
    if (
      this.failure ||
      !/^[FC]0[1-8]$/u.test(id) ||
      this.used.has(id) ||
      this.available.has(family) ||
      [...this.active.keys()].some((active) => active[0] === family) ||
      (index > 1 && !this.used.has(`${family}0${index - 1}` as NodeOneSendId)) ||
      (this.active.size > 0 &&
        (id.slice(1) !== '04' ||
          [...this.active.keys()].some((active) => active.slice(1) !== '04')))
    ) {
      this.revoke('permit')
      throw new Error('node-one:permit')
    }
    this.available.set(family, id)
    this.record({ scenarioId: id, status: 'granted' })
  }
  consume(family: 'F' | 'C') {
    const id = this.available.get(family)
    if (
      this.failure ||
      !id ||
      (this.active.size > 0 &&
        (id.slice(1) !== '04' ||
          [...this.active.keys()].some((active) => active.slice(1) !== '04')))
    ) {
      this.revoke('permit')
      throw new Error('node-one:permit')
    }
    this.available.delete(family)
    this.used.add(id)
    const abort = new AbortController()
    this.active.set(id, abort)
    this.record({ scenarioId: id, status: 'started' })
    return { id, abort }
  }
  finish(id: NodeOneSendId) {
    this.active.delete(id)
  }
  revoke(code: NodeOneFailure) {
    this.failure ||= code
    this.available.clear()
    for (const abort of this.active.values()) abort.abort()
    this.active.clear()
    clearTimeout(this.timer)
  }
  get state() {
    return {
      closed: !!this.failure,
      code: this.failure,
      sends: this.used.size,
      active: this.active.size
    }
  }
}

const fail = (code: NodeOneFailure): never => {
  throw new Error('node-one:' + code)
}
export async function readNodeOneStream(
  body: ReadableStream<Uint8Array>,
  abort: AbortController,
  {
    maxBytes = 16 * 1024,
    secrets = [],
    onBytes = () => {}
  }: {
    maxBytes?: number
    secrets?: string[]
    onBytes?: (bytes: number) => void
  } = {}
) {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      onBytes(bytes)
      // The threshold is enforced during reading, before storing or forwarding this chunk.
      if (bytes >= maxBytes) {
        abort.abort()
        fail('output')
      }
      chunks.push(next.value)
    }
    const buffer = Buffer.concat(chunks)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    const variants = secrets
      .filter(Boolean)
      .flatMap((secret) => [
        secret,
        encodeURIComponent(secret),
        Buffer.from(secret).toString('base64'),
        Buffer.from(secret).toString('base64url'),
        createHash('sha256').update(secret).digest('hex')
      ])
    if (variants.some((secret) => text.includes(secret))) fail('credential')
    if (!text.trimEnd().endsWith('data: [DONE]')) fail('format')
    let content = false
    for (const line of text.split('\n').filter((line) => line.startsWith('data: '))) {
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      const frame = JSON.parse(data)
      if (!frame || !Array.isArray(frame.choices)) fail('format')
      for (const choice of frame.choices) {
        const delta = choice.delta || choice.message || {}
        if (
          (delta.tool_calls && (!Array.isArray(delta.tool_calls) || delta.tool_calls.length)) ||
          delta.function_call ||
          choice.finish_reason === 'tool_calls' ||
          choice.finish_reason === 'function_call'
        )
          fail('tool')
        if (typeof delta.content === 'string' && delta.content.trim()) content = true
      }
    }
    if (!content) fail('format')
    return { buffer, bytes }
  } catch (error) {
    abort.abort()
    await reader.cancel().catch(() => {})
    if (error instanceof Error && /^node-one:(output|credential|tool|format)$/u.test(error.message))
      throw error
    fail('format')
  } finally {
    reader.releaseLock()
  }
}

export async function startNodeOneProxy(input: {
  freeTarget: string
  customTarget: string
  customKey: string
  customModel: string
  freeId: string
  evidence?: (event: NodeOneEvidence) => void
  requestMs?: number
  caseMs?: number
  fetchUpstream?: typeof fetch
}) {
  for (const target of [input.freeTarget, input.customTarget]) {
    const url = new URL(target)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.search || url.hash)
      fail('target')
  }
  const budget = new NodeOneBudget(input.evidence, input.caseMs)
  const held = new Map<NodeOneSendId, { promise: Promise<void>; release: () => void }>()
  const server = createServer((request, reply) => {
    void handle(request, reply)
  })
  async function handle(request: IncomingMessage, reply: ServerResponse) {
    let id: NodeOneSendId | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: AbortController | undefined
    let timedOut = false
    const started = Date.now()
    const disconnected = () => {
      if (!reply.writableFinished) budget.revoke('disconnect')
    }
    request.once('aborted', disconnected)
    reply.once('close', disconnected)
    try {
      if (
        request.method !== 'POST' ||
        !['/free', '/custom/chat/completions'].includes(request.url || '')
      )
        fail('target')
      const family = request.url === '/free' ? 'F' : 'C'
      ;({ id, abort } = budget.consume(family))
      timer = setTimeout(() => {
        timedOut = true
        budget.revoke('timeout')
        reply.destroy()
      }, input.requestMs ?? 30_000)
      const chunks: Buffer[] = []
      let bytes = 0
      // Keep an early exit from destroying the request before reporting its input error.
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length
        if (bytes > 64 * 1024) fail('input')
        chunks.push(chunk)
      }
      const original = Buffer.concat(chunks)
      const body = JSON.parse(original.toString())
      if (
        body.model !== (family === 'F' ? input.freeId : input.customModel) ||
        body.stream !== true
      )
        fail('target')
      if (family === 'C') {
        for (const key of [
          'tools',
          'functions',
          'tool_choice',
          'function_call',
          'parallel_tool_calls'
        ])
          delete body[key]
        body.max_tokens = 256
      }
      const headers =
        family === 'F'
          ? new Headers(
              Object.entries(request.headers).flatMap(([key, value]) =>
                typeof value === 'string' && !['host', 'content-length', 'connection'].includes(key)
                  ? [[key, value]]
                  : []
              )
            )
          : new Headers({
              'content-type': 'application/json',
              authorization: 'Bearer ' + input.customKey
            })
      const response = await (input.fetchUpstream || fetch)(
        family === 'F' ? input.freeTarget : input.customTarget,
        {
          method: 'POST',
          headers,
          body: family === 'F' ? original : JSON.stringify(body),
          redirect: 'error',
          signal: abort.signal
        }
      )
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get('content-type')?.startsWith('text/event-stream')
      )
        fail('upstream')
      const secrets = [
        input.customKey,
        headers.get('authorization')?.replace(/^Bearer /u, '') || '',
        ...[...headers]
          .filter(([key]) => /signature|nonce|token|secret/iu.test(key))
          .map(([, value]) => value)
      ]
      const output = await readNodeOneStream(response.body, abort, { secrets })
      const hold = held.get(id)
      if (hold)
        await Promise.race([
          hold.promise,
          new Promise<never>((_, reject) => {
            if (abort!.signal.aborted) reject(new Error('node-one:closed'))
            else
              abort!.signal.addEventListener('abort', () => reject(new Error('node-one:closed')), {
                once: true
              })
          })
        ])
      if (budget.state.closed || abort.signal.aborted) fail('closed')
      budget.record({
        scenarioId: id,
        status: 'completed',
        inputBytes: bytes,
        outputBytes: output.bytes,
        durationMs: Date.now() - started
      })
      reply.writeHead(200, { 'content-type': 'text/event-stream' }).end(output.buffer)
    } catch (error) {
      const match = error instanceof Error && /^node-one:([a-z]+)$/u.exec(error.message)
      const code = timedOut
        ? 'timeout'
        : match && failures.has(match[1] as NodeOneFailure)
          ? (match[1] as NodeOneFailure)
          : 'upstream'
      budget.revoke(code)
      if (id) budget.record({ scenarioId: id, status: 'rejected', code })
      if (!reply.destroyed)
        reply
          .writeHead(502, { 'content-type': 'application/json' })
          .end('{"error":"node_one_guard"}')
    } finally {
      clearTimeout(timer)
      if (id) {
        budget.finish(id)
        held.delete(id)
      }
    }
  }
  await new Promise<void>((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (!address || typeof address === 'string') fail('target')
  return {
    origin: 'http://127.0.0.1:' + address.port,
    budget,
    hold(id: NodeOneSendId) {
      let release!: () => void
      const promise = new Promise<void>((done) => {
        release = done
      })
      held.set(id, { promise, release })
    },
    release() {
      for (const hold of held.values()) hold.release()
    },
    async close() {
      budget.revoke('closed')
      for (const hold of held.values()) hold.release()
      server.closeAllConnections()
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(new Error('node-one:closed')) : done()))
      )
    }
  }
}
