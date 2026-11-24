import JSZip from 'jszip'

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const word14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
const review = 'urn:ncurator:docx-review'

type Marker = { id: string; kind: string }
type Paragraph = {
  block?: Marker
  runs: Array<{ start: number; end: number; marker?: Marker; fill?: string; border?: string }>
}

function nearestMarker(element: Element, stop?: Element): Marker | undefined {
  for (
    let current: Element | null = element;
    current && current !== stop;
    current = current.parentElement
  ) {
    const id = current.getAttributeNS(review, 'region')
    const kind = current.getAttributeNS(review, 'change')
    if (id && kind) return { id, kind }
  }
  return undefined
}

/** Only the read-only import receives generated paragraph IDs. The historical package stays byte-exact. */
export async function prepareSuperDocReview(source: Blob) {
  const zip = await JSZip.loadAsync(await source.arrayBuffer())
  const paragraphs = new Map<string, Paragraph>()
  const used = new Set<string>()
  let sequence = 0x60000000
  for (const part of Object.values(zip.files)) {
    if (!/^word\/(document|header[^/]*|footer[^/]*|footnotes|endnotes)\.xml$/.test(part.name))
      continue
    const dom = new DOMParser().parseFromString(await part.async('string'), 'application/xml')
    for (const p of dom.getElementsByTagNameNS(word, 'p')) {
      let id = p.getAttributeNS(word14, 'paraId')
      if (!id || used.has(id)) {
        do {
          id = (sequence++).toString(16).toUpperCase()
        } while (used.has(id))
        p.setAttributeNS(word14, 'w14:paraId', id)
      }
      used.add(id)
      const paragraph: Paragraph = { block: nearestMarker(p), runs: [] }
      let offset = 0
      for (const run of p.getElementsByTagNameNS(word, 'r')) {
        let owner = run.parentElement
        while (owner && owner.localName !== 'p') owner = owner.parentElement
        if (owner !== p) continue
        const marker = nearestMarker(run, p)
        const length = Array.from(run.getElementsByTagNameNS(word, '*')).reduce(
          (n, el) =>
            n +
            (el.localName === 't' || el.localName === 'delText'
              ? (el.textContent || '').length
              : ['tab', 'br', 'drawing', 'object'].includes(el.localName)
                ? 1
                : 0),
          0
        )
        const props = Array.from(run.children).find(
          (el) => el.namespaceURI === word && el.localName === 'rPr'
        )
        const color = (name: string, attr: string) => {
          const value = Array.from(props?.children ?? [])
            .find((el) => el.namespaceURI === word && el.localName === name)
            ?.getAttributeNS(word, attr)
          return value && /^[a-f0-9]{6}$/i.test(value) ? '#' + value : undefined
        }
        const fill = color('shd', 'fill'),
          border = color('bdr', 'color')
        if (marker || fill || border)
          paragraph.runs.push({ start: offset, end: offset + length, marker, fill, border })
        offset += length
      }
      if (paragraph.block || paragraph.runs.length) paragraphs.set(id, paragraph)
    }
    zip.file(part.name, new XMLSerializer().serializeToString(dom))
  }
  function decorate(host: HTMLElement) {
    const tag = (element: HTMLElement, marker: Marker) => {
      element.dataset.reviewRegion = marker.id
      element.dataset.docxChange = marker.kind
    }
    const offsets = new Map<string, number>()
    for (const block of host.querySelectorAll<HTMLElement>('.superdoc-page [data-para-id]')) {
      const id = block.dataset.paraId!
      const paragraph = paragraphs.get(id)
      if (!paragraph) continue
      if (paragraph.block) tag(block, paragraph.block)
      let offset = offsets.get(id) ?? 0
      for (const el of block.querySelectorAll<HTMLElement>('[data-run-id],img')) {
        if (el.closest('[data-para-id]') !== block || el.parentElement?.closest('[data-run-id]'))
          continue
        const end = offset + (el.textContent?.length || 1)
        const span = paragraph.runs.find((r) => r.start < end && r.end > offset)
        if (span?.marker) tag(el, span.marker)
        if (span?.fill) el.style.backgroundColor = span.fill
        if (span?.border) {
          el.style.borderColor = span.border
          el.style.boxShadow = 'inset 0 0 0 1px ' + span.border
        }
        offset = end
      }
      // Repeated headers/footers start at zero on each page.
      if (block.dataset.layoutStory === 'body') offsets.set(id, offset)
    }
  }
  return { document: await zip.generateAsync({ type: 'blob' }), decorate }
}
