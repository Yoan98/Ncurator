import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileChangeSession } from './FileChangeSession'
import {
  createTextFileDiffArtifact,
  countTextFileDiffLines
} from '../human/tools/textFile/textDiff'
import { decodeTextFile } from '../human/tools/textFile/textFileUtils'

export const materializeFileReview = async (input: {
  before?: Buffer
  after: Buffer
  session: FileChangeSession
  reviewDir: string
}) => {
  const { before, after, session, reviewDir } = input
  switch (session.record.capability) {
    case 'docx': {
      const { materializeDocxReview } = await import('../human/tools/docx/review/reviewSerializer')
      const previewPath = path.join(reviewDir, 'review.docx')
      const result = await materializeDocxReview({
        sourceBuffer: before || after,
        workingBuffer: after,
        outPath: previewPath,
        created: !before
      })
      return { changed: result.stats.changeCount > 0, ...result.stats, previewPath }
    }
    case 'excel': {
      const { materializeExcelReview } = await import('../human/tools/excel/runtime')
      return await materializeExcelReview({
        before,
        after,
        reviewDir,
        identity: session.identity?.kind === 'excel' ? session.identity : undefined
      })
    }
    case 'ppt': {
      const { materializePptReview } = await import('../human/tools/ppt/runtime')
      return await materializePptReview({ before, after, reviewDir, identity: session.identity })
    }
    case 'image':
      return {
        changed: !before || !before.equals(after),
        changeCount: 1,
        insertCount: 0,
        deleteCount: 0,
        previewPath: undefined
      }
    case 'text_file': {
      const sourcePath = session.record.path
      const artifact = createTextFileDiffArtifact({
        before: before ? decodeTextFile(before, sourcePath).normalizedContent : '',
        after: decodeTextFile(after, sourcePath).normalizedContent
      })
      const counts = countTextFileDiffLines(artifact)
      const previewPath = path.join(reviewDir, 'review.json')
      await fs.writeFile(previewPath, JSON.stringify(artifact))
      return {
        changed: !before || !before.equals(after),
        changeCount: Math.max(1, counts.insertCount + counts.deleteCount),
        ...counts,
        previewPath
      }
    }
    default:
      throw new Error('不支持的内容审核格式')
  }
}
