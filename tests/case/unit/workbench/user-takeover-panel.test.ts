import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workbenchSelectors } from '../../../../src/renderer/src/testing/selectors'

vi.mock('antd', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'data-testid': testId
  }: {
    children?: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    'data-testid'?: string
  }) =>
    React.createElement(
      'button',
      { type: 'button', disabled, onClick, 'data-testid': testId },
      children
    )
}))

describe('user takeover panel', () => {
  let dom: JSDOM
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>')
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      SVGElement: dom.window.SVGElement,
      MouseEvent: dom.window.MouseEvent,
      IS_REACT_ACT_ENVIRONMENT: true
    })
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    dom.window.close()
    vi.clearAllMocks()
  })

  it('shows the AI message and exposes confirm and cancel actions', async () => {
    const { default: UserTakeoverPanel } =
      await import('../../../../src/renderer/src/components/workbench/UserTakeoverPanel')
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    await act(async () => {
      root.render(
        React.createElement(UserTakeoverPanel, {
          message: '请在右侧浏览器完成登录',
          confirming: false,
          cancelling: false,
          onConfirm,
          onCancel
        })
      )
    })

    expect(
      container.querySelector(`[data-testid="${workbenchSelectors.userTakeoverMessage}"]`)
        ?.textContent
    ).toBe('请在右侧浏览器完成登录')

    container
      .querySelector<HTMLButtonElement>(
        `[data-testid="${workbenchSelectors.userTakeoverConfirmButton}"]`
      )
      ?.click()
    container
      .querySelector<HTMLButtonElement>(
        `[data-testid="${workbenchSelectors.userTakeoverCancelButton}"]`
      )
      ?.click()

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
