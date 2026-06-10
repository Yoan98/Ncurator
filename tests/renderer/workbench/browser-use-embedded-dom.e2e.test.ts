import { describe, it } from 'vitest'
import { loadBrowserE2ELlmConfigFromEnv } from '../../harness/e2e/browserLlmConfig'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import { waitForWorkbenchReady } from '../../harness/e2e/workbench'
import {
  openWorkbenchBrowserPanel,
  runBrowserPanelE2E,
  startWorkbenchBrowserFixtureServer
} from './browser-use-e2e-helpers'

const WORKBENCH_BROWSER_DOM_E2E_TIMEOUT_MS = 420_000

const domFixtureHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Browser DOM E2E Fixture</title>
    <style>
      body {
        margin: 32px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #1f1f1f;
      }
      main {
        max-width: 720px;
      }
      #alpha-status {
        margin: 20px 0;
        font-size: 28px;
        font-weight: 700;
      }
      button {
        min-height: 44px;
        padding: 0 18px;
        border: 1px solid #1f1f1f;
        background: #ffffff;
        color: #1f1f1f;
        font-size: 16px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Browser DOM E2E Fixture</h1>
      <p id="alpha-status">Alpha status: idle</p>
      <button id="mark-complete" type="button">Mark Complete</button>
    </main>
    <script>
      document.getElementById('mark-complete').addEventListener('click', () => {
        document.getElementById('alpha-status').textContent = 'Alpha status: complete'
      })
    </script>
  </body>
</html>`

type DomE2EResult = {
  extractContent: string
  observedActionCount: number
  observedActionText: string
  actSuccess: boolean
  actMessage: string
  pageState: string
  finalContent: string
}

describe('workbench browser panel e2e', () => {
  it('browser-use-embedded-dom', async () => {
    await runE2ECase<DomE2EResult>({
      caseId: 'browser-use-embedded-dom',
      domain: 'renderer',
      suite: 'workbench',
      description:
        'Workbench 右侧内嵌浏览器应能连接 Stagehand DOM 能力完成 extract、observe、act，并真实改变页面状态。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const fixture = await startWorkbenchBrowserFixtureServer({
          '/dom': domFixtureHtml
        })

        try {
          const llmConfig = loadBrowserE2ELlmConfigFromEnv()
          const targetUrl = fixture.url('/dom')
          const preflightResponse = await fetch(targetUrl)
          const preflightText = await preflightResponse.text()
          runtime.signal({
            name: 'fixture-preflight',
            message: 'Node 侧预检本地浏览器 fixture 可达。',
            data: {
              status: preflightResponse.status,
              textLength: preflightText.length,
              requests: fixture.requests()
            }
          })

          await runtime.step({
            name: 'open-browser-panel',
            message: '打开 Workbench 右侧内置浏览器面板。',
            run: async () => {
              await waitForWorkbenchReady(page)
              await openWorkbenchBrowserPanel(page)
            }
          })

          const extractResult = await runtime.step({
            name: 'dom-extract-idle',
            message: '通过 Stagehand DOM extract 读取初始页面状态。',
            run: async () => {
              try {
                return await runBrowserPanelE2E(page, {
                  action: 'extract',
                  instruction: 'Extract the current Alpha status text. Return only that visible text.',
                  url: targetUrl,
                  mode: 'dom',
                  llmConfig
                })
              } catch (error) {
                runtime.signal({
                  name: 'fixture-requests-after-navigation-failure',
                  message: '记录浏览器导航失败时本地 fixture 收到的请求。',
                  status: 'failed',
                  data: {
                    requests: fixture.requests(),
                    error: error instanceof Error ? error.message : String(error)
                  }
                })
                throw error
              }
            }
          })

          const observeResult = await runtime.step({
            name: 'dom-observe-actions',
            message: '通过 Stagehand DOM observe 观察可执行动作。',
            run: async () =>
              await runBrowserPanelE2E(page, {
                action: 'observe',
                instruction: 'Find the action that marks the Alpha status complete.',
                mode: 'dom',
                llmConfig
              })
          })

          const actResult = await runtime.step({
            name: 'dom-act-complete',
            message: '通过 Stagehand DOM act 点击完成按钮。',
            run: async () =>
              await runBrowserPanelE2E(page, {
                action: 'act',
                instruction: 'Click the Mark Complete button.',
                mode: 'dom',
                llmConfig
              })
          })

          const finalExtractResult = await runtime.step({
            name: 'dom-extract-complete',
            message: '再次读取页面状态，确认真实页面已变化。',
            run: async () =>
              await runBrowserPanelE2E(page, {
                action: 'extract',
                instruction: 'Extract the current Alpha status text. Return only that visible text.',
                mode: 'dom',
                llmConfig
              })
          })

          if (extractResult.action !== 'extract') throw new Error('expected extract result')
          if (observeResult.action !== 'observe') throw new Error('expected observe result')
          if (actResult.action !== 'act') throw new Error('expected act result')
          if (finalExtractResult.action !== 'extract') throw new Error('expected final extract result')

          return {
            extractContent: extractResult.content,
            observedActionCount: observeResult.actions.length,
            observedActionText: observeResult.actions.map((action) => action.description).join('\n'),
            actSuccess: actResult.success,
            actMessage: actResult.message,
            pageState: actResult.pageState || '',
            finalContent: finalExtractResult.content
          }
        } finally {
          await fixture.close()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.extractContent.toLowerCase().includes('idle'), {
          name: 'dom-extract-reads-initial-state',
          message: 'DOM extract 应能读取内嵌浏览器页面的初始状态。',
          data: {
            extractContent: result.extractContent
          }
        })
        await runtime.assertThat(result.observedActionCount > 0, {
          name: 'dom-observe-returns-actions',
          message: 'DOM observe 应返回可执行动作。',
          data: {
            observedActionCount: result.observedActionCount,
            observedActionText: result.observedActionText
          }
        })
        await runtime.assertThat(
          result.actSuccess && result.pageState.toLowerCase().includes('complete'),
          {
            name: 'dom-act-mutates-page',
            message: 'DOM act 应真实点击页面按钮，并在页面状态中体现完成态。',
            data: {
              actSuccess: result.actSuccess,
              actMessage: result.actMessage,
              pageState: result.pageState
            }
          }
        )
        await runtime.assertThat(result.finalContent.toLowerCase().includes('complete'), {
          name: 'dom-extract-reads-mutated-state',
          message: '动作后再次 DOM extract 应读到页面完成态。',
          data: {
            finalContent: result.finalContent
          }
        })
      }
    })
  }, WORKBENCH_BROWSER_DOM_E2E_TIMEOUT_MS)
})
