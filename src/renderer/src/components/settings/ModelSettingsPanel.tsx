import React, { useEffect, useMemo, useState } from 'react'
import { AutoComplete, Button, Form, Input, Modal, Popconfirm, Space, Table, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { HiArrowPath, HiArrowTopRightOnSquare, HiPencil, HiPlus, HiTrash } from 'react-icons/hi2'
import type { LLMConfig, LlmRemoteModel } from '../../../../shared/types'
import { FREE_AI_KEYS_URL } from '../../../../shared/constants'
import { inferLlmProviderKind } from '../../../../shared/llmProvider'
import { PROVIDER_OPTIONS } from './constants'
import type { LlmConfigFormValues } from './types'
import { settingsSelectors } from '../../testing/selectors'
import { normalizeUserFacingError } from '../../utils/userFacingError'

type ModelListState = {
  loading: boolean
  items: LlmRemoteModel[]
  error?: string
  loadedAt?: number
}

const maskApiKey = (apiKey: string): string => {
  const normalized = apiKey.trim()
  if (!normalized) return '-'
  const tail = normalized.slice(-4)
  return `****${tail}`
}

const getProviderLabel = (config: Pick<LLMConfig, 'providerKind' | 'base_url'>): string => {
  const preset = PROVIDER_OPTIONS.find((item) => item.value === config.base_url)
  if (preset) return preset.label
  if (config.providerKind === 'openai') return 'OpenAI'
  if (config.providerKind === 'deepseek') return 'DeepSeek'
  return 'OpenAI Compatible'
}

const getConfigName = (config: LLMConfig): string => config.name?.trim() || getProviderLabel(config)

const ModelSettingsPanel: React.FC = () => {
  const [configs, setConfigs] = useState<LLMConfig[]>([])
  const [modelListByConfigId, setModelListByConfigId] = useState<Record<string, ModelListState>>({})
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modelListConfigId, setModelListConfigId] = useState<string | null>(null)
  const [editingConfig, setEditingConfig] = useState<LLMConfig | null>(null)
  const [form] = Form.useForm<LlmConfigFormValues>()

  const loadConfigs = async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.api.llmConfigList()
      setConfigs(list)
      setActionError(null)
    } catch (error) {
      console.error('Failed to load configs', error)
      setActionError('加载配置失败')
      message.error('加载配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConfigs()
  }, [])

  const modelListConfig = useMemo(
    () => configs.find((config) => config.id === modelListConfigId) || null,
    [configs, modelListConfigId]
  )

  const applyProviderFromBaseUrl = (baseUrl: string): void => {
    form.setFieldValue('providerKind', inferLlmProviderKind(baseUrl))
  }

  const handleAdd = (): void => {
    setEditingConfig(null)
    form.resetFields()
    form.setFieldValue('providerKind', 'openai-compatible')
    setIsModalOpen(true)
  }

  const handleEdit = (record: LLMConfig): void => {
    setEditingConfig(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const fetchModels = async (config: LLMConfig): Promise<void> => {
    setModelListByConfigId((previous) => ({
      ...previous,
      [config.id]: {
        items: previous[config.id]?.items || [],
        loading: true
      }
    }))
    const response = await window.api.llmConfigModelList(config.id)
    setModelListByConfigId((previous) => ({
      ...previous,
      [config.id]: {
        loading: false,
        items: response.success ? response.items : [],
        error: response.success
          ? undefined
          : normalizeUserFacingError(response.error, '获取模型列表失败'),
        loadedAt: Date.now()
      }
    }))
    if (!response.success) {
      message.error(normalizeUserFacingError(response.error, '获取模型列表失败'))
      return
    }
  }

  const handleOpenModelList = (config: LLMConfig): void => {
    setModelListConfigId(config.id)
    const state = modelListByConfigId[config.id]
    if (!state?.loadedAt && !state?.loading) {
      void fetchModels(config)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    try {
      const response = await window.api.llmConfigDelete(id)
      if (!response.success) {
        const errorMessage = normalizeUserFacingError(response.error, '删除失败')
        setActionError(errorMessage)
        message.error(errorMessage)
        return
      }
      setActionError(null)
      setModelListByConfigId((previous) => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      message.success('配置已删除')
      await loadConfigs()
    } catch (error) {
      console.error(error)
      setActionError('删除失败')
      message.error('删除失败')
    }
  }

  const handleSave = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      const nextConfig: LLMConfig = {
        id: editingConfig ? editingConfig.id : crypto.randomUUID(),
        name: values.name.trim(),
        providerKind: values.providerKind || inferLlmProviderKind(values.base_url),
        base_url: values.base_url,
        api_key: values.api_key
      }

      const response = await window.api.llmConfigSave(nextConfig)
      if (!response.success) {
        const errorMessage = normalizeUserFacingError(
          response.error,
          editingConfig ? '更新失败' : '添加失败'
        )
        setActionError(errorMessage)
        message.error(errorMessage)
        return
      }
      setActionError(null)
      setModelListByConfigId((previous) => {
        const next = { ...previous }
        delete next[nextConfig.id]
        return next
      })
      message.success(editingConfig ? '配置已更新' : '配置已添加')
      setIsModalOpen(false)
      await loadConfigs()
    } catch (error) {
      console.error(error)
    }
  }

  const columns: TableColumnsType<LLMConfig> = [
    {
      title: '模型服务',
      key: 'model_service',
      width: 360,
      render: (_value, record) => (
        <div className="min-w-0">
          <div className="font-medium text-[#37352F]">{getConfigName(record)}</div>
          <div className="text-[12px] text-[#9B9A97]">{getProviderLabel(record)}</div>
          <div className="truncate text-[12px] text-[#787774]">{record.base_url}</div>
        </div>
      )
    },
    {
      title: 'API Key',
      dataIndex: 'api_key',
      key: 'api_key',
      width: 120,
      render: (text: string) => (
        <span className="rounded-[6px] border border-[#EEEEEC] bg-[#F4F4F2] px-2 py-1 text-[12px] text-[#37352F]">
          {maskApiKey(text)}
        </span>
      )
    },
    {
      title: '模型列表',
      key: 'models',
      width: 180,
      render: (_value, record) => {
        const state = modelListByConfigId[record.id]
        const label = state?.loading
          ? '获取中'
          : state?.error
            ? '获取失败'
            : state?.loadedAt !== undefined
              ? `${state.items.length} 个模型`
              : '查看'
        return (
          <Button
            type="link"
            size="small"
            loading={state?.loading}
            onClick={() => handleOpenModelList(record)}
            className="!h-auto !px-0 !text-[#37352F]"
            data-testid={`${settingsSelectors.modelListButtonPrefix}-${record.id}`}
          >
            {label}
          </Button>
        )
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_value, record) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<HiPencil />}
            onClick={() => handleEdit(record)}
            className="text-[#787774] hover:text-[#37352F]"
            data-testid={`${settingsSelectors.modelEditButtonPrefix}-${record.id}`}
          />
          <Popconfirm
            title="确定要删除此配置吗？"
            onConfirm={() => void handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<HiTrash />}
              data-testid={`${settingsSelectors.modelDeleteButtonPrefix}-${record.id}`}
            />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-4 overflow-hidden"
      data-testid={settingsSelectors.modelPanel}
    >
      <section className="shrink-0 px-1 pt-1">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            className="rounded-full border border-[#EEEEEC] bg-white px-3 py-1 text-[12px] text-[#787774]"
            data-testid={settingsSelectors.modelConfigCount}
          >
            共 {configs.length} 个配置
          </span>
          <Button
            icon={<HiArrowTopRightOnSquare className="h-4 w-4" />}
            onClick={() => void window.api.openExternal(FREE_AI_KEYS_URL)}
            aria-label="免费获取 AI Key"
            className="!border-[#E0DFDC] !bg-white !text-[#37352F] shadow-none hover:!border-[#D3D1CC] hover:!bg-[#F7F7F5]"
            data-testid={settingsSelectors.modelFreeKeyButton}
          >
            免费获取 AI Key
          </Button>
          <Button
            type="primary"
            icon={<HiPlus className="h-4 w-4" />}
            onClick={handleAdd}
            className="border-none !bg-[#37352F] shadow-none hover:!bg-[#2F3437]"
            data-testid={settingsSelectors.modelAddButton}
          >
            新增配置
          </Button>
        </div>
      </section>

      {actionError ? <div className="nc-notice nc-notice-danger">{actionError}</div> : null}

      <section className="min-h-0 flex-1">
        <div className="h-full overflow-auto pr-1">
          <Table
            dataSource={configs}
            columns={columns}
            rowKey="id"
            pagination={false}
            loading={loading}
            size="middle"
            className="[&_.ant-table-thead_th]:!bg-[#FFFFFF] [&_.ant-table-thead_th]:!py-3 [&_.ant-table-thead_th]:!text-[12px] [&_.ant-table-thead_th]:!text-[#787774] [&_.ant-table-thead_th]:!font-medium [&_.ant-table-tbody_td]:!py-3 [&_.ant-table-tbody_td]:!align-middle"
            data-testid={settingsSelectors.modelTable}
          />
        </div>
      </section>

      <Modal
        title={editingConfig ? '编辑配置' : '新增配置'}
        open={isModalOpen}
        maskClosable={false}
        onOk={() => void handleSave()}
        onCancel={() => setIsModalOpen(false)}
        width={520}
        data-testid={settingsSelectors.modelModal}
        okButtonProps={{ 'data-testid': settingsSelectors.modelSaveButton }}
        cancelButtonProps={{ 'data-testid': settingsSelectors.modelCancelButton }}
        className="[&_.ant-modal-content]:!rounded-[8px]"
      >
        <Form form={form} layout="vertical" className="pt-4">
          <Form.Item
            name="name"
            label="配置名称"
            rules={[{ required: true, message: '请输入配置名称' }]}
          >
            <Input placeholder="例如：公司 OpenAI" data-testid={settingsSelectors.modelNameInput} />
          </Form.Item>

          <Form.Item
            name="providerKind"
            hidden
            rules={[{ required: true, message: '请选择服务商' }]}
          >
            <Input data-testid={settingsSelectors.modelProviderInput} />
          </Form.Item>

          <Form.Item
            name="base_url"
            label="模型服务地址"
            rules={[{ required: true, message: '请输入模型服务地址' }]}
          >
            <AutoComplete
              defaultActiveFirstOption
              placeholder="填写模型服务提供的 API Base URL"
              allowClear
              data-testid={settingsSelectors.modelBaseUrlInput}
              options={PROVIDER_OPTIONS.map((provider) => ({
                value: provider.value,
                label: (
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center">{provider.icon}</div>
                    <span className="font-medium text-[#37352F]">{provider.label}</span>
                  </div>
                )
              }))}
              onSelect={(value) => applyProviderFromBaseUrl(String(value || ''))}
              onBlur={() => {
                const baseUrl = String(form.getFieldValue('base_url') || '')
                if (baseUrl) applyProviderFromBaseUrl(baseUrl)
              }}
              filterOption={(inputValue, option) => {
                const provider = PROVIDER_OPTIONS.find((item) => item.value === option?.value)
                const normalizedInput = inputValue.toUpperCase()
                const matchValue = option?.value?.toString().toUpperCase().includes(normalizedInput)
                const matchLabel = provider?.label.toUpperCase().includes(normalizedInput) || false
                return matchValue || matchLabel
              }}
            />
          </Form.Item>

          <Form.Item
            name="api_key"
            label="API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder="sk-..." data-testid={settingsSelectors.modelApiKeyInput} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={modelListConfig ? `${getConfigName(modelListConfig)} 可用模型` : '可用模型'}
        open={Boolean(modelListConfig)}
        maskClosable={false}
        footer={
          modelListConfig ? (
            <Button
              icon={<HiArrowPath />}
              loading={modelListByConfigId[modelListConfig.id]?.loading}
              onClick={() => void fetchModels(modelListConfig)}
              data-testid={settingsSelectors.modelListRetryButton}
            >
              重新获取
            </Button>
          ) : null
        }
        onCancel={() => setModelListConfigId(null)}
        width={560}
        className="[&_.ant-modal-content]:!rounded-[8px]"
        data-testid={settingsSelectors.modelListModal}
      >
        {modelListConfig ? (
          <div className="flex flex-col gap-3 pt-2">
            <div className="rounded-[8px] border border-[#EFEFED] bg-[#F7F7F5] px-3 py-2 text-[12px] text-[#787774]">
              <div className="font-medium text-[#37352F]">{getConfigName(modelListConfig)}</div>
              <div className="mt-1">{modelListConfig.base_url}</div>
            </div>
            {modelListByConfigId[modelListConfig.id]?.error ? (
              <div className="rounded-[8px] border border-[#E7CAC6] bg-[#F8EBE9] px-3 py-2 text-[12px] text-[#B3261E]">
                {modelListByConfigId[modelListConfig.id]?.error}
              </div>
            ) : null}
            <div className="text-[12px] text-[#787774]">
              共 {modelListByConfigId[modelListConfig.id]?.items.length || 0} 个模型
            </div>
            <div className="max-h-[320px] overflow-auto rounded-[8px] border border-[#EEEEEC]">
              {(modelListByConfigId[modelListConfig.id]?.items || []).map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between gap-3 border-b border-[#EEEEEC] px-3 py-2 last:border-b-0"
                >
                  <span className="min-w-0 truncate text-[13px] text-[#37352F]">
                    {model.label || model.id}
                  </span>
                </div>
              ))}
              {modelListByConfigId[modelListConfig.id]?.loading ? (
                <div className="px-3 py-8 text-center text-[12px] text-[#9B9A97]">获取中...</div>
              ) : null}
              {!modelListByConfigId[modelListConfig.id]?.loading &&
              (modelListByConfigId[modelListConfig.id]?.items.length || 0) === 0 ? (
                <div className="px-3 py-8 text-center text-[12px] text-[#9B9A97]">
                  暂无可展示模型
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

export default ModelSettingsPanel
