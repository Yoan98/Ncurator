import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import {
  renderAskUserQuestionModelResult,
  renderSkillConfigModelResult,
  renderLoadToolsetModelResult,
  renderLoadSkillModelResult,
  renderPlanUpdateModelResult,
  renderReadImageModelResult
} from '../../shared/modelToolResultRenderers'
import {
  SKILL_CONFIG_SCHEMA,
  DELEGATE_TO_SUBAGENT_SCHEMA,
  LIST_AGENT_SCHEMA,
  LOAD_TOOLSET_SCHEMA,
  LOAD_SKILL_SCHEMA,
  READ_IMAGE_SCHEMA,
  UPDATE_PLAN_SCHEMA,
  ASK_USER_QUESTION_SCHEMA
} from './toolSchemas'

export const ASK_USER_QUESTION_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof ASK_USER_QUESTION_SCHEMA>,
  'ask_user_question',
  'agent-control'
> = {
  name: 'ask_user_question',
  familyId: 'agent-control',
  toolsetIds: ['agent-control'],
  inputSchema: ASK_USER_QUESTION_SCHEMA,
  promptSpec: {
    name: 'ask_user_question',
    description:
      '碰到疑惑,不确定,需要用户协助等情况，必须向用户提出问题，获取用户的选择或意见，确认清楚。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'agent-control'
  }),
  modelResult: { renderSuccess: renderAskUserQuestionModelResult }
}

export const LOAD_TOOLSET_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof LOAD_TOOLSET_SCHEMA>,
  'load_toolset',
  'agent-control'
> = {
  name: 'load_toolset',
  familyId: 'agent-control',
  toolsetIds: ['agent-control'],
  inputSchema: LOAD_TOOLSET_SCHEMA,
  promptSpec: {
    name: 'load_toolset',
    description: '加载工具包，使其工具可用。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'agent-control'
  }),
  modelResult: { renderSuccess: renderLoadToolsetModelResult }
}

export const LOAD_SKILL_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof LOAD_SKILL_SCHEMA>,
  'load_skill',
  'agent-control'
> = {
  name: 'load_skill',
  familyId: 'agent-control',
  toolsetIds: ['agent-control'],
  inputSchema: LOAD_SKILL_SCHEMA,
  promptSpec: {
    name: 'load_skill',
    description: '加载技能说明和资源目录。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'agent-control'
  }),
  modelResult: {
    renderSuccess: renderLoadSkillModelResult
  }
}

export const UPDATE_PLAN_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof UPDATE_PLAN_SCHEMA>,
  'update_plan',
  'agent-control'
> = {
  name: 'update_plan',
  familyId: 'agent-control',
  toolsetIds: ['agent-control'],
  inputSchema: UPDATE_PLAN_SCHEMA,
  promptSpec: {
    name: 'update_plan',
    description: '更新当前任务的执行计划。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'agent-control'
  }),
  modelResult: { renderSuccess: renderPlanUpdateModelResult }
}

export const READ_IMAGE_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof READ_IMAGE_SCHEMA>,
  'read_image',
  'agent-control'
> = {
  name: 'read_image',
  familyId: 'agent-control',
  toolsetIds: ['agent-control'],
  inputSchema: READ_IMAGE_SCHEMA,
  promptSpec: {
    name: 'read_image',
    description: '读取 1 至 10 张本地或远程图片，并按输入顺序加入主模型多模态上下文。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'image'
  }),
  modelResult: { renderSuccess: renderReadImageModelResult }
}

export const DELEGATE_TO_SUBAGENT_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof DELEGATE_TO_SUBAGENT_SCHEMA>,
  'delegate_to_subagent',
  'agent-control'
> = {
  name: 'delegate_to_subagent',
  familyId: 'agent-control',
  toolsetIds: ['agent-control'],
  inputSchema: DELEGATE_TO_SUBAGENT_SCHEMA,
  promptSpec: {
    name: 'delegate_to_subagent',
    description: '创建或继续执行子 agent 任务，返回各任务的状态、结果和产物。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    defaultResourceKey: 'subagent'
  }),
  modelResult: { renderSuccess: ({ data }) => JSON.stringify(data) }
}

export const LIST_AGENT_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof LIST_AGENT_SCHEMA>,
  'list_agent',
  'agent-control'
> = {
  name: 'list_agent',
  familyId: 'agent-control',
  toolsetIds: ['agent-control'],
  inputSchema: LIST_AGENT_SCHEMA,
  promptSpec: {
    name: 'list_agent',
    description: '查询当前伙伴的子 agent ID、名称、原任务和状态。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'subagent'
  }),
  modelResult: { renderSuccess: ({ data }) => JSON.stringify(data) }
}

export const SKILL_CONFIG_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof SKILL_CONFIG_SCHEMA>,
  'skill_config',
  'agent-control'
> = {
  name: 'skill_config',
  familyId: 'agent-control',
  toolsetIds: ['agent-control'],
  inputSchema: SKILL_CONFIG_SCHEMA,
  promptSpec: { name: 'skill_config', description: '查询或配置当前伙伴的 Skill 启用状态。' },
  resolveExecutionMeta: (args) => ({
    mutability: args.enabled === undefined ? 'read_only' : 'mutating',
    resourceKey: 'skill-config'
  }),
  modelResult: {
    renderSuccess: renderSkillConfigModelResult,
    renderError: ({ data }) =>
      `Error: ${data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string' ? data.error : 'Skill configuration failed'}`
  }
}

export const AGENT_CONTROL_TOOL_SPECS = [
  DELEGATE_TO_SUBAGENT_TOOL_SPEC,
  LIST_AGENT_TOOL_SPEC,
  LOAD_TOOLSET_TOOL_SPEC,
  LOAD_SKILL_TOOL_SPEC,
  SKILL_CONFIG_TOOL_SPEC,
  UPDATE_PLAN_TOOL_SPEC,
  READ_IMAGE_TOOL_SPEC,
  ASK_USER_QUESTION_TOOL_SPEC
] as const
