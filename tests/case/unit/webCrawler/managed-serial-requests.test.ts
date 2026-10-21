import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ManagedWebCrawlerService } from '../../../../src/main/services/webCrawler/WebCrawlerService'
import type { WebCrawlerCdpConnection } from '../../../../src/main/services/webCrawler/ElectronWebCrawlerBrowserHost'

const connection: WebCrawlerCdpConnection = {
  browserWebSocketUrl: 'ws://127.0.0.1:9222/devtools/browser/protocol-peer',
  contextMarkerUrl: 'about:blank#ncurator-web-crawler-protocol-peer'
}

// This peer tests transport scheduling; it does not supply webpage/search evidence.
const peerProgram = String.raw`
const fs = require('node:fs');
require('node:readline').createInterface({input: process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  fs.appendFileSync(process.argv[1], JSON.stringify({query: request.input.query, pid: process.pid, cwd: process.cwd()}) + '\n');
  if (request.input.query === 'hold') return;
  setTimeout(() => console.log(JSON.stringify({id: request.id, ok: true, data: {query: request.input.query, results: []}})), 700);
});
`

const createPeer = async (
  resolveCdpConnection: () => Promise<WebCrawlerCdpConnection> = async () => connection
) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-serial-peer-'))
  const receiptPath = path.join(directory, 'receipts.jsonl')
  await fs.writeFile(receiptPath, '')
  const service = new ManagedWebCrawlerService({
    sidecarCommand: { executablePath: process.execPath, args: ['-e', peerProgram, receiptPath] },
    playwrightNodeExecutablePath: process.execPath,
    requestTimeoutMs: 1000,
    resolveCdpConnection
  })
  return {
    service,
    receipts: async () =>
      (await fs.readFile(receiptPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { query: string; pid: number; cwd: string }),
    close: async () => {
      await service.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
}

describe('managed sidecar serial transport', () => {
  it('isolates the runtime from the parent working directory and removes it on close', async () => {
    const peer = await createPeer()
    let cwd = ''
    try {
      await peer.service.search({ query: 'cwd' })
      cwd = (await peer.receipts())[0].cwd
      expect(cwd).not.toBe(process.cwd())
      expect(path.relative(cwd, process.execPath).startsWith('..')).toBe(true)
      expect(await fs.readdir(cwd)).toEqual([])
    } finally {
      await peer.close()
    }
    await expect(fs.access(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('starts queued deadlines on submission and recovers the timed-out process first', async () => {
    const peer = await createPeer()
    try {
      const first = peer.service.search({ query: 'hold' })
      const timedOut = expect(first).rejects.toThrow('request timeout')
      const next = peer.service.search({ query: 'after' })
      await timedOut
      expect((await next).query).toBe('after')
      const receipts = await peer.receipts()
      expect(receipts.map((receipt) => receipt.query)).toEqual(['hold', 'after'])
      expect(receipts[0].pid).not.toBe(receipts[1].pid)
    } finally {
      await peer.close()
    }
  })

  it('never submits a request cancelled while the shared process is starting', async () => {
    let release!: (value: WebCrawlerCdpConnection) => void
    const startup = new Promise<WebCrawlerCdpConnection>((resolve) => {
      release = resolve
    })
    const peer = await createPeer(() => startup)
    try {
      const controller = new AbortController()
      const cancelled = peer.service.search({ query: 'cancelled', abortSignal: controller.signal })
      const rejected = expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' })
      controller.abort()
      await rejected
      const next = peer.service.search({ query: 'after' })
      release(connection)
      expect((await next).query).toBe('after')
      expect((await peer.receipts()).map((receipt) => receipt.query)).toEqual(['after'])
    } finally {
      release(connection)
      await peer.close()
    }
  })
})
