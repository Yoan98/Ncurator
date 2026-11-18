import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initializeI18n } from './i18n'
import { dismissBootSplash } from './utils/bootSplash'
import ErrorBoundary from './components/ErrorBoundary'

const reportGlobalError = (event: ErrorEvent): void => {
  console.error('[APP-ERROR] uncaught', event.error || event.message)
}

window.addEventListener('error', reportGlobalError)

window.addEventListener('unhandledrejection', (event) => {
  console.error('[APP-ERROR] unhandled rejection', event.reason)
})

/**
 * 跨显示器诊断：窗口落到另一块屏后，采样 6 秒的渲染活跃度、指针事件与 hover 命中，
 * 写进 app.log。用于区分「主线程卡住」与「Chromium 鼠标跟踪失效」。
 */
/**
 * Chromium 在 macOS 上会缓存「已设置的光标」：窗口跨屏后系统把光标重置为箭头，
 * 而 Chromium 仍认为当前是手型，于是不再下发 cursor 更新，表现为 hover 正常但
 * 鼠标形状永远不变。这里把指针下元素的 cursor 临时改成另一个值再恢复，
 * 每次变化后请主进程注入一次可信 mouseMove，强制 Chromium 重新下发光标。
 */
const forceCursorResend = async (): Promise<void> => {
  const nextFrame = (): Promise<void> =>
    new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      window.setTimeout(resolve, ms)
    })

  for (let round = 0; round < 3; round += 1) {
    const hovered = Array.from(document.querySelectorAll(':hover')) as HTMLElement[]
    let target: HTMLElement | undefined
    let depth = -1
    for (const element of hovered) {
      let current: HTMLElement | null = element
      let elementDepth = 0
      while (current) {
        elementDepth += 1
        current = current.parentElement
      }
      if (elementDepth > depth) {
        depth = elementDepth
        target = element
      }
    }
    if (!target) return
    const computed = window.getComputedStyle(target).cursor || 'default'
    const opposite = computed === 'default' ? 'pointer' : 'default'
    target.style.setProperty('cursor', opposite, 'important')
    await nextFrame()
    await window.api.nudgeWindowCursor()
    await delay(45)
    target.style.removeProperty('cursor')
    await nextFrame()
    await window.api.nudgeWindowCursor()
    await delay(150)
  }
}

const installDisplayChangeProbe = (): void => {
  try {
    if (window.api.isE2EMode()) return
  } catch {
    return
  }

  window.api.onWindowDisplayChanged((payload) => {
    window.setTimeout(() => void forceCursorResend(), 250)
    const startedAt = performance.now()
    const longTasks: number[] = []
    const hovered: string[] = []
    let frames = 0
    let worstGapMs = 0
    let lastFrameAt = startedAt
    let pointerMoves = 0
    let pointerDowns = 0

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration))
    })
    try {
      observer.observe({ type: 'longtask' })
    } catch {
      // Optional: runtimes without longtask support report the rest only.
    }

    const onPointerMove = (): void => {
      pointerMoves += 1
    }
    const onPointerDown = (): void => {
      pointerDowns += 1
    }
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerdown', onPointerDown, true)

    const tick = (now: number): void => {
      frames += 1
      worstGapMs = Math.max(worstGapMs, now - lastFrameAt)
      lastFrameAt = now
      if (performance.now() - startedAt < 6000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    window.setTimeout(() => {
      observer.disconnect()
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      try {
        for (const element of document.querySelectorAll(':hover')) {
          hovered.push(element.tagName.toLowerCase())
        }
      } catch {
        // :hover query is best effort.
      }
      try {
        void window.api.errorLogReport?.({
          message: '[display-probe]',
          stack: JSON.stringify({
            payload,
            hasFocus: document.hasFocus(),
            dpr: window.devicePixelRatio,
            frames,
            worstGapMs: Math.round(worstGapMs),
            pointerMoves,
            pointerDowns,
            hovered: hovered.slice(-4),
            longTasks
          })
        })
      } catch {
        // Diagnostics must never affect the app.
      }
    }, 6000)
  })
}

const start = async (): Promise<void> => {
  installDisplayChangeProbe()
  const startup = await window.api.appStartupGetStatus()
  await initializeI18n(startup)
  if (startup.locale === 'zh-CN') await import('monaco-editor/nls/lang/zh-cn.js')
  const { default: App } = await import('./App')
  // 兜底：会话迟迟不就绪时也不让启动画面长期遮挡界面。
  window.setTimeout(dismissBootSplash, 8000)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}
void start().catch((error) => {
  console.error('Application startup failed', error)
  const root = document.getElementById('root')
  if (root) root.textContent = 'Unable to start the application. Please restart.'
})
