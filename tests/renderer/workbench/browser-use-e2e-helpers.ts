import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Page } from 'playwright'
import type { BrowserUseResult } from '../../../src/main/services/ai/types'
import type { BrowserPanelE2ERunRequest, JsonValue } from '../../../src/shared/types'
import { workbenchSelectors } from '../../../src/renderer/src/testing/selectors'
import { getWorkbenchLocator } from '../../harness/e2e/workbench'

type FixtureRoute = {
  statusCode?: number
  headers?: Record<string, string>
  body: string
}

type FixtureServer = {
  url: (pathname: string) => string
  requests: () => readonly string[]
  close: () => Promise<void>
}

const defaultHeaders = {
  'Content-Type': 'text/html; charset=utf-8'
} as const

const normalizeRoute = (route: string | FixtureRoute): FixtureRoute =>
  typeof route === 'string'
    ? {
        body: route
      }
    : route

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export const startWorkbenchBrowserFixtureServer = async (
  routes: Record<string, string | FixtureRoute>
): Promise<FixtureServer> => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
    requests.push(pathname)
    const route = routes[pathname]
    if (!route) {
      response.writeHead(404, defaultHeaders)
      response.end('<!doctype html><title>Not Found</title><body>Not Found</body>')
      return
    }

    const normalized = normalizeRoute(route)
    response.writeHead(normalized.statusCode || 200, {
      ...defaultHeaders,
      ...(normalized.headers || {})
    })
    response.end(normalized.body)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${String(address.port)}`
  return {
    url: (pathname) => `${origin}${pathname.startsWith('/') ? pathname : `/${pathname}`}`,
    requests: () => [...requests],
    close: async () => {
      await closeServer(server)
    }
  }
}

const isJsonObject = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toBrowserUseResult = (value: JsonValue | undefined): BrowserUseResult => {
  if (!isJsonObject(value)) {
    throw new Error('browser panel e2e returned empty result')
  }
  if (value.action !== 'extract' && value.action !== 'observe' && value.action !== 'act') {
    throw new Error('browser panel e2e returned invalid action result')
  }
  return value as BrowserUseResult
}

export const openWorkbenchBrowserPanel = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('ncurator-e2e-open-browser-panel'))
  })
  await getWorkbenchLocator(page, workbenchSelectors.browserPanel).waitFor({ state: 'visible' })
  await getWorkbenchLocator(page, workbenchSelectors.browserViewport).waitFor({ state: 'visible' })
  await page.evaluate(async (testId) => {
    const element = document.querySelector(`[data-testid="${testId}"]`)
    if (!(element instanceof HTMLElement)) {
      throw new Error('browser viewport not found')
    }
    const rect = element.getBoundingClientRect()
    const boundsResponse = await window.api.browserPanelSetBounds({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      visible: rect.width > 0 && rect.height > 0
    })
    if (!boundsResponse.success) {
      throw new Error(boundsResponse.error || 'browser panel bounds sync failed')
    }
    const showResponse = await window.api.browserPanelShow()
    if (!showResponse.success) {
      throw new Error(showResponse.error || 'browser panel show failed')
    }
  }, workbenchSelectors.browserViewport)
}

export const runBrowserPanelE2E = async (
  page: Page,
  payload: BrowserPanelE2ERunRequest
): Promise<BrowserUseResult> => {
  const response = await page.evaluate(
    async (input) => await window.api.browserPanelE2ERun(input),
    payload
  )
  if (!response.success) {
    throw new Error(response.error || 'browser panel e2e run failed')
  }
  return toBrowserUseResult(response.result)
}
