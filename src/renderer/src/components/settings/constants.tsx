/* eslint-disable react-refresh/only-export-components */
import type { LlmProviderKind } from '../../../../shared/types'
import type { ReactNode } from 'react'
import type { SettingsSectionMeta, SettingsSectionValue } from './types'
import { HiArrowPath, HiCloudArrowDown, HiOutlineRectangleStack, HiSparkles } from 'react-icons/hi2'

import openaiLogo from '../../assets/img/openai.png'
import qianwenLogo from '../../assets/img/qianwen.png'
import doubaoLogo from '../../assets/img/doubao.png'
import deepseekLogo from '../../assets/img/deepseek.png'
import kimiLogo from '../../assets/img/kimi.png'
import guijiliudongLogo from '../../assets/img/guijiliudong.png'

export const SETTINGS_SECTION_ORDER: SettingsSectionValue[] = [
  'model',
  'workspace',
  'vector',
  'app'
]

export const WORKSPACE_TREE_FILE_NAME_MAX_WIDTH = 'min(34rem, calc(100vw - 20rem))'

export const SETTINGS_SECTION_META: Record<SettingsSectionValue, SettingsSectionMeta> = {
  model: {
    value: 'model',
    label: '大模型',
    title: '大模型',
    description: '配置默认对话模型、API Key 和当前启用入口。',
    path: '/settings/model',
    icon: <HiSparkles className="h-5 w-5" />
  },
  workspace: {
    value: 'workspace',
    label: '工作空间',
    title: '工作空间',
    description: '管理本地项目路径、网页资料、目录变化和索引状态。',
    path: '/settings/workspace',
    icon: <HiOutlineRectangleStack className="h-5 w-5" />
  },
  vector: {
    value: 'vector',
    label: '向量模型',
    title: '向量模型',
    description: '下载本地检索模型，为搜索和知识库能力提供向量基础。',
    path: '/settings/vector',
    icon: <HiCloudArrowDown className="h-5 w-5" />
  },
  app: {
    value: 'app',
    label: '应用更新',
    title: '应用更新',
    description: '查看当前版本、检查新版本并安装已下载更新。',
    path: '/settings/app',
    icon: <HiArrowPath className="h-5 w-5" />
  }
}

export const APP_MENU_ITEMS = [
  {
    key: 'model',
    label: '大模型',
    description: '默认对话模型与 API 配置',
    path: '/settings/model',
    icon: <HiSparkles className="h-4 w-4" />
  },
  {
    key: 'workspace',
    label: '工作空间',
    description: '本地项目路径、网页资料、目录变化与索引',
    path: '/settings/workspace',
    icon: <HiOutlineRectangleStack className="h-4 w-4" />
  },
  {
    key: 'app',
    label: '应用更新',
    description: '版本检查与安装',
    path: '/settings/app',
    icon: <HiArrowPath className="h-4 w-4" />
  },
  {
    key: 'model-download',
    label: '向量模型',
    description: '下载本地检索模型',
    path: '/settings/vector',
    icon: <HiCloudArrowDown className="h-4 w-4" />
  }
] as const

export const PROVIDER_OPTIONS: Array<{
  label: string
  providerKind: LlmProviderKind
  value: string
  icon: ReactNode
  desc: string
}> = [
  {
    label: 'OpenAI',
    providerKind: 'openai',
    value: 'https://api.openai.com/v1',
    icon: <img src={openaiLogo} alt="OpenAI" className="w-4 h-4" />,
    desc: '官方 API'
  },
  {
    label: '阿里云百炼 (通义千问)',
    providerKind: 'openai-compatible',
    value: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    icon: <img src={qianwenLogo} alt="Qianwen" className="w-4 h-4" />,
    desc: '官方 API'
  },
  {
    label: '火山引擎 (豆包)',
    providerKind: 'openai-compatible',
    value: 'https://ark.cn-beijing.volces.com/api/v3',
    icon: <img src={doubaoLogo} alt="Doubao" className="w-4 h-4" />,
    desc: '官方 API'
  },
  {
    label: 'DeepSeek',
    providerKind: 'deepseek',
    value: 'https://api.deepseek.com',
    icon: <img src={deepseekLogo} alt="DeepSeek" className="w-4 h-4" />,
    desc: '官方 API'
  },
  {
    label: 'Kimi(Moonshot)',
    providerKind: 'openai-compatible',
    value: 'https://api.moonshot.cn/v1',
    icon: <img src={kimiLogo} alt="Kimi" className="w-4 h-4" />,
    desc: '官方 API'
  },
  {
    label: '硅基流动 (SiliconFlow)',
    providerKind: 'openai-compatible',
    value: 'https://api.siliconflow.cn/v1',
    icon: <img src={guijiliudongLogo} alt="SiliconFlow" className="w-4 h-4" />,
    desc: '官方 API'
  }
] as const

export const MODEL_MAPPING: Record<string, { value: string; label: string }[]> = {
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
