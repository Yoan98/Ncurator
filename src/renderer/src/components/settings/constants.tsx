import type { WorkspaceNode, WorkspaceSource, WebSourceRecord } from '../../../../shared/types'
import type { SettingsSectionMeta, SettingsSectionValue } from './types'
import { HiCloudArrowDown, HiOutlineRectangleStack, HiSparkles } from 'react-icons/hi2'

import openaiLogo from '../../assets/img/openai.png'
import qianwenLogo from '../../assets/img/qianwen.png'
import doubaoLogo from '../../assets/img/doubao.png'
import deepseekLogo from '../../assets/img/deepseek.png'
import kimiLogo from '../../assets/img/kimi.png'
import guijiliudongLogo from '../../assets/img/guijiliudong.png'

export const SETTINGS_SECTION_ORDER: SettingsSectionValue[] = ['model', 'workspace']

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
    description: '管理本地项目路径、网页资料、扫描状态和加载操作。',
    path: '/settings/workspace',
    icon: <HiOutlineRectangleStack className="h-5 w-5" />
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
    description: '本地项目路径、网页资料、扫描与加载',
    path: '/settings/workspace',
    icon: <HiOutlineRectangleStack className="h-4 w-4" />
  },
  {
    key: 'model-download',
    label: '向量模型',
    description: '下载本地检索模型',
    path: '/model-download',
    icon: <HiCloudArrowDown className="h-4 w-4" />
  }
] as const

export const PROVIDER_OPTIONS = [
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

export const WORKSPACE_STATUS_META: Record<
  WorkspaceSource['status'],
  { label: string; className: string }
> = {
  not_prepared: { label: '未加载', className: 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]' },
  scanning: { label: '扫描中', className: 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]' },
  preparing: { label: '加载中', className: 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]' },
  prepared: { label: '已加载', className: 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]' },
  stale: { label: '待更新', className: 'border-[#FDECC8] bg-[#FFF9ED] text-[#AD7B18]' },
  failed: { label: '失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' },
  unavailable: { label: '不可用', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
}

export const WORKSPACE_NODE_STATUS_META: Record<
  WorkspaceNode['prepare_status'],
  { label: string; className: string }
> = {
  not_prepared: { label: '未加载', className: 'border-[#E5E5E4] bg-[#F8F8F7] text-[#666666]' },
  preparing: { label: '加载中', className: 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]' },
  prepared: { label: '已加载', className: 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]' },
  stale: { label: '待更新', className: 'border-[#FDECC8] bg-[#FFF9ED] text-[#AD7B18]' },
  failed: { label: '失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' },
  missing: { label: '缺失', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
}

export const WEB_SOURCE_STATUS_META: Record<
  WebSourceRecord['import_status'],
  { label: string; className: string }
> = {
  1: { label: '处理中', className: 'border-[#FDE2D8] bg-[#FFF3EE] text-[#C66A4A]' },
  2: { label: '已抓取', className: 'border-[#DCEBD7] bg-[#F3FAF0] text-[#4F7A46]' },
  3: { label: '失败', className: 'border-[#F7D5D9] bg-[#FFF2F4] text-[#B5455D]' }
}
