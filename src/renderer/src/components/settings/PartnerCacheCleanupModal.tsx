import { useEffect, useMemo, useState } from 'react'
import { App, Checkbox, DatePicker, Modal, Select, Spin, Tooltip } from 'antd'
import { HiFolderOpen } from 'react-icons/hi2'
import dayjs from 'dayjs'
import {
  PARTNER_CACHE_CATEGORIES,
  type PartnerCacheCategory,
  type PartnerCachePreview
} from '../../../../shared/partnerCache'
import type { PartnerListItem } from '../../../../shared/types'
import { settingsSelectors } from '../../testing/selectors'

const descriptions: Record<PartnerCacheCategory, { title: string; description: string }> = {
  scripts: { title: '临时脚本', description: 'AI 执行任务时编写的临时脚本' },
  toolresult: { title: '工具结果', description: '工具输出过长时保存的完整文本' },
  assets: { title: '附件与临时资源', description: '粘贴附件、读图缓存、文档渲染图片及网页截图' },
  'file-changes': { title: '文件修改历史', description: '修改前备份与差异预览；清理后无法回退' }
}

const sizeText = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export default function PartnerCacheCleanupModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const { modal, message } = App.useApp()
  const [partners, setPartners] = useState<PartnerListItem[]>([])
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null)
  const [categories, setCategories] = useState<PartnerCacheCategory[]>([
    ...PARTNER_CACHE_CATEGORIES
  ])
  const [date, setDate] = useState(() => dayjs().subtract(30, 'day').startOf('day'))
  const [preview, setPreview] = useState<PartnerCachePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPreview(null)
    void Promise.all([window.api.partnerList(), window.api.workbenchUiStateGet()])
      .then(([items, ui]) => {
        if (cancelled) return
        setPartners(items)
        setSelectedPartner((previous) =>
          previous === 'all' || items.some((item) => item.id === previous)
            ? previous
            : items.find((item) => item.id === ui.state.activeViewKey)?.id || items[0]?.id || null
        )
      })
      .catch((error) => {
        if (!cancelled) void message.error(error instanceof Error ? error.message : '读取伙伴失败')
      })
    return () => {
      cancelled = true
    }
  }, [open, message])

  const partnerIds = useMemo(
    () =>
      selectedPartner === 'all'
        ? partners.map((item) => item.id)
        : selectedPartner
          ? [selectedPartner]
          : [],
    [selectedPartner, partners]
  )
  const before = date.startOf('day').valueOf()
  useEffect(() => {
    if (!open || !partnerIds.length) {
      setPreview(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setPreview(null)
    void window.api
      .partnerCachePreview({ partnerIds, categories: [...PARTNER_CACHE_CATEGORIES], before })
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch((error) => {
        if (!cancelled)
          setPreview({
            success: false,
            rows: [],
            skippedCount: 0,
            error: error instanceof Error ? error.message : '读取缓存失败'
          })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, partnerIds, before, revision])

  const rows = (preview?.rows || []).filter((row) => categories.includes(row.category))
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0)
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0)
  const busy = partners.some((item) => partnerIds.includes(item.id) && item.isRunning)
  const canClean = totalCount > 0 && !busy && !loading && !cleaning && preview?.success

  const openDirectory = async (category: PartnerCacheCategory): Promise<void> => {
    if (!selectedPartner || selectedPartner === 'all') return
    try {
      const result = await window.api.partnerCacheOpenDirectory({
        partnerId: selectedPartner,
        category
      })
      if (!result.success) void message.error(result.error || '打开目录失败')
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '打开目录失败')
    }
  }

  const confirmCleanup = (): void => {
    if (!canClean) return
    const name =
      selectedPartner === 'all'
        ? '全部伙伴'
        : partners.find((item) => item.id === selectedPartner)?.name || '伙伴'
    modal.confirm({
      title: '清理这些缓存数据？',
      content: (
        <div>
          <p>
            将永久删除「{name}」所选目录中 {date.format('YYYY-MM-DD')} 以前的数据，预计释放{' '}
            {sizeText(totalBytes)}。此操作无法恢复。
          </p>
        </div>
      ),
      okText: '清理',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setCleaning(true)
        try {
          const result = await window.api.partnerCacheCleanup({ partnerIds, categories, before })
          if (!result.success)
            throw new Error(
              (result.error || '清理失败') +
                (result.freedBytes ? `，已释放 ${sizeText(result.freedBytes)}` : '')
            )
          void message.success(
            `已清理 ${result.deletedCount} 项，释放 ${sizeText(result.freedBytes)}`
          )
        } catch (error) {
          void message.error(error instanceof Error ? error.message : '清理失败')
          throw error
        } finally {
          setCleaning(false)
          setRevision((value) => value + 1)
          void window.api.partnerList().then(setPartners)
        }
      }
    })
  }

  return (
    <Modal
      open={open}
      title="清理伙伴的缓存数据"
      width={680}
      centered
      styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' } }}
      modalRender={(node) => <div data-testid={settingsSelectors.cacheCleanupModal}>{node}</div>}
      onCancel={() => {
        if (!cleaning) onClose()
      }}
      maskClosable={false}
      closable={!cleaning}
      keyboard={!cleaning}
      footer={
        <div className="flex items-center justify-between gap-4 border-t border-[#EEEEEC] pt-4 text-left text-[14px] text-[#37352F]">
          <div>
            预计释放 <span className="tabular-nums">{sizeText(totalBytes)}</span>
            <div className="mt-0.5 text-[12px] text-[#787774]">
              {date.format('YYYY-MM-DD')} 00:00 以前 · {totalCount} 项
            </div>
          </div>
          <button
            type="button"
            disabled={!canClean}
            onClick={confirmCleanup}
            data-testid={settingsSelectors.cacheCleanupConfirm}
            className="rounded bg-[#F8EBE9] px-4 py-2 text-[13px] text-[#B3261E] hover:bg-[#F3DDD9] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {cleaning ? '正在清理…' : '清理所选数据'}
          </button>
        </div>
      }
      destroyOnClose
    >
      <div className="pt-2 text-[14px] text-[#37352F]">
        <label className="mb-2 block font-medium">伙伴</label>
        <Select
          value={selectedPartner}
          onChange={setSelectedPartner}
          className="w-full"
          disabled={cleaning}
          placeholder="选择伙伴"
          data-testid={settingsSelectors.cachePartnerSelect}
          options={[
            ...partners.map((item) => ({
              value: item.id,
              label: item.name + (item.isRunning ? '（运行中）' : '')
            })),
            ...(partners.length > 1 ? [{ value: 'all', label: '全部伙伴' }] : [])
          ]}
        />
        <div className="mb-1 mt-5 font-medium">清理内容</div>
        {PARTNER_CACHE_CATEGORIES.map((category) => {
          const info = descriptions[category]
          const bytes = (preview?.rows || [])
            .filter((row) => row.category === category)
            .reduce((sum, row) => sum + row.bytes, 0)
          return (
            <div key={category} className="flex items-center gap-3 border-b border-[#EEEEEC] py-3">
              <Checkbox
                className="min-w-0 flex-1"
                checked={categories.includes(category)}
                disabled={cleaning}
                data-testid={`${settingsSelectors.cacheCategoryPrefix}-${category}`}
                onChange={(event) =>
                  setCategories((previous) =>
                    event.target.checked
                      ? [...previous, category]
                      : previous.filter((value) => value !== category)
                  )
                }
              >
                <div className="font-medium">
                  {info.title}
                  <span className="ml-2 font-mono text-[12px] font-normal text-[#787774]">
                    {category}
                  </span>
                </div>
                <div className="mt-0.5 text-[12px] font-normal leading-5 text-[#787774]">
                  {info.description}
                </div>
              </Checkbox>
              <span className="shrink-0 text-[12px] tabular-nums text-[#787774]">
                {sizeText(bytes)}
              </span>
              <Tooltip
                title={
                  selectedPartner === 'all'
                    ? '先选择一个伙伴，再打开目录'
                    : `打开${info.title}文件夹`
                }
              >
                <button
                  type="button"
                  aria-label={`打开${info.title}文件夹`}
                  disabled={!selectedPartner || selectedPartner === 'all' || cleaning}
                  data-testid={`${settingsSelectors.cacheOpenPrefix}-${category}`}
                  onClick={() => void openDirectory(category)}
                  className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-[#787774] hover:bg-[#F4F4F2] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <HiFolderOpen className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
          )
        })}
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="mb-2 block font-medium">清理此日期以前的数据</label>
            <DatePicker
              value={date}
              allowClear={false}
              onChange={(value) => {
                if (value) setDate(value)
              }}
              disabled={cleaning}
              disabledDate={(value) => value.isAfter(dayjs().add(1, 'day').startOf('day'), 'day')}
              className="w-full"
              data-testid={settingsSelectors.cacheCutoffDate}
            />
          </div>
          {[30, 90].map((days) => (
            <button
              key={days}
              type="button"
              disabled={cleaning}
              onClick={() => setDate(dayjs().subtract(days, 'day').startOf('day'))}
              className="h-8 rounded border border-[#E6E6E3] px-3 text-[12px] hover:bg-[#F4F4F2] disabled:opacity-40"
            >
              {days} 天前
            </button>
          ))}
        </div>
        <div className="mb-2 mt-6 flex justify-between">
          <span className="font-medium">待清理数据</span>
          <span className="text-[12px] text-[#787774]">按时间，从旧到新</span>
        </div>
        <Spin spinning={loading}>
          <table className="w-full text-[12px]" data-testid={settingsSelectors.cachePreviewTable}>
            <thead className="bg-[#F4F4F2] text-[#787774]">
              <tr>
                <th className="px-2 py-2 text-left font-normal">日期</th>
                <th className="px-2 py-2 text-left font-normal">内容</th>
                <th className="px-2 py-2 text-right font-normal">数量</th>
                <th className="px-2 py-2 text-right font-normal">占用</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.day}-${row.category}`} className="border-b border-[#EEEEEC]">
                  <td className="px-2 py-2">{dayjs(row.day).format('YYYY-MM-DD')}</td>
                  <td className="px-2 py-2">{descriptions[row.category].title}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.count} 项</td>
                  <td className="px-2 py-2 text-right tabular-nums">{sizeText(row.bytes)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-[#787774]">
                    {!partners.length ? '暂无伙伴' : preview?.error || '当前条件下没有待清理数据'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Spin>
        <p className="mt-3 text-[12px] leading-5 text-[#787774]">
          清理所选目录中截止日期前的数据。伙伴、聊天记录和工作目录文件等不会被删除。
        </p>
        {busy && (
          <p className="mt-2 text-[12px] text-[#B3261E]">所选伙伴正在运行，请结束后再清理。</p>
        )}
        {!!preview?.skippedCount && (
          <p className="mt-2 text-[12px] text-[#787774]">
            已跳过 {preview.skippedCount} 项正在使用的数据。
          </p>
        )}
      </div>
    </Modal>
  )
}
