import { t } from '../../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  App as AntdApp,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Spin,
  Switch,
  TimePicker
} from 'antd'
import dayjs from 'dayjs'
import {
  HiOutlineClock,
  HiOutlinePencilSquare,
  HiOutlinePlus,
  HiOutlineTrash
} from 'react-icons/hi2'
import type {
  ChatMessageContentNode,
  PartnerListItem,
  SelectedReference,
  ScheduledTask,
  ScheduledTaskSaveRequest,
  ScheduledTaskScheduleType
} from '../../../../shared/types'
import { scheduledTaskSelectors } from '../../testing/selectors'
import ScheduledTaskCountChip from './ScheduledTaskCountChip'
import PartnerAvatar from '../workbench/PartnerAvatar'
import ComposerInputEditor from '../workbench/composer/ComposerInputEditor'

const WEEKDAY_OPTIONS = [
  { value: 0, label: t(($) => $.scheduledTasks.sun) },
  { value: 1, label: t(($) => $.scheduledTasks.mon) },
  { value: 2, label: t(($) => $.scheduledTasks.tue) },
  { value: 3, label: t(($) => $.scheduledTasks.wed) },
  { value: 4, label: t(($) => $.scheduledTasks.thu) },
  { value: 5, label: t(($) => $.scheduledTasks.fri) },
  { value: 6, label: t(($) => $.scheduledTasks.sat) }
]

const SCHEDULE_TYPE_OPTIONS = [
  { value: 'daily', label: t(($) => $.scheduledTasks.daily) },
  { value: 'weekly', label: t(($) => $.scheduledTasks.weekly) }
]

type FormState = {
  id: string
  partnerId: string
  name: string
  description: string
  contentNodes: ChatMessageContentNode[]
  selectedReferences: SelectedReference[]
  scheduleType: ScheduledTaskScheduleType
  timeOfDay: string
  weekday: number | null
}

const emptyForm = (): FormState => ({
  id: '',
  partnerId: '',
  name: '',
  description: '',
  contentNodes: [],
  selectedReferences: [],
  scheduleType: 'daily',
  timeOfDay: '09:00',
  weekday: null
})

const normalizeWeekday = (value: number | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  return Number.isInteger(value) && value >= 0 && value <= 6 ? value : null
}

const weekdayLabel = (weekday: number | null): string => {
  if (weekday === null) return ''
  return WEEKDAY_OPTIONS.find((item) => item.value === weekday)?.label || ''
}

const scheduleLabel = (task: ScheduledTask): string => {
  if (task.scheduleType === 'weekly') {
    const day = weekdayLabel(task.weekday)
    return t(($) => $.scheduledTasks.everyAt, {
      value1: day ? ` ${day}` : '',
      value2: task.timeOfDay
    })
  }
  return t(($) => $.scheduledTasks.dailyAt, { value1: task.timeOfDay })
}

const countEnabledTasks = (tasks: ScheduledTask[]): number =>
  tasks.reduce((count, task) => count + (task.enabled ? 1 : 0), 0)

const RequiredFieldLabel = ({ children }: { children: string }) => (
  <span className="text-[13px] text-[#37352F]">
    <span className="mr-1 text-[#ff4d4f]" aria-hidden>
      *
    </span>
    {children}
  </span>
)

