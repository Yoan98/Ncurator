import { shell, WebContentsView } from 'electron'
import type { BrowserWindow, Rectangle, WebContents } from 'electron'
import { z } from 'zod/v4'
import { normalizeOpenAIBaseUrl } from '../../../shared/llmBaseUrl'
import type { BrowserUseActionItem, BrowserUseService } from '../ai/types'
import {
  EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS,
  EMBEDDED_BROWSER_PARTITION,
  EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT,
  EMBEDDED_BROWSER_STAGEHAND_TIMEOUT_MS
} from './constants'
import type {
  BrowserPanelBoundsState,
  BrowserUseRunInput,
  BrowserUseRunResult,
  OpenAIChatMessage,
  OpenAICompatibleChatClient,
  OpenAICompatibleChatCompletionResponse
} from './types'

type StagehandModule = typeof import('@browserbasehq/stagehand')
type StagehandInstance = InstanceType<StagehandModule['Stagehand']>
type StagehandCustomClientParams = ConstructorParameters<StagehandModule['CustomOpenAIClient']>[0]

const visualObserveSchema = z.object({
  actions: z.array(
    z.object({
      description: z.string(),
      method: z.string().optional()
    })
  )
})

const visualActSchema = z.object({
  action: z.enum(['click', 'type', 'none']),
  x: z.number().optional(),
  y: z.number().optional(),
  text: z.string().optional(),
  message: z.string().optional()
})

const normalizeUrl = (rawUrl: string): string => {
  const parsed = new URL(String(rawUrl || '').trim())
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('browser_use only supports http/https URL navigation')
  }
  return parsed.toString()
}

const waitForWebContentsLoad = async (webContents: WebContents): Promise<void> => {
  if (!webContents.isLoadingMainFrame()) return
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`browser navigation timed out after ${EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS}ms`))
    }, EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS)
    const cleanup = (): void => {
      clearTimeout(timeout)
      webContents.removeListener('did-finish-load', onDone)
      webContents.removeListener('did-fail-load', onFail)
    }
    const onDone = (): void => {
      cleanup()
      resolve()
    }
    const onFail = (_event: Electron.Event, _errorCode: number, errorDescription: string): void => {
      cleanup()
      reject(new Error(errorDescription || 'browser navigation failed'))
    }
    webContents.once('did-finish-load', onDone)
    webContents.once('did-fail-load', onFail)
  })
}

