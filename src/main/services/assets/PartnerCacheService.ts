import fs from 'node:fs/promises'
import path from 'node:path'
import type { PartnerStore } from '../storage/domains/PartnerStore'
import type { WorkbenchUiStore } from '../storage/domains/WorkbenchUiStore'
import type { AiFileChangeStore } from '../storage/domains/AiFileChangeStore'
import {
  consolidatePartnerSnapshots,
  getFileChangeDirectory
} from '../ai/fileChanges/FileChangeSnapshots'
import {
  getPartnerRootDir,
  getPartnerRuntimeDir,
  getPartnerObjectsDir
} from './WorkspaceAssetService'
import {
  PARTNER_CACHE_CATEGORIES,
  type PartnerCacheCategory,
  type PartnerCacheRequest,
  type PartnerCachePreview,
  type PartnerCacheCleanupResult,
  type PartnerCacheRow
} from '../../../shared/partnerCache'

type CacheFile = { path: string; bytes: number; updatedAt: number }
type CacheUnit = {
  category: PartnerCacheCategory
  files: CacheFile[]
  timestamp: number
  count: number
  recordId?: string
  protected: boolean
}

const missing = (error: NodeJS.ErrnoException): boolean => error.code === 'ENOENT'
const within = (root: string, file: string): boolean => {
  const relative = path.relative(root, path.resolve(file))
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

/** Never follow links while inspecting or removing application-owned cache files. */
const filesIn = async (directory: string): Promise<CacheFile[]> => {
  const stat = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (missing(error)) return undefined
    throw error
  })
  if (!stat) return []
  if (stat.isSymbolicLink()) throw new Error('缓存目录包含符号链接，无法清理')
  if (stat.isFile()) return [{ path: directory, bytes: stat.size, updatedAt: stat.mtimeMs }]
  if (!stat.isDirectory()) return []
  const files: CacheFile[] = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    files.push(...(await filesIn(path.join(directory, entry.name))))
  }
  return files
}

export class PartnerCacheService {
  private readonly cleaning = new Set<string>()

  public constructor(
    private readonly deps: {
      partners: PartnerStore
      ui: WorkbenchUiStore
      fileChanges: AiFileChangeStore
      isPartnerBusy: (partnerId: string) => boolean
      beforeCleanup?: (partnerId: string) => Promise<void>
    }
  ) {}

  public isCleaning(partnerId: string): boolean {
    return this.cleaning.has(partnerId)
  }

  public async withIdlePartner<T>(partnerId: string, action: () => Promise<T>): Promise<T> {
    if (this.cleaning.has(partnerId) || this.deps.isPartnerBusy(partnerId))
      throw new Error('当前伙伴仍在运行或清理数据，请稍后再试')
    this.cleaning.add(partnerId)
    try {
      await this.assertPartner(partnerId)
      return await action()
    } finally {
      this.cleaning.delete(partnerId)
    }
  }

