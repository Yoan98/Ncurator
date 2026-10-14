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
  const itemType = itemSchema ? renderSchemaType(itemSchema, context, level + 1) : 'unknown'
  return `${itemType.includes(' | ') ? `(${itemType})` : itemType}[]`
}

const renderSchemaType = (node: JsonSchemaNode, context: RenderContext, level: number): string => {
  const displayType =
    typeof node['x-display-type'] === 'string' ? String(node['x-display-type']) : ''
  if (displayType) return displayType

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
    return renderUnion(
      anyOf.map((item) => renderSchemaType(item, context, level + 1)),
      level
    )
  }

  const oneOf = asJsonSchemaNodeArray(node.oneOf)
  if (oneOf.length > 0) {
    return renderUnion(
      oneOf.map((item) => renderSchemaType(item, context, level + 1)),
      level
    )
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

  if (typeValue === 'string' || typeValue === 'number') return String(typeValue)
  if (typeValue === 'integer') return 'number'

  if (typeValue === 'boolean') return 'boolean'
  if (typeValue === 'null') return 'null'

  const allOf = asJsonSchemaNodeArray(node.allOf)
  if (allOf.length > 0) {
    return renderUnion(
      allOf.map((item) => renderSchemaType(item, context, level + 1)),
      level
    )
  }

  const description = typeof node.description === 'string' ? node.description.trim() : ''
  if (description) {
    return description
  }

  return 'unknown'
}

const renderObjectCompact = (node: JsonSchemaNode, context: RenderContext): string => {
  const properties = isJsonSchemaNode(node.properties) ? node.properties : {}
  const required = new Set(
    Array.isArray(node.required) ? node.required.map((item) => String(item)) : []
  )
  const propertyEntries = Object.entries(properties).flatMap(([key, value]) =>
    isJsonSchemaNode(value) ? ([[key, value]] as Array<[string, JsonSchemaNode]>) : []
  )

  if (propertyEntries.length === 0) {
    if (isJsonSchemaNode(node.additionalProperties)) {
      return `{ [key: string]: ${renderSchemaTypeCompact(node.additionalProperties, context)} }`
    }
    return '{}'
  }

  return `{ ${propertyEntries
    .map(([key, value]) => {
      const optional = required.has(key) ? '' : '?'
      return `${key}${optional}: ${renderSchemaTypeCompact(value, context)}`
    })
    .join(', ')} }`
}

const renderArrayCompact = (node: JsonSchemaNode, context: RenderContext): string => {
  if (Array.isArray(node.items)) {
    const tupleItems = node.items
      .filter(isJsonSchemaNode)
      .map((item) => renderSchemaTypeCompact(item, context))
    return `[${tupleItems.join(', ')}]`
  }

  const itemSchema = isJsonSchemaNode(node.items) ? node.items : undefined
  const itemType = itemSchema ? renderSchemaTypeCompact(itemSchema, context) : 'unknown'
  return `${itemType.includes(' | ') ? `(${itemType})` : itemType}[]`
}

const renderSchemaTypeCompact = (node: JsonSchemaNode, context: RenderContext): string => {
  const displayType =
    typeof node['x-display-type'] === 'string' ? String(node['x-display-type']) : ''
  if (displayType) return displayType

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
    return anyOf.map((item) => renderSchemaTypeCompact(item, context)).join(' | ')
  }

  const oneOf = asJsonSchemaNodeArray(node.oneOf)
  if (oneOf.length > 0) {
    return oneOf.map((item) => renderSchemaTypeCompact(item, context)).join(' | ')
  }

  const typeValue = node.type
  if (Array.isArray(typeValue) && typeValue.length > 0) {
    return typeValue.map((item) => formatLiteral(item)).join(' | ')
  }

  if (typeValue === 'object' || isJsonSchemaNode(node.properties)) {
    return renderObjectCompact(node, context)
  }

  if (typeValue === 'array') {
    return renderArrayCompact(node, context)
  }

  if (typeValue === 'string' || typeValue === 'number') return String(typeValue)
  if (typeValue === 'integer') return 'number'

  if (typeValue === 'boolean') return 'boolean'
  if (typeValue === 'null') return 'null'

  const allOf = asJsonSchemaNodeArray(node.allOf)
  if (allOf.length > 0) {
    return allOf.map((item) => renderSchemaTypeCompact(item, context)).join(' | ')
  }

  const description = typeof node.description === 'string' ? node.description.trim() : ''
  if (description) {
    return description
  }

  return 'unknown'
}

const buildCompactSchemaRenderOutput = (
  schema: z.ZodType,
  options?: { brainPromptFriendly?: boolean }
): { rootSchema: string; definitionBlocks: string[] } => {
  const document = toJSONSchema(schema) as JsonSchemaNode
  const normalizedDocument = options?.brainPromptFriendly
    ? compressBrainHandCallDisplay(document)
    : document
  const defs = isJsonSchemaNode(normalizedDocument.$defs)
    ? (normalizedDocument.$defs as Record<string, JsonSchemaNode>)
    : {}
  const context: RenderContext = { defs }
  const definitionNames = collectReferencedDefinitionNames(normalizedDocument, defs)
  return {
    rootSchema: renderSchemaTypeCompact(normalizedDocument, context),
    definitionBlocks: definitionNames.map(
      (name) => `type ${name} = ${renderSchemaTypeCompact(defs[name]!, context)}`
    )
  }
}

