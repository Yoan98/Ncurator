export const AI_TOOL_FAMILY_IDS = [
  'terminal',
  'text-file',
  'kb',
  'docx',
  'pdf',
  'ppt',
  'excel',
  'web',
  'image-recognition',
  'image-generation',
  'agent-control'
] as const

export type RuntimeToolFamilyId = (typeof AI_TOOL_FAMILY_IDS)[number]
export type RuntimeSkillSource = 'builtin' | 'external'

type RuntimeSkillCatalogEntry = {
  familyId: RuntimeToolFamilyId
  source: RuntimeSkillSource
  countsTowardToolBudget: boolean
  title: string
  displayName: string
  description: string
}

export const RUNTIME_SKILL_CATALOG = {
  terminal: {
    familyId: 'terminal',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'terminal',
    displayName: '命令执行器',
    description:
      '在用户工作区根目录执行和读取命令，并返回终端状态、增量输出、退出状态和用户工作区域文件产物。'
  },
  'text-file': {
    familyId: 'text-file',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'text-file',
    displayName: '文件编辑器',
    description:
      '读取和写入 Markdown、TXT、代码等 UTF-8 普通文本文件，并返回文本、行范围、执行结果和文件修改记录。 碰到有文本文件操作的需要时，必须要使用该技能'
  },
  'kb-retrieval': {
    familyId: 'kb',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'kb-retrieval',
    displayName: '资料查阅器',
    description:
      '查询用户工作区域知识库的已索引文档或检索相关内容片段，并返回命中证据、来源文档与内容块信息。'
  },
  'web-browsing': {
    familyId: 'web',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'web-browsing',
    displayName: '网页浏览器',
    description:
      '按关键词搜索并读取公开网页正文，或直接读取指定网页，或操作内置浏览器，并返回网页正文、链接或浏览器动作结果。'
  },
  'docx-read': {
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-read',
    displayName: 'docx 阅读器',
    description:
      '读取 .docx、.doc 文档的结构、递归内容树、检索结果和视觉内容，并返回块级索引、正文、节点、匹配信息或视觉识别结果。 碰到有word文件阅读的需要时，必须要使用该技能'
  },
  'docx-write': {
    familyId: 'docx',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'docx-write',
    displayName: 'docx 写作器',
    description:
      '使用递归节点创建或修改 Word 文档中的段落、表格、文本和节点样式，并返回写入状态和相邻区域的详细回读信息。 碰到有操作word文件的需要时，必须要使用该技能'
  },
  'pdf-read': {
    familyId: 'pdf',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'pdf-read',
    displayName: 'PDF 阅读器',
    description:
      '读取 PDF 文档信息、页级文本、检索结果和页面视觉内容，并返回元数据、正文、匹配位置或视觉识别结果。 碰到有pdf文件阅读的需要时，必须要使用该技能'
  },
  'ppt-read': {
    familyId: 'ppt',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'ppt-read',
    displayName: 'PPT 阅读器',
    description:
      '读取 PPTX 的页面结构、内容、搜索结果和页面视觉内容，并返回页面提纲、元素、匹配位置或视觉识别结果。碰到有ppt文件阅读的需要时，必须要使用该技能'
  },
  'ppt-write': {
    familyId: 'ppt',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'ppt-write',
    displayName: 'PPT 编辑器',
    description:
      '使用受限 HTML 创建或编辑 PPTX 页面和元素，并返回变化页面回读和布局警告。碰到操作ppt文件的需要时，必须要使用该技能'
  },
  'excel-read': {
    familyId: 'excel',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'excel-read',
    displayName: 'Excel 阅读器',
    description:
      '读取 Excel 工作簿、工作表、单元格范围、公式和值，并返回结构概览、搜索结果和单元格明细。碰到有excel文件阅读的需要时，必须要使用该技能'
  },
  'excel-write': {
    familyId: 'excel',
    source: 'external',
    countsTowardToolBudget: true,
    title: 'excel-write',
    displayName: 'Excel 编辑器',
    description:
      '创建或编辑 Excel 工作簿中的工作表、单元格、公式、格式和结构，并返回写入后的范围、回读值和文件修改记录。碰到有操作excel文件的需要时，必须要使用该技能'
  },
  'image-recognition': {
    familyId: 'image-recognition',
    source: 'external',
    countsTowardToolBudget: true,
    title: '图像识别',
    displayName: '图像识别',
    description: '读取图片并按 instruction 分析图片内容，并返回模型生成的文本结果。'
  },
  'image-generation': {
    familyId: 'image-generation',
    source: 'external',
    countsTowardToolBudget: true,
    title: '图片生成',
    displayName: '图片生成',
    description: '通过 SVG 绘制生成 PNG、JPEG 或 WebP 图片，并保存为用户工作区域文件。'
  },
  'agent-control': {
    familyId: 'agent-control',
    source: 'builtin',
    countsTowardToolBudget: false,
    title: 'agent-control',
    displayName: '任务控制',
    description: '管理任务推进过程：学习需要的技能、维护并更新执行计划。'
  }
} as const satisfies Record<string, RuntimeSkillCatalogEntry>

