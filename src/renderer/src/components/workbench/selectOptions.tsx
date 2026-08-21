import React from 'react'
import { Tooltip } from 'antd'
import {
  HiCircleStack,
  HiExclamationTriangle,
  HiQuestionMarkCircle,
  HiShieldCheck,
  HiSparkles
} from 'react-icons/hi2'
import { FaCircle } from 'react-icons/fa'
import type { WorkbenchSelectOption } from './types'

const preferenceDots = (count: 1 | 2): React.ReactNode => (
  <span className="inline-flex items-center gap-0.5 text-[#787774]">
    {Array.from({ length: count }).map((_, index) => (
      <FaCircle key={index} className="h-1.5 w-1.5" />
    ))}
  </span>
)

export const AI_PREFERENCE_OPTIONS: WorkbenchSelectOption[] = [
  {
    value: 'default',
    label: '默认',
    icon: <HiSparkles className="h-3.5 w-3.5" />,
    description: 'AI 自主判断如何推进任务',
    trailing: (
      <Tooltip title="AI 自主判断如何推进任务">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#9B9A97] transition hover:bg-[#EFEFED] hover:text-[#37352F]"
          aria-label="默认偏好说明"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <HiQuestionMarkCircle className="h-3.5 w-3.5" />
        </span>
      </Tooltip>
    )
  },
  {
    value: 'local_sources',
    label: '本地资料',
    icon: <HiCircleStack className="h-3.5 w-3.5" />,
    description: '系统管理知识库和本地资料',
    children: [
      {
        value: 'local_sources_relaxed',
        label: '宽松',
        triggerLabel: '本地资料',
        triggerIcon: <HiCircleStack className="h-3.5 w-3.5" />,
        triggerSuffix: (
          <span className="inline-flex items-center gap-1">
            {preferenceDots(1)}
          </span>
        ),
        icon: preferenceDots(1),
        description: '优先依据本地资料推进任务',
        trailing: (
          <Tooltip title="优先依据本地资料内容推进任务">
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#9B9A97] transition hover:bg-[#EFEFED] hover:text-[#37352F]"
              aria-label="本地资料宽松模式说明"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <HiQuestionMarkCircle className="h-3.5 w-3.5" />
            </span>
          </Tooltip>
        )
      },
      {
        value: 'local_sources_strict',
        label: '严谨',
        triggerLabel: '本地资料',
        triggerIcon: <HiCircleStack className="h-3.5 w-3.5" />,
        triggerSuffix: (
          <span className="inline-flex items-center gap-1">
            {preferenceDots(2)}
          </span>
        ),
        icon: preferenceDots(2),
        description: 'AI 只能依据本地资料推进任务',
        trailing: (
          <Tooltip title="完全只根据本地资料的内容推进任务">
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#9B9A97] transition hover:bg-[#EFEFED] hover:text-[#37352F]"
              aria-label="本地资料严谨模式说明"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <HiQuestionMarkCircle className="h-3.5 w-3.5" />
            </span>
          </Tooltip>
        )
      }
    ]
  }
]

export const EXECUTION_PERMISSION_OPTIONS: WorkbenchSelectOption[] = [
  {
    value: 'review',
    label: '审核',
    icon: <HiShieldCheck className="h-4 w-4 text-[#787774]" />,
    triggerIcon: <HiShieldCheck className="h-3.5 w-3.5" />,
    description: '涉及到风险操作需要你审核'
  },
  {
    value: 'full_access',
    label: '完全访问',
    icon: <HiExclamationTriangle className="h-4 w-4 text-[#E85D04]" />,
    triggerIcon: <HiExclamationTriangle className="h-3.5 w-3.5 text-[#E85D04]" />,
    description: '不受限制的操作你的电脑',
    labelClassName: '!text-[#E85D04]',
    descriptionClassName: '!text-[#E85D04]'
  }
]
