import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import {
  renderGenericModelError,
  renderSkillConfigModelResult
} from '../../shared/modelToolResultRenderers'
import { SKILL_CONFIG_SCHEMA } from './toolSchemas'

export const SKILL_CONFIG_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof SKILL_CONFIG_SCHEMA>,
  'skill_config',
  'skill-management'
> = {
  name: 'skill_config',
  familyId: 'skill-management',
  toolsetIds: ['skill-management'],
  inputSchema: SKILL_CONFIG_SCHEMA,
  promptSpec: { name: 'skill_config', description: '查询或批量修改当前伙伴的 Skill 启用状态。' },
  resolveExecutionMeta: (args) => ({
    mutability: args.action === 'list' ? 'read_only' : 'mutating',
    resourceKey: 'skill-config'
  }),
  modelResult: {
    renderSuccess: renderSkillConfigModelResult,
    renderError: renderGenericModelError
  }
}

export const SKILL_MANAGEMENT_TOOL_SPECS = [SKILL_CONFIG_TOOL_SPEC] as const
