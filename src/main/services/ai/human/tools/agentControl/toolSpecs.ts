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
    description:
      '在推进任务时，如果碰到无法从已有上下文、资料或工具结果可靠判断的疑惑、歧义或可能违背用户意图的地方，向用户询问并沟通确认。对于可以自行判断或通过读取资料确定的信息不要询问；只有不同理解可能改变用户意图、执行方案或最终结果时才提问。'
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
    description:
      '将 1–3 项独立任务并行交给临时子 agent，再整合它们的结果。提供完整任务背景和资料路径；不复制聊天历史。子任务不能提问或再次派发，需要协助会交回。避免派发相互依赖或同时修改同一文件的任务。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    defaultResourceKey: 'subagent'
  }),
  modelResult: { renderSuccess: ({ data }) => JSON.stringify(data) }
}

export const AGENT_CONTROL_TOOL_SPECS = [
  DELEGATE_TO_SUBAGENT_TOOL_SPEC,
  LEARN_SKILL_TOOL_SPEC,
  UPDATE_PLAN_TOOL_SPEC,
  READ_IMAGE_TOOL_SPEC,
  ASK_USER_QUESTION_TOOL_SPEC
] as const
