import React, { useEffect, useMemo, useState } from 'react'
import {
  AutoComplete,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  message
} from 'antd'
import type { TableColumnsType } from 'antd'
import { HiCheckCircle, HiCog6Tooth, HiPencil, HiPlus, HiTrash } from 'react-icons/hi2'
import type { LLMConfig } from '../../../../shared/types'
import { MODEL_MAPPING, PROVIDER_OPTIONS } from './constants'
import type { FlatModelOption, GroupedModelOption, LlmConfigFormValues } from './types'

const ModelSettingsPanel: React.FC = () => {
  const [configs, setConfigs] = useState<LLMConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<LLMConfig | null>(null)
  const [form] = Form.useForm<LlmConfigFormValues>()
  const currentBaseUrl = Form.useWatch('base_url', form)

  const loadConfigs = async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.api.llmConfigList()
      setConfigs(list)
    } catch (error) {
      console.error('Failed to load configs', error)
      message.error('加载配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConfigs()
  }, [])

  const modelOptions = useMemo<Array<FlatModelOption | GroupedModelOption>>(() => {
    if (!currentBaseUrl) {
      return Object.entries(MODEL_MAPPING).map(([url, models]) => {
        const provider = PROVIDER_OPTIONS.find((item) => item.value === url)
        return {
          label: provider?.label || url,
          options: models
        }
      })
    }

    const exactMatch = MODEL_MAPPING[currentBaseUrl]
    return exactMatch || []
  }, [currentBaseUrl])

  const activeConfig = useMemo(
    () => configs.find((config) => config.is_active) || configs[0] || null,
    [configs]
  )

  const handleAdd = (): void => {
    setEditingConfig(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const handleEdit = (record: LLMConfig): void => {
    setEditingConfig(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await window.api.llmConfigDelete(id)
      message.success('配置已删除')
      await loadConfigs()
    } catch (error) {
      console.error(error)
      message.error('删除失败')
    }
  }

  const handleActivate = async (id: string): Promise<void> => {
    try {
      await window.api.llmConfigSetActive(id)
      message.success('已切换当前模型')
      await loadConfigs()
      window.dispatchEvent(new Event('check-llm-config'))
    } catch (error) {
      console.error(error)
      message.error('切换失败')
    }
  }

  const handleSave = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      const nextConfig: LLMConfig = {
        id: editingConfig ? editingConfig.id : crypto.randomUUID(),
        ...values,
        is_active: editingConfig ? editingConfig.is_active : configs.length === 0
      }

      await window.api.llmConfigSave(nextConfig)
      message.success(editingConfig ? '配置已更新' : '配置已添加')
      setIsModalOpen(false)
      await loadConfigs()

      if (nextConfig.is_active) {
        window.dispatchEvent(new Event('check-llm-config'))
      }
    } catch (error) {
      console.error(error)
    }
  }

  const columns: TableColumnsType<LLMConfig> = [
    {
      title: '配置名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: LLMConfig) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-[#1F1F1F]">{text}</span>
          {record.is_active ? (
            <Tag color="#D97757" icon={<HiCheckCircle className="inline" />}>
              当前使用
            </Tag>
          ) : null}
        </div>
      )
    },
    {
      title: '模型名称',
      dataIndex: 'model_name',
      key: 'model_name',
      render: (text: string) => <Tag>{text}</Tag>
    },
    {
      title: '服务商/Base URL',
      dataIndex: 'base_url',
      key: 'base_url',
      ellipsis: true,
      render: (text: string) => <span className="text-[#666666]">{text}</span>
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_value, record) => (
        <Space size="small">
          {!record.is_active ? (
            <Button
              type="link"
              size="small"
              onClick={() => void handleActivate(record.id)}
              className="!text-[#D97757]"
            >
              启用
            </Button>
          ) : null}
          <Button
            type="text"
            size="small"
            icon={<HiPencil />}
            onClick={() => handleEdit(record)}
            className="text-[#666666] hover:text-[#D97757]"
          />
          <Popconfirm
            title="确定要删除此配置吗？"
            onConfirm={() => void handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="text" danger size="small" icon={<HiTrash />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div className="space-y-4">
      <section className="rounded-[18px] border border-[#E5E5E4] bg-white/88 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-[#F4E5DF] bg-[#FBF5F2] text-[#D97757]">
              <HiCog6Tooth className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold tracking-tight text-[#1F1F1F]">大模型</h2>
              {activeConfig ? (
                <div className="truncate text-[12px] text-[#666666]">{activeConfig.model_name}</div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tag className="!m-0 rounded-full border-[#E5E5E4] bg-white px-3 py-1 text-[12px] text-[#666666]">
              共 {configs.length} 个配置
            </Tag>
            {activeConfig ? (
              <Tag className="!m-0 rounded-full border-[#F4E5DF] bg-[#FBF5F2] px-3 py-1 text-[12px] text-[#D97757]">
                当前 {activeConfig.model_name}
              </Tag>
            ) : null}
            <Button
              type="primary"
              icon={<HiPlus className="h-4 w-4" />}
              onClick={handleAdd}
              className="border-none !bg-[#D97757] shadow-sm hover:!bg-[#C66A4A]"
            >
              新增配置
            </Button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-[#E5E5E4] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <Table
          dataSource={configs}
          columns={columns}
          rowKey="id"
          pagination={false}
          loading={loading}
          size="middle"
          className="[&_.ant-table-thead_th]:!bg-[#F5F5F4] [&_.ant-table-thead_th]:!py-3 [&_.ant-table-thead_th]:!text-[12px] [&_.ant-table-thead_th]:!text-[#666666] [&_.ant-table-thead_th]:!font-medium [&_.ant-table-tbody_td]:!py-3 [&_.ant-table-tbody_td]:!align-middle"
        />
      </section>

      <Modal
        title={editingConfig ? '编辑配置' : '新增配置'}
        open={isModalOpen}
        onOk={() => void handleSave()}
        onCancel={() => setIsModalOpen(false)}
        width={520}
        className="[&_.ant-modal-content]:!rounded-[24px]"
      >
        <Form form={form} layout="vertical" className="pt-4">
          <Form.Item
            name="name"
            label="配置名称"
            rules={[{ required: true, message: '请输入配置名称' }]}
          >
            <Input size="large" placeholder="例如：我的 OpenAI" />
          </Form.Item>

          <Form.Item
            name="base_url"
            label="服务商/Base URL"
            rules={[{ required: true, message: '请输入 Base URL' }]}
            help="选择常用地址或手动输入"
          >
            <AutoComplete
              defaultActiveFirstOption
              placeholder="https://api.openai.com/v1"
              allowClear
              options={PROVIDER_OPTIONS.map((provider) => ({
                value: provider.value,
                label: (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-5 w-5 items-center justify-center">
                        {provider.icon}
                      </div>
                      <span className="font-medium text-[#1F1F1F]">{provider.label}</span>
                    </div>
                    <span className="text-xs text-[#999999]">{provider.desc}</span>
                  </div>
                )
              }))}
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
            name="model_name"
            label="模型名称"
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <AutoComplete
              placeholder="例如：gpt-4o-mini"
              allowClear
              options={modelOptions}
              filterOption={(inputValue, option) => {
                const normalizedInput = inputValue.toUpperCase()
                const valueText =
                  option && 'value' in option && typeof option.value === 'string'
                    ? option.value.toUpperCase()
                    : ''
                const labelText =
                  typeof option?.label === 'string' ? option.label.toUpperCase() : ''
                return valueText.includes(normalizedInput) || labelText.includes(normalizedInput)
              }}
            />
          </Form.Item>

          <Form.Item
            name="api_key"
            label="API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password size="large" placeholder="sk-..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ModelSettingsPanel