const cloneJsonSchemaNode = (node: JsonSchemaNode): JsonSchemaNode => {
  const output: JsonSchemaNode = {}
  Object.entries(node).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      output[key] = value.map((item) => (isJsonSchemaNode(item) ? cloneJsonSchemaNode(item) : item))
      return
    }
    output[key] = isJsonSchemaNode(value) ? cloneJsonSchemaNode(value) : value
  })
  return output
}

const collectReferencedDefinitionNames = (
  root: JsonSchemaNode,
  defs: Record<string, JsonSchemaNode>
): string[] => {
  const names: string[] = []
  const visited = new Set<string>()

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isJsonSchemaNode(value)) return

    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/$defs/')) {
      const name = value.$ref.slice('#/$defs/'.length)
      if (!visited.has(name)) {
        visited.add(name)
        names.push(name)
        visit(defs[name])
      }
      return
    }

    Object.entries(value).forEach(([key, child]) => {
      if (key !== '$defs') visit(child)
    })
  }

  visit(root)
  return names
}

const compressBrainHandCallDisplay = (node: JsonSchemaNode): JsonSchemaNode => {
  const cloned = cloneJsonSchemaNode(node)

  if (Array.isArray(cloned.anyOf)) {
    cloned.anyOf = cloned.anyOf.map((item) =>
      isJsonSchemaNode(item) ? compressBrainHandCallDisplay(item) : item
    )
  }
  if (Array.isArray(cloned.oneOf)) {
    cloned.oneOf = cloned.oneOf.map((item) =>
      isJsonSchemaNode(item) ? compressBrainHandCallDisplay(item) : item
    )
  }
  if (Array.isArray(cloned.allOf)) {
    cloned.allOf = cloned.allOf.map((item) =>
      isJsonSchemaNode(item) ? compressBrainHandCallDisplay(item) : item
    )
  }

  if (isJsonSchemaNode(cloned.properties)) {
    Object.entries(cloned.properties).forEach(([key, value]) => {
      if (isJsonSchemaNode(value)) {
        cloned.properties = cloned.properties as JsonSchemaNode
        ;(cloned.properties as JsonSchemaNode)[key] = compressBrainHandCallDisplay(value)
      }
    })
  }

  if (isJsonSchemaNode(cloned.items)) {
    cloned.items = compressBrainHandCallDisplay(cloned.items)
  } else if (Array.isArray(cloned.items)) {
    cloned.items = cloned.items.map((item) =>
      isJsonSchemaNode(item) ? compressBrainHandCallDisplay(item) : item
    )
  }

  const properties = isJsonSchemaNode(cloned.properties) ? cloned.properties : undefined
  const actionProperty =
    properties && isJsonSchemaNode(properties.action) ? properties.action : undefined
  const callsProperty =
    properties && isJsonSchemaNode(properties.calls) ? properties.calls : undefined
  if (actionProperty?.const === 'hand' && callsProperty) {
    ;(cloned.properties as JsonSchemaNode).calls = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          toolName: {
            type: 'string'
          },
          args: {
            'x-display-type': 'object'
          }
        },
        required: ['toolName', 'args']
      }
    }
  }

  return cloned
}

const buildSchemaRenderOutput = (
  schema: z.ZodType,
  options?: { brainPromptFriendly?: boolean }
): { rootSchema: string; definitionBlocks: string[] } => {
  const document = toJSONSchema(schema) as JsonSchemaNode
  const normalizedDocument = options?.brainPromptFriendly
    ? compressBrainHandCallDisplay(document)
    : document
  const defs = isJsonSchemaNode(normalizedDocument.$defs)
    ? (normalizedDocument.$defs as Record<string, JsonSchemaNode>)
    : {}
  const context: RenderContext = { defs }
  const definitionNames = collectReferencedDefinitionNames(normalizedDocument, defs)
  return {
    rootSchema: renderSchemaType(normalizedDocument, context, 0),
    definitionBlocks: definitionNames.map(
      (name) => `type ${name} = ${renderSchemaType(defs[name]!, context, 0)}`
    )
  }
}

export const renderSchemaShape = (
  schema: z.ZodType,
  options?: { brainPromptFriendly?: boolean }
): string => {
  const { rootSchema, definitionBlocks } = buildSchemaRenderOutput(schema, options)

  return [
    indentBlock(rootSchema, 1),
    ...(definitionBlocks.length > 0
      ? ['', '补充定义：', ...definitionBlocks.map((block) => indentBlock(block, 1))]
      : [])
  ].join('\n')
}

export const renderToolInputSchemaForPrompt = (
  schema: z.ZodType,
  options?: { compact?: boolean }
): string => {
  if (!options?.compact) return renderSchemaShape(schema)

  const { rootSchema, definitionBlocks } = buildCompactSchemaRenderOutput(schema)
  return [
    rootSchema,
    ...(definitionBlocks.length > 0 ? ['类型定义：', ...definitionBlocks] : [])
  ].join('\n')
}

export const renderBrainOutputSchemaForPrompt = (
  schema: z.ZodType,
  options?: { compact?: boolean }
): string => {
  if (!options?.compact) {
    return renderSchemaShape(schema, { brainPromptFriendly: true })
  }

  const { rootSchema, definitionBlocks } = buildCompactSchemaRenderOutput(schema, {
    brainPromptFriendly: true
  })
  return [
    rootSchema,
    ...(definitionBlocks.length > 0 ? ['类型定义：', ...definitionBlocks] : [])
  ].join('\n')
}
