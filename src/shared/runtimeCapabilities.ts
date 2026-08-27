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

type RuntimeToolCatalogEntry = {
  familyId: RuntimeToolFamilyId
  skillId: string
}

export const RUNTIME_TOOL_CATALOG = {
  terminal_run: { familyId: 'terminal', skillId: 'terminal' },
  terminal_read: { familyId: 'terminal', skillId: 'terminal' },
  text_file_read: { familyId: 'text-file', skillId: 'text-file' },
  text_file_search: { familyId: 'text-file', skillId: 'text-file' },
  text_file_edit: { familyId: 'text-file', skillId: 'text-file' },
  kb_search: { familyId: 'kb', skillId: 'kb-retrieval' },
  kb_list_documents: { familyId: 'kb', skillId: 'kb-retrieval' },
  docx_read_outline: { familyId: 'docx', skillId: 'docx-read' },
  docx_search: { familyId: 'docx', skillId: 'docx-read' },
  docx_read_nodes: { familyId: 'docx', skillId: 'docx-read' },
  docx_read_visuals: { familyId: 'docx', skillId: 'docx-read' },
  docx_content_edit: { familyId: 'docx', skillId: 'docx-write' },
  docx_format: { familyId: 'docx', skillId: 'docx-write' },
  docx_table_edit: { familyId: 'docx', skillId: 'docx-write' },
  docx_media_edit: { familyId: 'docx', skillId: 'docx-write' },
  docx_comments_revisions: { familyId: 'docx', skillId: 'docx-write' },
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

export type RuntimeSkillId = (typeof RUNTIME_TOOL_CATALOG)[RuntimeToolName]['skillId']

export const RUNTIME_TOOL_NAMES = Object.keys(RUNTIME_TOOL_CATALOG) as RuntimeToolName[]

export const RUNTIME_SKILL_IDS = [
  ...new Set(RUNTIME_TOOL_NAMES.map((toolName) => RUNTIME_TOOL_CATALOG[toolName].skillId))
] as RuntimeSkillId[]

export const RUNTIME_SKILL_DISPLAY_NAMES = {
  terminal: '命令执行器',
  'text-file': '文件编辑器',
  'kb-retrieval': '资料查阅器',
  'web-browsing': '网页浏览器',
  'docx-read': 'docx 阅读器',
  'docx-write': 'docx 编辑器',
  'pdf-read': 'PDF 阅读器',
  'ppt-read': 'PPT 阅读器',
  'ppt-write': 'PPT 编辑器',
  'excel-read': 'Excel 阅读器',
  'excel-write': 'Excel 编辑器',
  'image-recognition': '图像识别',
  'image-generation': '图片生成',
  'agent-control': '任务控制'
} as const satisfies Record<RuntimeSkillId, string>

export const isRuntimeSkillId = (value: unknown): value is RuntimeSkillId =>
  typeof value === 'string' && RUNTIME_SKILL_IDS.includes(value as RuntimeSkillId)

export const getRuntimeSkillDisplayName = (skillId: string): string | undefined =>
  RUNTIME_SKILL_DISPLAY_NAMES[skillId as RuntimeSkillId]
