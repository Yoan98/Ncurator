import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MarkdownRenderer from '../../src/renderer/src/components/MarkdownRenderer'

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneLight: {}
}))

describe('MarkdownRenderer', () => {
  it('preserves ncurator file references and routes clicks through onOpenReference', () => {
    const onOpenReference = vi.fn()

    render(
      <MarkdownRenderer
        content='[sample-edit.docx](ncurator://ref?kind=normal&resourceType=file&label=sample-edit.docx&path=%2Ftmp%2Fsample-edit.docx)'
        onOpenReference={onOpenReference}
      />
    )

    const link = screen.getByRole('link', { name: /sample-edit\.docx/i })
    expect(link.getAttribute('href')).toBe(
      'ncurator://ref?kind=normal&resourceType=file&label=sample-edit.docx&path=%2Ftmp%2Fsample-edit.docx'
    )

    fireEvent.click(link)

    expect(onOpenReference).toHaveBeenCalledTimes(1)
    expect(onOpenReference).toHaveBeenCalledWith({
      kind: 'normal',
      resourceType: 'file',
      label: 'sample-edit.docx',
      path: '/tmp/sample-edit.docx'
    })
  })

  it('keeps standard web links on the default external path', () => {
    render(<MarkdownRenderer content='[OpenAI](https://openai.com)' />)

    const link = screen.getByRole('link', { name: 'OpenAI' })
    expect(link.getAttribute('href')).toBe('https://openai.com')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
