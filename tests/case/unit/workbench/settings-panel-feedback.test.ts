// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { message } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ModelSettingsPanel from '../../../../src/renderer/src/components/settings/ModelSettingsPanel'
import VectorModelSettingsPanel from '../../../../src/renderer/src/components/settings/VectorModelSettingsPanel'
import { settingsSelectors, vectorSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { DownloadProgressPayload } from '../../../../src/renderer/src/components/settings/types'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
  const nativeGetComputedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) =>
    pseudoElement ? nativeGetComputedStyle(element) : nativeGetComputedStyle(element, pseudoElement)
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const setDesktopApi = (value: object): void => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value
  })
}

describe('settings panel feedback', () => {
  it('keeps a model config visible when deletion fails and hides internal errors', async () => {
    const deleteConfig = vi.fn().mockResolvedValue({
      success: false,
      error: 'TypeError in /src/main/services/storage/delete.ts'
    })
    const errorMessage = vi.spyOn(message, 'error').mockImplementation(() => undefined)
    setDesktopApi({
      llmConfigList: vi.fn().mockResolvedValue([
        {
          id: 'config-1',
          name: '保留配置',
          providerKind: 'openai-compatible',
          base_url: 'https://example.com/v1',
          api_key: 'sk-test'
        }
      ]),
      llmConfigDelete: deleteConfig,
      llmConfigModelList: vi.fn()
    })

    render(React.createElement(ModelSettingsPanel))
    await screen.findByText('保留配置')
    fireEvent.click(screen.getByTestId(`${settingsSelectors.modelDeleteButtonPrefix}-config-1`))
    fireEvent.click(document.querySelector('.ant-popconfirm-buttons .ant-btn-primary') as HTMLElement)

    await waitFor(() => expect(deleteConfig).toHaveBeenCalledWith('config-1'))
    expect(screen.getByText('保留配置')).toBeTruthy()
    expect(screen.getByText('删除失败')).toBeTruthy()
    expect(errorMessage).toHaveBeenCalledWith('删除失败')
    expect(screen.queryByText(/TypeError|\/src\/main/u)).toBeNull()
  })

  it('restores vector progress and converges completion and failure states', async () => {
    let progressListener: ((payload: DownloadProgressPayload) => void) | undefined
    const getModels = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'repo-1',
          name: '向量模型',
          description: '测试模型',
          tags: ['test'],
          isDownloaded: false
        }
      ])
      .mockResolvedValue([
        {
          id: 'repo-1',
          name: '向量模型',
          description: '测试模型',
          tags: ['test'],
          isDownloaded: true
        }
      ])
    vi.spyOn(message, 'success').mockImplementation(() => undefined)
    vi.spyOn(message, 'error').mockImplementation(() => undefined)
    setDesktopApi({
      getModels,
      getActiveDownload: vi.fn().mockResolvedValue({
        repoId: 'repo-1',
        status: 'downloading',
        progress: 35,
        currentFile: 'onnx/model.onnx',
        totalFiles: 4,
        completedFiles: 1,
        updatedAt: Date.now()
      }),
      onDownloadProgress: vi.fn((listener: (payload: DownloadProgressPayload) => void) => {
        progressListener = listener
      }),
      removeDownloadProgressListeners: vi.fn(),
      downloadModel: vi.fn(),
      deleteModel: vi.fn()
    })

    render(React.createElement(VectorModelSettingsPanel))
    await screen.findByTestId(`${vectorSelectors.progressPrefix}-repo-1`)
    expect(screen.getByText('35%')).toBeTruthy()
    expect(screen.getByTestId(`${vectorSelectors.currentFilePrefix}-repo-1`).textContent).toBe(
      'onnx/model.onnx'
    )

    await act(async () => {
      progressListener?.({ repoId: 'repo-1', status: 'completed', progress: 100 })
    })
    await screen.findByTestId(`${vectorSelectors.installedBadgePrefix}-repo-1`)

    await act(async () => {
      progressListener?.({
        repoId: 'repo-1',
        status: 'error',
        progress: 40,
        error: 'network unavailable'
      })
    })
    expect(
      (await screen.findByTestId(`${vectorSelectors.errorPrefix}-repo-1`)).textContent
    ).toContain('network unavailable')
  })

  it('requires vector model deletion confirmation and preserves failures', async () => {
    const deleteModel = vi.fn().mockResolvedValue({
      success: false,
      error: 'model directory is locked'
    })
    vi.spyOn(message, 'error').mockImplementation(() => undefined)
    setDesktopApi({
      getModels: vi.fn().mockResolvedValue([
        {
          id: 'repo-installed',
          name: '已安装模型',
          description: '测试模型',
          tags: ['test'],
          isDownloaded: true
        }
      ]),
      getActiveDownload: vi.fn().mockResolvedValue(null),
      onDownloadProgress: vi.fn(),
      removeDownloadProgressListeners: vi.fn(),
      downloadModel: vi.fn(),
      deleteModel
    })

    render(React.createElement(VectorModelSettingsPanel))
    const deleteButton = await screen.findByTestId(
      `${vectorSelectors.deleteButtonPrefix}-repo-installed`
    )
    fireEvent.click(deleteButton)
    fireEvent.click(
      await screen.findByTestId(`${vectorSelectors.deleteCancelButtonPrefix}-repo-installed`)
    )
    expect(deleteModel).not.toHaveBeenCalled()

    fireEvent.click(deleteButton)
    fireEvent.click(
      await screen.findByTestId(`${vectorSelectors.deleteConfirmButtonPrefix}-repo-installed`)
    )
    await waitFor(() => expect(deleteModel).toHaveBeenCalledWith('repo-installed'))
    expect(
      screen.getByTestId(`${vectorSelectors.installedBadgePrefix}-repo-installed`)
    ).toBeTruthy()
    expect(
      (await screen.findByTestId(`${vectorSelectors.errorPrefix}-repo-installed`)).textContent
    ).toContain('model directory is locked')
  })
})
