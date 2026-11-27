import { skillError } from './skillErrors'
import { useEffect, useState } from 'react'
import { App, Button, Input, Tooltip } from 'antd'
import {
  HiOutlineBookOpen,
  HiOutlineArrowDownTray,
  HiOutlineFolder,
  HiOutlineTrash,
  HiOutlinePencilSquare,
  HiOutlineCloudArrowDown,
  HiCheckCircle,
  HiCheckBadge,
  HiChevronDown
} from 'react-icons/hi2'
import type { UserSkillOption } from '../../../../shared/userSkills'
import type { OfficialSkill } from '../../../../shared/officialSkills'

type Props = {
  skills: UserSkillOption[]
  revision: number
  busy: boolean
  onEdit: (skill: UserSkillOption) => void
  onRemove: (skill: UserSkillOption) => void
  onChanged: () => void
}
export default function SkillCatalogList({
  skills,
  revision,
  busy,
  onEdit,
  onRemove,
  onChanged
}: Props) {
  const { message, modal } = App.useApp()
  const [catalog, setCatalog] = useState<OfficialSkill[]>([])
  const [offline, setOffline] = useState(false)
  const [search, setSearch] = useState('')
  const [folded, setFolded] = useState({ official: false, thirdParty: false })
  const [downloading, setDownloading] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void window.api
      .officialSkillsList()
      .then((result) => {
        if (active) {
          setCatalog(result.items)
          setOffline(!!result.offline)
        }
      })
      .catch(() => {
        if (active) setOffline(true)
      })
    return () => {
      active = false
    }
  }, [revision])
  const matches = (name: string, description: string) =>
    `${name} ${description}`.toLowerCase().includes(search.trim().toLowerCase())
  const download = async (skill: OfficialSkill) => {
    setDownloading(skill.id)
    let token: string | undefined
    try {
      const prepared = await window.api.officialSkillsPrepare(skill.id)
      token = prepared.token
      if (prepared.replacing) {
        const accepted = await new Promise<boolean>((resolve) =>
          modal.confirm({
            title: `覆盖「${skill.displayName}」？`,
            content: prepared.locallyModified
              ? '本地 Skill 已修改。下载会覆盖本地内容，建议先让 AI 复制成自己的 Skill，再更新官方版本。'
              : '此操作将替换本地 Skill 内容，伙伴绑定会保留。',
            okText: '覆盖并下载',
            cancelText: '取消',
            onOk: () => resolve(true),
            onCancel: () => resolve(false)
          })
        )
        if (!accepted) return
      }
      await window.api.officialSkillsCommit(token)
      token = undefined
      onChanged()
      void message.success('Skill 已下载')
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error))
    } finally {
      if (token) await window.api.officialSkillsCancel(token).catch(() => {})
      setDownloading(null)
    }
  }
  const officialRows = catalog.filter((skill) =>
    matches(skill.displayName + ' ' + skill.name, skill.description)
  )
  const orphaned = skills.filter(
    (skill) =>
      skill.officialId &&
      !catalog.some((item) => item.id === skill.officialId) &&
      matches(skill.displayName || skill.name, skill.description)
  )
  const thirdParty = skills.filter(
    (skill) => !skill.officialId && matches(skill.name, skill.description)
  )
  const folder = (skill: UserSkillOption) =>
    void window.api.userSkillsOpenFolder({ name: skill.name })
  const label = (kind: 'official' | 'thirdParty', text: string, count: number) => (
    <button
      type="button"
      className="my-4 flex cursor-pointer items-center gap-2 text-[14px] text-[var(--notion-text-soft)]"
      aria-expanded={!folded[kind]}
      onClick={() => setFolded((value) => ({ ...value, [kind]: !value[kind] }))}
    >
      <HiChevronDown className={`h-4 w-4 ${folded[kind] ? '-rotate-90' : ''}`} />
      {text}
      <span className="text-[12px] text-[var(--notion-text-faint)]">{count}</span>
    </button>
  )
  const actions = (local: UserSkillOption) => (
    <>
      <Tooltip title="打开文件夹">
        <Button
          type="text"
          disabled={busy || !!downloading}
          icon={<HiOutlineFolder />}
          aria-label={`打开 ${local.displayName || local.name} 文件夹`}
          onClick={() => folder(local)}
        />
      </Tooltip>
      <Tooltip title="删除本地 Skill">
        <Button
          type="text"
          disabled={busy || !!downloading}
          icon={<HiOutlineTrash />}
          data-testid={`user-skill-delete-${local.name}`}
          aria-label={`删除 ${local.displayName || local.name}`}
          onClick={() => onRemove(local)}
        />
      </Tooltip>
    </>
  )
  return (
    <div data-testid="skill-catalog-list">
      <Input
        allowClear
        placeholder="搜索 Skill"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="mb-2"
      />
      {offline ? (
        <p className="mt-2 text-[12px] text-[var(--notion-text-soft)]">
          官方目录暂时不可用，已下载的 Skill 可继续使用。
        </p>
      ) : null}
      {label('official', '官方', officialRows.length + orphaned.length)}
      {!folded.official ? (
        <div className="divide-y divide-[var(--notion-line)]">
          {officialRows.map((skill) => {
            const local = skills.find((item) => item.officialId === skill.id),
              update = !!local && local.version !== skill.version
            const action = local
              ? update
                ? `更新到 v${skill.version}`
                : `重新下载 v${skill.version}`
              : `下载 v${skill.version}`
            return (
              <div
                key={skill.id}
                className="flex items-center gap-3 py-4"
                data-testid={`official-skill-${skill.id}`}
              >
                <Tooltip title={local ? '已下载' : '未下载'}>
                  <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-[var(--notion-blue-bg)] text-[var(--notion-blue)]">
                    {skill.iconUrl ? (
                      <img src={skill.iconUrl} alt="" className="h-7 w-7 object-contain" />
                    ) : (
                      <HiOutlineBookOpen className="h-6 w-6" />
                    )}
                    <span className="absolute -bottom-1 -right-1 rounded-full bg-[var(--notion-page)] p-0.5">
                      {local ? (
                        <HiCheckCircle className="h-4 w-4" />
                      ) : (
                        <HiOutlineCloudArrowDown className="h-4 w-4" />
                      )}
                    </span>
                  </div>
                </Tooltip>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px] font-medium">
                    <span className="line-clamp-2 break-words">{skill.displayName}</span>
                    <Tooltip title="官方 Skill">
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-normal text-[var(--notion-blue)]">
                        <HiCheckBadge className="h-4 w-4" />
                        官方
                      </span>
                    </Tooltip>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[13px] text-[var(--notion-text-soft)]">
                    {skill.description}
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--notion-text-faint)]">
                    {local ? `v${local.version || skill.version}` : `v${skill.version}`}
                    {update ? (
                      <span className="ml-3 text-[var(--notion-blue)]">
                        新版本 v{skill.version}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Tooltip title={action}>
                  <Button
                    type="text"
                    icon={<HiOutlineArrowDownTray />}
                    loading={downloading === skill.id}
                    disabled={busy || !!downloading}
                    aria-label={action}
                    onClick={() => void download(skill)}
                  />
                </Tooltip>
                {local ? actions(local) : null}
              </div>
            )
          })}
          {orphaned.map((skill) => (
            <div key={skill.id} className="flex items-center gap-3 py-4">
              <HiCheckBadge className="h-6 w-6 shrink-0 text-[var(--notion-blue)]" />
              <div className="min-w-0 flex-1">
                <div>{skill.displayName || skill.name}</div>
                <p className="text-xs text-[var(--notion-text-soft)]">{skill.description}</p>
              </div>
              {actions(skill)}
            </div>
          ))}
        </div>
      ) : null}
      {label('thirdParty', '第三方', thirdParty.length)}
      {!folded.thirdParty ? (
        <div className="divide-y divide-[var(--notion-line)]">
          {thirdParty.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center gap-3 py-3"
              data-testid={`user-skill-${skill.name}`}
            >
              <HiOutlineBookOpen className="h-6 w-6 shrink-0 text-[var(--notion-text-soft)]" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[14px] font-medium">{skill.name}</div>
                <div className="mt-1 line-clamp-2 text-[13px] text-[var(--notion-text-soft)]">
                  {skill.error ? skillError(skill.error) : skill.description}
                </div>
              </div>
              <Tooltip title="编辑 Skill">
                <Button
                  type="text"
                  disabled={busy}
                  icon={<HiOutlinePencilSquare />}
                  aria-label={`编辑 ${skill.name}`}
                  data-testid={`user-skill-edit-${skill.name}`}
                  onClick={() => onEdit(skill)}
                />
              </Tooltip>
              {actions(skill)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