  private async assertPartner(partnerId: string): Promise<void> {
    const root = getPartnerRootDir(partnerId)
    if (!(await this.deps.partners.getPartner(partnerId))) throw new Error('伙伴不存在')
    for (const directory of [path.dirname(root), root, getPartnerRuntimeDir(partnerId)]) {
      const stat = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
        if (missing(error)) return undefined
        throw error
      })
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
        throw new Error('伙伴缓存目录无效')
    }
  }

  private async assertManagedFile(partnerId: string, file: string): Promise<void> {
    const root = getPartnerRootDir(partnerId)
    if (!within(root, file)) throw new Error('缓存文件不在伙伴目录内')
    await this.assertPartner(partnerId)
    const parts = path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean)
    let directory = root
    for (const part of parts) {
      directory = path.join(directory, part)
      const stat = await fs.lstat(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('缓存文件所在目录已变化')
    }
  }

  public async directory(partnerId: string, category: PartnerCacheCategory): Promise<string> {
    if (!PARTNER_CACHE_CATEGORIES.includes(category)) throw new Error('缓存类型无效')
    await this.assertPartner(partnerId)
    const directory = path.join(getPartnerRuntimeDir(partnerId), category)
    const stat = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
      if (missing(error)) return undefined
      throw error
    })
    if (!stat) throw new Error('该目录暂无数据')
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('缓存目录无效')
    return directory
  }

  private validate(request: PartnerCacheRequest): string[] {
    if (!Array.isArray(request.partnerIds) || !request.partnerIds.length)
      throw new Error('请先选择伙伴')
    if (
      !Array.isArray(request.categories) ||
      !request.categories.length ||
      request.categories.some((category) => !PARTNER_CACHE_CATEGORIES.includes(category))
    )
      throw new Error('请选择有效的清理内容')
    if (
      !Number.isFinite(request.before) ||
      request.before <= 0 ||
      request.before > Date.now() + 86_400_000
    )
      throw new Error('清理日期无效')
    return [...new Set(request.partnerIds)]
  }

  private async collect(
    partnerId: string,
    categories: readonly PartnerCacheCategory[]
  ): Promise<CacheUnit[]> {
    await this.assertPartner(partnerId)
    const runtime = getPartnerRuntimeDir(partnerId)
    const state = await this.deps.ui.getPartnerState(partnerId)
    const protectedPaths = new Set(
      (state?.composer.draft.attachments || []).map((item) => path.resolve(item.path))
    )
    const records = (await this.deps.fileChanges.listRecords({ partnerId })).items
    const allHistoryFiles = await filesIn(path.join(runtime, 'file-changes'))
    const allObjects = await filesIn(getPartnerObjectsDir(partnerId))
    const historyFiles = [...allHistoryFiles, ...allObjects]
    const covered = new Set<string>()
    const units: CacheUnit[] = []
    for (const record of records) {
      const directory = getFileChangeDirectory(partnerId, record.runId, record.id)
      const references = [
        record.beforeSnapshotPath,
        record.afterSnapshotPath,
        record.previewPath
      ].filter((value): value is string => Boolean(value))
      const files = historyFiles.filter(
        (file) =>
          within(directory, file.path) ||
          references.includes(file.path) ||
          Boolean(
            record.previewPath &&
            within(path.dirname(record.previewPath), file.path) &&
            path.basename(path.dirname(record.previewPath)) !== record.runId
          )
      )
      files.forEach((file) => covered.add(file.path))
      // Kept historical snapshots can also reside in older asset layouts.
      references.forEach((reference) => protectedPaths.add(path.resolve(reference)))
      if (categories.includes('file-changes'))
        units.push({
          category: 'file-changes',
          files,
          timestamp: record.createdAt,
          count: 1,
          recordId: record.id,
          protected: false
        })
    }
    for (const category of categories) {
      if (category === 'file-changes') {
        for (const file of historyFiles)
          if (!covered.has(file.path))
            units.push({
              category,
              files: [file],
              timestamp: file.updatedAt,
              count: 1,
              protected: false
            })
        continue
      }
      const directory = path.join(runtime, category)
      const entries = await fs
        .readdir(directory, { withFileTypes: true })
        .catch((error: NodeJS.ErrnoException) => {
          if (missing(error)) return []
          throw error
        })
      // Validate the category root even when it has no children.
      await filesIn(directory)
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const target = path.join(directory, entry.name)
        const files = await filesIn(target)
        const bundles =
          category === 'scripts' || entry.name === 'read_image-cache'
            ? files.map((file) => [file])
            : [files]
        for (const bundle of bundles) {
          if (!bundle.length) continue
          units.push({
            category,
            files: bundle,
            timestamp: Math.max(...bundle.map((file) => file.updatedAt)),
            count: bundle.length,
            protected: bundle.some((file) =>
              [...protectedPaths].some(
                (reference) => file.path === reference || within(reference, file.path)
              )
            )
          })
        }
      }
    }
    return units
  }

  public async preview(request: PartnerCacheRequest): Promise<PartnerCachePreview> {
    try {
      const partnerIds = this.validate(request)
      const rows = new Map<string, PartnerCacheRow>()
      let skippedCount = 0
      for (const partnerId of partnerIds) {
        for (const unit of await this.collect(partnerId, request.categories)) {
          if (unit.timestamp >= request.before) continue
          if (unit.protected) {
            skippedCount += unit.count
            continue
          }
          const day = new Date(unit.timestamp)
          day.setHours(0, 0, 0, 0)
          const key = `${unit.category}:${day.getTime()}`
          const row = rows.get(key) || {
            category: unit.category,
            day: day.getTime(),
            count: 0,
            bytes: 0
          }
          row.count += unit.count
          row.bytes += unit.files.reduce((sum, file) => sum + file.bytes, 0)
          rows.set(key, row)
        }
      }
      return {
        success: true,
        rows: [...rows.values()].sort(
          (a, b) => a.day - b.day || a.category.localeCompare(b.category)
        ),
        skippedCount
      }
    } catch (error) {
      return {
        success: false,
        rows: [],
        skippedCount: 0,
        error: error instanceof Error ? error.message : '读取缓存失败'
      }
    }
  }

  private async remove(
    partnerId: string,
    categories: readonly PartnerCacheCategory[],
    before: number
  ): Promise<PartnerCacheCleanupResult> {
    await this.deps.beforeCleanup?.(partnerId)
    // Consolidate only retained checkpoints; records being removed do not need readable backups.
    if (categories.includes('file-changes'))
      await consolidatePartnerSnapshots(partnerId, this.deps.fileChanges, before)
    const units = await this.collect(partnerId, categories)
    const result: PartnerCacheCleanupResult = {
      success: true,
      deletedCount: 0,
      freedBytes: 0,
      skippedCount: 0
    }
    for (const unit of units) {
      if (unit.timestamp >= before) continue
      if (unit.protected) {
        result.skippedCount += unit.count
        continue
      }
      try {
        for (const file of unit.files) {
          await this.assertManagedFile(partnerId, file.path)
          // Recheck links and file age after the preview; external edits are not deleted as stale data.
          const stat = await fs.lstat(file.path).catch((error: NodeJS.ErrnoException) => {
            if (missing(error)) return undefined
            throw error
          })
          if (!stat) continue
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('缓存文件已变化，请重新检查')
          if (!unit.recordId && stat.mtimeMs >= before)
            throw new Error('缓存文件已更新，请重新检查')
          await fs.rm(file.path)
          result.freedBytes += stat.size
        }
        if (unit.recordId) await this.deps.fileChanges.removeRecords([unit.recordId])
        result.deletedCount += unit.count
      } catch (error) {
        result.success = false
        result.error = error instanceof Error ? error.message : '部分缓存清理失败'
        break
      }
    }
    return result
  }

  public async clearPartnerFiles(partnerId: string, deleteFileChanges: boolean): Promise<void> {
    const categories = PARTNER_CACHE_CATEGORIES.filter(
      (category) => category !== 'file-changes' || deleteFileChanges
    )
    const result = await this.remove(partnerId, categories, Infinity)
    if (!result.success) throw new Error(result.error || '清理缓存失败')
  }

  public async cleanup(request: PartnerCacheRequest): Promise<PartnerCacheCleanupResult> {
    const held: string[] = []
    const result: PartnerCacheCleanupResult = {
      success: true,
      deletedCount: 0,
      freedBytes: 0,
      skippedCount: 0
    }
    try {
      const partnerIds = this.validate(request)
      for (const partnerId of partnerIds) {
        if (this.cleaning.has(partnerId) || this.deps.isPartnerBusy(partnerId))
          throw new Error('所选伙伴仍在运行或清理数据，请稍后再试')
        this.cleaning.add(partnerId)
        held.push(partnerId)
      }
      for (const partnerId of partnerIds) await this.assertPartner(partnerId)
      for (const partnerId of partnerIds) {
        const partial = await this.remove(partnerId, request.categories, request.before)
        result.deletedCount += partial.deletedCount
        result.freedBytes += partial.freedBytes
        result.skippedCount += partial.skippedCount
        if (!partial.success) throw new Error(partial.error)
      }
    } catch (error) {
      result.success = false
      result.error = error instanceof Error ? error.message : '清理缓存失败'
    } finally {
      held.forEach((partnerId) => this.cleaning.delete(partnerId))
    }
    return result
  }
}
