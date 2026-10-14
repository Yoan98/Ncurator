export const isElementNode = (value: Node | null): value is Element => {
  return value !== null && value.nodeType === 1
}

export const childElements = (node: Element, localName?: string): Element[] => {
  const out: Element[] = []
  const children = node.childNodes
  for (let index = 0; index < children.length; index += 1) {
    const child = children.item(index)
    if (!isElementNode(child)) continue
    if (!localName || child.localName === localName) out.push(child)
  }
  return out
}

export const descendantElements = (node: Element, localName: string): Element[] => {
  const out: Element[] = []
  const stack: Node[] = []
  const children = node.childNodes
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children.item(index)
    if (child) stack.push(child)
  }

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !isElementNode(current)) continue
    if (current.localName === localName) out.push(current)
    const currentChildren = current.childNodes
    for (let index = currentChildren.length - 1; index >= 0; index -= 1) {
      const child = currentChildren.item(index)
      if (child) stack.push(child)
    }
  }

  return out
}

export const firstChildElement = (node: Element, localName: string): Element | null => {
  const children = node.childNodes
  for (let index = 0; index < children.length; index += 1) {
    const child = children.item(index)
    if (!isElementNode(child)) continue
    if (child.localName === localName) return child
  }
  return null
}

export const getAttr = (node: Element, localName: string): string => {
  const names = [localName, `w:${localName}`, `cp:${localName}`, `dc:${localName}`]
  for (const name of names) {
    const value = node.getAttribute(name)
    if (value) return value
  }
  return ''
}

export const collectText = (node: Element): string => {
  let text = ''
  const stack: Node[] = [node]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    if (current.nodeType === 3) {
      text += current.nodeValue || ''
      continue
    }
    if (!isElementNode(current)) continue
    const name = current.localName
    if (name === 'tab') {
      text += '\t'
      continue
    }
    if (name === 'br' || name === 'cr') {
      text += '\n'
      continue
    }
    const children = current.childNodes
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children.item(index)
      if (child) stack.push(child)
    }
  }
  return text
}
