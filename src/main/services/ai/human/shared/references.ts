import type { HumanReference } from '../types'

const normalizePath = (value: string): string => value.trim()

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value)

const inferReferenceSourceText = (path: string): string => {
  const normalizedPath = normalizePath(path).toLowerCase()
  if (isHttpUrl(normalizedPath)) return '外部网页资料'
  if (normalizedPath.startsWith('knowledge://')) return '工作区内部知识检索资料'
  return '用户本地资料'
}

export const buildReferenceMarkdown = (reference: HumanReference): string => {
  const encodedLabel = encodeURIComponent(reference.label)
  const encodedPath = encodeURIComponent(normalizePath(reference.path))
  return `[${reference.label}](ncurator://ref?label=${encodedLabel}&path=${encodedPath})`
}

export const renderHumanReferences = (references: HumanReference[] | undefined): string => {
  if (!references || references.length === 0) return 'none'
  return references
    .map(
      (reference, index) =>
        `${index + 1}. 引用资料：${reference.label}\n   - 支撑内容：${reference.usedFor}\n   - 资料地址：${reference.path}\n   - 资料来源：${inferReferenceSourceText(reference.path)}\n   - 正文引用片段：${buildReferenceMarkdown(reference)}`
    )
    .join('\n')
}

export const inferReferenceIconKind = (input: {
  label: string
  path: string
}): 'web' | 'knowledge' | 'docx' | 'pdf' | 'markdown' | 'text' | 'generic' => {
  const normalizedPath = input.path.trim().toLowerCase()
  const normalizedLabel = input.label.trim().toLowerCase()
  if (isHttpUrl(normalizedPath)) return 'web'
  if (normalizedPath.startsWith('knowledge://')) return 'knowledge'
  if (normalizedPath.endsWith('.docx') || normalizedLabel.endsWith('.docx')) return 'docx'
  if (normalizedPath.endsWith('.pdf') || normalizedLabel.endsWith('.pdf')) return 'pdf'
  if (
    normalizedPath.endsWith('.md') ||
    normalizedPath.endsWith('.markdown') ||
    normalizedLabel.endsWith('.md')
  ) {
    return 'markdown'
  }
  if (
    normalizedPath.endsWith('.txt') ||
    normalizedPath.endsWith('.text') ||
    normalizedLabel.endsWith('.txt')
  ) {
    return 'text'
  }
  return 'generic'
}
