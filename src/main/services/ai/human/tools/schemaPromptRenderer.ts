import { toJSONSchema } from 'zod/v4'
import type { z } from 'zod/v4'

type JsonSchemaNode = Record<string, unknown>

type RenderContext = {
  defs: Record<string, JsonSchemaNode>
}

const INDENT = '  '

const isJsonSchemaNode = (value: unknown): value is JsonSchemaNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asJsonSchemaNodeArray = (value: unknown): JsonSchemaNode[] =>
  Array.isArray(value) ? value.filter(isJsonSchemaNode) : []

const indentBlock = (value: string, level: number): string =>
  value
    .split('\n')
    .map((line) => `${INDENT.repeat(level)}${line}`)
    .join('\n')

const formatLiteral = (value: unknown): string => JSON.stringify(value)

const renderUnion = (parts: string[], level: number): string => {
  if (parts.length === 0) return 'unknown'
  if (parts.length === 1) return parts[0]
  if (parts.every((part) => !part.includes('\n'))) {
    return parts.join(' | ')
  }

  const unionLines = parts.flatMap((part) => {
    const [firstLine, ...restLines] = part.split('\n')
    return [
      `${INDENT.repeat(level + 1)}| ${firstLine}`,
      ...restLines.map((line) => `${INDENT.repeat(level + 2)}${line}`)
    ]
  })

  return ['(', ...unionLines, `${INDENT.repeat(level)})`].join('\n')
}

const renderObject = (node: JsonSchemaNode, context: RenderContext, level: number): string => {
  const properties = isJsonSchemaNode(node.properties) ? node.properties : {}
  const required = new Set(
    Array.isArray(node.required) ? node.required.map((item) => String(item)) : []
  )
  const propertyEntries = Object.entries(properties).flatMap(([key, value]) =>
    isJsonSchemaNode(value) ? ([[key, value]] as Array<[string, JsonSchemaNode]>) : []
  )

  if (propertyEntries.length === 0) {
    if (isJsonSchemaNode(node.additionalProperties)) {
      return `{ [key: string]: ${renderSchemaType(node.additionalProperties, context, level)} }`
    }
    return '{}'
  }

  const lines = propertyEntries.map(([key, value]) => {
    const optional = required.has(key) ? '' : '?'
    const rendered = renderSchemaType(value, context, level + 1)
    if (!rendered.includes('\n')) {
      return `${INDENT.repeat(level + 1)}${key}${optional}: ${rendered}`
    }

    const [firstLine, ...restLines] = rendered.split('\n')
    return [
      `${INDENT.repeat(level + 1)}${key}${optional}: ${firstLine}`,
      ...restLines.map((line) => `${INDENT.repeat(level + 2)}${line}`)
    ].join('\n')
  })

  return ['{', ...lines, `${INDENT.repeat(level)}}`].join('\n')
}

const renderArray = (node: JsonSchemaNode, context: RenderContext, level: number): string => {
  if (Array.isArray(node.items)) {
    const tupleItems = node.items
      .filter(isJsonSchemaNode)
      .map((item) => renderSchemaType(item, context, level + 1))
    return `[${tupleItems.join(', ')}]`
  }

  const itemSchema = isJsonSchemaNode(node.items) ? node.items : undefined
  return `Array<${itemSchema ? renderSchemaType(itemSchema, context, level + 1) : 'unknown'}>`
}

const renderSchemaType = (node: JsonSchemaNode, context: RenderContext, level: number): string => {
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
    return node.$ref.slice('#/$defs/'.length)
  }

  if (Object.prototype.hasOwnProperty.call(node, 'const')) {
    return formatLiteral(node.const)
  }

  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return node.enum.map((value) => formatLiteral(value)).join(' | ')
  }

  const anyOf = asJsonSchemaNodeArray(node.anyOf)
  if (anyOf.length > 0) {
    return renderUnion(anyOf.map((item) => renderSchemaType(item, context, level + 1)), level)
  }

  const oneOf = asJsonSchemaNodeArray(node.oneOf)
  if (oneOf.length > 0) {
    return renderUnion(oneOf.map((item) => renderSchemaType(item, context, level + 1)), level)
  }

  const typeValue = node.type
  if (Array.isArray(typeValue) && typeValue.length > 0) {
    return renderUnion(
      typeValue.map((item) => formatLiteral(item)),
      level
    )
  }

  if (typeValue === 'object' || isJsonSchemaNode(node.properties)) {
    return renderObject(node, context, level)
  }

  if (typeValue === 'array') {
    return renderArray(node, context, level)
  }

  if (typeValue === 'string' || typeValue === 'number' || typeValue === 'integer') {
    return String(typeValue)
  }

  if (typeValue === 'boolean') return 'boolean'
  if (typeValue === 'null') return 'null'

  const allOf = asJsonSchemaNodeArray(node.allOf)
  if (allOf.length > 0) {
    return renderUnion(allOf.map((item) => renderSchemaType(item, context, level + 1)), level)
  }

  const description = typeof node.description === 'string' ? node.description.trim() : ''
  if (description) {
    return description
  }

  return 'unknown'
}

const buildSchemaRenderOutput = (schema: z.ZodType): { rootSchema: string; definitionBlocks: string[] } => {
  const document = toJSONSchema(schema) as JsonSchemaNode
  const defs = isJsonSchemaNode(document.$defs) ? (document.$defs as Record<string, JsonSchemaNode>) : {}
  const context: RenderContext = { defs }
  return {
    rootSchema: renderSchemaType(document, context, 0),
    definitionBlocks: Object.entries(defs).map(
      ([name, definition]) => `${name} = ${renderSchemaType(definition, context, 0)}`
    )
  }
}

export const renderSchemaShape = (schema: z.ZodType): string => {
  const { rootSchema, definitionBlocks } = buildSchemaRenderOutput(schema)

  return [
    indentBlock(rootSchema, 1),
    ...(definitionBlocks.length > 0
      ? ['', '补充定义：', ...definitionBlocks.map((block) => indentBlock(block, 1))]
      : [])
  ].join('\n')
}

export const renderToolInputSchemaForPrompt = (schema: z.ZodType): string =>
  ['输入结构：', renderSchemaShape(schema)].join('\n')

export const renderToolOutputSchemaForPrompt = (schema: z.ZodType): string =>
  ['输出结构：', renderSchemaShape(schema)].join('\n')

export const renderBrainOutputSchemaForPrompt = (schema: z.ZodType): string =>
  ['输出 JSON 结构：', renderSchemaShape(schema)].join('\n')
