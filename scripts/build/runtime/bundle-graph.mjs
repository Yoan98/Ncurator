import fs from 'node:fs'
import ts from 'typescript'
import { builtinModules } from 'node:module'
import path from 'node:path'

const BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  'electron'
])

const resolveLocalModule = (importerPath, specifier) => {
  if (!specifier.startsWith('.')) return null
  const candidate = path.resolve(path.dirname(importerPath), specifier)
  const candidates = [candidate, `${candidate}.js`, path.join(candidate, 'index.js')]
  return candidates.find((item) => fs.existsSync(item)) || null
}

export const readBundleGraph = (entryPath) => {
  if (!fs.existsSync(entryPath)) {
    throw new Error(`runtime bundle not found: ${entryPath}`)
  }

  const pending = [entryPath]
  const visited = new Set()
  const externalImports = new Set()
  while (pending.length > 0) {
    const currentPath = pending.pop()
    if (!currentPath || visited.has(currentPath)) continue
    visited.add(currentPath)
    const source = fs.readFileSync(currentPath, 'utf8')
    const ast = ts.createSourceFile(
      currentPath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    )
    const visit = (node) => {
      let specifier
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        specifier = node.moduleSpecifier.text
      if (
        ts.isCallExpression(node) &&
        node.arguments.length &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const expression = node.expression
        if (
          expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(expression) && expression.text === 'require') ||
          (ts.isPropertyAccessExpression(expression) &&
            ts.isIdentifier(expression.expression) &&
            expression.expression.text === 'require' &&
            expression.name.text === 'resolve')
        )
          specifier = node.arguments[0].text
      }
      if (specifier) {
        const local = resolveLocalModule(currentPath, specifier)
        if (local) pending.push(local)
        else externalImports.add(specifier)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }

  return { visited, externalImports }
}

export const packageNameFromSpecifier = (specifier) => {
  if (!specifier || BUILTIN_MODULES.has(specifier) || specifier.startsWith('node:')) return null
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

export const collectRuntimePackageNames = (entryPaths) => {
  const packageNames = new Set()
  for (const entryPath of entryPaths) {
    const graph = readBundleGraph(entryPath)
    for (const specifier of graph.externalImports) {
      const packageName = packageNameFromSpecifier(specifier)
      if (packageName) packageNames.add(packageName)
    }
  }
  return [...packageNames].sort()
}