export type RuntimeSkillId = keyof typeof RUNTIME_SKILL_CATALOG

type RuntimeToolCatalogEntry = {
  familyId: RuntimeToolFamilyId
  skillId: RuntimeSkillId
}

export const RUNTIME_TOOL_CATALOG = {
  terminal_run: { familyId: 'terminal', skillId: 'terminal' },
  terminal_read: { familyId: 'terminal', skillId: 'terminal' },
  text_file_read: { familyId: 'text-file', skillId: 'text-file' },
  text_file_edit: { familyId: 'text-file', skillId: 'text-file' },
  kb_search: { familyId: 'kb', skillId: 'kb-retrieval' },
  kb_list_documents: { familyId: 'kb', skillId: 'kb-retrieval' },
  docx_read_outline: { familyId: 'docx', skillId: 'docx-read' },
  docx_search: { familyId: 'docx', skillId: 'docx-read' },
  docx_read_blocks: { familyId: 'docx', skillId: 'docx-read' },
  docx_read_visuals: { familyId: 'docx', skillId: 'docx-read' },
  docx_edit: { familyId: 'docx', skillId: 'docx-write' },
  pdf_inspect: { familyId: 'pdf', skillId: 'pdf-read' },
  pdf_search: { familyId: 'pdf', skillId: 'pdf-read' },
  pdf_read_pages: { familyId: 'pdf', skillId: 'pdf-read' },
  pdf_read_visuals: { familyId: 'pdf', skillId: 'pdf-read' },
  ppt_read_outline: { familyId: 'ppt', skillId: 'ppt-read' },
  ppt_read_slides: { familyId: 'ppt', skillId: 'ppt-read' },
  ppt_search: { familyId: 'ppt', skillId: 'ppt-read' },
  ppt_read_visuals: { familyId: 'ppt', skillId: 'ppt-read' },
  ppt_edit: { familyId: 'ppt', skillId: 'ppt-write' },
  excel_read_outline: { familyId: 'excel', skillId: 'excel-read' },
  excel_search: { familyId: 'excel', skillId: 'excel-read' },
  excel_read_cells: { familyId: 'excel', skillId: 'excel-read' },
  excel_edit: { familyId: 'excel', skillId: 'excel-write' },
  web_search: { familyId: 'web', skillId: 'web-browsing' },
  browser_use: { familyId: 'web', skillId: 'web-browsing' },
  image_analyze: { familyId: 'image-recognition', skillId: 'image-recognition' },
  image_generate: { familyId: 'image-generation', skillId: 'image-generation' },
  learn_skill: { familyId: 'agent-control', skillId: 'agent-control' },
  update_plan: { familyId: 'agent-control', skillId: 'agent-control' }
} as const satisfies Record<string, RuntimeToolCatalogEntry>

export type RuntimeToolName = keyof typeof RUNTIME_TOOL_CATALOG

export const RUNTIME_SKILL_IDS = Object.keys(RUNTIME_SKILL_CATALOG) as RuntimeSkillId[]
export const BUILTIN_RUNTIME_SKILL_IDS = RUNTIME_SKILL_IDS.filter(
  (skillId) => RUNTIME_SKILL_CATALOG[skillId].source === 'builtin'
)
export const EXTERNAL_RUNTIME_SKILL_IDS = RUNTIME_SKILL_IDS.filter(
  (skillId) => RUNTIME_SKILL_CATALOG[skillId].source === 'external'
)
export const LEARNABLE_RUNTIME_SKILL_IDS = EXTERNAL_RUNTIME_SKILL_IDS
export const RUNTIME_TOOL_NAMES = Object.keys(RUNTIME_TOOL_CATALOG) as RuntimeToolName[]

export const getRuntimeSkillDisplayName = (skillId: string): string | undefined =>
  RUNTIME_SKILL_CATALOG[skillId as RuntimeSkillId]?.displayName

export const listRuntimeToolNamesForSkill = (skillId: RuntimeSkillId): RuntimeToolName[] =>
  RUNTIME_TOOL_NAMES.filter((toolName) => RUNTIME_TOOL_CATALOG[toolName].skillId === skillId)
