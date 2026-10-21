import fs from 'node:fs'
import ts from 'typescript'

let source
const read = (node) => {
  if (ts.isAsExpression(node)) return read(node.expression)
  if (ts.isStringLiteral(node)) return node.text
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property))
          throw new Error('Translation resources must be literal objects')
        return [
          property.name.getText(source).replace(/^['"]|['"]$/g, ''),
          read(property.initializer)
        ]
      })
    )
  throw new Error('Translation resources must contain strings only')
}
const resources = {}
for (const [locale, filename] of [
  ['zh', 'zh-CN.ts'],
  ['en', 'en.ts']
]) {
  source = ts.createSourceFile(
    filename,
    fs.readFileSync(`src/renderer/src/i18n/${filename}`, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) === locale)
        resources[locale] = read(declaration.initializer)
    }
  }
}
const flatten = (object, prefix = '') =>
  Object.fromEntries(
    Object.entries(object).flatMap(([key, value]) =>
      typeof value === 'string'
        ? [[`${prefix}${key}`, value]]
        : Object.entries(flatten(value, `${prefix}${key}.`))
    )
  )
const zh = flatten(resources.zh),
  en = flatten(resources.en)
const placeholders = (value) =>
  [...new Set(value.match(/\{\{\w+\}\}|\$\{\w+\}|\{\d+\}/g) || [])].sort().join(',')
if (Object.keys(zh).sort().join('\n') !== Object.keys(en).sort().join('\n'))
  throw new Error('Chinese and English translation keys differ')
for (const key of Object.keys(zh)) {
  if (!en[key].trim() || placeholders(zh[key]) !== placeholders(en[key]))
    throw new Error(`Translation placeholders differ: ${key}`)
}
process.stdout.write(`[i18n] ${Object.keys(zh).length} bilingual keys validated\n`)
