import { describe, expect, it } from 'vitest'
import { splitStableMarkdown } from '../../../../src/shared/streamingMarkdown'

const split = (markdown: string) => {
  const result = splitStableMarkdown(markdown)
  expect(result.stable + result.tail).toBe(markdown)
  return result
}

describe('splitStableMarkdown', () => {
  it('keeps everything in the tail until a block closes', () => {
    expect(split('')).toEqual({ stable: '', tail: '' })
    expect(split('一段还在生长的文字')).toEqual({ stable: '', tail: '一段还在生长的文字' })
    expect(split('第一段\n还在写')).toEqual({ stable: '', tail: '第一段\n还在写' })
  })

  it('moves closed paragraphs into the stable prefix', () => {
    const result = split('第一段已经写完。\n\n第二段正在写')
    expect(result.stable).toBe('第一段已经写完。\n\n')
    expect(result.tail).toBe('第二段正在写')
  })

  it('uses the last closed block', () => {
    const result = split('A\n\nB\n\nC')
    expect(result.stable).toBe('A\n\nB\n\n')
    expect(result.tail).toBe('C')
  })

  it('never splits inside fenced code, including blank lines in the fence', () => {
    const text = ['说明：', '', '```ts', 'const a = 1', '', 'const b = 2', '```', ''].join('\n')
    const result = split(text)
    expect(result.stable).toBe('说明：\n\n')
    expect(result.tail).toBe('```ts\nconst a = 1\n\nconst b = 2\n```\n')

    const stillStreaming = '说明：\n\n```ts\nconst a = 1\n\nconst b'
    expect(split(stillStreaming)).toEqual({
      stable: '说明：\n\n',
      tail: '```ts\nconst a = 1\n\nconst b'
    })
  })

  it('keeps GFM tables whole', () => {
    const text = ['前文', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', ''].join('\n')
    expect(split(text)).toEqual({
      stable: '前文\n\n',
      tail: '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    })
  })

  it('keeps a list that continues after a blank line together', () => {
    const ordered = '说明：\n\n1. 第一项\n2. 第二项\n\n3. 第三项正在写'
    expect(split(ordered)).toEqual({
      stable: '说明：\n\n',
      tail: '1. 第一项\n2. 第二项\n\n3. 第三项正在写'
    })

    const bullets = '- a\n- b\n\n- c'
    expect(split(bullets)).toEqual({ stable: '', tail: bullets })
  })

  it('splits again once a new non-list block starts', () => {
    const text = '1. 第一项\n\n2. 第二项\n\n## 新标题\n正文'
    expect(split(text)).toEqual({
      stable: '1. 第一项\n\n2. 第二项\n\n',
      tail: '## 新标题\n正文'
    })
  })
})
