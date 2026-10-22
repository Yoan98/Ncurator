export const AI_TOOL_FAMILY_IDS = [
  'terminal',
  'text-file',
  'kb',
  'docx',
  'pdf',
  'ppt',
  'excel',
  'web',
  'image-generation',
  'agent-control',
  'scheduled-tasks'
] as const

export type RuntimeToolFamilyId = (typeof AI_TOOL_FAMILY_IDS)[number]

type RuntimeToolCatalogEntry = {
  familyId: RuntimeToolFamilyId
  toolsetId: string
}

export const RUNTIME_TOOL_CATALOG = {
  terminal_run: { familyId: 'terminal', toolsetId: 'terminal' },
  terminal_read: { familyId: 'terminal', toolsetId: 'terminal' },
  text_file_read: { familyId: 'text-file', toolsetId: 'text-file' },
  text_file_search: { familyId: 'text-file', toolsetId: 'text-file' },
  text_file_edit: { familyId: 'text-file', toolsetId: 'text-file' },
  kb_search: { familyId: 'kb', toolsetId: 'kb-retrieval' },
  kb_list_documents: { familyId: 'kb', toolsetId: 'kb-retrieval' },
  docx_read_outline: { familyId: 'docx', toolsetId: 'docx-read' },
  docx_search: { familyId: 'docx', toolsetId: 'docx-read' },
  docx_read_nodes: { familyId: 'docx', toolsetId: 'docx-read' },
  docx_content_edit: { familyId: 'docx', toolsetId: 'docx-write' },
  docx_format: { familyId: 'docx', toolsetId: 'docx-write' },
  docx_table_edit: { familyId: 'docx', toolsetId: 'docx-write' },
  docx_comments_revisions: { familyId: 'docx', toolsetId: 'docx-write' },
  pdf_outline: { familyId: 'pdf', toolsetId: 'pdf-read' },
  pdf_search: { familyId: 'pdf', toolsetId: 'pdf-read' },
  pdf_read_pages: { familyId: 'pdf', toolsetId: 'pdf-read' },
  ppt_read_outline: { familyId: 'ppt', toolsetId: 'ppt-read' },
  ppt_read_slides: { familyId: 'ppt', toolsetId: 'ppt-read' },
  ppt_search: { familyId: 'ppt', toolsetId: 'ppt-read' },
  ppt_edit: { familyId: 'ppt', toolsetId: 'ppt-write' },
  excel_read: { familyId: 'excel', toolsetId: 'excel-read' },
  excel_edit: { familyId: 'excel', toolsetId: 'excel-write' },
  web_search: { familyId: 'web', toolsetId: 'web-browsing' },
  browser_use: { familyId: 'web', toolsetId: 'web-browsing' },
  image_generate: { familyId: 'image-generation', toolsetId: 'image-generation' },
  load_toolset: { familyId: 'agent-control', toolsetId: 'agent-control' },
  load_skill: { familyId: 'agent-control', toolsetId: 'agent-control' },
  update_plan: { familyId: 'agent-control', toolsetId: 'agent-control' },
  read_image: { familyId: 'agent-control', toolsetId: 'agent-control' },
  list_agent: { familyId: 'agent-control', toolsetId: 'agent-control' },
  delegate_to_subagent: { familyId: 'agent-control', toolsetId: 'agent-control' },
  ask_user_question: { familyId: 'agent-control', toolsetId: 'agent-control' },
  scheduled_task_list: { familyId: 'scheduled-tasks', toolsetId: 'scheduled-tasks' },
  scheduled_task_action: { familyId: 'scheduled-tasks', toolsetId: 'scheduled-tasks' }
} as const satisfies Record<string, RuntimeToolCatalogEntry>

export type RuntimeToolName = keyof typeof RUNTIME_TOOL_CATALOG

export type RuntimeToolsetId = (typeof RUNTIME_TOOL_CATALOG)[RuntimeToolName]['toolsetId']

export const RUNTIME_TOOL_NAMES = Object.keys(RUNTIME_TOOL_CATALOG) as RuntimeToolName[]

export const RUNTIME_TOOLSET_IDS = [
  ...new Set(RUNTIME_TOOL_NAMES.map((toolName) => RUNTIME_TOOL_CATALOG[toolName].toolsetId))
] as RuntimeToolsetId[]

const RUNTIME_TOOLSET_DISPLAY_NAMES = {
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
  'image-generation': '图片生成',
  'agent-control': '任务控制',
  'scheduled-tasks': '定时任务'
} as const satisfies Record<RuntimeToolsetId, string>

export const getRuntimeToolsetDisplayName = (toolsetId: string): string | undefined =>
  RUNTIME_TOOLSET_DISPLAY_NAMES[toolsetId as RuntimeToolsetId]
