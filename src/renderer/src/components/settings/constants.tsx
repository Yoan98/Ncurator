import { t } from '../../i18n'
import type { LlmProviderId } from '../../../../shared/types'
import type { ReactNode } from 'react'
import type { SettingsSectionMeta, SettingsSectionValue } from './types'
import {
  HiCloudArrowDown,
  HiOutlineAdjustmentsHorizontal,
  HiOutlineRectangleStack,
  HiSparkles
} from 'react-icons/hi2'

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

export const SETTINGS_SECTION_META: Record<SettingsSectionValue, SettingsSectionMeta> = {
  general: {
    value: 'general',
    label: t(($) => $.settings.general),
    title: t(($) => $.settings.general),
    description: t(($) => $.settings.manageAppPreferencesIncludingDesktopNotifications),
    path: '/settings/general',
    icon: <HiOutlineAdjustmentsHorizontal className="h-5 w-5" />
  },
  model: {
    value: 'model',
    label: t(($) => $.settings.languageModels),
    title: t(($) => $.settings.languageModels),
    description: t(($) => $.settings.manageModelServicesAndApiKeys),
    path: '/settings/model',
    icon: <HiSparkles className="h-5 w-5" />
  },
  workspace: {
    value: 'workspace',
    label: t(($) => $.settings.workspace),
    title: t(($) => $.settings.workspace),
    description: t(($) => $.settings.manageLocalPathsWebSourcesDirectoryChangesAndIndexes),
    path: '/settings/workspace',
    icon: <HiOutlineRectangleStack className="h-5 w-5" />
  },
  vector: {
    value: 'vector',
    label: t(($) => $.settings.vectorModels),
    title: t(($) => $.settings.vectorModels),
    description: t(($) => $.settings.downloadLocalEmbeddingModelsForSearchAndKnowledgeRetrieval),
    path: '/settings/vector',
    icon: <HiCloudArrowDown className="h-5 w-5" />
  }
}

const PROVIDER_LOGO_MAP: Partial<Record<LlmProviderId, ReactNode>> = {
  deepseek: <img src={deepseekLogo} alt="DeepSeek" className="w-4 h-4" />,
  dashscope: <img src={qianwenLogo} alt="Qianwen" className="w-4 h-4" />,
  mimo: <img src={mimoLogo} alt="MiMo" className="w-4 h-4" />,
  zhipu: <img src={zhipuLogo} alt="Zhipu" className="w-4 h-4" />
}

export const getProviderLogo = (providerId: LlmProviderId): ReactNode =>
  PROVIDER_LOGO_MAP[providerId] ?? <HiSparkles className="w-4 h-4 text-[#9B9A97]" />
