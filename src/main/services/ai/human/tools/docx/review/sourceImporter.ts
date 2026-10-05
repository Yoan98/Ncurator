import path from 'node:path'
import { XMLSerializer } from '@xmldom/xmldom'
import { childElements, firstChildElement, getAttr } from '../adapters/ooxml/dom'
import { resolveDocxRelationshipTarget } from '../adapters/ooxml/relationshipPath'
import type { DocxStoryPart, ParsedDocxBundle } from '../adapters/ooxml/types'
import {
  canonical,
  effectivePropertyElements,
  hash,
  numberingMap,
  parseXml,
  relsPath,
  resolveThemeProperty,
  styleMap,
  themeMap,
  R,
  W
} from './documentModel'
import type { DocumentContext } from './documentModel'
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const serializer = new XMLSerializer()

/** Import source relationships and recursively preserve their dependent parts. */
export class SourceImporter {
  private readonly partMap = new Map<string, string>()
  private readonly documents = new Map<string, Document>()
  private readonly relationMap = new Map<string, string>()
  private oldTheme: Awaited<ReturnType<typeof themeMap>> = new Map()
  private newTheme: Awaited<ReturnType<typeof themeMap>> = new Map()
  private readonly sourceRelationships = new Map<string, Map<string, Element>>()
  private readonly styleIds = new Map<string, string>()
  private readonly numberIds = new Map<string, string>()
  private readonly commentIds = new Map<string, string>()
  public constructor(
    private readonly source: ParsedDocxBundle,
    private readonly target: ParsedDocxBundle
  ) {}

  public async prepareDefinitions(
    oldStyles: Map<string, Element>,
    oldNumbering: Map<string, string>
  ): Promise<void> {
    this.oldTheme = await themeMap(this.source)
    this.newTheme = await themeMap(this.target)
    const sourceStyles = this.source.stylesDom
    if (sourceStyles && !this.target.stylesDom)
      this.target.stylesDom = parseXml(`<w:styles xmlns:w="${W}"/>`)
    const targetStyles = this.target.stylesDom
    if (sourceStyles && targetStyles) {
      const current = styleMap(this.target)
      for (const [id, style] of oldStyles) {
        if (current.has(id) && canonical(current.get(id)!) === canonical(style)) {
          this.styleIds.set(id, id)
          continue
        }
        const next = `ncr_${hash(canonical(style)).slice(0, 16)}_${id}`
        this.styleIds.set(id, next)
      }
      for (const [id, next] of this.styleIds) {
        if (id === next) continue
        const source = oldStyles.get(id)!,
          copy = targetStyles.importNode(source, true) as Element
        copy.setAttribute('w:styleId', next)
        copy.removeAttribute('w:default')
        for (const name of ['basedOn', 'next', 'link']) {
          const prop = firstChildElement(copy, name)
          if (prop)
            prop.setAttribute(
              'w:val',
              this.styleIds.get(getAttr(prop, 'val')) || getAttr(prop, 'val')
            )
        }
        targetStyles.documentElement.appendChild(copy)
        oldStyles.set(next, source)
      }
      this.documents.set('word/styles.xml', targetStyles)
      await this.registerDefinitionPart('styles')
    }
    const numbering = this.source.zip.file('word/numbering.xml')
    if (numbering) {
      const old = parseXml(await numbering.async('text'))
      const entry = this.target.zip.file('word/numbering.xml')
      const next = parseXml(entry ? await entry.async('text') : `<w:numbering xmlns:w="${W}"/>`)
      let maxNum = Math.max(
        0,
        ...Array.from(next.getElementsByTagNameNS(W, 'num')).map((e) => Number(getAttr(e, 'numId')))
      )
      let maxAbstract = Math.max(
        0,
        ...Array.from(next.getElementsByTagNameNS(W, 'abstractNum')).map((e) =>
          Number(getAttr(e, 'abstractNumId'))
        )
      )
      const abstracts = new Map(
        Array.from(old.getElementsByTagNameNS(W, 'abstractNum')).map((e) => [
          getAttr(e, 'abstractNumId'),
          e
        ])
      )
      const currentKeys = await numberingMap(this.target)
      for (const num of Array.from(old.getElementsByTagNameNS(W, 'num'))) {
        const id = getAttr(num, 'numId')
        if (currentKeys.get(id) === oldNumbering.get(id)) {
          this.numberIds.set(id, id)
          continue
        }
        const abstractId = getAttr(firstChildElement(num, 'abstractNumId')!, 'val'),
          definition = abstracts.get(abstractId)
        if (!definition) continue
        const copiedAbstract = next.importNode(definition, true) as Element,
          newAbstract = String(++maxAbstract)
        copiedAbstract.setAttribute('w:abstractNumId', newAbstract)
        for (const name of ['pStyle', 'rStyle', 'numStyleLink', 'styleLink'])
          for (const reference of Array.from(copiedAbstract.getElementsByTagNameNS(W, name)))
            reference.setAttribute(
              'w:val',
              this.styleIds.get(getAttr(reference, 'val')) || getAttr(reference, 'val')
            )
        next.documentElement.appendChild(copiedAbstract)
        const copiedNum = next.importNode(num, true) as Element,
          newNum = String(++maxNum)
        copiedNum.setAttribute('w:numId', newNum)
        firstChildElement(copiedNum, 'abstractNumId')!.setAttribute('w:val', newAbstract)
        next.documentElement.appendChild(copiedNum)
        this.numberIds.set(id, newNum)
        oldNumbering.set(newNum, oldNumbering.get(id)!)
      }
      this.documents.set('word/numbering.xml', next)
      await this.registerDefinitionPart('numbering')
    }
    const comments = this.source.zip.file('word/comments.xml')
    if (comments) {
      const old = parseXml(await comments.async('text'))
      const entry = this.target.zip.file('word/comments.xml')
      const next = parseXml(entry ? await entry.async('text') : `<w:comments xmlns:w="${W}"/>`)
      let max = Math.max(
        0,
        ...childElements(next.documentElement).map((e) => Number(getAttr(e, 'id')))
      )
      for (const comment of childElements(old.documentElement)) {
        const id = getAttr(comment, 'id'),
          current = childElements(next.documentElement).find((e) => getAttr(e, 'id') === id)
        if (current && canonical(current) === canonical(comment)) {
          this.commentIds.set(id, id)
          continue
        }
        const copy = next.importNode(comment, true) as Element,
          newId = String(++max)
        copy.setAttribute('w:id', newId)
        next.documentElement.appendChild(copy)
        this.commentIds.set(id, newId)
      }
      this.documents.set('word/comments.xml', next)
      await this.registerDefinitionPart('comments')
    }
  }

