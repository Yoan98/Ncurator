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
import ScheduledTaskDescriptionEditor from './ScheduledTaskDescriptionEditor'
import type { ScheduledTaskDescriptionEditorHandle } from './ScheduledTaskDescriptionEditor'

const WEEKDAY_OPTIONS = [
  { value: 0, label: '周日' },
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' }
]

const SCHEDULE_TYPE_OPTIONS = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' }
]

type FormState = {
  id: string
  partnerId: string
  name: string
  description: string
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
    return `每周${day ? ` ${day}` : ''} ${task.timeOfDay}`
  }
  return `每天 ${task.timeOfDay}`
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
    className="max-h-[320px] min-h-[72px] overflow-y-auto rounded-[8px] border border-[#E5E4E0] bg-white p-1"
    data-testid={dataTestId}
  >
    {partners.length === 0 ? (
      <div className="flex h-[72px] items-center justify-center text-[13px] text-[#91918E]">
        暂无伙伴
      </div>
    ) : (
      <div className="flex flex-col gap-0.5">
        {partners.map((partner) => {
          const selected = partner.id === value
          return (
            <button
              key={partner.id}
              type="button"
              className={`flex min-h-12 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left transition-colors ${
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
  const descriptionEditorRef = useRef<ScheduledTaskDescriptionEditorHandle | null>(null)
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
      title: '放弃未保存的更改？',
      content: '关闭后，本次对定时任务的修改不会保存。',
      okText: '放弃修改',
      okButtonProps: { danger: true },
      cancelText: '继续编辑',
      onOk: () => setFormOpen(false)
    })
  }

  const buildSaveRequest = (descriptionValue: string): ScheduledTaskSaveRequest | null => {
    const timeOfDay = form.timeOfDay.trim()
    const description = descriptionValue.trim()
    if (!partners.some((partner) => partner.id === form.partnerId)) {
      message.warning('请选择伙伴')
      return null
    }
    if (!form.name.trim()) {
      message.warning('请填写任务名称')
      return null
    }
    if (!description) {
      message.warning('请填写任务描述')
      return null
    }
    if (!timeOfDay) {
      message.warning('请选择执行时间')
      return null
    }
    if (form.scheduleType === 'weekly' && form.weekday === null) {
      message.warning('请选择星期几')
      return null
    }
    return {
      id: form.id || undefined,
      name: form.name.trim(),
      description,
      contentNodes: buildContentNodes(description, form.selectedReferences),
      selectedReferences: form.selectedReferences,
      scheduleType: form.scheduleType,
      timeOfDay,
      weekday: form.scheduleType === 'weekly' ? normalizeWeekday(form.weekday) : null,
      partnerId: form.partnerId
    }
  }

  const handleSave = async (): Promise<void> => {
    const description = descriptionEditorRef.current?.getValue() ?? form.description
    if (description !== form.description) {
      setForm((current) => ({ ...current, description }))
    }
    const payload = buildSaveRequest(description)
    if (!payload) return
    setSaving(true)
    try {
      const response = await window.api.scheduledTaskSave(payload)
      if (!response.success) {
        message.error(response.error || '保存失败')
        return
      }
      message.success('已保存')
      setFormOpen(false)
      await loadTasks()
    } catch (error) {
      message.error('保存失败')
      console.error('[SCHEDULED-TASKS] save failed:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (task: ScheduledTask, enabled: boolean): Promise<void> => {
    try {
      const response = await window.api.scheduledTaskSetEnabled({ id: task.id, enabled })
      if (!response.success) {
        message.error(response.error || '操作失败')
        return
      }
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? response.task || { ...item, enabled } : item))
      )
    } catch (error) {
      message.error('操作失败')
      console.error('[SCHEDULED-TASKS] toggle failed:', error)
    }
  }

  const handleRunNow = (task: ScheduledTask): void => {
    modal.confirm({
      title: '立即执行定时任务？',
      content: `将按「${task.name}」的配置在绑定伙伴执行。`,
      okText: '立即执行',
      cancelText: '取消',
      onOk: async () => {
        const response = await window.api.scheduledTaskRunNow({ id: task.id })
        if (!response.success) {
          message.warning(response.error || '立即执行失败')
          return
        }
        message.success('已开始执行')
        await loadTasks()
      }
    })
  }

  const handleDelete = (task: ScheduledTask): void => {
    modal.confirm({
      title: '删除定时任务',
      content: `确定删除「${task.name}」吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const response = await window.api.scheduledTaskDelete(task.id)
        if (!response.success) {
          message.error(response.error || '删除失败')
          return
        }
        message.success('已删除')
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
          <span className="text-[13px] font-medium text-[#37352F]">定时任务</span>
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
            手动创建
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
            AI 创建
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
              description="还没有定时任务，点击右上角「手动创建」或「AI 创建」"
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
                        ? partnerNames.get(task.partnerId) || '伙伴已删除'
                        : '未绑定 / 已停用'}{' '}
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
                    立即执行
                  </Button>
                  <Button
                    type="text"
                    size="small"
                    icon={<HiOutlinePencilSquare />}
                    onClick={() => openEdit(task)}
                    aria-label={`编辑 ${task.name}`}
                    data-testid={`${scheduledTaskSelectors.itemEditPrefix}-${task.id}`}
                  />
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<HiOutlineTrash />}
                    onClick={() => handleDelete(task)}
                    aria-label={`删除 ${task.name}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Drawer
        open={formOpen}
        title={form.id ? '编辑定时任务' : '新增定时任务'}
        placement="right"
        width="min(50vw, 800px)"
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
            <label className="flex flex-col gap-2">
              <RequiredFieldLabel>伙伴</RequiredFieldLabel>
              <PartnerOptionList
                partners={partners}
                value={form.partnerId}
                dataTestId={scheduledTaskSelectors.formPartner}
                onChange={(partnerId) => setForm((current) => ({ ...current, partnerId }))}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <RequiredFieldLabel>任务名称</RequiredFieldLabel>
              <Input
                value={form.name}
                placeholder="例如：每日晨报"
                data-testid={scheduledTaskSelectors.formName}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <RequiredFieldLabel>任务描述</RequiredFieldLabel>
              <ScheduledTaskDescriptionEditor
                ref={descriptionEditorRef}
                value={form.description}
                selectedReferences={form.selectedReferences}
                onChange={(description, selectedReferences) =>
                  setForm((current) => ({ ...current, description, selectedReferences }))
                }
              />
            </div>

            <div className="flex flex-col gap-2">
              <RequiredFieldLabel>执行周期</RequiredFieldLabel>
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
                  placeholder="选择星期"
                  options={WEEKDAY_OPTIONS}
                  data-testid={scheduledTaskSelectors.formWeekday}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, weekday: normalizeWeekday(value) }))
                  }
                />
              ) : null}
            </div>

            <label className="flex flex-col gap-2">
              <RequiredFieldLabel>执行时间</RequiredFieldLabel>
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
              取消
            </Button>
            <Button
              type="primary"
              data-testid={scheduledTaskSelectors.formSave}
              loading={saving}
              onClick={() => void handleSave()}
            >
              保存
            </Button>
          </div>
        </div>
      </Drawer>
      <Modal
        open={aiCreateOpen}
        title="选择伙伴"
        okText="开始 AI 创建"
        cancelText="取消"
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
