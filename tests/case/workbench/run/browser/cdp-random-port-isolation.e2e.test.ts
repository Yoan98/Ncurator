import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  DEVTOOLS_ACTIVE_PORT_FILENAME,
  parseDevToolsActivePort
} from '../../../../../src/main/services/browser/CdpEndpointService'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'

const CASE_ID = 'cdp-random-port-isolation'
let occupiedPortServer: Server | null = null

const occupyLegacyPort = async (): Promise<void> => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve()
        return
      }
      reject(error)
    })
    server.listen(9333, '127.0.0.1', () => {
      occupiedPortServer = server
      resolve()
    })
  })
}

const readCdpPort = async (userDataDir: string): Promise<number> => {
  const deadline = Date.now() + 10_000
  let latestError: unknown
  while (Date.now() < deadline) {
    try {
      const activePort = parseDevToolsActivePort(
        await readFile(path.join(userDataDir, DEVTOOLS_ACTIVE_PORT_FILENAME), 'utf8')
      )
      const response = await fetch(`http://127.0.0.1:${String(activePort.port)}/json/version`)
      if (!response.ok) throw new Error(`CDP endpoint returned ${response.status}`)
      return activePort.port
    } catch (error) {
      latestError = error
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
  }
  throw latestError instanceof Error ? latestError : new Error('CDP endpoint did not become ready')
}

beforeAll(occupyLegacyPort)

afterAll(async () => {
  if (!occupiedPortServer) return
  await new Promise<void>((resolve, reject) => {
    occupiedPortServer?.close((error) => (error ? reject(error) : resolve()))
  })
})

describe('workbench browser CDP e2e', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'run',
      groups: ['browser'],
      description: '占用旧的 9333 端口后启动 Electron，验证应用自动选择可用的随机回环 CDP 端口。',
      fixtures: [],
      serviceMode: 'fixture',
      fixtureReason: '只验证 Electron CDP 监听和端口冲突恢复，不调用模型或业务服务。',
      windowMode: 'background',
      runMode: 'single',
      execute: async (runtime) => {
        return { cdpPort: await readCdpPort(runtime.userDataDir) }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.cdpPort !== 9333, {
          name: 'electron-cdp-random-port-isolation',
          message: '9333 被占用时 Electron 仍应启动，并自动选择其他随机 CDP 端口。',
          data: result
        })
      }
    })
  })
})
