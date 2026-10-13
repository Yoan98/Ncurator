import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import {
  renderAskUserQuestionModelResult,
  renderLearnSkillModelResult,
  renderPlanUpdateModelResult,
  renderReadImageModelResult
} from '../../shared/modelToolResultRenderers'
import {
  DELEGATE_TO_SUBAGENT_SCHEMA,
  LIST_AGENT_SCHEMA,
  LEARN_SKILL_SCHEMA,
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
  skillIds: ['agent-control'],
  inputSchema: ASK_USER_QUESTION_SCHEMA,
  promptSpec: {
    name: 'ask_user_question',
    description: '碰到疑惑,不确定,需要用户协助等情况，可以向用户提出问题，获取用户的选择或意见。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'agent-control'
  }),
  modelResult: { renderSuccess: renderAskUserQuestionModelResult }
}

export const LEARN_SKILL_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof LEARN_SKILL_SCHEMA>,
  'learn_skill',
  'agent-control'
> = {
  name: 'learn_skill',
  familyId: 'agent-control',
  skillIds: ['agent-control'],
  inputSchema: LEARN_SKILL_SCHEMA,
  promptSpec: {
    name: 'learn_skill',
    description: '加载指定技能。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'agent-control'
  }),
  modelResult: { renderSuccess: renderLearnSkillModelResult }
}

export const UPDATE_PLAN_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof UPDATE_PLAN_SCHEMA>,
  'update_plan',
  'agent-control'
> = {
  name: 'update_plan',
  familyId: 'agent-control',
  skillIds: ['agent-control'],
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
  skillIds: ['agent-control'],
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
  skillIds: ['agent-control'],
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
  skillIds: ['agent-control'],
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

export const AGENT_CONTROL_TOOL_SPECS = [
  DELEGATE_TO_SUBAGENT_TOOL_SPEC,
  LIST_AGENT_TOOL_SPEC,
  LEARN_SKILL_TOOL_SPEC,
  UPDATE_PLAN_TOOL_SPEC,
  READ_IMAGE_TOOL_SPEC,
  ASK_USER_QUESTION_TOOL_SPEC
] as const
