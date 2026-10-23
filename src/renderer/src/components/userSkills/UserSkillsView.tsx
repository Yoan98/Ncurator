import { useEffect, useRef, useState } from 'react'
import { App as AntdApp, Button, Empty, Input, Modal, Select, Spin, Switch } from 'antd'
import {
  HiOutlineArrowPath,
  HiOutlineFolderPlus,
  HiOutlinePlus,
  HiOutlineTrash
} from 'react-icons/hi2'
import type { PartnerListItem } from '../../../../shared/types'
import type { UserSkill } from '../../../../shared/userSkills'
import { t } from '../../i18n'
import { userSkillsSelectors } from '../../testing/selectors'
import { normalizeUserFacingError } from '../../utils/userFacingError'

const INITIAL_CONTENT =
  '---\nname: my-skill\ndescription: Describe when to use this skill.\n---\n\n# My skill\n\nWrite the instructions here.\n'

export default function UserSkillsView({ partners }: { partners: PartnerListItem[] }) {
  const { message, modal } = AntdApp.useApp()
  const [skills, setSkills] = useState<UserSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [partnerId, setPartnerId] = useState<string>()
  const [binding, setBinding] = useState<{ partnerId: string; ids: string[] } | null>(null)
  const [bindingFailed, setBindingFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [content, setContent] = useState(INITIAL_CONTENT)
  const selectedPartnerId = partners.some((partner) => partner.id === partnerId)
    ? partnerId
    : undefined

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
          void message.error(normalizeUserFacingError(error))
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
    if (selectedPartnerId) {
      window.api
        .userSkillsGetEnabled(selectedPartnerId)
        .then((ids) => {
          if (!cancelled) setBinding({ partnerId: selectedPartnerId, ids })
        })
        .catch((error) => {
          if (!cancelled) {
            setBindingFailed(true)
            void message.error(normalizeUserFacingError(error))
          }
        })
    }
    return () => {
      cancelled = true
    }
  }, [selectedPartnerId, revision, message])

  // A synchronous guard also blocks repeated clicks before React renders the busy state.
  const mutate = async (operation: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await operation()
    } catch (error) {
      void message.error(normalizeUserFacingError(error))
      throw error
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const importSkill = async (): Promise<void> => {
    await mutate(async () => {
      const skill = await window.api.userSkillsImport()
      if (skill) setSkills((items) => [...items.filter((item) => item.id !== skill.id), skill])
    }).catch(() => undefined)
  }

  const createSkill = async (): Promise<void> => {
    if (!content.trim()) return
    await mutate(async () => {
      const skill = await window.api.userSkillsCreate({ content })
      setSkills((items) => [...items, skill])
      setCreateOpen(false)
      setContent(INITIAL_CONTENT)
    }).catch(() => undefined)
  }

  const requestClose = (): void => {
    if (busyRef.current) return
    if (content !== INITIAL_CONTENT) {
      modal.confirm({
        title: t(($) => $.userSkills.discardTitle),
        okText: t(($) => $.userSkills.discard),
        cancelText: t(($) => $.common.cancel),
        onOk: () => {
          setCreateOpen(false)
          setContent(INITIAL_CONTENT)
        }
      })
    } else {
      setCreateOpen(false)
    }
  }

  const deleteSkill = (skill: UserSkill): void => {
    modal.confirm({
      title: t(($) => $.userSkills.deleteTitle, { name: skill.name }),
      content: t(($) => $.userSkills.deleteDescription),
      okText: t(($) => $.userSkills.delete),
      okButtonProps: { danger: true },
      cancelText: t(($) => $.common.cancel),
      onOk: () =>
        mutate(async () => {
          await window.api.userSkillsDelete(skill.id)
          setSkills((items) => items.filter((item) => item.id !== skill.id))
          setRevision((value) => value + 1)
        })
    })
  }

  const toggleSkill = async (id: string, checked: boolean): Promise<void> => {
    if (!selectedPartnerId || binding?.partnerId !== selectedPartnerId) return
    const targetPartnerId = selectedPartnerId
    const ids = checked
      ? [...new Set([...binding.ids, id])]
      : binding.ids.filter((item) => item !== id)
    await mutate(async () => {
      await window.api.userSkillsSetEnabled({ partnerId: targetPartnerId, skillIds: ids })
      setBinding((current) =>
        current?.partnerId === targetPartnerId ? { partnerId: targetPartnerId, ids } : current
      )
    }).catch(() => undefined)
  }

  return (
    <div className="h-full overflow-y-auto bg-white" data-testid={userSkillsSelectors.view}>
      <div className="mx-auto max-w-[1080px] space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold text-[#37352F]">
              {t(($) => $.userSkills.title)}
            </h1>
            <p className="mt-2 max-w-[680px] text-[13px] leading-6 text-[#787774]">
              {t(($) => $.userSkills.description)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<HiOutlineArrowPath />}
              disabled={busy || loading}
              onClick={() => setRevision((value) => value + 1)}
              aria-label={t(($) => $.userSkills.refresh)}
            />
            <Button
              icon={<HiOutlineFolderPlus />}
              disabled={busy || loading || loadFailed}
              onClick={() => void importSkill()}
              data-testid={userSkillsSelectors.import}
            >
              {t(($) => $.userSkills.import)}
            </Button>
            <Button
              type="primary"
              icon={<HiOutlinePlus />}
              disabled={busy || loading || loadFailed}
              onClick={() => setCreateOpen(true)}
              data-testid={userSkillsSelectors.create}
            >
              {t(($) => $.userSkills.create)}
            </Button>
          </div>
        </div>
        <div className="rounded-[10px] border border-[#EEEEEC] px-4 py-3 text-[13px] leading-6 text-[#787774]">
          {t(($) => $.userSkills.safety)}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="user-skills-partner" className="text-[14px] text-[#37352F]">
            {t(($) => $.userSkills.partner)}
          </label>
          <Select
            id="user-skills-partner"
            className="w-[200px] max-w-full"
            value={selectedPartnerId}
            disabled={busy}
            placeholder={t(($) => $.userSkills.choosePartner)}
            options={partners.map((partner) => ({ value: partner.id, label: partner.name }))}
            onChange={setPartnerId}
            data-testid={userSkillsSelectors.partner}
          />
          {partners.length === 0 && (
            <span className="text-[13px] text-[#787774]">{t(($) => $.common.noPartnersYet)}</span>
          )}
          {bindingFailed && (
            <span role="alert" className="text-[13px] text-[#B3261E]">
              {t(($) => $.userSkills.bindingFailed)}
            </span>
          )}
        </div>
        {loading ? (
          <div className="py-12 text-center">
            <Spin />
          </div>
        ) : loadFailed ? (
          <div role="alert" className="py-12 text-center text-[#787774]">
            {t(($) => $.userSkills.loadFailed)}
          </div>
        ) : skills.length === 0 ? (
          <Empty description={t(($) => $.userSkills.empty)} />
        ) : (
          <div className="divide-y divide-[#EEEEEC] rounded-[10px] border border-[#EEEEEC]">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className="flex flex-wrap items-center gap-4 px-4 py-4"
                data-testid={`${userSkillsSelectors.itemPrefix}-${skill.id}`}
              >
                <div className="min-w-0 flex-1 basis-[200px]">
                  <div className="break-words text-[14px] font-medium text-[#37352F]">
                    {skill.name}
                  </div>
                  <div className="mt-1 break-words text-[13px] leading-5 text-[#787774]">
                    {skill.description}
                  </div>
                  <div className="mt-1 break-all text-[12px] text-[#91918E]">
                    {skill.directoryName}/SKILL.md
                  </div>
                </div>
                <Switch
                  size="small"
                  data-testid={`${userSkillsSelectors.togglePrefix}-${skill.id}`}
                  checked={
                    binding?.partnerId === selectedPartnerId &&
                    Boolean(binding?.ids.includes(skill.id))
                  }
                  disabled={busy || !selectedPartnerId || binding?.partnerId !== selectedPartnerId}
                  onChange={(checked) => void toggleSkill(skill.id, checked)}
                  aria-label={t(($) => $.userSkills.enable, { name: skill.name })}
                />
                <Button
                  type="text"
                  danger
                  disabled={busy}
                  icon={<HiOutlineTrash />}
                  data-testid={`${userSkillsSelectors.deletePrefix}-${skill.id}`}
                  onClick={() => deleteSkill(skill)}
                  aria-label={t(($) => $.userSkills.deleteTitle, { name: skill.name })}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <Modal
        title={t(($) => $.userSkills.create)}
        open={createOpen}
        width={720}
        maskClosable={false}
        closable={!busy}
        keyboard={!busy}
        onCancel={requestClose}
        onOk={() => void createSkill()}
        confirmLoading={busy}
        okButtonProps={{ disabled: !content.trim() }}
        cancelButtonProps={{ disabled: busy }}
        okText={t(($) => $.userSkills.create)}
        cancelText={t(($) => $.common.cancel)}
      >
        <p className="mb-3 text-[13px] leading-6 text-[#787774]">
          {t(($) => $.userSkills.contentHelp)}
        </p>
        <Input.TextArea
          aria-label="SKILL.md"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          disabled={busy}
          rows={14}
          className="font-mono"
          data-testid={userSkillsSelectors.content}
        />
      </Modal>
    </div>
  )
}
