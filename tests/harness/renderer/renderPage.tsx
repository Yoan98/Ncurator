import React from 'react'
import { App, ConfigProvider, theme } from 'antd'
import { render, type RenderResult } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import type { DesktopApiMock } from './apiMock'

const TestProviders = (input: { children: React.ReactNode }): React.JSX.Element => {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm
      }}
    >
      <App>
        <HashRouter>{input.children}</HashRouter>
      </App>
    </ConfigProvider>
  )
}

export const renderWithDesktopApi = (input: {
  apiMock: DesktopApiMock
  ui: React.ReactElement
  route?: string
}): RenderResult => {
  window.api = input.apiMock.api
  window.location.hash = input.route || '#/'
  return render(input.ui, {
    wrapper: TestProviders
  })
}
