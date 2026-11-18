import ts from 'typescript'

/** Read existing case declarations without executing test modules or maintaining a second list. */
export const readE2ESeedFixtures = (fileName, source, testNamePattern = '') => {
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const pattern = testNamePattern ? new RegExp(testNamePattern, 'u') : null
  const fixtures = new Set()
  const fail = (detail) => {
    throw new Error(`Cannot safely plan knowledge seed for ${fileName}: ${detail}`)
  }
  const constants = new Map()
  for (const statement of tree.statements) {
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          ts.isStringLiteralLike(declaration.initializer)
        )
          constants.set(declaration.name.text, declaration.initializer.text)
      }
    }
  }
  const literal = (node) =>
    node && ts.isStringLiteralLike(node)
      ? node.text
      : node && ts.isIdentifier(node)
        ? constants.get(node.text)
        : undefined
  const walk = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'runE2ECase'
    ) {
      const definition = node.arguments[0]
      if (!definition || !ts.isObjectLiteralExpression(definition))
        fail('case definition must be an object literal')
      const properties = new Map()
      for (const property of definition.properties) {
        if (ts.isSpreadAssignment(property)) continue
        const name =
          property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
            ? property.name.text
            : null
        if (name && ts.isPropertyAssignment(property)) properties.set(name, property.initializer)
      }
      const knowledge = properties.get('knowledge')
      if (knowledge && literal(knowledge) === undefined) fail('knowledge must be a string literal')
      if (literal(knowledge) === 'cached') {
        if (definition.properties.some(ts.isSpreadAssignment))
          fail('spread cached case metadata is not supported')
        const caseId = literal(properties.get('caseId'))
        if (!caseId) fail('cached caseId must be a string literal')
        if (!pattern || pattern.test(caseId)) {
          const inputs = properties.get('fixtures')
          if (!inputs || !ts.isArrayLiteralExpression(inputs))
            fail(`${caseId}: fixtures must be a literal array`)
          for (const element of inputs.elements) {
            const fixture = literal(element)
            if (fixture === undefined) fail(`${caseId}: fixture paths must be string literals`)
            fixtures.add(fixture)
          }
        }
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(tree)
  return [...fixtures].sort()
}
