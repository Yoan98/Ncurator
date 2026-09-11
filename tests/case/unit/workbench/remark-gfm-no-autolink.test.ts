import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import {
  gfmNoAutolinkFromMarkdown,
  gfmNoAutolinkMicromarkExtension
} from '../../../../src/shared/markdown/remarkGfmNoAutolink'

const parse = (markdown: string) =>
  fromMarkdown(markdown, {
    extensions: [gfmNoAutolinkMicromarkExtension],
    mdastExtensions: [gfmNoAutolinkFromMarkdown]
  })

type MdastNode = {
  type: string
  value?: string
  url?: string
  children?: MdastNode[]
}

const collectTypes = (node: MdastNode, types: string[] = []): string[] => {
  types.push(node.type)
  for (const child of node.children || []) {
    collectTypes(child, types)
  }
  return types
}

describe('remarkGfmNoAutolink', () => {
  it('keeps bare https urls as text and preserves surrounding emphasis', () => {
    const tree = parse(
      '平台主页 **https://www.zcat.cn/teach/ai**，显示"欢迎来到超喵"，当前身份为 **教师**。'
    ) as MdastNode
    const types = collectTypes(tree)
    expect(types).not.toContain('link')
    expect(types.filter((type) => type === 'strong')).toHaveLength(2)

    const paragraph = tree.children?.[0]
    expect(paragraph?.type).toBe('paragraph')
    const firstStrong = paragraph?.children?.find((child) => child.type === 'strong')
    expect(firstStrong?.children?.[0]).toMatchObject({
      type: 'text',
      value: 'https://www.zcat.cn/teach/ai'
    })
  })

  it('does not autolink www hosts while still parsing standard markdown links', () => {
    const tree = parse('见 [超喵](https://www.zcat.cn/teach/ai) 与 www.zcat.cn') as MdastNode
    const paragraph = tree.children?.[0]
    expect(paragraph?.type).toBe('paragraph')

    const links = (paragraph?.children || []).filter((child) => child.type === 'link')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      type: 'link',
      url: 'https://www.zcat.cn/teach/ai'
    })
    expect(
      (paragraph?.children || []).some(
        (child) => child.type === 'text' && (child.value || '').includes('www.zcat.cn')
      )
    ).toBe(true)
  })
})
