import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import {
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
  '向用户询问会实际改变任务定义或执行结果的关键信息。能从资料确定的信息不要询问；每批最多 3 个相关问题，选项要具体、互斥、可执行，并在有合理默认方案时标记 recommended。用户始终可以选择“其他，请填写”。必须单独调用，不能与写文件、运行命令等工具调用混在同一批。'

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
  modelResult: { renderSuccess: (result) => JSON.stringify(result) }
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
