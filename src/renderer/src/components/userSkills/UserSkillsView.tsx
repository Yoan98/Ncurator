import { useEffect, useRef, useState } from 'react'
import { App, Button, Empty, Input, Modal, Spin } from 'antd'
import {
  HiOutlineBookOpen,
  HiOutlineFolderPlus,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlinePencilSquare
} from 'react-icons/hi2'
import type {
  UserSkill,
  UserSkillDraft,
  UserSkillImportPreview
} from '../../../../shared/userSkills'
import { t } from '../../i18n'
import { userSkillsSelectors as selectors } from '../../testing/selectors'
import ConfigurationDrawer from '../workbench/ConfigurationDrawer'
import ConfigurationFieldLabel from '../workbench/ConfigurationFieldLabel'
import ViewToolbar from '../workbench/ViewToolbar'
import { skillError } from './skillErrors'
import SkillResources from './SkillResources'

import MarkdownInput from '../fileRenders/MarkdownInput'
const emptyDraft = (): UserSkillDraft => ({ name: '', description: '', body: '' })

export default function UserSkillsView() {
  const { message, modal } = App.useApp()
  const [skills, setSkills] = useState<UserSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const [draft, setDraft] = useState<UserSkillDraft>(emptyDraft)
  const original = useRef<UserSkillDraft>(emptyDraft())
  const [preview, setPreview] = useState<UserSkillImportPreview | null>(null)
  const token = useRef<string | null>(null)
  const [replacing, setReplacing] = useState<UserSkill | null>(null)
  const [resources, setResources] = useState<string[]>([])
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (token.current) void window.api.userSkillsCancelImport(token.current)
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    void window.api
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
  const mutate = async (operation: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await operation()
    } catch (error) {
      void message.error(skillError(error))
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const cancelPending = async (): Promise<void> => {
    if (token.current) await window.api.userSkillsCancelImport(token.current)
    token.current = null
    setPreview(null)
    setReplacing(null)
  }
  const close = (): void => {
    void mutate(async () => {
      await cancelPending()
      setOpen(false)
    })
  }
  const edit = (skill?: UserSkill): void => {
    void mutate(async () => {
      const value = skill
        ? await window.api.userSkillsGet(skill.id)
        : { ...emptyDraft(), resources: [] }
      const next = { name: value.name, description: value.description, body: value.body }
      original.current = next
      setDraft(next)
      setEditingId(skill?.id)
      setResources(value.resources)
      setOpen(true)
    })
  }
  const selectFolder = (): void => {
    void mutate(async () => {
      const pending = await window.api.userSkillsImport()
      if (!pending) return
      if (!mounted.current) {
        await window.api.userSkillsCancelImport(pending.token)
        return
      }
      await cancelPending()
      token.current = pending.token
      setPreview(pending)
      setDraft({ name: pending.name, description: pending.description, body: pending.body })
      setResources(pending.resources)
    })
  }
  const dirty = Boolean(preview) || JSON.stringify(draft) !== JSON.stringify(original.current)
  const importFolder = (): void => {
    if (!dirty) {
      selectFolder()
      return
    }
    modal.confirm({
      title: t(($) => $.userSkills.importDraftTitle),
      content: t(($) => $.userSkills.importDraftDescription),
      okText: t(($) => $.userSkills.importConfirm),
      cancelText: t(($) => $.common.cancel),
      onOk: selectFolder
    })
  }
  const publish = async (replaceId: string | null): Promise<void> => {
    if (preview)
      await window.api.userSkillsCommitImport({ token: preview.token, replaceId, ...draft })
    else if (editingId) await window.api.userSkillsUpdate({ id: editingId, ...draft })
    else await window.api.userSkillsCreate(draft)
    await cancelPending()
    setOpen(false)
    setRevision((value) => value + 1)
  }
  const save = (): void => {
    void mutate(async () => {
      if (preview && !editingId) {
        const conflict = (await window.api.userSkillsList()).find(
          (skill) => skill.name === draft.name.trim()
        )
        if (conflict) {
          setReplacing(conflict)
          return
        }
      }
      await publish(editingId ?? null)
    })
  }
  const remove = (skill: UserSkill): void => {
    modal.confirm({
      title: t(($) => $.userSkills.deleteTitle, { name: skill.name }),
      content: t(($) => $.userSkills.deleteDescription),
      okText: t(($) => $.userSkills.delete),
      okButtonProps: { danger: true },
      cancelText: t(($) => $.common.cancel),
      onOk: async () => {
        try {
          await window.api.userSkillsDelete(skill.id)
          setRevision((value) => value + 1)
        } catch (error) {
          void message.error(skillError(error))
          throw error
        }
      }
    })
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-white" data-testid={selectors.view}>
      <ViewToolbar
        title={t(($) => $.userSkills.title)}
        icon={<HiOutlineBookOpen className="h-4 w-4 text-[#787774]" />}
        testId={selectors.topbar}
      >
        <Button
          type="primary"
          icon={<HiOutlinePlus />}
          onClick={() => edit()}
          disabled={busy || loading || loadFailed}
          data-testid={selectors.create}
        >
          {t(($) => $.userSkills.create)}
        </Button>
      </ViewToolbar>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="py-12 text-center">
            <Spin />
          </div>
        ) : loadFailed ? (
          <Button onClick={() => setRevision((value) => value + 1)}>
            {t(($) => $.userSkills.refresh)}
          </Button>
        ) : skills.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(($) => $.userSkills.empty)}
            />
          </div>
        ) : (
          <div className="divide-y divide-[#EEEEEC]">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center gap-3 py-3"
                data-testid={`${selectors.itemPrefix}-${skill.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="break-words text-[14px] font-medium text-[#37352F]">
                    {skill.name}
                  </div>
                  <div className="mt-1 break-words text-[13px] text-[#787774]">
                    {skill.description}
                  </div>
                </div>
                <Button
                  type="text"
                  disabled={busy}
                  icon={<HiOutlinePencilSquare />}
                  onClick={() => edit(skill)}
                  aria-label={t(($) => $.userSkills.editTitle, { name: skill.name })}
                  data-testid={`${selectors.editPrefix}-${skill.id}`}
                />
                <Button
                  type="text"
                  danger
                  disabled={busy}
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
      <ConfigurationDrawer
        open={open}
        title={editingId ? t(($) => $.userSkills.edit) : t(($) => $.userSkills.create)}
        width={720}
        busy={busy}
        dirty={dirty}
        extra={
          <Button
            type="text"
            size="small"
            icon={<HiOutlineFolderPlus />}
            onClick={importFolder}
            disabled={busy}
            data-testid={selectors.import}
          >
            {t(($) => $.userSkills.importConfirm)}
          </Button>
        }
        onClose={close}
        onSave={save}
        disabled={!draft.name.trim() || !draft.description.trim() || !draft.body.trim()}
        saveText={editingId ? t(($) => $.common.save) : t(($) => $.workbench.create)}
        testId={selectors.editor}
        saveTestId={selectors.save}
        cancelTestId={selectors.cancel}
      >
        <div>
          <div className="mb-4 space-y-4">
            <label className="flex flex-col gap-1.5">
              <ConfigurationFieldLabel required>
                {t(($) => $.userSkills.name)}
              </ConfigurationFieldLabel>
              <Input
                className="nc-document-title"
                aria-label={t(($) => $.userSkills.name)}
                value={draft.name}
                onChange={(event) => {
                  setDraft((draft) => ({ ...draft, name: event.target.value }))
                }}
                placeholder={t(($) => $.userSkills.namePlaceholder)}
                maxLength={64}
                disabled={busy}
                data-testid={selectors.name}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <ConfigurationFieldLabel required>
                {t(($) => $.userSkills.descriptionLabel)}
              </ConfigurationFieldLabel>
              <Input.TextArea
                className="nc-document-description"
                aria-label={t(($) => $.userSkills.descriptionLabel)}
                placeholder={t(($) => $.userSkills.descriptionPlaceholder)}
                value={draft.description}
                onChange={(event) => {
                  setDraft((draft) => ({ ...draft, description: event.target.value }))
                }}
                autoSize={{ minRows: 2, maxRows: 5 }}
                maxLength={1024}
                disabled={busy}
                data-testid={selectors.description}
              />
            </label>
          </div>
          <SkillResources
            key={preview?.token ?? editingId ?? 'new'}
            resources={resources}
            source={preview ? { token: preview.token } : editingId ? { id: editingId } : null}
            disabled={busy}
          />
          <div>
            <div className="mb-1.5">
              <ConfigurationFieldLabel required>
                {t(($) => $.userSkills.body)}
              </ConfigurationFieldLabel>
            </div>
            <div className="nc-skill-authoring h-[min(52vh,480px)] min-h-[280px]">
              <MarkdownInput
                value={draft.body}
                onChange={(body) => {
                  setDraft((draft) => ({ ...draft, body }))
                }}
                readOnly={busy}
                authoring
                placeholder={t(($) => $.userSkills.contentPlaceholder)}
                testId={selectors.content}
              />
            </div>
          </div>
        </div>
      </ConfigurationDrawer>
      <Modal
        title={t(($) => $.userSkills.replaceTitle, { name: replacing?.name ?? '' })}
        open={Boolean(replacing)}
        onCancel={() => {
          if (!busy) setReplacing(null)
        }}
        onOk={() => {
          if (replacing) void mutate(() => publish(replacing.id))
        }}
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
