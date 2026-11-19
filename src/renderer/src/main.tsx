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
    try {
      await nextFrame()
      await window.api.nudgeWindowCursor()
      await delay(45)
    } finally {
      target.style.removeProperty('cursor')
    }
    await nextFrame()
    await window.api.nudgeWindowCursor().catch(() => undefined)
    await delay(150)
  }
}

/**
 * 窗口换屏（或恢复到副屏）后，主进程会通知渲染层重建指针跟踪；这里把指针下
 * 元素的 cursor 翻转几次并请求主进程注入可信鼠标移动，强制 Chromium 重新下发
 * 光标状态。详见 forceCursorResend 的注释。
 */
const installPointerResyncHandler = (): void => {
  try {
    if (window.api.isE2EMode()) return
  } catch {
    return
  }

  window.api.onWindowPointerResync(() => {
    window.setTimeout(() => void forceCursorResend(), 250)
  })
}

const start = async (): Promise<void> => {
  installPointerResyncHandler()
  const startup = await window.api.appStartupGetStatus()
  // Paint the resolved appearance before the first React frame so the splash never flips colour.
  document.documentElement.dataset.theme = startup.theme
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
