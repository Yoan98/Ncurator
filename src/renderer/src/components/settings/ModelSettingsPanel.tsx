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
    <div className="space-y-6">
      <section className="rounded-[28px] border border-[#E5E5E4] bg-[radial-gradient(circle_at_top_left,_#FBF5F2,_#F5F5F4_68%)] px-7 py-7 shadow-[0_4px_16px_rgba(0,0,0,0.06)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#F4E5DF] bg-white px-3 py-1 text-[12px] font-medium text-[#D97757]">
              <HiCog6Tooth className="h-4 w-4" />
              Model
            </div>
            <h2 className="text-[28px] font-semibold tracking-tight text-[#1F1F1F]">模型与 API 配置</h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-[#666666]">
              在这里维护对话与推理使用的模型配置。激活后的配置会立即成为默认执行入口。
            </p>
          </div>
          <Button
            type="primary"
            icon={<HiPlus className="h-4 w-4" />}
            onClick={handleAdd}
            className="h-11 rounded-lg border-none !bg-[#D97757] px-5 shadow-sm hover:!bg-[#C66A4A]"
          >
            新增配置
          </Button>
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-[#E5E5E4] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <Table
          dataSource={configs}
          columns={columns}
          rowKey="id"
          pagination={false}
          loading={loading}
          size="middle"
          className="[&_.ant-table-thead_th]:!bg-[#F5F5F4] [&_.ant-table-thead_th]:!py-4 [&_.ant-table-thead_th]:!text-[#666666] [&_.ant-table-thead_th]:!font-medium [&_.ant-table-tbody_td]:!py-4"
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
                      <div className="flex h-5 w-5 items-center justify-center">{provider.icon}</div>
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
                const valueText = typeof option?.value === 'string' ? option.value.toUpperCase() : ''
                const labelText = typeof option?.label === 'string' ? option.label.toUpperCase() : ''
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
