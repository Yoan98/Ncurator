import { describe, it } from 'vitest'
import { loadBrowserE2ELlmConfigFromEnv } from '../../harness/e2e/browserLlmConfig'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import { waitForWorkbenchReady } from '../../harness/e2e/workbench'
import {
  openWorkbenchBrowserPanel,
  runBrowserPanelE2E,
  startWorkbenchBrowserFixtureServer
} from './browser-use-e2e-helpers'

const WORKBENCH_BROWSER_VISUAL_E2E_TIMEOUT_MS = 420_000
const VISUAL_CODE = 'VISUAL-CODE-7421'

const visualFixtureHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Browser Visual E2E Fixture</title>
    <style>
      html,
      body {
        min-height: 100%;
        margin: 0;
      }
      body {
        display: grid;
        place-items: center;
        background: #ffffff;
        color: #101010;
        font-family: Arial, Helvetica, sans-serif;
      }
      .code {
        border: 4px solid #101010;
        padding: 32px 42px;
        font-size: 52px;
        font-weight: 800;
        letter-spacing: 0;
      }
    </style>
  </head>
  <body>
    <main aria-label="visual verification">
      <div class="code">${VISUAL_CODE}</div>
    </main>
  </body>
</html>`

type VisualE2EResult = {
  modelName: string
  content: string
  normalizedContent: string
}

const normalizeCodeText = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '')

describe('workbench browser panel e2e', () => {
  it('browser-use-visual-qwen', async () => {
    await runE2ECase<VisualE2EResult>({
      caseId: 'browser-use-visual-qwen',
      domain: 'renderer',
      suite: 'workbench',
      description:
        'Workbench 右侧内嵌浏览器 visual 模式应能截图并通过 Qwen 视觉模型读取页面可见文本。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const fixture = await startWorkbenchBrowserFixtureServer({
          '/visual': visualFixtureHtml
        })

        try {
          const llmConfig = loadBrowserE2ELlmConfigFromEnv()
          runtime.signal({
            name: 'browser-visual-model',
            message: '加载 browser visual e2e 模型配置。',
            data: {
              baseUrl: llmConfig.base_url,
              modelName: llmConfig.model_name,
              providerKind: llmConfig.providerKind
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
            name: 'visual-extract-code',
            message: '通过 visual extract 截图并读取可见验证码文本。',
            run: async () =>
              await runBrowserPanelE2E(page, {
                action: 'extract',
                instruction:
                  'Read the large verification code visible in the browser screenshot. Return only the code.',
                url: fixture.url('/visual'),
                mode: 'visual',
                llmConfig
              })
          })

          if (extractResult.action !== 'extract') throw new Error('expected extract result')

          return {
            modelName: llmConfig.model_name,
            content: extractResult.content,
            normalizedContent: normalizeCodeText(extractResult.content)
          }
        } finally {
          await fixture.close()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.normalizedContent.includes(normalizeCodeText(VISUAL_CODE)),
          {
            name: 'visual-extract-reads-screenshot-code',
            message: 'visual extract 应通过截图和视觉模型读出页面上的固定文本。',
            data: {
              modelName: result.modelName,
              content: result.content,
              normalizedContent: result.normalizedContent
            }
          }
        )
      }
    })
  }, WORKBENCH_BROWSER_VISUAL_E2E_TIMEOUT_MS)
})
