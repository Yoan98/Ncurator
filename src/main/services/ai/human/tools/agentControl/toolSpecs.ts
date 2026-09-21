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
  LEARN_SKILL_SCHEMA,
  READ_IMAGE_SCHEMA,
  UPDATE_PLAN_SCHEMA,
  ASK_USER_QUESTION_SCHEMA
} from './toolSchemas'

const ASK_USER_QUESTION_DESCRIPTION =
  '在推进任务时，如果对用户意图存在无法自行消除的疑惑或歧义，并且不同理解可能改变结果或违背用户本意，向用户确认后再继续。能够从已有信息或资料中可靠确定的内容不要询问。'

export const ASK_USER_QUESTION_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof ASK_USER_QUESTION_SCHEMA>,
  'ask_user_question',
  'agent-control'
> = {
  name: 'ask_user_question',
  familyId: 'agent-control',
  skillIds: ['agent-control'],
  inputSchema: ASK_USER_QUESTION_SCHEMA,
  promptSpec: { name: 'ask_user_question', description: ASK_USER_QUESTION_DESCRIPTION },
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

export const AGENT_CONTROL_TOOL_SPECS = [
  LEARN_SKILL_TOOL_SPEC,
  UPDATE_PLAN_TOOL_SPEC,
  READ_IMAGE_TOOL_SPEC,
  ASK_USER_QUESTION_TOOL_SPEC
] as const
