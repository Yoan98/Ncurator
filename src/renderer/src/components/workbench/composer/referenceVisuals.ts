import { getFileIconKind, type FileIconKind } from '../../../utils/fileIcons'
import type { DocumentSelectionNode, SelectedReference } from '../../../../../shared/types'

export const INLINE_TOKEN_CLASS_NAME =
  'mr-1.5 inline-flex max-w-full items-baseline gap-1 rounded-md px-1.5 py-0.5 align-baseline text-[0.9em] font-medium leading-[1.4]'
export const REFERENCE_TOKEN_CLASS_NAME = INLINE_TOKEN_CLASS_NAME + ' bg-[#F4F4F2]'
export const INLINE_TOKEN_LABEL_CLASS_NAME = 'min-w-0 max-w-[180px] truncate'
export const SELECTION_TOKEN_CLASS_NAME =
  INLINE_TOKEN_CLASS_NAME +
  ' cursor-pointer bg-[#F3EDF9] text-[#6F4F91] outline-none transition-colors hover:bg-[#E9DDFB] focus-visible:ring-2 focus-visible:ring-[#0B6BCB]'
export const SELECTION_NUMBER_CLASS_NAME =
  'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[5px] bg-[#E3D5F2] px-[3px] text-[10px] font-semibold leading-none text-[#6F4F91]'
export const SELECTION_DOCUMENT_ICON_PATH =
  'M10.5 2.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 15.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5m-4-4 4 4h-4v-4ZM6.5 9h5m-5 3h5'
export const selectionFileName = (node: DocumentSelectionNode): string =>
  node.filePath.split(/[/\\]/).pop() || node.filePath

export type ReferenceVisualSpec = {
  kind: FileIconKind
  iconClassName: string
  labelClassName: string
}

export const getReferenceVisualSpec = (reference: SelectedReference): ReferenceVisualSpec => ({
  kind:
    reference.kind === 'file'
      ? getFileIconKind(reference.relativePath || reference.name, reference.fileExt)
      : reference.kind,
  iconClassName: 'text-[#787774]',
  labelClassName: 'text-[#37352F]'
})

/** Keep the same purple selection token while distinguishing the selected file format. */
export const selectionIconPath = (node: DocumentSelectionNode): string => {
  if (node.anchor?.kind === 'excel') return 'M3 3h12v12H3zM3 7h12M3 11h12M7 3v12'
  if (node.anchor?.kind === 'ppt') return 'M2.5 3h13v9h-13zM9 12v4M6 16h6M6 6h6M6 9h4'
  if (node.anchor?.kind === 'pdf')
    return 'M10.5 2.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 15.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5m-4-4 4 4h-4v-4ZM6 12l3-5 3 5M7 10h4'
  return SELECTION_DOCUMENT_ICON_PATH
}
