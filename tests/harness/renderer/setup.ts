import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import React from 'react'
import type { SourceScopeSelection } from '../../../src/shared/types'

vi.mock('../../../src/renderer/src/components/fileRenders', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('../../../src/renderer/src/components/MarkdownRenderer', () => ({
  __esModule: true,
  default: (input: { content: string }) => input.content
}))

vi.mock('../../../src/renderer/src/components/SourceScopeSelect', () => ({
  __esModule: true,
  default: (input: {
    mode: 'chat' | 'search'
    value: SourceScopeSelection[]
    onChange: (nextValue: SourceScopeSelection[]) => void
  }) => {
    const [options, setOptions] = React.useState<SourceScopeSelection[]>([])

    React.useEffect(() => {
      let mounted = true

      void window.api
        .sourceScopeList({ mode: input.mode })
        .then((response) => {
          if (mounted) {
            setOptions(response.items)
          }
        })

      return () => {
        mounted = false
      }
    }, [input.mode])

    const getScopeKey = (scope: SourceScopeSelection): string =>
      [scope.sourceType, scope.sourceId, scope.scopeType, scope.nodeId || 'root'].join(':')
    const mergedOptions = [...options]

    input.value.forEach((scope) => {
      if (!mergedOptions.some((option) => getScopeKey(option) === getScopeKey(scope))) {
        mergedOptions.push(scope)
      }
    })

    return React.createElement(
      'select',
      {
        multiple: true,
        value: input.value.map(getScopeKey),
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
          const selectedValues = Array.from(event.target.selectedOptions).map((option) => option.value)
          const nextValue = mergedOptions.filter((scope) =>
            selectedValues.includes(getScopeKey(scope))
          )
          input.onChange(nextValue)
        }
      },
      mergedOptions.map((scope) =>
        React.createElement(
          'option',
          {
            key: getScopeKey(scope),
            value: getScopeKey(scope)
          },
          scope.label
        )
      )
    )
  }
}))

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  })
})

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverStub
})

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: IntersectionObserverStub
})

Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: () => undefined
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