  private async registerDefinitionPart(kind: 'styles' | 'numbering' | 'comments'): Promise<void> {
    const name = `word/${kind}.xml`,
      relationName = relsPath('word/document.xml')
    let relations = this.documents.get(relationName)
    if (!relations) {
      const entry = this.target.zip.file(relationName)
      relations = parseXml(entry ? await entry.async('text') : `<Relationships xmlns="${REL}"/>`)
      this.documents.set(relationName, relations)
    }
    const type = `${R}/${kind}`
    if (!childElements(relations.documentElement).some((e) => e.getAttribute('Type') === type)) {
      const relation = relations.createElementNS(REL, 'Relationship')
      let id = `ncuratorDefinition_${kind}`
      while (childElements(relations.documentElement).some((e) => e.getAttribute('Id') === id))
        id += '_'
      relation.setAttribute('Id', id)
      relation.setAttribute('Type', type)
      relation.setAttribute('Target', `${kind}.xml`)
      relations.documentElement.appendChild(relation)
    }
    const types =
      this.documents.get('[Content_Types].xml') ||
      parseXml(await this.target.zip.file('[Content_Types].xml')!.async('text'))
    if (
      !childElements(types.documentElement).some((e) => e.getAttribute('PartName') === `/${name}`)
    ) {
      const override = types.createElementNS(types.documentElement.namespaceURI, 'Override')
      override.setAttribute('PartName', `/${name}`)
      override.setAttribute(
        'ContentType',
        `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`
      )
      types.documentElement.appendChild(override)
    }
    this.documents.set('[Content_Types].xml', types)
  }

