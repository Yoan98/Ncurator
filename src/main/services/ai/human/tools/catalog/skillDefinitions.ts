import type { RuntimeSkillId } from '../../types'
import type { CatalogSkillMetadata } from './factories'

export const CATALOG_SKILL_DEFINITIONS: Record<RuntimeSkillId, CatalogSkillMetadata> = {
  'workspace-cli': {
    skillId: 'workspace-cli',
    title: 'workspace-cli',
    summary: '读取 workspace 文件、检查环境、执行单条 CLI 命令。',
    whenToUse: '当任务需要读取本地工作区文件、验证环境或执行单条命令时。',
    detail:
      '优先把命令收敛到单条、最小范围、可解释的读取或处理动作；已有足够事实时不要继续探测环境。'
  },
  'docx-read': {
    skillId: 'docx-read',
    title: 'docx-read',
    summary: '打开 docx、定位结构、查找内容、查看历史。',
    whenToUse: '当任务需要读取、定位或理解 docx 内容时。',
    detail:
      '先 open 拿到文档上下文，再按需要 outline/search/get_block；如果需要回看变更历史，可读取 history。'
  },
  'docx-write': {
    skillId: 'docx-write',
    title: 'docx-write',
    summary: '修改 docx 内容，或基于历史快照回滚。',
    whenToUse: '当任务已经确定要修改 docx 内容或需要回滚上一步文档修改时。',
    detail: '修改前先确认目标位置；修改后通常还需要 delivery skill 做 preview、validate 或 save。'
  },
  'docx-delivery': {
    skillId: 'docx-delivery',
    title: 'docx-delivery',
    summary: '做文档校验、生成预览、按需落盘。',
    whenToUse: '当任务已经完成 docx 修改，需要收敛为可审阅或可落盘结果时。',
    detail: '优先 validate 和 render preview；只有明确需要落盘时才 save。'
  },
  'kb-document-discovery': {
    skillId: 'kb-document-discovery',
    title: 'kb-document-discovery',
    summary: '先确定应该查哪份知识文档。',
    whenToUse: '当知识范围不明确，需要先枚举文档再决定检索方向时。',
    detail: '只在范围不清时做文档发现；已有明确文档或 chunk 证据时不要反复列文档。'
  },
  'kb-evidence-query': {
    skillId: 'kb-evidence-query',
    title: 'kb-evidence-query',
    summary: '直接查询 chunk 证据并收敛事实依据。',
    whenToUse: '当已经知道查询目标，需要直接从本地知识库提取证据时。',
    detail: '默认优先 hybrid；需要精确关键词时再 fts，需要更宽语义时再 vector。'
  }
}
