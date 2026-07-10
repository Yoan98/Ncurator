import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it } from 'vitest'
import { settingsSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createModelConfigThroughSettingsUi,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

type ModelServerMode = 'success' | 'failure'

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

const startModelListServer = async (): Promise<{
  baseUrl: string
  setMode: (mode: ModelServerMode) => void
  close: () => Promise<void>
}> => {
  let mode: ModelServerMode = 'success'
  const server = createServer((request, response) => {
    if (request.url === '/v1/models') {
      if (mode === 'failure') {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: 'model list failed' }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(
        JSON.stringify({
          data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }]
        })
      )
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('failed to start model list server')
  }

  return {
    baseUrl: `http://127.0.0.1:${String((address as AddressInfo).port)}/v1`,
    setMode: (nextMode) => {
      mode = nextMode
    },
    close: async () => {
      await closeServer(server)
    }
  }
}

describe('settings model e2e', () => {
  it('model-remote-list-refresh', async () => {
    await runE2ECase({
      caseId: 'model-remote-list-refresh',
      domain: 'settings',
      suite: 'model',
      description: '连接配置可通过模型列表入口获取远端模型，并在失败时给出明确反馈。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const server = await startModelListServer()
        let successText = ''
        let failureText = ''

        try {
          await runtime.step({
            name: 'create-config-through-ui',
            message: '通过设置页 UI 新增一个指向本地 HTTP 服务的模型配置。',
            run: async () => {
              await createModelConfigThroughSettingsUi(page, {
                baseUrl: server.baseUrl,
                apiKey: 'sk-local-model-list'
              })
              await navigateToSettingsSection(page, 'model')
            }
          })

          const row = page.locator('tbody tr').filter({ hasText: server.baseUrl })
          const listButton = row.locator(`[data-testid^="${settingsSelectors.modelListButtonPrefix}-"]`)

          await runtime.step({
            name: 'open-model-list-success',
            message: '点击模型列表，真实请求本地 /models 并展示模型数量和条目。',
            run: async () => {
              server.setMode('success')
              await listButton.click()
              await row.filter({ hasText: '2 个模型' }).waitFor({ state: 'visible' })
              await page.getByText('gpt-4o-mini').waitFor({ state: 'visible' })
            }
          })

          successText = (await getSettingsLocator(page, settingsSelectors.modelTable).textContent()) || ''
          await page.locator('.ant-modal-close').click()
          await page.getByText('gpt-4o-mini').waitFor({ state: 'hidden' })

          await runtime.step({
            name: 'open-model-list-failed',
            message: '本地 /models 返回 500 后点击重新获取，确认 UI 进入失败态。',
            run: async () => {
              server.setMode('failure')
              await listButton.click()
              await getSettingsLocator(page, settingsSelectors.modelListRetryButton).click()
              await row.filter({ hasText: '获取失败' }).waitFor({ state: 'visible' })
              await page.getByText(/获取模型列表失败/u).waitFor({ state: 'visible' })
            }
          })

          failureText = (await getSettingsLocator(page, settingsSelectors.modelTable).textContent()) || ''
          return {
            successText,
            failureText
          }
        } finally {
          await server.close()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.successText.includes('2 个模型'), {
          name: 'remote-model-list-refresh-shows-count',
          message: '获取模型列表成功后，应展示可用模型数量，对齐 SET-MODEL-002-AC4。',
          data: result
        })

        await runtime.assertThat(result.failureText.includes('获取失败'), {
          name: 'remote-model-list-refresh-failure-shows-error-state',
          message: '获取模型列表失败时，应显示明确失败状态和错误提示，对齐 SET-MODEL-002-AC5。',
          data: result
        })
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS * 2)
})
