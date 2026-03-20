import React, { useState, useEffect } from 'react'
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  AutoComplete,
  message,
  Typography,
  Tag,
  Space,
  Popconfirm
} from 'antd'
import { HiPlus, HiPencil, HiTrash, HiCheckCircle, HiCog6Tooth } from 'react-icons/hi2'
import type { LLMConfig } from '../../../shared/types'

import openaiLogo from '../assets/img/openai.png'
import qianwenLogo from '../assets/img/qianwen.png'
import doubaoLogo from '../assets/img/doubao.png'
import deepseekLogo from '../assets/img/deepseek.png'
import kimiLogo from '../assets/img/kimi.png'
import guijiliudongLogo from '../assets/img/guijiliudong.png'

const { Title } = Typography

const PROVIDER_OPTIONS = [
  {
    label: 'OpenAI',
    value: 'https://api.openai.com/v1',
    icon: <img src={openaiLogo} alt="OpenAI" className="w-4 h-4" />,
    desc: '官方 API'
  },
  {
    label: '阿里云百炼 (通义千问)',
    value: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    icon: <img src={qianwenLogo} alt="Qianwen" className="w-4 h-4" />,
    desc: '官方 API'
  },
  {
    label: '火山引擎 (豆包)',
    value: 'https://ark.cn-beijing.volces.com/api/v3',
    icon: <img src={doubaoLogo} alt="Doubao" className="w-4 h-4" />,
    desc: '官方 API'
  },
  {
    label: 'DeepSeek',
    value: 'https://api.deepseek.com',
    icon: <img src={deepseekLogo} alt="DeepSeek" className="w-4 h-4" />,
    desc: '官方 API'
  },
  {
    label: 'Kimi(Moonshot)',
    value: 'https://api.moonshot.cn/v1',
    icon: <img src={kimiLogo} alt="Kimi" className="w-4 h-4" />,
    desc: '官方 API'
  },
  {
    label: '硅基流动 (SiliconFlow)',
    value: 'https://api.siliconflow.cn/v1',
    icon: <img src={guijiliudongLogo} alt="SiliconFlow" className="w-4 h-4" />,
    desc: '官方 API'
  }
]

