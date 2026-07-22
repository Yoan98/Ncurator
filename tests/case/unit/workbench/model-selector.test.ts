// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkbenchModelSelector from '../../../../src/renderer/src/components/workbench/WorkbenchModelSelector'

afterEach(cleanup)

describe('workbench model selector', () => {
  it('shows an empty state instead of creating models from the search text', () => {
    renderSelector()
    openMainModelList()

    fireEvent.change(screen.getByPlaceholderText('搜索模型'), {
      target: { value: 'missing-model' }
    })

    expect(screen.getByText('暂无匹配模型')).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'missing-model' })).toBeNull()
    expect(screen.queryByText('model-a')).toBeNull()
  })

  it('places the collapse icon after the config text and toggles its models', () => {
    renderSelector()
    openMainModelList()

    const groupButton = screen.getByRole('button', { name: '配置 A' })
    const content = groupButton.firstElementChild
    expect(content?.children[0]?.textContent).toBe('配置 A')
    expect(content?.children[1]?.tagName.toLowerCase()).toBe('svg')
    expect(screen.getByRole('option', { name: 'model-a' })).toBeTruthy()

    fireEvent.click(groupButton)

    expect(groupButton.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('option', { name: 'model-a' })).toBeNull()
  })

  it('closes the trigger tooltip while the model menu is open', async () => {
    renderSelector()
    const trigger = screen.getByRole('button', { name: '选择模型' })

    fireEvent.mouseEnter(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())

    fireEvent.click(trigger)

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })
})

const renderSelector = (): void => {
  render(
    React.createElement(WorkbenchModelSelector, {
      configs: [
        {
          id: 'config-a',
          name: '配置 A',
          providerKind: 'openai-compatible',
          base_url: 'https://example.test/v1',
          api_key: 'test-key'
        }
      ],
      modelListsByConfigId: {
        'config-a': [{ id: 'model-a', label: 'model-a' }]
      },
      value: { mainModel: null, visionModel: null },
      onChange: vi.fn()
    })
  )
}

const openMainModelList = (): void => {
  fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
  fireEvent.click(screen.getByText('主模型').closest('button')!)
}
