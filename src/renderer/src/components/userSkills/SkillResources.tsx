import { useState } from 'react'
import { App, Button, Modal } from 'antd'
import {
  HiOutlineChevronDown,
  HiOutlineChevronRight,
  HiOutlineCodeBracket,
  HiOutlineDocumentText,
  HiOutlineFolderOpen,
  HiOutlinePaperClip,
  HiOutlinePhoto
} from 'react-icons/hi2'
import type { UserSkillSource, UserSkillResourcePreview } from '../../../../shared/userSkills'
import { t } from '../../i18n'
import { userSkillsSelectors as selectors } from '../../testing/selectors'
import { skillError } from './skillErrors'

export default function SkillResources({
  resources,
  source,
  disabled
}: {
  resources: string[]
  source: UserSkillSource | null
  disabled: boolean
}) {
  const { message } = App.useApp()
  const [expanded, setExpanded] = useState(false)
  const [preview, setPreview] = useState<{
    path: string
    content: UserSkillResourcePreview
  } | null>(null)
  const [loading, setLoading] = useState(false)
  if (!resources.length || !source) return null
  const openFolder = async (): Promise<void> => {
    try {
      const error = await window.api.userSkillsOpenFolder(source)
      if (error) throw new Error(error)
    } catch (error) {
      void message.error(skillError(error))
    }
  }
  const inspect = async (path: string): Promise<void> => {
    setLoading(true)
    try {
      setPreview({ path, content: await window.api.userSkillsPreviewResource(source, path) })
    } catch (error) {
      void message.error(skillError(error))
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="mb-4" data-testid={selectors.resources}>
      <div className="flex items-center justify-between gap-3">
        <Button
          type="text"
          size="small"
          className="min-w-0 !px-0 !text-[12px] !text-[#787774]"
          icon={<HiOutlinePaperClip />}
          disabled={disabled}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {t(($) => $.userSkills.resources, { count: resources.length })}
          <HiOutlineChevronDown
            className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </Button>
        <Button
          type="text"
          size="small"
          icon={<HiOutlineFolderOpen />}
          onClick={() => void openFolder()}
          disabled={disabled}
          className="shrink-0 !text-[12px] !text-[#787774]"
        >
          {t(($) => $.userSkills.openFolder)}
        </Button>
      </div>
      {expanded && (
        <div className="mt-1 pl-5">
          {resources.map((path) => {
            const parts = path.split('/')
            const name = parts.pop()!
            const Icon = /\.(png|jpe?g|gif|webp)$/i.test(name)
              ? HiOutlinePhoto
              : /\.(py|sh|js|ts|bat|ps1)$/i.test(name)
                ? HiOutlineCodeBracket
                : HiOutlineDocumentText
            return (
              <button
                key={path}
                type="button"
                disabled={disabled || loading}
                onClick={() => void inspect(path)}
                className="flex w-full items-center gap-2.5 rounded-[6px] px-1.5 py-2 text-left hover:bg-[#F4F4F2]"
              >
                <Icon className="h-4 w-4 shrink-0 text-[#787774]" />
                <span className="min-w-0 flex-1 break-words text-[13px] text-[#37352F]">
                  <span className="line-clamp-2 [overflow-wrap:anywhere]" title={name}>
                    {name}
                  </span>
                  <span
                    className="line-clamp-2 text-[12px] text-[#787774] [overflow-wrap:anywhere]"
                    title={parts.length ? parts.join('/') + '/' : './'}
                  >
                    {parts.length ? parts.join('/') + '/' : './'}
                  </span>
                </span>
                <HiOutlineChevronRight className="h-3 w-3 shrink-0 text-[#91918E]" />
              </button>
            )
          })}
        </div>
      )}
      <Modal
        open={Boolean(preview)}
        title={preview?.path}
        onCancel={() => setPreview(null)}
        footer={<Button onClick={() => setPreview(null)}>{t(($) => $.common.close)}</Button>}
        destroyOnClose
        data-testid={selectors.resourcePreview}
      >
        {preview?.content && 'text' in preview.content ? (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words text-[13px] leading-6">
            {preview.content.text}
          </pre>
        ) : preview?.content && 'image' in preview.content ? (
          <img
            src={preview.content.image}
            alt={preview.path}
            className="max-h-[60vh] max-w-full object-contain"
          />
        ) : (
          <div className="py-5 text-[13px] text-[#787774]">
            {t(($) => $.userSkills.previewUnavailable)}
            <Button type="link" onClick={() => void openFolder()}>
              {t(($) => $.userSkills.openFolder)}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
