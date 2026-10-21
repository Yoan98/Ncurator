import { t } from '../../i18n'
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
    label: t(($) => $.workbench.default),
    icon: <HiSparkles className="h-3.5 w-3.5" />,
    description: t(($) => $.workbench.aiDecidesHowToProceed),
    trailing: (
      <Tooltip title={t(($) => $.workbench.aiDecidesHowToProceed)}>
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#9B9A97] transition hover:bg-[#EFEFED] hover:text-[#37352F]"
          aria-label={t(($) => $.workbench.aboutDefaultPreferences)}
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
    label: t(($) => $.workbench.localSources),
    icon: <HiCircleStack className="h-3.5 w-3.5" />,
    description: t(($) => $.workbench.theSystemManagesTheKnowledgeBaseAndLocalSources),
    children: [
      {
        value: 'local_sources_relaxed',
        label: t(($) => $.workbench.flexible),
        triggerLabel: t(($) => $.workbench.localSources),
        triggerIcon: <HiCircleStack className="h-3.5 w-3.5" />,
        triggerSuffix: <span className="inline-flex items-center gap-1">{preferenceDots(1)}</span>,
        icon: preferenceDots(1),
        description: t(($) => $.workbench.prioritizeLocalSources),
        trailing: (
          <Tooltip title={t(($) => $.workbench.prioritizeContentFromLocalSources)}>
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#9B9A97] transition hover:bg-[#EFEFED] hover:text-[#37352F]"
              aria-label={t(($) => $.workbench.aboutFlexibleLocalSourceMode)}
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
        label: t(($) => $.workbench.strict),
        triggerLabel: t(($) => $.workbench.localSources),
        triggerIcon: <HiCircleStack className="h-3.5 w-3.5" />,
        triggerSuffix: <span className="inline-flex items-center gap-1">{preferenceDots(2)}</span>,
        icon: preferenceDots(2),
        description: t(($) => $.workbench.aiCanOnlyUseLocalSources),
        trailing: (
          <Tooltip title={t(($) => $.workbench.useOnlyTheContentOfLocalSourcesToPerform)}>
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#9B9A97] transition hover:bg-[#EFEFED] hover:text-[#37352F]"
              aria-label={t(($) => $.workbench.aboutStrictLocalSourceMode)}
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
    label: t(($) => $.workbench.review),
    icon: <HiShieldCheck className="h-4 w-4 text-[#787774]" />,
    triggerIcon: <HiShieldCheck className="h-3.5 w-3.5" />,
    description: t(($) => $.workbench.potentiallyRiskyOperationsRequireYourApproval)
  },
  {
    value: 'full_access',
    label: t(($) => $.workbench.fullAccess),
    icon: <HiExclamationTriangle className="h-4 w-4 text-[#E85D04]" />,
    triggerIcon: <HiExclamationTriangle className="h-3.5 w-3.5 text-[#E85D04]" />,
    description: t(($) => $.workbench.operateYourComputerWithoutRestrictions),
    labelClassName: '!text-[#E85D04]',
    descriptionClassName: '!text-[#E85D04]'
  }
]