const loadWebContentsUrl = async (webContents: WebContents, url: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error(`browser navigation timed out after ${EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS}ms`))
    }, EMBEDDED_BROWSER_NAVIGATION_TIMEOUT_MS)

    const cleanup = (): void => {
      clearTimeout(timeout)
      webContents.removeListener('dom-ready', onDone)
      webContents.removeListener('did-navigate', onDone)
      webContents.removeListener('did-finish-load', onDone)
      webContents.removeListener('did-stop-loading', onDone)
      webContents.removeListener('did-fail-load', onFail)
    }
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        reject(error)
        return
      }
      resolve()
    }
    const onDone = (): void => {
      finish()
    }
    const onFail = (
      _event: Electron.Event,
      _errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean
    ): void => {
      if (!isMainFrame) return
      finish(new Error(errorDescription || 'browser navigation failed'))
    }

    webContents.once('dom-ready', onDone)
    webContents.once('did-navigate', onDone)
    webContents.once('did-finish-load', onDone)
    webContents.once('did-stop-loading', onDone)
    webContents.on('did-fail-load', onFail)
    void webContents.loadURL(url).catch((error) => {
      finish(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

const parseJsonFromModelText = (text: string): object => {
  const trimmed = String(text || '').trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const firstBrace = withoutFence.indexOf('{')
  const lastBrace = withoutFence.lastIndexOf('}')
  const jsonText =
    firstBrace >= 0 && lastBrace > firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence
  return JSON.parse(jsonText) as object
}

const stringifyStagehandExtraction = (value: object): string => {
  if ('extraction' in value && typeof value.extraction === 'string') return value.extraction
  if ('pageText' in value && typeof value.pageText === 'string') return value.pageText
  return JSON.stringify(value)
}

const normalizeOpenAIChatResponse = (payload: object): OpenAICompatibleChatCompletionResponse => {
  const parsed = z
    .object({
      choices: z.array(
        z.object({
          message: z.object({
            content: z.string().nullable()
          })
        })
      ),
      usage: z
        .object({
          prompt_tokens: z.number().optional(),
          completion_tokens: z.number().optional(),
          total_tokens: z.number().optional()
        })
        .optional()
    })
    .parse(payload)
  return parsed
}

export class BrowserEmbedService implements BrowserUseService {
  private readonly mainWindow: BrowserWindow
  private view: WebContentsView | null = null
  private bounds: BrowserPanelBoundsState = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    visible: false
  }

  public constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  public async show(): Promise<void> {
    this.ensureView()
    this.bounds = {
      ...this.bounds,
      visible: true
    }
    this.applyBounds()
  }

  public hide(): void {
    this.bounds = {
      ...this.bounds,
      visible: false
    }
    this.applyBounds()
  }

  public setBounds(bounds: BrowserPanelBoundsState): void {
    this.bounds = bounds
    this.applyBounds()
  }

  public async navigate(rawUrl: string): Promise<void> {
    const view = this.ensureView()
    const url = normalizeUrl(rawUrl)
    if (view.webContents.getURL() !== url) {
      await loadWebContentsUrl(view.webContents, url)
      return
    }
    await waitForWebContentsLoad(view.webContents)
  }

  public reload(): void {
    this.ensureView().webContents.reload()
  }

  public openExternal(): void {
    const url = this.view?.webContents.getURL()
    if (!url) return
    void shell.openExternal(url)
  }

  public async run(input: BrowserUseRunInput): Promise<BrowserUseRunResult> {
    await this.show()
    if (input.url) {
      await this.navigate(input.url)
    }
    if (input.mode === 'visual') {
      return await this.runVisual(input)
    }
    return await this.runDom(input)
  }

  private ensureView(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view

    this.view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        partition: EMBEDDED_BROWSER_PARTITION
      }
    })
    this.view.webContents.setWindowOpenHandler((details) => {
      void this.view?.webContents.loadURL(details.url)
      return { action: 'deny' }
    })
    this.mainWindow.contentView.addChildView(this.view)
    this.applyBounds()
    return this.view
  }

  private applyBounds(): void {
    if (!this.view || this.view.webContents.isDestroyed()) return
    const visible =
      this.bounds.visible && this.bounds.width > 0 && this.bounds.height > 0 && !this.mainWindow.isDestroyed()
    const nextBounds: Rectangle = visible
      ? {
          x: Math.max(0, Math.round(this.bounds.x)),
          y: Math.max(0, Math.round(this.bounds.y)),
          width: Math.max(1, Math.round(this.bounds.width)),
          height: Math.max(1, Math.round(this.bounds.height))
        }
      : {
          x: 0,
          y: 0,
          width: 0,
          height: 0
        }
    this.view.setBounds(nextBounds)
  }

  private async runDom(input: BrowserUseRunInput): Promise<BrowserUseRunResult> {
    const view = this.ensureView()
    await waitForWebContentsLoad(view.webContents)
    const stagehandModule = await import('@browserbasehq/stagehand')
    const cdpUrl = await this.getCdpWebSocketUrl()
    const stagehand = new stagehandModule.Stagehand({
      env: 'LOCAL',
      disablePino: true,
      verbose: 0,
      disableAPI: true,
      llmClient: new stagehandModule.CustomOpenAIClient({
        modelName: input.llmConfig.model_name,
        client: this.createStagehandOpenAIClient(input.llmConfig)
      }),
      localBrowserLaunchOptions: {
        cdpUrl,
        connectTimeoutMs: 20_000
      },
      actTimeoutMs: EMBEDDED_BROWSER_STAGEHAND_TIMEOUT_MS,
      domSettleTimeout: 1_000
    })
    try {
      await stagehand.init()
      const page = await this.resolveStagehandPage(stagehand, view.webContents.getURL())
      const title = await page.title()
      if (input.action === 'extract') {
        const result = await stagehand.extract(input.instruction, { page })
        return {
          action: 'extract',
          url: page.url(),
          title,
          mode: input.mode,
          content: stringifyStagehandExtraction(result)
        }
      }
      if (input.action === 'observe') {
        const actions = await stagehand.observe(input.instruction, { page })
        return {
          action: 'observe',
          url: page.url(),
          title,
          mode: input.mode,
          actions: actions.map((action): BrowserUseActionItem => ({
            description: action.description,
            method: action.method
          }))
        }
      }

      const result = await stagehand.act(input.instruction, { page })
      return {
        action: 'act',
        url: page.url(),
        title: await page.title(),
        mode: input.mode,
        success: result.success,
        message: result.message,
        pageState: await this.readPageState()
      }
    } finally {
      await this.closeStagehand(stagehand)
    }
  }

  private async runVisual(input: BrowserUseRunInput): Promise<BrowserUseRunResult> {
    const view = this.ensureView()
    await waitForWebContentsLoad(view.webContents)
    const title = await this.getTitle()
    const url = view.webContents.getURL()
    const screenshot = await view.webContents.capturePage()
    const imageUrl = screenshot.toDataURL()

    if (input.action === 'extract') {
      const content = await this.chatWithScreenshot({
        llmConfig: input.llmConfig,
        imageUrl,
        system:
          'You read browser screenshots. Return only the content requested by the user, without markdown fences.',
        user: input.instruction
      })
      return {
        action: 'extract',
        url,
        title,
        mode: input.mode,
        content
      }
    }

    if (input.action === 'observe') {
      const content = await this.chatWithScreenshot({
        llmConfig: input.llmConfig,
        imageUrl,
        system:
          'You inspect a browser screenshot. Return JSON only: {"actions":[{"description":"...","method":"click|type|scroll|read"}]}.',
        user: input.instruction
      })
      const parsed = visualObserveSchema.parse(parseJsonFromModelText(content))
      return {
        action: 'observe',
        url,
        title,
        mode: input.mode,
        actions: parsed.actions
      }
    }

    const content = await this.chatWithScreenshot({
      llmConfig: input.llmConfig,
      imageUrl,
      system:
        'You control a browser screenshot. Return JSON only: {"action":"click|type|none","x":number,"y":number,"text":"optional","message":"short result"}. Coordinates are relative to the screenshot top-left.',
      user: input.instruction
    })
    const parsed = visualActSchema.parse(parseJsonFromModelText(content))
    if (parsed.action === 'click' && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      view.webContents.sendInputEvent({ type: 'mouseDown', x: parsed.x, y: parsed.y, button: 'left' })
      view.webContents.sendInputEvent({ type: 'mouseUp', x: parsed.x, y: parsed.y, button: 'left' })
      await waitForWebContentsLoad(view.webContents)
    } else if (parsed.action === 'type' && parsed.text) {
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        view.webContents.sendInputEvent({ type: 'mouseDown', x: parsed.x, y: parsed.y, button: 'left' })
        view.webContents.sendInputEvent({ type: 'mouseUp', x: parsed.x, y: parsed.y, button: 'left' })
      }
      await view.webContents.insertText(parsed.text)
    }
    return {
      action: 'act',
      url: view.webContents.getURL(),
      title: await this.getTitle(),
      mode: input.mode,
      success: parsed.action !== 'none',
      message: parsed.message || (parsed.action === 'none' ? 'visual action not available' : 'visual action executed'),
      pageState: await this.readPageState()
    }
  }

  private async resolveStagehandPage(stagehand: StagehandInstance, currentUrl: string) {
    const pages = stagehand.context.pages()
    const exact = pages.find((page) => page.url() === currentUrl)
    const matched = exact || pages.find((page) => page.url() && page.url() !== 'about:blank')
    if (!matched) {
      const activePage = stagehand.context.activePage()
      if (!activePage) throw new Error('embedded browser page not found in CDP context')
      return activePage
    }
    stagehand.context.setActivePage(matched)
    return matched
  }

  private async closeStagehand(stagehand: StagehandInstance): Promise<void> {
    try {
      await stagehand.close({ force: true })
    } catch {
      return
    }
  }

  private async getCdpWebSocketUrl(): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${String(EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT)}/json/version`)
    if (!response.ok) throw new Error(`CDP endpoint unavailable: ${String(response.status)}`)
    const payload = z
      .object({
        webSocketDebuggerUrl: z.string().min(1)
      })
      .parse(await response.json())
    return payload.webSocketDebuggerUrl
  }

  private createOpenAICompatibleClient(config: BrowserUseRunInput['llmConfig']): OpenAICompatibleChatClient {
    return {
      chat: {
        completions: {
          create: async (body) => {
            const baseUrl = normalizeOpenAIBaseUrl(config.base_url)
            if (!baseUrl) throw new Error('LLM base_url is empty')
            const response = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.api_key}`
              },
              body: JSON.stringify(body)
            })
            const payload = (await response.json()) as object
            if (!response.ok) {
              const errorMessage =
                'error' in payload && typeof payload.error === 'object'
                  ? JSON.stringify(payload.error)
                  : JSON.stringify(payload)
              throw new Error(`LLM chat completion failed: ${errorMessage}`)
            }
            return normalizeOpenAIChatResponse(payload)
          }
        }
      }
    }
  }

  private createStagehandOpenAIClient(
    config: BrowserUseRunInput['llmConfig']
  ): StagehandCustomClientParams['client'] {
    return this.createOpenAICompatibleClient(config) as never
  }

  private async chatWithScreenshot(input: {
    llmConfig: BrowserUseRunInput['llmConfig']
    imageUrl: string
    system: string
    user: string
  }): Promise<string> {
    const client = this.createOpenAICompatibleClient(input.llmConfig)
    const messages: OpenAIChatMessage[] = [
      {
        role: 'system',
        content: input.system
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: input.user
          },
          {
            type: 'image_url',
            image_url: {
              url: input.imageUrl
            }
          }
        ]
      }
    ]
    const result = await client.chat.completions.create({
      model: input.llmConfig.model_name,
      messages,
      temperature: 0,
      stream: false
    })
    const content = result.choices[0]?.message.content
    if (!content) throw new Error('vision model returned empty content')
    return content
  }

  private async getTitle(): Promise<string | undefined> {
    const view = this.ensureView()
    const title = await view.webContents.getTitle()
    return title.trim() || undefined
  }

  private async readPageState(): Promise<string> {
    const view = this.ensureView()
    const title = await this.getTitle()
    const url = view.webContents.getURL()
    const bodyText = await view.webContents.executeJavaScript(
      'document.body ? document.body.innerText.slice(0, 4000) : ""',
      true
    )
    return [`url=${url}`, title ? `title=${title}` : undefined, String(bodyText || '').trim()]
      .filter((item): item is string => Boolean(item))
      .join('\n')
  }
}
