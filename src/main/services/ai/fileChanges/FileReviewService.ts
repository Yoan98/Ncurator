import fs from 'node:fs/promises'
import path from 'node:path'
import {
  officeReviewIndexSchema,
  textReviewSchema,
  isWpsApplication,
  type GetFileReviewResponse,
  type OpenFileReviewLocationRequest,
  type ReviewNavigationResult
} from '../../../../shared/fileReview'
import type { AiFileChangeService } from './AiFileChangeService'
import type { OpenWithService } from '../../openWith/OpenWithService'
import { navigateOfficeReview } from '../../wps/officeFileWriteNotify'

export class FileReviewService {
  private readonly latestRequests = new Map<string, symbol>()
  constructor(
    private readonly changes: AiFileChangeService,
    private readonly applications: OpenWithService
  ) {}
  async read(changeRecordId: string): Promise<GetFileReviewResponse> {
    try {
      const { record } = await this.changes.getRecord({ changeId: changeRecordId })
      if (!record?.previewPath) throw new Error('审核产物不存在')
      if (record.capability === 'text_file') {
        const value = textReviewSchema.parse(
          JSON.parse(await fs.readFile(record.previewPath, 'utf8'))
        )
        return {
          success: true,
          content: { kind: 'text', before: value.before, after: value.after }
        }
      }
      if (!['docx', 'ppt', 'excel'].includes(record.capability))
        throw new Error('该文件不支持内容审核')
      const index = officeReviewIndexSchema.parse(
        JSON.parse(
          await fs.readFile(path.join(path.dirname(record.previewPath), 'navigation.json'), 'utf8')
        )
      )
      if (index.afterChecksum !== record.afterChecksum)
        throw new Error('审核定位索引与本次修改不一致')
      if (new Set(index.regions.map((r) => r.id)).size !== index.regions.length)
        throw new Error('审核定位索引包含重复区域')
      await fs.access(record.previewPath)
      return { success: true, content: { kind: 'office', previewPath: record.previewPath, index } }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error && !('issues' in error) && !('code' in error)
            ? error.message
            : '审核产物缺失、损坏或格式已不支持，请重新生成修改记录'
      }
    }
  }
  async openLocation(request: OpenFileReviewLocationRequest): Promise<ReviewNavigationResult> {
    const token = Symbol()
    this.latestRequests.set(request.changeRecordId, token)
    try {
      const { record } = await this.changes.getRecord({ changeId: request.changeRecordId })
      if (!record) throw new Error('修改记录不存在')
      const review = await this.read(request.changeRecordId)
      if (!review.success) throw new Error(review.error)
      if (review.content.kind !== 'office') throw new Error('只有 Office 审核支持外部定位')
      const region = review.content.index.regions.find((r) => r.id === request.regionId)
      if (!region) throw new Error('修改区域不存在')
      const filePath = record.afterPath || record.path
      const listed = await this.applications.list(filePath)
      if (!listed.success) throw new Error(listed.error)
      const application = listed.applications.find((a) => a.id === listed.defaultApplicationId)
      if (!application || !isWpsApplication(application))
        throw new Error('请先将 WPS 设为此类型文件在馆长内的默认应用')
      // Resolve against the live WPS document, including unsaved edits. A whole-file
      // checksum cannot establish whether this particular cell or object moved.
      await fs.access(filePath)
      if (this.latestRequests.get(request.changeRecordId) !== token)
        return { status: 'opened', reason: '已切换到其他定位请求' }
      return await navigateOfficeReview(filePath, region.target, async () => {
        const opened = await this.applications.open(filePath, application.id)
        if (!opened.success) throw new Error(opened.error || '无法打开 WPS')
      })
    } catch (error) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
    } finally {
      if (this.latestRequests.get(request.changeRecordId) === token)
        this.latestRequests.delete(request.changeRecordId)
    }
  }
}