  private async copyPart(sourceName: string): Promise<string> {
    const cached = this.partMap.get(sourceName)
    if (cached) return cached
    const entry = this.source.zip.file(sourceName)
    if (!entry) throw new Error(`review source resource missing: ${sourceName}`)
    const data = await entry.async('nodebuffer')
    const existing = this.target.zip.file(sourceName)
    const relFile = this.source.zip.file(relsPath(sourceName))
    if (!relFile && existing && (await existing.async('nodebuffer')).equals(data)) {
      this.partMap.set(sourceName, sourceName)
      return sourceName
    }
    const targetName = path.posix.join(
      path.posix.dirname(sourceName),
      `review-${hash(Buffer.concat([data, Buffer.from(sourceName), relFile ? await relFile.async('nodebuffer') : Buffer.alloc(0)])).slice(0, 20)}${path.posix.extname(sourceName)}`
    )
    this.partMap.set(sourceName, targetName)
    this.target.zip.file(targetName, data)
    if (relFile) {
      const relDoc = parseXml(await relFile.async('text'))
      for (const rel of childElements(relDoc.documentElement)) {
        if (rel.getAttribute('TargetMode') === 'External') continue
        const oldName = resolveDocxRelationshipTarget(rel.getAttribute('Target') || '', sourceName)
        if (oldName)
          rel.setAttribute(
            'Target',
            path.posix.relative(path.posix.dirname(targetName), await this.copyPart(oldName))
          )
      }
      this.target.zip.file(relsPath(targetName), serializer.serializeToString(relDoc))
    }
    const sourceTypes = parseXml(await this.source.zip.file('[Content_Types].xml')!.async('text'))
    const targetTypes =
      this.documents.get('[Content_Types].xml') ||
      parseXml(await this.target.zip.file('[Content_Types].xml')!.async('text'))
    this.documents.set('[Content_Types].xml', targetTypes)
    const override = childElements(sourceTypes.documentElement).find(
      (e) => e.localName === 'Override' && e.getAttribute('PartName') === `/${sourceName}`
    )
    if (override) {
      const copied = targetTypes.importNode(override, true) as Element
      copied.setAttribute('PartName', `/${targetName}`)
      if (
        !childElements(targetTypes.documentElement).some(
          (e) => e.getAttribute('PartName') === `/${targetName}`
        )
      )
        targetTypes.documentElement.appendChild(copied)
    } else {
      const extension = path.posix.extname(sourceName).slice(1)
      const def = childElements(sourceTypes.documentElement).find(
        (e) => e.localName === 'Default' && e.getAttribute('Extension') === extension
      )
      if (def) {
        const existing = childElements(targetTypes.documentElement).find(
          (e) => e.getAttribute('Extension') === extension
        )
        if (!existing) targetTypes.documentElement.appendChild(targetTypes.importNode(def, true))
        else if (existing.getAttribute('ContentType') !== def.getAttribute('ContentType')) {
          const override = targetTypes.createElementNS(
            targetTypes.documentElement.namespaceURI,
            'Override'
          )
          override.setAttribute('PartName', `/${targetName}`)
          override.setAttribute('ContentType', def.getAttribute('ContentType') || '')
          targetTypes.documentElement.appendChild(override)
        }
      }
    }
    return targetName
  }

