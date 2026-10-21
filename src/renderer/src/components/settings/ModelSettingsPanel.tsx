import { t, providerDisplayName } from '../../i18n'
import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  message
} from 'antd'
import type { TableColumnsType } from 'antd'
import { HiPencil, HiPlus, HiTrash } from 'react-icons/hi2'
import type { LLMConfig, LlmProviderId } from '../../../../shared/types'
import { inferLlmProviderKind } from '../../../../shared/llmProvider'
import {
  LLM_PRESET_PROVIDER_OPTIONS,
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
      setActionError(t(($) => $.settings.couldNotLoadConfigurations))
      message.error(t(($) => $.settings.couldNotLoadConfigurations))
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
      const registry = getProviderRegistryEntry(preset.providerId)
      form.setFieldsValue({
        api_key: record.api_key,
        providerKind: registry?.providerKind || 'openai-compatible'
      })
    } else {
      setMode('custom')
      setSelectedProviderId(null)
      form.setFieldsValue(record)
    }
    setIsModalOpen(true)
  }

  const handleModeChange = (value: string | number): void => {
    setMode(value === 'custom' ? 'custom' : 'preset')
  }

  const handleSelectProvider = (providerId: LlmProviderId): void => {
    setSelectedProviderId(providerId)
  }

  const handleDelete = async (id: string): Promise<void> => {
    try {
      const response = await window.api.llmConfigDelete(id)
      if (!response.success) {
        const errorMessage = normalizeUserFacingError(
          response.error,
          t(($) => $.common.couldNotDelete)
        )
        setActionError(errorMessage)
        message.error(errorMessage)
        return
      }
      setActionError(null)
      message.success(t(($) => $.settings.configurationDeleted))
      await loadConfigs()
    } catch (error) {
      console.error(error)
      setActionError(t(($) => $.common.couldNotDelete))
      message.error(t(($) => $.common.couldNotDelete))
    }
  }

  const handleSave = async (): Promise<void> => {
    try {
      if (mode === 'preset' && !selectedProviderId) {
        message.warning(t(($) => $.settings.selectAProvider))
        return
      }
      const values = await form.validateFields()
      const id = editingConfig ? editingConfig.id : crypto.randomUUID()

      let nextConfig: LLMConfig
      if (mode === 'preset') {
        const preset = getPresetProvider(selectedProviderId!)
        const registry = getProviderRegistryEntry(selectedProviderId!)
        if (!preset || !registry) {
          message.error(t(($) => $.settings.providerConfigurationIsIncomplete))
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
          editingConfig ? t(($) => $.settings.couldNotUpdate) : t(($) => $.settings.couldNotAdd)
        )
        setActionError(errorMessage)
        message.error(errorMessage)
        return
      }
      setActionError(null)
      message.success(
        editingConfig
          ? t(($) => $.settings.configurationUpdated)
          : t(($) => $.settings.configurationAdded)
      )
      setIsModalOpen(false)
      await loadConfigs()
    } catch (error) {
      console.error(error)
    }
  }

  const columns: TableColumnsType<LLMConfig> = [
    {
      title: t(($) => $.settings.provider),
      key: 'provider',
      width: 360,
      render: (_value, record) => {
        const preset = resolvePresetModeProvider(record)
        return (
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center">
              {preset ? getProviderLogo(preset.providerId) : getProviderLogo('custom')}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-[#37352F]">
                  {preset ? providerDisplayName(preset.providerId, record.name) : record.name}
                </span>
                {!preset ? (
                  <Tag
                    className="!m-0 !border-[#EEEEEC] !bg-[#F4F4F2] !text-[11px] !text-[#787774]"
                    data-testid={settingsSelectors.modelCustomTag}
                  >
                    {t(($) => $.settings.custom)}
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
      title: t(($) => $.settings.actions),
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
            title={t(($) => $.settings.deleteThisConfiguration)}
            onConfirm={() => void handleDelete(record.id)}
            okText={t(($) => $.common.confirm)}
            cancelText={t(($) => $.common.cancel)}
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
      <section className="nc-settings-panel flex min-h-0 flex-col overflow-hidden">
        <div className="nc-settings-panel-toolbar shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2>{t(($) => $.settings.configuredServices)}</h2>
            <span
              className="text-[12px] text-[#787774]"
              data-testid={settingsSelectors.modelConfigCount}
            >
              {t(($) => $.settings.serviceConnectionCount, { count: configs.length })}
            </span>
          </div>
          <Button
            type="primary"
            icon={<HiPlus className="h-4 w-4" />}
            onClick={handleAdd}
            className="border-none !bg-[#37352F] shadow-none hover:!bg-[#2F3437]"
            data-testid={settingsSelectors.modelAddButton}
          >
            {t(($) => $.settings.addConfiguration)}
          </Button>
        </div>
        {actionError ? <div className="nc-notice nc-notice-danger m-3">{actionError}</div> : null}

        <div className="min-h-0 overflow-auto">
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
        title={
          editingConfig
            ? t(($) => $.settings.editConfiguration)
            : t(($) => $.settings.addConfiguration)
        }
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
          <Form.Item
            name="providerKind"
            hidden
            rules={[{ required: true, message: t(($) => $.settings.selectAProvider) }]}
          >
            <Input data-testid={settingsSelectors.modelProviderInput} />
          </Form.Item>

          <Form.Item label={t(($) => $.settings.type)} className="!mb-0">
            <Radio.Group
              value={mode}
              onChange={(event) => handleModeChange(event.target.value)}
              data-testid={settingsSelectors.modelTypeRadio}
            >
              <Radio value="preset" data-testid={settingsSelectors.modelTypeRecommend}>
                {t(($) => $.common.recommended)}
              </Radio>
              <Radio value="custom" data-testid={settingsSelectors.modelTypeCustom}>
                {t(($) => $.settings.custom)}
              </Radio>
            </Radio.Group>
          </Form.Item>

          {mode === 'preset' ? (
            <Form.Item label={t(($) => $.settings.selectProvider)} className="!mb-0 !mt-4">
              <Select
                placeholder={t(($) => $.settings.selectProvider2)}
                value={selectedProviderId || undefined}
                onChange={(value: LlmProviderId) => handleSelectProvider(value)}
                data-testid={settingsSelectors.modelPresetProviderSelect}
                options={LLM_PRESET_PROVIDER_OPTIONS.map((provider) => {
                  const configured = configuredPresetProviderIds.has(provider.providerId)
                  const disabled = configured && editingPresetProviderId !== provider.providerId
                  return {
                    value: provider.providerId,
                    disabled,
                    label: (
                      <span className="inline-flex items-center gap-2">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {getProviderLogo(provider.providerId)}
                        </span>
                        <span>{providerDisplayName(provider.providerId, provider.label)}</span>
                        {configured ? (
                          <span className="text-[11px] text-[#9B9A97]">
                            {t(($) => $.settings.configured)}
                          </span>
                        ) : null}
                      </span>
                    )
                  }
                })}
              />
            </Form.Item>
          ) : (
            <>
              <Form.Item
                name="name"
                label={t(($) => $.settings.name)}
                rules={[{ required: true, message: t(($) => $.settings.enterAName) }]}
                className="!mb-0 !mt-4"
              >
                <Input
                  placeholder={t(($) => $.settings.forExampleCompanyOpenai)}
                  data-testid={settingsSelectors.modelNameInput}
                />
              </Form.Item>
              <Form.Item
                name="base_url"
                label={t(($) => $.settings.modelServiceUrl)}
                rules={[{ required: true, message: t(($) => $.settings.enterAModelServiceUrl) }]}
                className="!mb-0 !mt-4"
              >
                <Input
                  placeholder={t(($) => $.settings.enterTheApiBaseUrlFromYourModelService)}
                  allowClear
                  data-testid={settingsSelectors.modelBaseUrlInput}
                  onBlur={() => {
                    const baseUrl = String(form.getFieldValue('base_url') || '')
                    if (baseUrl) applyProviderFromBaseUrl(baseUrl)
                  }}
                />
              </Form.Item>
            </>
          )}

          <Form.Item
            name="api_key"
            label="API Key:"
            rules={[{ required: true, message: t(($) => $.settings.enterAnApiKey) }]}
            className="!mb-0 !mt-4"
          >
            <Input.Password placeholder="sk-..." data-testid={settingsSelectors.modelApiKeyInput} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ModelSettingsPanel
