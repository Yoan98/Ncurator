import { createPortal } from 'react-dom'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { HiOutlineCheck, HiOutlineSparkles, HiOutlineTrash } from 'react-icons/hi2'
import type { ChatInlineContentNode } from '../../../../../shared/types'
import { chatContentText, chatReferences, hasUserText } from '../../../../../shared/chatContent'
import ComposerInputEditor from '../../workbench/composer/ComposerInputEditor'
import type { SelectionFloatingPosition } from './floatingLayout'
import type { SelectionPopup } from './types'

export default function SelectionPopover({
  popup,
  setPopup,
  popupRef,
  floating,
  locked,
  save,
  remove,
  maxWidth,
  testPrefix
}: {
  popup: SelectionPopup
  setPopup: Dispatch<SetStateAction<SelectionPopup | null>>
  popupRef: RefObject<HTMLDivElement | null>
  floating: SelectionFloatingPosition | null
  locked: boolean
  save: () => void
  remove: (id: string) => void
  maxWidth: number
  testPrefix: string
}) {
  return createPortal(
    <div
      ref={popupRef}
      data-testid={`${testPrefix}-selection-popup`}
      data-placement={floating?.placement}
      className={
        'fixed z-[1100] border border-[#E0DFDC] bg-white shadow-[0_4px_16px_rgba(15,15,15,0.10)] ' +
        (popup.mode === 'editor'
          ? 'flex w-[420px] items-end gap-1 rounded-[19px] p-[4px] focus-within:border-[#B5CCE2]'
          : 'rounded-lg p-1')
      }
      style={{
        left: floating?.left,
        top: floating?.top,
        maxWidth: maxWidth,
        visibility: floating ? 'visible' : 'hidden'
      }}
    >
      {popup.mode === 'action' ? (
        <button
          type="button"
          data-testid={`${testPrefix}-selection-ai-reference`}
          disabled={locked}
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-[#37352F] outline-none hover:bg-[#F4F4F2] focus-visible:ring-2 focus-visible:ring-[#0B6BCB] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => setPopup((previous) => previous && { ...previous, mode: 'editor' })}
        >
          <HiOutlineSparkles className="h-4 w-4 text-[#80649F]" aria-hidden="true" />
          AI 引用
        </button>
      ) : (
        <>
          <ComposerInputEditor
            value={{
              contentNodes: popup.node.children,
              input: chatContentText(popup.node.children).trim(),
              selectedReferences: chatReferences(popup.node.children)
            }}
            variant="inline"
            placeholder="描述你想对引用内容做什么"
            dataTestId={`${testPrefix}-selection-thought`}
            disabled={locked}
            onSubmit={save}
            editorClassName="max-h-[68px] overflow-auto"
            onChange={(value) =>
              setPopup(
                (previous) =>
                  previous && {
                    ...previous,
                    node: {
                      ...previous.node,
                      children: value.contentNodes.filter(
                        (node): node is ChatInlineContentNode => node.kind !== 'document_selection'
                      )
                    }
                  }
              )
            }
          />
          {popup.node.number ? (
            <button
              type="button"
              aria-label="删除引用"
              title="删除引用"
              disabled={locked}
              className="flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-full text-[#91918E] outline-none hover:bg-[#F8EBE9] hover:text-[#B3261E] focus-visible:ring-2 focus-visible:ring-[#0B6BCB] disabled:cursor-not-allowed"
              onClick={() => {
                remove(popup.node.id)
                setPopup(null)
              }}
            >
              <HiOutlineTrash className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            data-testid={`${testPrefix}-selection-save`}
            aria-label={popup.node.number ? '确认修改' : '添加到输入框'}
            title={popup.node.number ? '确认修改' : '添加到输入框'}
            disabled={locked || !hasUserText(popup.node.children)}
            className="flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#37352F] text-white outline-none hover:bg-[#25241F] focus-visible:ring-2 focus-visible:ring-[#0B6BCB] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#F4F4F2] disabled:text-[#B8B7B3]"
            onClick={save}
          >
            <HiOutlineCheck className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </>
      )}
    </div>,
    document.body
  )
}
