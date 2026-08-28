import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message
} from 'antd'
import type { TableColumnsType } from 'antd'
import { HiArrowTopRightOnSquare, HiPencil, HiPlus, HiTrash } from 'react-icons/hi2'
import type { LLMConfig, LlmProviderId } from '../../../../shared/types'
import { FREE_AI_KEYS_URL } from '../../../../shared/constants'
import { inferLlmProviderKind } from '../../../../shared/llmProvider'
import {
  LLM_PRESET_PROVIDERS,
  getPresetProvider,
  getProviderRegistryEntry,
  resolvePresetModeProvider
} from '../../../../shared/llmPresets'
import { getProviderLogo } from './constants'
import type { LlmConfigFormValues } from './types'
import { settingsSelectors } from '../../testing/selectors'
import { normalizeUserFacingError } from '../../utils/userFacingError'

type ModelMode = 'preset' | 'custom'

const maskApiKey = (apiKey: string): string => {
  const normalized = apiKey.trim()
  if (!normalized) return '-'
  const tail = normalized.slice(-4)
  return `****${tail}`
}

const ModelSettingsPanel: React.FC = () => {
  const [configs, setConfigs] = useState<LLMConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<LLMConfig | null>(null)
  const [mode, setMode] = useState<ModelMode>('preset')
  const [selectedProviderId, setSelectedProviderId] = useState<LlmProviderId | null>(null)
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

  const configuredPresetProviderIds = useMemo(() => {
    const ids = new Set<LlmProviderId>()
    for (const config of configs) {
      const preset = resolvePresetModeProvider(config)
      if (preset) ids.add(preset.providerId)
    }
    return ids
  }, [configs])

  const editingPresetProviderId = useMemo(
    () => (editingConfig ? resolvePresetModeProvider(editingConfig)?.providerId || null : null),
    [editingConfig]
  )

  const applyProviderFromBaseUrl = (baseUrl: string): void => {
    form.setFieldValue('providerKind', inferLlmProviderKind(baseUrl))
  }

  const handleAdd = (): void => {
    setEditingConfig(null)
    setMode('preset')
    setSelectedProviderId(null)
    form.resetFields()
    form.setFieldValue('providerKind', 'openai-compatible')
    setIsModalOpen(true)
  }

  const handleEdit = (record: LLMConfig): void => {
    setEditingConfig(record)
    const preset = resolvePresetModeProvider(record)
    if (preset) {
      setMode('preset')
      setSelectedProviderId(preset.providerId)
      form.resetFields()
      form.setFieldsValue({ api_key: record.api_key })
    } else {
      setMode('custom')
      setSelectedProviderId(null)
      form.setFieldsValue(record)
    }
    setIsModalOpen(true)
  }

  const handleModeChange = (value: string | number): void => {
    const nextMode = value === 'custom' ? 'custom' : 'preset'
    if (nextMode === 'custom') {
      if (selectedProviderId) {
        const preset = getPresetProvider(selectedProviderId)
        const registry = getProviderRegistryEntry(selectedProviderId)
        form.setFieldsValue({
          name: preset?.label,
          base_url: registry?.defaultBaseUrl
        })
      }
    } else {
      form.resetFields(['name', 'base_url'])
    }
    setMode(nextMode)
  }

  const handleSelectProvider = (providerId: LlmProviderId): void => {
    setSelectedProviderId(providerId)
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
      if (mode === 'preset' && !selectedProviderId) {
        message.warning('请选择服务商')
        return
      }
      const values = await form.validateFields()
      const id = editingConfig ? editingConfig.id : crypto.randomUUID()

      let nextConfig: LLMConfig
      if (mode === 'preset') {
        const preset = getPresetProvider(selectedProviderId!)
        const registry = getProviderRegistryEntry(selectedProviderId!)
        if (!preset || !registry) {
          message.error('服务商配置不完整')
          return
        }
        nextConfig = {
          id,
          name: preset.label,
          providerKind: registry.providerKind,
          base_url: registry.defaultBaseUrl,
          api_key: values.api_key
        }
      } else {
        nextConfig = {
          id,
          name: values.name.trim(),
          providerKind: values.providerKind || inferLlmProviderKind(values.base_url),
          base_url: values.base_url,
          api_key: values.api_key
        }
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
      message.success(editingConfig ? '配置已更新' : '配置已添加')
      setIsModalOpen(false)
      await loadConfigs()
    } catch (error) {
      console.error(error)
    }
  }

  const columns: TableColumnsType<LLMConfig> = [
    {
      title: '服务商',
      key: 'provider',
      width: 360,
      render: (_value, record) => {
        const preset = resolvePresetModeProvider(record)
        return (
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center">
              {preset
                ? getProviderLogo(preset.providerId)
                : getProviderLogo('custom')}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-[#37352F]">{record.name}</span>
                {!preset ? (
                  <Tag
                    className="!m-0 !border-[#EEEEEC] !bg-[#F4F4F2] !text-[11px] !text-[#787774]"
                    data-testid={settingsSelectors.modelCustomTag}
                  >
                    自定义
                  </Tag>
                ) : null}
              </div>
              <div className="truncate text-[12px] text-[#9B9A97]">{record.base_url}</div>
            </div>
          </div>
        )
      }
    },
    {
      title: 'API Key',
      dataIndex: 'api_key',
      key: 'api_key',
      width: 140,
      render: (text: string) => (
        <span className="rounded-[6px] border border-[#EEEEEC] bg-[#F4F4F2] px-2 py-1 text-[12px] text-[#37352F]">
          {maskApiKey(text)}
        </span>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
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
        width={560}
        data-testid={settingsSelectors.modelModal}
        okButtonProps={{ 'data-testid': settingsSelectors.modelSaveButton }}
        cancelButtonProps={{ 'data-testid': settingsSelectors.modelCancelButton }}
        className="[&_.ant-modal-content]:!rounded-[8px]"
      >
        <Form form={form} layout="vertical">
        <Tabs
          activeKey={mode}
          onChange={handleModeChange}
          items={[
            {
              key: 'preset',
              label: '服务商配置',
              children: (
                <div className="flex flex-col gap-4">
                  <Form.Item label="选择服务商" className="!mb-0">
                    <Select
                      placeholder="选择服务商"
                      disabled={editingPresetProviderId !== null}
                      value={selectedProviderId || undefined}
                      onChange={(value: LlmProviderId) => handleSelectProvider(value)}
                      data-testid={settingsSelectors.modelPresetProviderSelect}
                      options={LLM_PRESET_PROVIDERS.map((provider) => {
                        const configured = configuredPresetProviderIds.has(provider.providerId)
                        const disabled =
                          configured && editingPresetProviderId !== provider.providerId
                        return {
                          value: provider.providerId,
                          disabled,
                          label: (
                            <span className="inline-flex items-center gap-2">
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                {getProviderLogo(provider.providerId)}
                              </span>
                              <span>{provider.label}</span>
                              {configured ? (
                                <span className="text-[11px] text-[#9B9A97]">已配置</span>
                              ) : null}
                            </span>
                          )
                        }
                      })}
                    />
                  </Form.Item>
                  <Form.Item
                    name="api_key"
                    label="API Key"
                    rules={[{ required: true, message: '请输入 API Key' }]}
                    className="!mb-0"
                  >
                    <Input.Password
                      placeholder="sk-..."
                      data-testid={settingsSelectors.modelApiKeyInput}
                    />
                  </Form.Item>
                </div>
              )
            },
            {
              key: 'custom',
              label: '自定义配置',
              children: (
                <>
                  <Form.Item
                    name="name"
                    label="配置名称"
                    rules={[{ required: true, message: '请输入配置名称' }]}
                  >
                    <Input
                      placeholder="例如：公司 OpenAI"
                      data-testid={settingsSelectors.modelNameInput}
                    />
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
                    <Input
                      placeholder="填写模型服务提供的 API Base URL"
                      allowClear
                      data-testid={settingsSelectors.modelBaseUrlInput}
                      onBlur={() => {
                        const baseUrl = String(form.getFieldValue('base_url') || '')
                        if (baseUrl) applyProviderFromBaseUrl(baseUrl)
                      }}
                    />
                  </Form.Item>

                  <Form.Item
                    name="api_key"
                    label="API Key"
                    rules={[{ required: true, message: '请输入 API Key' }]}
                    className="!mb-0"
                  >
                    <Input.Password
                      placeholder="sk-..."
                      data-testid={settingsSelectors.modelApiKeyInput}
                    />
                  </Form.Item>
                </>
              )
            }
          ]}
          data-testid={settingsSelectors.modelModeSegment}
        />
      </Form>
      </Modal>
    </div>
  )
}

export default ModelSettingsPanel