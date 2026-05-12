import type { HumanReference } from '../types'

const normalizePath = (value: string): string => value.trim()

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value)

export const buildReferenceMarkdown = (reference: HumanReference): string => {
  const encodedLabel = encodeURIComponent(reference.label)
  const encodedPath = encodeURIComponent(normalizePath(reference.path))
  const encodedKind = encodeURIComponent(reference.kind)
  return `[${reference.label}](ncurator://ref?label=${encodedLabel}&path=${encodedPath}&kind=${encodedKind})`
}

export const renderHumanReferences = (references: HumanReference[] | undefined): string => {
  if (!references || references.length === 0) return 'none'
  return references
    .map(
      (reference, index) =>
        `${index + 1}. ${buildReferenceMarkdown(reference)}\n   kind: ${reference.kind}\n   path: ${reference.path}\n   usedFor: ${reference.usedFor}`
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