  public async importElement(
    element: Element,
    sourcePart: DocxStoryPart,
    targetPart: DocxStoryPart
  ): Promise<Element> {
    const result = targetPart.dom.importNode(element, true) as Element
    const oldContext: DocumentContext = {
      bundle: this.source,
      part: sourcePart,
      assets: new Map(),
      styles: styleMap(this.source),
      theme: this.oldTheme
    }
    const freeze = (original: Element, copy: Element): void => {
      if (original.localName === 'p') {
        let props = firstChildElement(copy, 'pPr')
        if (!props) {
          props = copy.ownerDocument.createElementNS(W, 'w:pPr')
          copy.insertBefore(props, copy.firstChild)
        }
        for (const [name, property] of effectivePropertyElements(oldContext, original))
          if (!firstChildElement(props, name))
            props.appendChild(copy.ownerDocument.importNode(property, true))
        const originalRuns = Array.from(original.getElementsByTagNameNS(W, 'r')),
          runs = Array.from(copy.getElementsByTagNameNS(W, 'r'))
        originalRuns.forEach((run, index) => {
          const cloned = runs[index]!
          let rPr = firstChildElement(cloned, 'rPr')
          if (!rPr) {
            rPr = cloned.ownerDocument.createElementNS(W, 'w:rPr')
            cloned.insertBefore(rPr, cloned.firstChild)
          }
          for (const [name, property] of effectivePropertyElements(oldContext, original, run)) {
            const existing = firstChildElement(rPr, name)
            if (existing) rPr.removeChild(existing)
            rPr.appendChild(
              cloned.ownerDocument.importNode(resolveThemeProperty(property, this.oldTheme), true)
            )
          }
        })
      } else {
        const originals = childElements(original),
          copies = childElements(copy)
        originals.forEach((node, index) => freeze(node, copies[index]!))
      }
    }
    const defaults = (bundle: ParsedDocxBundle): string => {
      const root = bundle.stylesDom?.getElementsByTagNameNS(W, 'docDefaults')[0]
      const style = Array.from(bundle.stylesDom?.getElementsByTagNameNS(W, 'style') || []).find(
        (e) => getAttr(e, 'type') === 'paragraph' && getAttr(e, 'default') === '1'
      )
      return JSON.stringify([root ? canonical(root) : '', style ? canonical(style) : ''])
    }
    if (
      defaults(this.source) !== defaults(this.target) ||
      JSON.stringify([...this.oldTheme]) !== JSON.stringify([...this.newTheme])
    )
      freeze(element, result)
    const visit = async (node: Element): Promise<void> => {
      if (['pStyle', 'rStyle', 'tblStyle'].includes(node.localName))
        node.setAttribute('w:val', this.styleIds.get(getAttr(node, 'val')) || getAttr(node, 'val'))
      if (node.localName === 'numId')
        node.setAttribute('w:val', this.numberIds.get(getAttr(node, 'val')) || getAttr(node, 'val'))
      if (['commentRangeStart', 'commentRangeEnd', 'commentReference'].includes(node.localName))
        node.setAttribute('w:id', this.commentIds.get(getAttr(node, 'id')) || getAttr(node, 'id'))
      for (const attr of Array.from(node.attributes)) {
        if (attr.namespaceURI !== R) continue
        const mapKey = `${sourcePart.partName}:${targetPart.partName}:${attr.value}`
        let id = this.relationMap.get(mapKey)
        if (!id) {
          const targetName = relsPath(targetPart.partName)
          let doc = this.documents.get(targetName)
          if (!doc) {
            const entry = this.target.zip.file(targetName)
            doc = parseXml(entry ? await entry.async('text') : `<Relationships xmlns="${REL}"/>`)
            this.documents.set(targetName, doc)
          }
          let sourceRelations = this.sourceRelationships.get(sourcePart.partName)
          if (!sourceRelations) {
            const sourceRelFile = this.source.zip.file(relsPath(sourcePart.partName))
            if (!sourceRelFile) throw new Error(`review source relationship missing: ${attr.value}`)
            sourceRelations = new Map(
              childElements(parseXml(await sourceRelFile.async('text')).documentElement).map(
                (e) => [e.getAttribute('Id') || '', e]
              )
            )
            this.sourceRelationships.set(sourcePart.partName, sourceRelations)
          }
          const sourceRel = sourceRelations.get(attr.value)
          if (!sourceRel) throw new Error(`review source relationship missing: ${attr.value}`)
          id = `ncuratorReview${this.relationMap.size + 1}`
          while (childElements(doc.documentElement).some((e) => e.getAttribute('Id') === id))
            id += '_'
          const rel = doc.importNode(sourceRel, true) as Element
          rel.setAttribute('Id', id)
          if (rel.getAttribute('TargetMode') !== 'External') {
            const name = resolveDocxRelationshipTarget(
              rel.getAttribute('Target') || '',
              sourcePart.partName
            )
            if (name)
              rel.setAttribute(
                'Target',
                path.posix.relative(
                  path.posix.dirname(targetPart.partName),
                  // Preserve an already broken image target (e.g. Word's ../NULL sentinel).
                  // It has no bytes to import; real images still retain both old/new resources.
                  (rel.getAttribute('Type') || '').endsWith('/image') && !this.source.zip.file(name)
                    ? name
                    : await this.copyPart(name)
                )
              )
          }
          doc.documentElement.appendChild(rel)
          this.relationMap.set(mapKey, id)
        }
        const original = attr.value
        sourcePart.relationshipTargets.set(id, sourcePart.relationshipTargets.get(original) || '')
        sourcePart.relationshipTypes.set(id, sourcePart.relationshipTypes.get(original) || '')
        sourcePart.relationshipTargetModes.set(
          id,
          sourcePart.relationshipTargetModes.get(original) || ''
        )
        node.setAttributeNS(R, attr.name, id)
      }
      for (const child of childElements(node)) await visit(child)
    }
    await visit(result)
    return result
  }

  public flush(): void {
    for (const [name, doc] of this.documents)
      this.target.zip.file(name, serializer.serializeToString(doc))
  }
}
