import { useEffect, useRef, useState } from 'react'
import { App as AntdApp, Button, Empty, Input, Modal, Select, Spin, Switch } from 'antd'
import {
  HiOutlineArrowPath,
  HiOutlineFolderPlus,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlinePencilSquare
} from 'react-icons/hi2'
import type { PartnerListItem } from '../../../../shared/types'
import type {
  UserSkill,
  UserSkillDraft,
  UserSkillSelection,
  UserSkillImportPreview
} from '../../../../shared/userSkills'
import { t } from '../../i18n'
import { userSkillsSelectors as selectors } from '../../testing/selectors'
import { normalizeUserFacingError } from '../../utils/userFacingError'

const emptyDraft = (): UserSkillDraft => ({ name: '', description: '', body: '' })

const skillError = (error: unknown): string => {
  const text = String(error)
  if (text.includes('A skill with this name already exists'))
    return t(($) => $.userSkills.nameConflict)
  if (text.includes('Skill name must be')) return t(($) => $.userSkills.invalidName)
  if (text.includes('Skill description must be')) return t(($) => $.userSkills.invalidDescription)
  if (text.includes('Skill instructions cannot be empty')) return t(($) => $.userSkills.emptyBody)
  if (text.includes('SKILL.md must be at most 32 KiB')) return t(($) => $.userSkills.fileTooLarge)
  const affected = /Skill instructions exceed 64 KiB for: (.+)/.exec(text)
  if (affected) return t(($) => $.userSkills.affectedPartners, { names: affected[1] })
  if (text.includes('Skill instructions exceed 64 KiB')) return t(($) => $.userSkills.overBudget)
  if (text.includes('Skill import expired') || text.includes('Skill changed during import'))
    return t(($) => $.userSkills.importExpired)
  return normalizeUserFacingError(error)
}

