import {
  prepareDocxLocations,
  collectDocxRegions,
  writeReviewIndex
} from '../../../../fileChanges/reviewNavigationIndex'
import fs from 'node:fs/promises'
import path from 'node:path'
import { XMLSerializer } from '@xmldom/xmldom'
import { loadDocxBundle } from '../adapters/ooxml/nodeIndex'
import { findNewDocxValidationProblems, validateDocxBuffer } from '../adapters/ooxml/validator'
import { buildDocxNetReview } from './netReview'
import type { DocxNetReview } from './netReview'
import { REVIEW } from './documentModel'

/** Sole production review path: immutable owner baseline versus the real final package. */
export const materializeDocxReview = async (input: {
  sourceBuffer: Buffer
  workingBuffer: Buffer
  outPath: string
  created?: boolean
}): Promise<DocxNetReview> => {
  const source = await loadDocxBundle(input.sourceBuffer),
    working = await loadDocxBundle(input.workingBuffer)
  const locations = prepareDocxLocations(working)
  const result = await buildDocxNetReview(source, working, input.created),
    serializer = new XMLSerializer()
  const regions = collectDocxRegions(working, locations)
  const parts = new Map(working.stories.map((part) => [part.partName, part.dom]))
  for (const [name, document] of parts) {
    // Word requires drawing ids to be unique even when an old/new object is shown twice.
    let drawingId = 1
    for (const node of Array.from(document.getElementsByTagName('*'))) {
      if (['docPr', 'cNvPr'].includes(node.localName) && node.hasAttribute('id'))
        node.setAttribute('id', String(drawingId++))
    }
    document.documentElement.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:ncr', REVIEW)
    if (result.summaries.length)
      document.documentElement.setAttributeNS(
        REVIEW,
        'ncr:documentChanges',
        JSON.stringify(result.summaries)
      )
    document.documentElement.setAttributeNS(
      'http://www.w3.org/2000/xmlns/',
      'xmlns:mc',
      'http://schemas.openxmlformats.org/markup-compatibility/2006'
    )
    const ignorable = document.documentElement.getAttribute('mc:Ignorable') || ''
    document.documentElement.setAttributeNS(
      'http://schemas.openxmlformats.org/markup-compatibility/2006',
      'mc:Ignorable',
      [...new Set([...ignorable.split(/\s+/).filter(Boolean), 'ncr'])].join(' ')
    )
    working.zip.file(name, serializer.serializeToString(document))
  }
  const buffer = await working.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const problems = findNewDocxValidationProblems(
    await validateDocxBuffer(input.sourceBuffer),
    await validateDocxBuffer(buffer)
  )
  if (problems.length)
    throw new Error(
      `review_artifact_invalid_generated: ${problems.map((p) => `${p.code}:${p.message}`).join('; ')}`
    )
  await fs.mkdir(path.dirname(input.outPath), { recursive: true })
  await fs.writeFile(input.outPath, buffer)
  await writeReviewIndex(path.dirname(input.outPath), input.workingBuffer, regions)
  return result
}
