import { t } from '../../i18n'
import type { DocRenderer, DocRendererProps } from 'react-doc-viewer'
import { IMAGE_PREVIEW_FILE_TYPES } from './capabilities'
import type { LoadedFileRenderDocument } from './types'

const CustomImageRenderer: DocRenderer = ({ mainState }: DocRendererProps) => {
  const document = mainState.currentDocument as LoadedFileRenderDocument | undefined
  if (!document?.uri) return null

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-[#F4F4F2] p-6">
      <img
        src={document.uri}
        alt={document.fileName || t(($) => $.editors.imagePreview)}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  )
}

CustomImageRenderer.fileTypes = IMAGE_PREVIEW_FILE_TYPES
CustomImageRenderer.weight = 2

export default CustomImageRenderer