export default function UserSkillsView({ partners }: { partners: PartnerListItem[] }) {
  const { message, modal } = AntdApp.useApp()
  const [skills, setSkills] = useState<UserSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [partnerId, setPartnerId] = useState<string>()
  const [binding, setBinding] = useState<(UserSkillSelection & { partnerId: string }) | null>(null)
  const [bindingFailed, setBindingFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const [draft, setDraft] = useState<UserSkillDraft>(emptyDraft)
  const originalDraft = useRef<UserSkillDraft>(emptyDraft())
  const [preview, setPreview] = useState<UserSkillImportPreview | null>(null)
  const importToken = useRef<string | null>(null)
  const mounted = useRef(true)
  const selectedPartnerId = partners.some((partner) => partner.id === partnerId)
    ? partnerId
    : undefined

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (importToken.current) void window.api.userSkillsCancelImport(importToken.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    window.api
      .userSkillsList()
      .then((items) => {
        if (!cancelled) setSkills(items)
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadFailed(true)
          void message.error(skillError(error))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [message, revision])

  useEffect(() => {
    let cancelled = false
    setBinding(null)
    setBindingFailed(false)
    if (selectedPartnerId)
      window.api
        .userSkillsGetEnabled(selectedPartnerId)
        .then((selection) => {
          if (!cancelled) setBinding({ ...selection, partnerId: selectedPartnerId })
        })
        .catch((error) => {
          if (!cancelled) {
            setBindingFailed(true)
            void message.error(skillError(error))
          }
        })
    return () => {
      cancelled = true
    }
  }, [selectedPartnerId, revision, message])

  const mutate = async (operation: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await operation()
    } catch (error) {
      void message.error(skillError(error))
      throw error
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const refresh = (): void => {
    if (mounted.current) setRevision((value) => value + 1)
  }
  const cancelImport = async (): Promise<void> => {
    if (busyRef.current || !importToken.current) return
    await mutate(async () => {
      await window.api.userSkillsCancelImport(importToken.current!)
      importToken.current = null
      setPreview(null)
    }).catch(() => undefined)
  }
  const importSkill = async (): Promise<void> => {
    await mutate(async () => {
      const pending = await window.api.userSkillsImport()
      if (!pending) return
      importToken.current = pending.token
      if (!mounted.current) {
        await window.api.userSkillsCancelImport(pending.token)
        importToken.current = null
        return
      }
      if (pending.conflict) {
        setPreview(pending)
        return
      }
      try {
        await window.api.userSkillsCommitImport({ token: pending.token, replaceExisting: false })
        refresh()
      } finally {
        await window.api.userSkillsCancelImport(pending.token)
        importToken.current = null
      }
    }).catch(() => undefined)
  }
  const replaceSkill = async (): Promise<void> => {
    if (!preview) return
    await mutate(async () => {
      await window.api.userSkillsCommitImport({ token: preview.token, replaceExisting: true })
      importToken.current = null
      setPreview(null)
      refresh()
    }).catch(() => undefined)
  }
  const openEditor = async (skill?: UserSkill): Promise<void> => {
    await mutate(async () => {
      const value = skill ? await window.api.userSkillsGet(skill.id) : emptyDraft()
      const next = { name: value.name, description: value.description, body: value.body }
      originalDraft.current = next
      setDraft(next)
      setEditingId(skill?.id)
      setEditorOpen(true)
    }).catch(() => undefined)
  }
  const closeEditor = (): void => {
    if (busyRef.current) return
    if (JSON.stringify(draft) !== JSON.stringify(originalDraft.current)) {
      modal.confirm({
        title: t(($) => $.userSkills.discardTitle),
        okText: t(($) => $.userSkills.discard),
        cancelText: t(($) => $.common.cancel),
        onOk: () => setEditorOpen(false)
      })
    } else setEditorOpen(false)
  }
  const save = async (): Promise<void> => {
    await mutate(async () => {
      if (editingId) await window.api.userSkillsUpdate({ id: editingId, ...draft })
      else await window.api.userSkillsCreate(draft)
      setEditorOpen(false)
      refresh()
    }).catch(() => undefined)
  }
  const remove = (skill: UserSkill): void => {
    modal.confirm({
      title: t(($) => $.userSkills.deleteTitle, { name: skill.name }),
      content: t(($) => $.userSkills.deleteDescription),
      okText: t(($) => $.userSkills.delete),
      okButtonProps: { danger: true },
      cancelText: t(($) => $.common.cancel),
      onOk: () =>
        mutate(async () => {
          await window.api.userSkillsDelete(skill.id)
          refresh()
        })
    })
  }
  const toggle = async (id: string, checked: boolean): Promise<void> => {
    if (!selectedPartnerId || binding?.partnerId !== selectedPartnerId) return
    const ids = checked
      ? [...new Set([...binding.skillIds, id])]
      : binding.skillIds.filter((item) => item !== id)
    await mutate(async () => {
      await window.api.userSkillsSetEnabled({ partnerId: selectedPartnerId, skillIds: ids })
      refresh()
    }).catch(() => undefined)
  }
  const blocked = busy || Boolean(preview)

  return (
    <div className="h-full overflow-y-auto bg-white" data-testid={selectors.view}>
      <div className="mx-auto max-w-[1080px] space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold text-[#37352F]">
              {t(($) => $.userSkills.title)}
            </h1>
            <p className="mt-2 text-[13px] leading-6 text-[#787774]">
              {t(($) => $.userSkills.description)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<HiOutlineArrowPath />}
              disabled={blocked || loading}
              onClick={refresh}
              aria-label={t(($) => $.userSkills.refresh)}
            />
            <Button
              icon={<HiOutlineFolderPlus />}
              disabled={blocked || loading || loadFailed}
              onClick={() => void importSkill()}
              data-testid={selectors.import}
            >
              {t(($) => $.userSkills.import)}
            </Button>
            <Button
              type="primary"
              icon={<HiOutlinePlus />}
              disabled={blocked || loading || loadFailed}
              onClick={() => void openEditor()}
              data-testid={selectors.create}
            >
              {t(($) => $.userSkills.create)}
            </Button>
          </div>
        </div>
        <p className="rounded-[10px] border border-[#EEEEEC] px-4 py-3 text-[13px] leading-6 text-[#787774]">
          {t(($) => $.userSkills.safety)}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="user-skills-partner" className="text-[14px] text-[#37352F]">
            {t(($) => $.userSkills.partner)}
          </label>
          <Select
            id="user-skills-partner"
            className="w-[200px] max-w-full"
            value={selectedPartnerId}
            disabled={blocked}
            placeholder={t(($) => $.userSkills.choosePartner)}
            options={partners.map((partner) => ({ value: partner.id, label: partner.name }))}
            onChange={setPartnerId}
            data-testid={selectors.partner}
          />
          {binding && binding.partnerId === selectedPartnerId && (
            <span className="text-[13px] text-[#787774]" data-testid={selectors.budget}>
              {t(($) => $.userSkills.budget, {
                used: (binding.bodyBytes / 1024).toFixed(1),
                limit: binding.maxBodyBytes / 1024
              })}
            </span>
          )}
          {partners.length === 0 && (
            <span className="text-[13px] text-[#787774]">{t(($) => $.common.noPartnersYet)}</span>
          )}
          {bindingFailed && (
            <span role="alert" className="text-[13px] text-[#B3261E]">
              {t(($) => $.userSkills.bindingFailed)}
            </span>
          )}
        </div>
        {Boolean(binding?.unavailableSkillNames.length) && (
          <p role="alert" className="text-[13px] text-[#B3261E]">
            {t(($) => $.userSkills.unavailable, {
              names: binding!.unavailableSkillNames.join('、')
            })}
          </p>
        )}
        {loading ? (
          <div className="py-12 text-center">
            <Spin />
          </div>
        ) : loadFailed ? (
          <div role="alert">{t(($) => $.userSkills.loadFailed)}</div>
        ) : skills.length === 0 ? (
          <Empty description={t(($) => $.userSkills.empty)} />
        ) : (
          <div className="divide-y divide-[#EEEEEC] rounded-[10px] border border-[#EEEEEC]">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="flex flex-wrap items-center gap-4 px-4 py-4"
                data-testid={`${selectors.itemPrefix}-${skill.id}`}
              >
                <div className="min-w-0 flex-1 basis-[200px]">
                  <div className="break-words text-[14px] font-medium text-[#37352F]">
                    {skill.name}
                  </div>
                  <div className="mt-1 break-words text-[13px] leading-5 text-[#787774]">
                    {skill.description}
                  </div>
                </div>
                <Switch
                  size="small"
                  checked={
                    binding?.partnerId === selectedPartnerId &&
                    Boolean(binding?.skillIds.includes(skill.id))
                  }
                  disabled={
                    blocked || !selectedPartnerId || binding?.partnerId !== selectedPartnerId
                  }
                  onChange={(checked) => void toggle(skill.id, checked)}
                  aria-label={t(($) => $.userSkills.enable, { name: skill.name })}
                  data-testid={`${selectors.togglePrefix}-${skill.id}`}
                />
                <Button
                  type="text"
                  disabled={blocked}
                  icon={<HiOutlinePencilSquare />}
                  onClick={() => void openEditor(skill)}
                  aria-label={t(($) => $.userSkills.editTitle, { name: skill.name })}
                  data-testid={`${selectors.editPrefix}-${skill.id}`}
                />
                <Button
                  type="text"
                  danger
                  disabled={blocked}
                  icon={<HiOutlineTrash />}
                  onClick={() => remove(skill)}
                  aria-label={t(($) => $.userSkills.deleteTitle, { name: skill.name })}
                  data-testid={`${selectors.deletePrefix}-${skill.id}`}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <Modal
        title={editingId ? t(($) => $.userSkills.edit) : t(($) => $.userSkills.create)}
        open={editorOpen}
        width={720}
        closable={!busy}
        keyboard={!busy}
        onCancel={closeEditor}
        onOk={() => void save()}
        confirmLoading={busy}
        okButtonProps={{
          disabled: !draft.name.trim() || !draft.description.trim() || !draft.body.trim()
        }}
        cancelButtonProps={{ disabled: busy }}
        okText={editingId ? t(($) => $.common.save) : t(($) => $.workbench.create)}
        cancelText={t(($) => $.common.cancel)}
        data-testid={selectors.editor}
      >
        <div className="max-h-[65vh] space-y-4 overflow-y-auto">
          <label className="block text-[13px] text-[#787774]">
            {t(($) => $.userSkills.name)}
            <Input
              className="mt-2"
              value={draft.name}
              onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
              placeholder="weekly-report"
              maxLength={64}
              disabled={busy}
              data-testid={selectors.name}
            />
          </label>
          <label className="block text-[13px] text-[#787774]">
            {t(($) => $.userSkills.whenToUse)}
            <Input.TextArea
              className="mt-2"
              value={draft.description}
              onChange={(event) =>
                setDraft((value) => ({ ...value, description: event.target.value }))
              }
              rows={2}
              maxLength={1024}
              disabled={busy}
              data-testid={selectors.description}
            />
          </label>
          <label className="block text-[13px] text-[#787774]">
            {t(($) => $.userSkills.body)}
            <Input.TextArea
              className="mt-2 font-mono"
              value={draft.body}
              onChange={(event) => setDraft((value) => ({ ...value, body: event.target.value }))}
              rows={12}
              disabled={busy}
              data-testid={selectors.content}
            />
          </label>
          <p className="text-[12px] leading-5 text-[#91918E]">
            {t(($) => $.userSkills.contentHelp)}
          </p>
        </div>
      </Modal>
      <Modal
        title={t(($) => $.userSkills.replaceTitle, { name: preview?.name ?? '' })}
        open={Boolean(preview)}
        onCancel={() => void cancelImport()}
        onOk={() => void replaceSkill()}
        okText={t(($) => $.userSkills.replace)}
        cancelText={t(($) => $.common.cancel)}
        confirmLoading={busy}
        closable={!busy}
        keyboard={!busy}
        cancelButtonProps={{ disabled: busy }}
        data-testid={selectors.replace}
      >
        <p className="text-[13px] leading-6">{t(($) => $.userSkills.replaceDescription)}</p>
      </Modal>
    </div>
  )
}