const MODEL_MAPPING: Record<string, { value: string; label: string }[]> = {
  'https://api.openai.com/v1': [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
  ],
  'https://dashscope.aliyuncs.com/compatible-mode/v1': [
    { value: 'qwen-max', label: '通义千问-Max' },
    { value: 'qwen-plus', label: '通义千问-Plus' },
    { value: 'qwen-turbo', label: '通义千问-Turbo' },
    { value: 'qwen-long', label: '通义千问-Long' }
  ],
  'https://ark.cn-beijing.volces.com/api/v3': [
    { value: 'doubao-pro-32k', label: '豆包-Pro-32k' },
    { value: 'doubao-lite-32k', label: '豆包-Lite-32k' },
    { value: 'doubao-pro-4k', label: '豆包-Pro-4k' }
  ],
  'https://api.deepseek.com': [
    { value: 'deepseek-chat', label: 'DeepSeek Chat (V3)' },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' }
  ],
  'https://api.moonshot.cn/v1': [
    { value: 'moonshot-v1-8k', label: 'Moonshot V1 8k' },
    { value: 'moonshot-v1-32k', label: 'Moonshot V1 32k' },
    { value: 'moonshot-v1-128k', label: 'Moonshot V1 128k' }
  ],
  'https://api.siliconflow.cn/v1': [
    { value: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' },
    { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
    { value: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B' },
    { value: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen 2.5 7B' },
    { value: 'Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen 2.5 Coder 32B' }
  ]
}

type LlmConfigFormValues = Pick<LLMConfig, 'name' | 'base_url' | 'model_name' | 'api_key'>
type FlatModelOption = { value: string; label: string }
type GroupedModelOption = { label: string; options: FlatModelOption[] }

const SettingsPage: React.FC = () => {
  const [configs, setConfigs] = useState<LLMConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<LLMConfig | null>(null)
  const [form] = Form.useForm()
  const currentBaseUrl = Form.useWatch('base_url', form)

  const loadConfigs = async () => {
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
    loadConfigs()
  }, [])

  const modelOptions = React.useMemo<Array<FlatModelOption | GroupedModelOption>>(() => {
    if (!currentBaseUrl) {
      // Return all grouped
      return Object.entries(MODEL_MAPPING).map(([url, models]) => {
        const provider = PROVIDER_OPTIONS.find((p) => p.value === url)
        return {
          label: provider?.label || url,
          options: models
        }
      })
    }
    // Try to find exact match
    const exactMatch = MODEL_MAPPING[currentBaseUrl]
    if (exactMatch) return exactMatch

    // If no exact match, return empty array to allow free input
    return []
  }, [currentBaseUrl])

  const handleAdd = () => {
    setEditingConfig(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const handleEdit = (record: LLMConfig) => {
    setEditingConfig(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await window.api.llmConfigDelete(id)
      message.success('配置已删除')
      loadConfigs()
    } catch (e) {
      console.error(e)
      message.error('删除失败')
    }
  }

  const handleActivate = async (id: string) => {
    try {
      await window.api.llmConfigSetActive(id)
      message.success('已切换当前模型')
      loadConfigs()
      // Trigger global event to re-check config status
      window.dispatchEvent(new Event('check-llm-config'))
    } catch (e) {
      console.error(e)
      message.error('切换失败')
    }
  }

  const handleOk = async () => {
    try {
      const values = (await form.validateFields()) as LlmConfigFormValues

      const newConfig: LLMConfig = {
        id: editingConfig ? editingConfig.id : crypto.randomUUID(),
        ...values,
        is_active: editingConfig ? editingConfig.is_active : configs.length === 0
      }

      await window.api.llmConfigSave(newConfig)
      message.success(editingConfig ? '配置已更新' : '配置已添加')
      setIsModalOpen(false)
      loadConfigs()

      if (newConfig.is_active) {
        window.dispatchEvent(new Event('check-llm-config'))
      }
    } catch (e) {
      // Validation failed or save failed
      console.error(e)
    }
  }

  const columns = [
    {
      title: '配置名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: LLMConfig) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-[#1F1F1F]">{text}</span>
          {record.is_active && (
            <Tag color="#D97757" icon={<HiCheckCircle className="inline" />}>
              当前使用
            </Tag>
          )}
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
      render: (_: unknown, record: LLMConfig) => (
        <Space size="small">
          {!record.is_active && (
            <Button
              type="link"
              size="small"
              onClick={() => handleActivate(record.id)}
              className="!text-[#D97757]"
            >
              启用
            </Button>
          )}
          <Button
            type="text"
            size="small"
            icon={<HiPencil />}
            onClick={() => handleEdit(record)}
            className="text-[#666666] hover:text-[#D97757]"
          />
          <Popconfirm
            title="确定要删除此配置吗？"
            onConfirm={() => handleDelete(record.id)}
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
    <div className="min-h-full p-8 font-sans max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#FBF5F2] flex items-center justify-center text-[#D97757]">
            <HiCog6Tooth className="text-xl" />
          </div>
          <div>
            <Title level={3} className="!mb-0 !font-bold !text-[#1F1F1F]">
              大模型配置
            </Title>
            <p className="text-[#999999] text-sm mt-1">配置 LLM API 连接信息</p>
          </div>
        </div>
        <Button
          type="primary"
          icon={<HiPlus className="w-4 h-4" />}
          onClick={handleAdd}
          className="!bg-[#D97757] hover:!bg-[#C66A4A] h-9 px-5 rounded-lg shadow-sm border-none"
        >
          新增配置
        </Button>
      </div>

      <div className="bg-white rounded-2xl border border-[#E5E5E4] shadow-sm overflow-hidden">
        <Table
          dataSource={configs}
          columns={columns}
          rowKey="id"
          pagination={false}
          loading={loading}
          size="middle"
          className="[&_.ant-table-thead_th]:!bg-[#F5F5F4] [&_.ant-table-thead_th]:!text-[#666666] [&_.ant-table-thead_th]:!font-medium [&_.ant-table-tbody_td]:!py-4"
        />
      </div>
      <Modal
        title={editingConfig ? '编辑配置' : '新增配置'}
        open={isModalOpen}
        onOk={handleOk}
        onCancel={() => setIsModalOpen(false)}
        width={500}
        className="[&_.ant-modal-content]:!rounded-2xl"
      >
        <Form form={form} layout="vertical" className="pt-4">
          <Form.Item
            name="name"
            label="配置名称"
            rules={[{ required: true, message: '请输入配置名称' }]}
          >
            <Input placeholder="例如：我的 OpenAI" />
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
                      <div className="flex items-center justify-center w-5 h-5">
                        {provider.icon}
                      </div>
                      <span className="font-medium text-[#1F1F1F]">{provider.label}</span>
                    </div>
                    <span className="text-xs text-[#999999]">{provider.desc}</span>
                  </div>
                )
              }))}
              filterOption={(inputValue, option) => {
                const provider = PROVIDER_OPTIONS.find((p) => p.value === option?.value)
                const matchValue = option?.value
                  ?.toString()
                  .toUpperCase()
                  .includes(inputValue.toUpperCase())
                const matchLabel = provider?.label.toUpperCase().includes(inputValue.toUpperCase())
                return !!(matchValue || matchLabel)
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
                const upperInput = inputValue.toUpperCase()
                const hasValue = Boolean(option && 'value' in option)
                const hasLabel = Boolean(option && 'label' in option)
                const upperValue = hasValue
                  ? String((option as FlatModelOption).value).toUpperCase()
                  : ''
                const upperLabel = hasLabel ? String(option?.label).toUpperCase() : ''
                return !!(upperValue?.includes(upperInput) || upperLabel?.includes(upperInput))
              }}
            />
          </Form.Item>

          <Form.Item
            name="api_key"
            label="API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder="sk-..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default SettingsPage
