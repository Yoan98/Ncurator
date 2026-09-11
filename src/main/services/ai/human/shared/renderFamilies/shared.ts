import type { JsonObject, JsonValue } from '../../../../../../shared/types'

const MODEL_TEXT_LINE_CHARS = 1_600

export const isObject = (value: JsonValue | undefined): value is JsonObject =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

export const readString = (value: JsonValue | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined

export const readNumber = (value: JsonValue | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const wrapPhysicalLine = (value: string): string[] => {
  const characters = Array.from(value)
  if (characters.length <= MODEL_TEXT_LINE_CHARS) return [value]
  const lines: string[] = []
  for (let offset = 0; offset < characters.length; offset += MODEL_TEXT_LINE_CHARS) {
    lines.push(characters.slice(offset, offset + MODEL_TEXT_LINE_CHARS).join(''))
  }
  return lines
}

export const wrapModelTextLines = (value: string): string =>
  value
    .split(/\r\n|\r|\n/u)
    .flatMap(wrapPhysicalLine)
    .join('\n')

export const indentBlock = (value: string, depth: number): string => {
  const indent = '  '.repeat(depth)
  return wrapModelTextLines(value)
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n')
}

export const escapeXmlAttribute = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