const PartnerOptionList = ({
  partners,
  value,
  onChange,
  dataTestId
}: {
  partners: PartnerListItem[]
  value: string
  onChange: (partnerId: string) => void
  dataTestId: string
}) => (
  <div
    className="max-h-[208px] min-h-[72px] overflow-y-auto rounded-[8px] border border-[#E5E4E0] bg-white p-1"
    data-testid={dataTestId}
  >
    {partners.length === 0 ? (
      <div className="flex h-[72px] items-center justify-center text-[13px] text-[#91918E]">
        {t(($) => $.common.noPartnersYet)}
      </div>
    ) : (
      <div className="flex flex-col gap-0.5">
        {partners.map((partner) => {
          const selected = partner.id === value
          return (
            <button
              key={partner.id}
              type="button"
              className={`flex h-12 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left transition-colors ${
                selected ? 'bg-[#EDF3F8] text-[#2F5F8F]' : 'text-[#37352F] hover:bg-[#F4F4F2]'
              }`}
              aria-pressed={selected}
              data-testid={`${dataTestId}-option-${partner.id}`}
              onClick={() => onChange(partner.id)}
            >
              <PartnerAvatar
                shape={partner.avatar_shape}
                color={partner.avatar_color}
                size={32}
                animationSeed={`scheduled-task-${partner.id}`}
                animated
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {partner.name}
              </span>
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  selected ? 'border-[#2F5F8F] bg-[#2F5F8F]' : 'border-[#D8D7D3] bg-white'
                }`}
                aria-hidden="true"
              >
                {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
              </span>
            </button>
          )
        })}
      </div>
    )}
  </div>
)

const buildContentNodes = (
  description: string,
  references: SelectedReference[]
): ChatMessageContentNode[] => [
  ...(description ? [{ kind: 'text' as const, text: description }] : []),
  ...references.map((reference) => ({ kind: 'reference' as const, reference }))
]

type ScheduledTasksViewProps = {
  onEnabledCountChange?: (enabledCount: number) => void
  onAiCreate?: (partnerId: string) => Promise<void> | void
}

const ScheduledTasksView: React.FC<ScheduledTasksViewProps> = ({
  onEnabledCountChange,
  onAiCreate
}) => {
  const { message, modal } = AntdApp.useApp()
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [partners, setPartners] = useState<PartnerListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [aiCreateOpen, setAiCreateOpen] = useState(false)
  const [aiPartnerId, setAiPartnerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())
  const formInitialSnapshotRef = useRef('')
  const enabledCount = useMemo(() => countEnabledTasks(tasks), [tasks])
  const partnerNames = useMemo(
    () => new Map(partners.map((partner) => [partner.id, partner.name])),
    [partners]
  )

  const loadTasks = useCallback(async (): Promise<void> => {
    try {
      setTasks(await window.api.scheduledTaskList())
    } catch (error) {
      console.error('[SCHEDULED-TASKS] list failed:', error)
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTasks()
    const loadPartners = (): void => {
      void window.api
        .partnerList()
        .then(setPartners)
        .catch(() => setPartners([]))
    }
    loadPartners()
    const unsubscribe = window.api.onPartnerListRefresh(() => {
      void loadTasks()
      loadPartners()
    })
    return unsubscribe
  }, [loadTasks])

  useEffect(() => {
    if (loading) return
    onEnabledCountChange?.(enabledCount)
  }, [enabledCount, loading, onEnabledCountChange])

  const openCreate = (): void => {
    const nextForm = emptyForm()
    setForm(nextForm)
    formInitialSnapshotRef.current = JSON.stringify(nextForm)
    setFormOpen(true)
  }

  const openEdit = (task: ScheduledTask): void => {
    const nextForm = {
      id: task.id,
      partnerId: task.partnerId,
      name: task.name,
      description: task.description,
      contentNodes:
        task.contentNodes?.length > 0
          ? task.contentNodes
          : buildContentNodes(task.description, task.selectedReferences),
      selectedReferences: task.selectedReferences,
      scheduleType: task.scheduleType,
      timeOfDay: task.timeOfDay,
      weekday: task.weekday
    }
    setForm(nextForm)
    formInitialSnapshotRef.current = JSON.stringify(nextForm)
    setFormOpen(true)
  }

  const requestCloseForm = (): void => {
    if (JSON.stringify(form) === formInitialSnapshotRef.current) {
      setFormOpen(false)
      return
    }
    modal.confirm({
      title: t(($) => $.scheduledTasks.discardUnsavedChanges),
      content: t(($) => $.scheduledTasks.changesToThisScheduledTaskWillNotBeSaved),
      okText: t(($) => $.scheduledTasks.discardChanges),
      okButtonProps: { danger: true },
      cancelText: t(($) => $.scheduledTasks.keepEditing),
      zIndex: 1200,
      onOk: () => setFormOpen(false)
    })
  }

  const buildSaveRequest = (): ScheduledTaskSaveRequest | null => {
    const timeOfDay = form.timeOfDay.trim()
    const description = form.description.trim()
    if (!partners.some((partner) => partner.id === form.partnerId)) {
      message.warning(t(($) => $.scheduledTasks.selectAPartner))
      return null
    }
    if (!form.name.trim()) {
      message.warning(t(($) => $.scheduledTasks.enterATaskName))
      return null
    }
    if (!description) {
      message.warning(t(($) => $.scheduledTasks.enterATaskDescription))
      return null
    }
    if (!timeOfDay) {
      message.warning(t(($) => $.scheduledTasks.selectAnExecutionTime))
      return null
    }
    if (form.scheduleType === 'weekly' && form.weekday === null) {
      message.warning(t(($) => $.scheduledTasks.selectAWeekday))
      return null
    }
    return {
      id: form.id || undefined,
      name: form.name.trim(),
      description,
      contentNodes:
        form.contentNodes.length > 0
          ? form.contentNodes
          : buildContentNodes(description, form.selectedReferences),
      selectedReferences: form.selectedReferences,
      scheduleType: form.scheduleType,
      timeOfDay,
      weekday: form.scheduleType === 'weekly' ? normalizeWeekday(form.weekday) : null,
      partnerId: form.partnerId
    }
  }

  const handleSave = async (): Promise<void> => {
    const payload = buildSaveRequest()
    if (!payload) return
    setSaving(true)
    try {
      const response = await window.api.scheduledTaskSave(payload)
      if (!response.success) {
        message.error(response.error || t(($) => $.common.couldNotSave))
        return
      }
      message.success(t(($) => $.scheduledTasks.saved))
      setFormOpen(false)
      await loadTasks()
    } catch (error) {
      message.error(t(($) => $.common.couldNotSave))
      console.error('[SCHEDULED-TASKS] save failed:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (task: ScheduledTask, enabled: boolean): Promise<void> => {
    try {
      const response = await window.api.scheduledTaskSetEnabled({ id: task.id, enabled })
      if (!response.success) {
        message.error(response.error || t(($) => $.common.operationFailed))
        return
      }
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? response.task || { ...item, enabled } : item))
      )
    } catch (error) {
      message.error(t(($) => $.common.operationFailed))
      console.error('[SCHEDULED-TASKS] toggle failed:', error)
    }
  }

  const handleRunNow = (task: ScheduledTask): void => {
    modal.confirm({
      title: t(($) => $.common.runThisScheduledTaskNow),
      content: t(($) => $.common.theTaskWillRunInItsBoundPartnerUsing, { value1: task.name }),
      okText: t(($) => $.common.runNow),
      cancelText: t(($) => $.common.cancel),
      onOk: async () => {
        const response = await window.api.scheduledTaskRunNow({ id: task.id })
        if (!response.success) {
          message.warning(response.error || t(($) => $.common.couldNotStartTheTask))
          return
        }
        message.success(t(($) => $.common.taskStarted))
        await loadTasks()
      }
    })
  }

  const handleDelete = (task: ScheduledTask): void => {
    modal.confirm({
      title: t(($) => $.scheduledTasks.deleteScheduledTask),
      content: t(($) => $.scheduledTasks.delete2, { value1: task.name }),
      okText: t(($) => $.common.delete),
      okButtonProps: { danger: true },
      cancelText: t(($) => $.common.cancel),
      onOk: async () => {
        const response = await window.api.scheduledTaskDelete(task.id)
        if (!response.success) {
          message.error(response.error || t(($) => $.common.couldNotDelete))
          return
        }
        message.success(t(($) => $.common.deleted))
        await loadTasks()
      }
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={scheduledTaskSelectors.view}>
      <div
        className="flex h-[44px] shrink-0 items-center justify-between border-b border-[#EEEEEC] bg-white px-4"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <div className="flex items-center gap-2">
          <HiOutlineClock
            className={`h-4 w-4 ${enabledCount > 0 ? 'text-[#2F5F8F]' : 'text-[#787774]'}`}
          />
          <span className="text-[13px] font-medium text-[#37352F]">
            {t(($) => $.common.scheduledTasks)}
          </span>
          <ScheduledTaskCountChip
            enabledCount={enabledCount}
            dataTestId={scheduledTaskSelectors.countChip}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="default"
            size="small"
            icon={<HiOutlinePlus />}
            onClick={openCreate}
            data-testid={scheduledTaskSelectors.addButton}
          >
            {t(($) => $.scheduledTasks.createManually)}
          </Button>
          <Button
            type="primary"
            size="small"
            data-testid={scheduledTaskSelectors.aiAddButton}
            onClick={() => {
              setAiPartnerId(partners[0]?.id || '')
              setAiCreateOpen(true)
            }}
          >
            {t(($) => $.scheduledTasks.createWithAi)}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Spin />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(
                ($) => $.scheduledTasks.noScheduledTasksYetChooseCreateManuallyOrCreate
              )}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="flex flex-col gap-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="group flex items-center gap-3 rounded-[8px] border border-[#EEEEEC] bg-white px-4 py-3"
                  data-testid={`${scheduledTaskSelectors.itemPrefix}-${task.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[#37352F]">
                      {task.name}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-[#91918E]">
                      {task.partnerId
                        ? partnerNames.get(task.partnerId) ||
                          t(($) => $.scheduledTasks.partnerDeleted)
                        : t(($) => $.scheduledTasks.unboundDisabled)}{' '}
                      · {scheduleLabel(task)}
                    </div>
                  </div>
                  <Switch
                    size="small"
                    checked={task.enabled}
                    disabled={!task.partnerId}
                    onChange={(checked) => void handleToggle(task, checked)}
                    data-testid={`${scheduledTaskSelectors.itemTogglePrefix}-${task.id}`}
                  />
                  <Button
                    type="default"
                    size="small"
                    onClick={() => handleRunNow(task)}
                    data-testid={`${scheduledTaskSelectors.itemRunNowPrefix}-${task.id}`}
                  >
                    {t(($) => $.common.runNow)}
                  </Button>
                  <Button
                    type="text"
                    size="small"
                    icon={<HiOutlinePencilSquare />}
                    onClick={() => openEdit(task)}
                    aria-label={t(($) => $.scheduledTasks.edit2, { value1: task.name })}
                    data-testid={`${scheduledTaskSelectors.itemEditPrefix}-${task.id}`}
                  />
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<HiOutlineTrash />}
                    onClick={() => handleDelete(task)}
                    aria-label={t(($) => $.scheduledTasks.delete3, { value1: task.name })}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Drawer
        open={formOpen}
        title={
          form.id
            ? t(($) => $.scheduledTasks.editScheduledTask)
            : t(($) => $.scheduledTasks.newScheduledTask)
        }
        placement="right"
        width="min(50vw, 800px)"
        closable
        maskClosable={false}
        onClose={requestCloseForm}
        rootClassName="scheduled-task-config-drawer"
        styles={{ body: { padding: 0 } }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div
            className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5"
            data-testid={scheduledTaskSelectors.formContent}
          >
            <label className="flex flex-col gap-1.5">
              <RequiredFieldLabel>{t(($) => $.scheduledTasks.taskName)}</RequiredFieldLabel>
              <Input
                value={form.name}
                placeholder={t(($) => $.scheduledTasks.forExampleDailyBriefing)}
                data-testid={scheduledTaskSelectors.formName}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>

            <div
              className="flex flex-col gap-1.5"
              data-testid={scheduledTaskSelectors.formDescription}
            >
              <RequiredFieldLabel>{t(($) => $.scheduledTasks.taskDescription)}</RequiredFieldLabel>
              <ComposerInputEditor
                value={{
                  input: form.description,
                  contentNodes: form.contentNodes,
                  selectedReferences: form.selectedReferences
                }}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    description: value.input,
                    contentNodes: value.contentNodes,
                    selectedReferences: value.selectedReferences
                  }))
                }
                placeholder={t(
                  ($) => $.scheduledTasks.describeWhatThePartnerShouldDoUseToReference
                )}
                dataTestId={scheduledTaskSelectors.formDescriptionInput}
                editorClassName="h-[120px] overflow-y-auto"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <RequiredFieldLabel>{t(($) => $.common.partner)}</RequiredFieldLabel>
              <PartnerOptionList
                partners={partners}
                value={form.partnerId}
                dataTestId={scheduledTaskSelectors.formPartner}
                onChange={(partnerId) => setForm((current) => ({ ...current, partnerId }))}
              />
            </div>

            <div className="flex flex-col gap-2">
              <RequiredFieldLabel>{t(($) => $.scheduledTasks.schedule)}</RequiredFieldLabel>
              <Segmented
                value={form.scheduleType}
                options={SCHEDULE_TYPE_OPTIONS}
                data-testid={scheduledTaskSelectors.formScheduleType}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    scheduleType: value as ScheduledTaskScheduleType
                  }))
                }
              />
              {form.scheduleType === 'weekly' ? (
                <Select
                  value={form.weekday ?? undefined}
                  className="w-full"
                  placeholder={t(($) => $.scheduledTasks.selectWeekday)}
                  options={WEEKDAY_OPTIONS}
                  data-testid={scheduledTaskSelectors.formWeekday}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, weekday: normalizeWeekday(value) }))
                  }
                />
              ) : null}
            </div>

            <label className="flex flex-col gap-2">
              <RequiredFieldLabel>{t(($) => $.scheduledTasks.executionTime)}</RequiredFieldLabel>
              <span data-testid={scheduledTaskSelectors.formTime}>
                <TimePicker
                  className="w-full"
                  format="HH:mm"
                  value={dayjs(form.timeOfDay, 'HH:mm')}
                  allowClear={false}
                  minuteStep={1}
                  onChange={(time) =>
                    setForm((current) => ({
                      ...current,
                      timeOfDay: time ? time.format('HH:mm') : ''
                    }))
                  }
                />
              </span>
            </label>
          </div>
          <div
            className="flex shrink-0 justify-end gap-2 border-t border-[#EEEEEC] bg-white px-6 py-4"
            data-testid={scheduledTaskSelectors.formFooter}
          >
            <Button
              data-testid={scheduledTaskSelectors.formCancel}
              onClick={requestCloseForm}
              disabled={saving}
            >
              {t(($) => $.common.cancel)}
            </Button>
            <Button
              type="primary"
              data-testid={scheduledTaskSelectors.formSave}
              loading={saving}
              onClick={() => void handleSave()}
            >
              {t(($) => $.common.save)}
            </Button>
          </div>
        </div>
      </Drawer>
      <Modal
        open={aiCreateOpen}
        title={t(($) => $.common.selectPartner)}
        okText={t(($) => $.scheduledTasks.startCreatingWithAi)}
        cancelText={t(($) => $.common.cancel)}
        okButtonProps={{
          disabled: !partners.some((partner) => partner.id === aiPartnerId),
          'data-testid': scheduledTaskSelectors.aiConfirm
        }}
        onCancel={() => setAiCreateOpen(false)}
        onOk={() => {
          if (!aiPartnerId) return
          setAiCreateOpen(false)
          if (onAiCreate) void onAiCreate(aiPartnerId)
        }}
      >
        <PartnerOptionList
          partners={partners}
          value={aiPartnerId}
          dataTestId={scheduledTaskSelectors.aiPartner}
          onChange={setAiPartnerId}
        />
      </Modal>
    </div>
  )
}

export default ScheduledTasksView
