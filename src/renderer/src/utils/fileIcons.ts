export type FileIconKind =
  | 'directory'
  | 'web'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'ppt'
  | 'audio'
  | 'video'
  | 'file'

const documentOutline = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6'
const iconPaths: Record<FileIconKind, string[]> = {
  directory: ['M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z'],
  web: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18'],
  pdf: [documentOutline, 'M8 17l4-6 4 6M9.5 15h5'],
  docx: [documentOutline, 'M8 12h8M8 16h8'],
  xlsx: [
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM3 9h18M3 15h18M9 3v18'
  ],
  ppt: ['M2 3h20M3 3v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V3M12 16v5M8 21h8M7 7h10M7 11h6'],
  audio: ['M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
  video: [
    'M4 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM17 10l5-3v10l-5-3'
  ],
  file: [documentOutline]
}

export const getFileIconPaths = (kind: FileIconKind, expanded = false): string[] =>
  kind === 'directory' && expanded
    ? [
        'M3 8V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2M3 20h16a2 2 0 0 0 2-1.5l2-7a1 1 0 0 0-1-1.5H7a2 2 0 0 0-2 1.5L3 20ZM3 20a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1h3'
      ]
    : iconPaths[kind]

export const getFileIconKind = (name: string, extension?: string): FileIconKind => {
  const ext = (extension || name.split(/[\\/]/u).pop()?.split('.').slice(1).pop() || '')
    .replace(/^\./u, '')
    .toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx'].includes(ext)) return 'docx'
  if (['xls', 'xlsx', 'xlsm', 'xltx', 'xltm', 'csv'].includes(ext)) return 'xlsx'
  if (['ppt', 'pptx'].includes(ext)) return 'ppt'
  if (['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba'].includes(ext))
    return 'audio'
  if (['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm', 'wmv'].includes(ext))
    return 'video'
  return 'file'
}
