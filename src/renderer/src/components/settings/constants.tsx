/* eslint-disable react-refresh/only-export-components */
import type { LlmProviderId, LlmProviderKind } from '../../../../shared/types'
import type { ReactNode } from 'react'
import type { SettingsSectionMeta, SettingsSectionValue } from './types'
import {
  HiCloudArrowDown,
  HiOutlineAdjustmentsHorizontal,
  HiOutlineRectangleStack,
  HiSparkles
} from 'react-icons/hi2'
import { LLM_PROVIDER_REGISTRY } from '../../../../shared/llmProvider'

import deepseekLogo from '../../assets/img/deepseek.png'
import qianwenLogo from '../../assets/img/qianwen.png'
import zhipuLogo from '../../assets/img/zhipu.png'
import mimoLogo from '../../assets/img/mimo.png'

export const SETTINGS_SECTION_ORDER: SettingsSectionValue[] = [
  'general',
  'model',
  'workspace',
  'vector'
]

export const WORKSPACE_TREE_FILE_NAME_MAX_WIDTH = 'min(34rem, calc(100vw - 20rem))'

export const SETTINGS_SECTION_META: Record<SettingsSectionValue, SettingsSectionMeta> = {
  general: {
    value: 'general',
    label: '通用',
    title: '通用',
    description: '管理桌面通知等应用偏好。',
    path: '/settings/general',
    icon: <HiOutlineAdjustmentsHorizontal className="h-5 w-5" />
  },
  model: {
    value: 'model',
    label: '大模型',
    title: '大模型',
    description: '管理可用的大模型服务与 API Key。',
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
  }
}

export const APP_MENU_ITEMS = [
  {
    key: 'general',
    label: '通用',
    path: '/settings/general',
    icon: <HiOutlineAdjustmentsHorizontal className="h-4 w-4" />
  },
  {
    key: 'model',
    label: '大模型',
    path: '/settings/model',
    icon: <HiSparkles className="h-4 w-4" />
  },
  {
    key: 'workspace',
    label: '工作空间',
    path: '/settings/workspace',
    icon: <HiOutlineRectangleStack className="h-4 w-4" />
  },
  {
    key: 'model-download',
    label: '向量模型',
    path: '/settings/vector',
    icon: <HiCloudArrowDown className="h-4 w-4" />
  }
] as const

export const PROVIDER_LOGO_MAP: Partial<Record<LlmProviderId, ReactNode>> = {
  deepseek: <img src={deepseekLogo} alt="DeepSeek" className="w-4 h-4" />,
  dashscope: <img src={qianwenLogo} alt="Qianwen" className="w-4 h-4" />,
  mimo: <img src={mimoLogo} alt="MiMo" className="w-4 h-4" />,
  zhipu: <img src={zhipuLogo} alt="Zhipu" className="w-4 h-4" />
}

export const getProviderLogo = (providerId: LlmProviderId): ReactNode =>
  PROVIDER_LOGO_MAP[providerId] ?? <HiSparkles className="w-4 h-4 text-[#9B9A97]" />

export const PROVIDER_OPTIONS: Array<{
  label: string
  providerKind: LlmProviderKind
  value: string
  icon: ReactNode
  desc: string
}> = LLM_PROVIDER_REGISTRY.map((provider) => ({
  label: provider.label,
  providerKind: provider.providerKind,
  value: provider.defaultBaseUrl,
  icon: getProviderLogo(provider.id),
  desc: '官方 API'
}))
