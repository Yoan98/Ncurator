import { VideoFeedbackContext } from './composer/VideoFeedbackContext'
import { t, getRendererRuntime } from '../../i18n'
import FileIcon from '../FileIcon'
import UsageRing from '../UsageRing'
import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { DocumentSelectionContext } from './composer/DocumentSelectionContext'
import { App as AntdApp, Spin, Tooltip } from 'antd'
import { HiArrowUp, HiPhoto, HiStop, HiXMark } from 'react-icons/hi2'
import { LuPlus } from 'react-icons/lu'
import type {
  ChatAttachment,
  LLMConfig,
  LlmRemoteModel,
  SelectedReference,
  WorkbenchModelSelection
} from '../../../../shared/types'
import type { ChatMessageLogPlanItem } from '../../../../shared/types'
import type { FreeModelPublicEntry } from '../../../../shared/freeModels'
import { workbenchSelectors } from '../../testing/selectors'
import { normalizeUserFacingError } from '../../utils/userFacingError'
import type {
  WorkbenchAiPreference,
  WorkbenchContextUsage,
  WorkbenchExecutionPermission,
  WorkbenchFileRef
} from './types'
import { buildComposerPlaceholder } from './composer/constants'
import AttachmentFileIcon from './composer/AttachmentFileIcon'
import { isAttachmentDocumentPreviewable } from './composer/attachmentPresentation'
import ReferenceMentionPanel from './composer/ReferenceMentionPanel'
import { useReferenceMention } from './composer/useReferenceMention'
import type { ComposerDraftValue, ComposerNode } from './composer/types'
import {
  anchorCaretInTextNode,
  clearCaretPlaceholders,
  createComposerNodesFromDraftValue,
  createScopeTokenElement,
  editorHasVisibleText,
  extractComposerDraftValue,
  getScopeKey,
  hasComposerContent,
  moveCaretToEnd,
  moveCaretToTextNode,
  readComposerNodesFromEditor,
  removeComposerTokenAtCaret,
  renderComposerNodesToEditor,
  stripCaretPlaceholderChars,
  syncComposerTokens
} from './composer/utils'
import WorkbenchSelect from './WorkbenchSelect'
import WorkbenchModelSelector from './WorkbenchModelSelector'
import type { PartnerAvatarColor, PartnerAvatarShape } from '../../../../shared/types'
import { AI_PREFERENCE_OPTIONS, EXECUTION_PERMISSION_OPTIONS } from './selectOptions'
import type { ImageLightboxImage } from './ImageLightbox'
import WorkbenchPlanProgress from './WorkbenchPlanProgress'

type MentionContext = {
  textNode: Text
  caretOffset: number
  triggerIndex: number
  query: string
}

export type DroppedAttachmentItem = { file: File; kind: 'file' | 'directory' }

type WorkbenchComposerProps = {
  partnerName?: string | null
  /** 当前伙伴形象，用于强度滑块的滑块外观。 */
  partnerAvatar?: { shape: PartnerAvatarShape; color: PartnerAvatarColor } | null
  aiPreference: WorkbenchAiPreference
  onAiPreferenceChange: (preference: WorkbenchAiPreference) => void
  executionPermission: WorkbenchExecutionPermission
  onExecutionPermissionChange: (permission: WorkbenchExecutionPermission) => void
  modelConfigs: LLMConfig[]
  modelListsByConfigId: Record<string, LlmRemoteModel[]>
  modelListErrorsByConfigId: Record<string, string>
  modelListsLoading: boolean
  modelSelection: WorkbenchModelSelection
  onModelSelectionChange: (selection: WorkbenchModelSelection) => void
  onRefreshModelLists?: () => void | Promise<void>
  onAddManualModel: (configId: string, modelName: string) => Promise<void>
  onFreeModelsChange?: (models: FreeModelPublicEntry[]) => void
  onDraftChange: (draft: ComposerDraftValue) => void
  onSubmit: () => void
  onCancel: () => void
  onPreviewImage?: (image: ImageLightboxImage) => void
  onPreviewFile?: (file: WorkbenchFileRef) => void
  loading: boolean
  cancelling?: boolean
  canSubmit: boolean
  submitDisabledReason?: string | null
  showCancel: boolean
  draftValue: ComposerDraftValue
  draftKey: string
  contextUsage?: WorkbenchContextUsage | null
  plan?: ChatMessageLogPlanItem[]
  requestAttachmentTarget: () => Promise<{
    partnerId: string
    assetBucketId: string
  } | null>
  onFileDropHandlerReady?: (handler: ((items: DroppedAttachmentItem[]) => void) | null) => void
}

const isTextNode = (value: Node | null): value is Text => value instanceof Text
const CARET_ANCHOR_ROLE = 'composer-caret-anchor'

/** Native deletion can leave one empty BR; user line breaks are inserted as text. */
const markEmptyCaretAnchor = (editor: HTMLElement): boolean => {
  if (
    editorHasVisibleText(editor) ||
    editor.querySelector('[data-role="scope-token"], [data-role="document-selection-token"]')
  )
    return false
  const breaks = editor.querySelectorAll('br')
  if (breaks.length !== 1) return false
  breaks[0].dataset.role = CARET_ANCHOR_ROLE
  return true
}

const WorkbenchComposer: React.FC<WorkbenchComposerProps> = ({
  partnerName,
  partnerAvatar,
  aiPreference,
  onAiPreferenceChange,
  executionPermission,
  onExecutionPermissionChange,
  modelConfigs,
  modelListsByConfigId,
  modelListErrorsByConfigId,
  modelListsLoading,
  modelSelection,
  onModelSelectionChange,
  onRefreshModelLists,
  onAddManualModel,
  onFreeModelsChange,
  onDraftChange,
  onSubmit,
  onCancel,
  onPreviewImage,
  onPreviewFile,
  loading,
  cancelling = false,
  canSubmit,
  submitDisabledReason,
  showCancel,
  draftValue,
  draftKey,
  contextUsage,
  plan = [],
  requestAttachmentTarget,
  onFileDropHandlerReady
}) => {
  const documentSelections = useContext(DocumentSelectionContext)
  const videos = useContext(VideoFeedbackContext)
  const locked = Boolean(documentSelections?.locked)
  const { message } = AntdApp.useApp()
  const editorRef = useRef<HTMLSpanElement | null>(null)
  const draftNodesRef = useRef<ComposerNode[]>([])
  const draftValueRef = useRef<ComposerDraftValue>(draftValue)
  const knownScopesRef = useRef(new Map<string, SelectedReference>())
  const mentionRefreshFrameRef = useRef<number | null>(null)
  const mentionContextRef = useRef<MentionContext | null>(null)
  const controlFocusTimeoutRef = useRef<number | null>(null)
  const compositionGuardTimeoutRef = useRef<number | null>(null)
  const isComposingRef = useRef(false)
  const compositionJustEndedRef = useRef(false)
  const attachmentPreviewUrlsRef = useRef<Record<string, string>>({})
  const [hasContent, setHasContent] = useState(false)
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    draftValueRef.current = draftValue
    setHasContent(hasComposerContent(draftValue.contentNodes))
  }, [draftValue])

  useLayoutEffect(() => {
    if (editorRef.current)
      syncComposerTokens(
        editorRef.current,
        draftValue.contentNodes,
        onPreviewFile
          ? (file) =>
              onPreviewFile({ path: file.absolutePath, fileName: file.name, origin: 'preview' })
          : undefined
      )
  })

  const getInsertedScopeKeys = useCallback((): Set<string> => {
    const editor = editorRef.current
    const currentKeys = new Set<string>()
    if (!editor) return currentKeys
    const draft = extractComposerDraftValue(
      readComposerNodesFromEditor(editor, knownScopesRef.current)
    )
    draft.selectedReferences.forEach((scope) => currentKeys.add(getScopeKey(scope)))
    return currentKeys
  }, [])

  const {
    state: mention,
    getCurrent: getCurrentMention,
    search: searchMention,
    close: closeMention,
    loadMore: loadMoreMentionOptions,
    move: moveMention,
    canSelect: canSelectMention
  } = useReferenceMention(getInsertedScopeKeys)

  const rememberScopes = useCallback((nodes: ComposerNode[]): void => {
    nodes.forEach((node) => {
      if (node.kind === 'scope') {
        knownScopesRef.current.set(getScopeKey(node.scope), node.scope)
      }
    })
  }, [])

  const ensureEditorHasCaretTarget = useCallback((): void => {
    const editor = editorRef.current
    if (!editor) return
    const lastChild = editor.lastChild
    if (isTextNode(lastChild) && !lastChild.data.endsWith('\n')) {
      return
    }
    if (lastChild instanceof HTMLBRElement && lastChild.dataset.role === CARET_ANCHOR_ROLE) {
      return
    }
    if (markEmptyCaretAnchor(editor)) return
    const anchor = document.createElement('br')
    anchor.dataset.role = CARET_ANCHOR_ROLE
    editor.appendChild(anchor)
  }, [])

  const stripCaretPlaceholderFromEditor = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.querySelectorAll(`br[data-role="${CARET_ANCHOR_ROLE}"]`).forEach((anchor) => {
      anchor.remove()
    })
  }, [])

  const moveEditorCaretToEnd = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    ensureEditorHasCaretTarget()
    moveCaretToEnd(editor)
  }, [ensureEditorHasCaretTarget])

  const renderDraftNodes = useCallback(
    (nodes: ComposerNode[], options?: { restoreCaret?: boolean }): void => {
      const editor = editorRef.current
      if (!editor) return
      rememberScopes(nodes)
      draftNodesRef.current = nodes
      renderComposerNodesToEditor(editor, nodes)
      ensureEditorHasCaretTarget()
      setHasContent(hasComposerContent(nodes))
      if (options?.restoreCaret && document.activeElement === editor) {
        moveCaretToEnd(editor)
      }
    },
    [ensureEditorHasCaretTarget, rememberScopes]
  )

  const focusEditorAtEnd = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    moveEditorCaretToEnd()
  }, [moveEditorCaretToEnd])

  const focusEditorAfterControlChange = useCallback(() => {
    if (controlFocusTimeoutRef.current !== null) {
      window.clearTimeout(controlFocusTimeoutRef.current)
    }
    window.requestAnimationFrame(() => {
      controlFocusTimeoutRef.current = window.setTimeout(() => {
        const activeElement = document.activeElement
        if (
          activeElement instanceof HTMLElement &&
          activeElement !== editorRef.current &&
          !editorRef.current?.contains(activeElement)
        ) {
          activeElement.blur()
        }
        focusEditorAtEnd()
        controlFocusTimeoutRef.current = null
      }, 80)
    })
  }, [focusEditorAtEnd])

  const syncDraftFromEditor = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    stripCaretPlaceholderFromEditor()
    markEmptyCaretAnchor(editor)
    const nodes = readComposerNodesFromEditor(editor, knownScopesRef.current)
    // A trailing newline needs a caret anchor; retain native nodes for undo.
    ensureEditorHasCaretTarget()
    if (hasComposerContent(nodes)) {
      // Deleting text can leave the caret in an empty text node or on an element boundary.
      stripCaretPlaceholderChars(editor)
      anchorCaretInTextNode(editor)
    } else {
      clearCaretPlaceholders(editor)
    }
    draftNodesRef.current = nodes
    setHasContent(hasComposerContent(nodes))
    const draft = extractComposerDraftValue(nodes)
    draft.attachments = draftValueRef.current.attachments || []
    rememberScopes(nodes)
    onDraftChange(draft)
  }, [onDraftChange, rememberScopes, stripCaretPlaceholderFromEditor, ensureEditorHasCaretTarget])

  const getMentionContext = useCallback((): MentionContext | null => {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection || !selection.rangeCount || !selection.isCollapsed) return null

    const anchorNode = selection.anchorNode
    let textNode: Text | null = null
    let caretOffset = selection.anchorOffset

    if (isTextNode(anchorNode) && editor.contains(anchorNode)) {
      textNode = anchorNode
    } else if (anchorNode === editor) {
      const previousChild =
        selection.anchorOffset > 0 ? editor.childNodes[selection.anchorOffset - 1] : null
      const nextChild = editor.childNodes[selection.anchorOffset] || null
      if (isTextNode(previousChild)) {
        textNode = previousChild
        caretOffset = previousChild.data.length
      } else if (isTextNode(nextChild)) {
        textNode = nextChild
        caretOffset = 0
      }
    } else if (anchorNode instanceof HTMLElement && editor.contains(anchorNode)) {
      const previousChild = anchorNode.childNodes[Math.max(0, selection.anchorOffset - 1)] || null
      const nextChild = anchorNode.childNodes[selection.anchorOffset] || null
      if (isTextNode(previousChild)) {
        textNode = previousChild
        caretOffset = previousChild.data.length
      } else if (isTextNode(nextChild)) {
        textNode = nextChild
        caretOffset = 0
      }
    }

    if (!textNode) return null

    const beforeCaret = textNode.data.slice(0, caretOffset)
    const triggerIndex = beforeCaret.lastIndexOf('@')
    if (triggerIndex < 0) return null

    const query = beforeCaret.slice(triggerIndex + 1)
    if (/\s/.test(query)) return null

    const previousChar = triggerIndex > 0 ? beforeCaret.charAt(triggerIndex - 1) : ''
    if (previousChar && !/[\s([{,，。；;、]/.test(previousChar)) return null

    return {
      textNode,
      caretOffset,
      triggerIndex,
      query
    }
  }, [])

  const refreshMentionContext = useCallback(() => {
    const context = getMentionContext()
    mentionContextRef.current = context
    if (!context) {
      closeMention()
      return
    }
    searchMention(context.query)
  }, [closeMention, getMentionContext, searchMention])

  const scheduleMentionRefresh = useCallback(() => {
    if (mentionRefreshFrameRef.current !== null) {
      window.cancelAnimationFrame(mentionRefreshFrameRef.current)
    }
    mentionRefreshFrameRef.current = window.requestAnimationFrame(() => {
      mentionRefreshFrameRef.current = null
      refreshMentionContext()
    })
  }, [refreshMentionContext])

  const insertTextAtSelection = useCallback(
    (text: string) => {
      const editor = editorRef.current
      if (!editor) return

      let selection = window.getSelection()
      if (!selection || !selection.rangeCount) {
        focusEditorAtEnd()
        selection = window.getSelection()
      }
      if (!selection || !selection.rangeCount) return

      const range = selection.getRangeAt(0)
      if (!editor.contains(range.commonAncestorContainer)) {
        focusEditorAtEnd()
      }

      const nextSelection = window.getSelection()
      if (!nextSelection || !nextSelection.rangeCount) return
      const nextRange = nextSelection.getRangeAt(0)
      nextRange.deleteContents()
      const startContainer = nextRange.startContainer
      if (isTextNode(startContainer)) {
        const insertOffset = nextRange.startOffset
        startContainer.data = `${startContainer.data.slice(0, insertOffset)}${text}${startContainer.data.slice(insertOffset)}`
        moveCaretToTextNode(startContainer, insertOffset + text.length)
      } else {
        const textNode = document.createTextNode(text)
        nextRange.insertNode(textNode)
        moveCaretToTextNode(textNode, text.length)
      }
      editor.normalize()
      syncDraftFromEditor()
      // Programmatic insertion needs an explicit scroll, including after a trailing newline.
      const caretMarker = document.createElement('span')
      caretMarker.textContent = '\u200b'
      caretMarker.style.cssText = 'display:inline-block;height:1lh;vertical-align:top'
      const caretRange = nextSelection.getRangeAt(0).cloneRange()
      caretRange.insertNode(caretMarker)
      caretMarker.scrollIntoView({ block: 'nearest' })
      caretMarker.remove()
      editor.normalize()
      // Inserting the marker split a text node; never leave the caret on that DOM boundary.
      anchorCaretInTextNode(editor)
      refreshMentionContext()
    },
    [focusEditorAtEnd, refreshMentionContext, syncDraftFromEditor]
  )

  const insertMentionScope = useCallback(
    (scope: SelectedReference) => {
      const editor = editorRef.current
      // A document preview can move the native selection while this menu is open.
      // Insert at the still-valid query that produced the selected candidate.
      const context = getMentionContext() || mentionContextRef.current
      if (
        !editor ||
        !context ||
        !editor.contains(context.textNode) ||
        context.textNode.data.slice(context.triggerIndex, context.caretOffset) !==
          `@${context.query}` ||
        !canSelectMention(context.query)
      )
        return

      knownScopesRef.current.set(getScopeKey(scope), scope)

      const before = context.textNode.data.slice(0, context.triggerIndex)
      const after = context.textNode.data.slice(context.caretOffset)
      const parent = context.textNode.parentNode
      if (!parent) return

      const nodes: Node[] = []
      if (before) {
        nodes.push(document.createTextNode(before))
      }

      nodes.push(createScopeTokenElement(scope))

      const tailText = after.startsWith(' ') || !after ? `${after}` : ` ${after}`
      const trailingTextNode = document.createTextNode(tailText || ' ')
      nodes.push(trailingTextNode)

      nodes.forEach((node) => parent.insertBefore(node, context.textNode))
      parent.removeChild(context.textNode)

      editor.focus({ preventScroll: true })
      moveCaretToTextNode(trailingTextNode, Math.min(1, trailingTextNode.data.length))
      mentionContextRef.current = null
      closeMention()
      syncDraftFromEditor()
    },
    [canSelectMention, closeMention, getMentionContext, syncDraftFromEditor]
  )

  useEffect(() => {
    const nextNodes = createComposerNodesFromDraftValue(draftValueRef.current)
    renderDraftNodes(nextNodes)
    closeMention()
  }, [closeMention, draftKey, renderDraftNodes])

  useEffect(() => {
    const handleSelectionChange = (): void => {
      if (isComposingRef.current) return
      const editor = editorRef.current
      const selection = window.getSelection()
      if (!editor || !selection) return
      if (selection.anchorNode !== editor && !editor.contains(selection.anchorNode)) return
      refreshMentionContext()
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      if (mentionRefreshFrameRef.current !== null) {
        window.cancelAnimationFrame(mentionRefreshFrameRef.current)
      }
      if (controlFocusTimeoutRef.current !== null) {
        window.clearTimeout(controlFocusTimeoutRef.current)
      }
      if (compositionGuardTimeoutRef.current !== null) {
        window.clearTimeout(compositionGuardTimeoutRef.current)
      }
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [refreshMentionContext])

  const handleEditorInput = (): void => {
    if (isComposingRef.current) {
      const editor = editorRef.current
      const hasText = editor ? editorHasVisibleText(editor) : false
      const hasToken = Boolean(
        editor?.querySelector('[data-role="scope-token"], [data-role="document-selection-token"]')
      )
      setHasContent(hasText || hasToken)
      return
    }
    syncDraftFromEditor()
    scheduleMentionRefresh()
  }

  const handleEditorFocus = (): void => {
    ensureEditorHasCaretTarget()
  }

  const updateAttachments = useCallback(
    (nextAttachments: ChatAttachment[]): void => {
      const current = draftValueRef.current
      const nextDraft: ComposerDraftValue = {
        ...current,
        attachments: nextAttachments
      }
      draftValueRef.current = nextDraft
      setHasContent(hasComposerContent(nextDraft.contentNodes))
      onDraftChange(nextDraft)
    },
    [onDraftChange]
  )

  const appendAttachments = useCallback(
    (nextItems: ChatAttachment[], assetBucketId?: string | null): void => {
      if (nextItems.length === 0) return
      const current = draftValueRef.current
      const nextDraft: ComposerDraftValue = {
        ...current,
        assetBucketId: assetBucketId || current.assetBucketId || null,
        attachments: [...(current.attachments || []), ...nextItems]
      }
      draftValueRef.current = nextDraft
      setHasContent(hasComposerContent(nextDraft.contentNodes))
      onDraftChange(nextDraft)
    },
    [onDraftChange]
  )

  const removeAttachment = useCallback(
    (attachmentId: string): void => {
      updateAttachments(
        (draftValueRef.current.attachments || []).filter((item) => item.id !== attachmentId)
      )
    },
    [updateAttachments]
  )

  const handlePickAttachments = useCallback(async (): Promise<void> => {
    const target = await requestAttachmentTarget()
    if (!target) {
      focusEditorAfterControlChange()
      return
    }
    const response = await window.api.attachmentPick(target)
    if (response.error)
      message.warning(
        normalizeUserFacingError(
          response.error,
          t(($) => $.workbench.couldNotSelectAttachments)
        )
      )
    if (!response.canceled) appendAttachments(response.items, target.assetBucketId)
    focusEditorAfterControlChange()
  }, [appendAttachments, focusEditorAfterControlChange, message, requestAttachmentTarget])

  const createClipboardAttachmentFromFile = useCallback(
    async (file: File) => {
      const target = await requestAttachmentTarget()
      if (!target) {
        return null
      }
      const saved = await window.api.attachmentSaveFile({
        partnerId: target.partnerId,
        assetBucketId: target.assetBucketId,
        name: file.name || (file.type.startsWith('image/') ? 'clipboard.png' : 'clipboard-file'),
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
        kind: file.type.startsWith('image/') ? 'image' : 'file'
      })
      if (!saved.success && saved.error) {
        message.warning(saved.error)
      }
      return saved.attachment
        ? { attachment: saved.attachment, assetBucketId: target.assetBucketId }
        : null
    },
    [message, requestAttachmentTarget]
  )

  const createDroppedAttachmentFromFile = useCallback(
    async ({ file }: DroppedAttachmentItem) => {
      const target = await requestAttachmentTarget()
      if (!target) return null
      const sourcePath = window.api.attachmentGetSourcePath(file)
      if (!sourcePath) {
        message.warning(t(($) => $.workbench.couldNotReadTheOriginalPathOfTheDropped))
        return null
      }
      const created = await window.api.attachmentCreateFromPath({
        sourcePath,
        mimeType: file.type
      })
      if (!created.success && created.error) message.warning(created.error)
      return created.attachment
        ? { attachment: created.attachment, assetBucketId: target.assetBucketId }
        : null
    },
    [message, requestAttachmentTarget]
  )

  const handleClipboardFiles = useCallback(
    (files: File[]): void => {
      if (files.length === 0) return
      void Promise.all(files.map(createClipboardAttachmentFromFile)).then((items) => {
        const validItems = items.filter(
          (item): item is { attachment: ChatAttachment; assetBucketId: string } => Boolean(item)
        )
        appendAttachments(
          validItems.map((item) => item.attachment),
          validItems[0]?.assetBucketId || null
        )
      })
    },
    [appendAttachments, createClipboardAttachmentFromFile]
  )

  const handleDroppedAttachments = useCallback(
    (items: DroppedAttachmentItem[]): void => {
      if (items.length === 0) return
      void Promise.all(items.map(createDroppedAttachmentFromFile)).then((created) => {
        const validItems = created.filter(
          (item): item is { attachment: ChatAttachment; assetBucketId: string } => Boolean(item)
        )
        appendAttachments(
          validItems.map((item) => item.attachment),
          validItems[0]?.assetBucketId || null
        )
      })
    },
    [appendAttachments, createDroppedAttachmentFromFile]
  )

  useEffect(() => {
    onFileDropHandlerReady?.(handleDroppedAttachments)
    return () => onFileDropHandlerReady?.(null)
  }, [handleDroppedAttachments, onFileDropHandlerReady])

  const handleEditorPaste = (event: React.ClipboardEvent<HTMLSpanElement>): void => {
    if (locked) {
      event.preventDefault()
      return
    }
    const files = Array.from(event.clipboardData.files || [])
    if (files.length > 0) {
      event.preventDefault()
      handleClipboardFiles(files)
      return
    }
    const pastedText = event.clipboardData.getData('text/plain')
    if (!pastedText) return
    event.preventDefault()
    insertTextAtSelection(pastedText)
  }

  const handleMentionKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (getCurrentMention().query === null) return false
      if (event.isComposing || isComposingRef.current) return false
      // Same native event can reach both the window capture listener and the editor handler.
      if (event.defaultPrevented) return true
      const { options, activeIndex } = getCurrentMention()
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        moveMention(event.key === 'ArrowDown' ? 1 : -1)
        return true
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        const nextOption = options[activeIndex]
        if (nextOption) insertMentionScope(nextOption)
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeMention()
        return true
      }
      return false
    },
    [closeMention, getCurrentMention, insertMentionScope, moveMention]
  )

  useEffect(() => {
    if (mention.query === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      handleMentionKeyDown(event)
    }
    // Capture on window so ArrowDown/Up still move the highlight when focus left the editor
    // (e.g. mention option buttons), which matches the packaged E2E failure mode.
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [handleMentionKeyDown, mention.query])

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (event.nativeEvent.isComposing || isComposingRef.current) return
    if (event.key === 'Enter' && compositionJustEndedRef.current) {
      event.preventDefault()
      return
    }

    if (handleMentionKeyDown(event.nativeEvent)) return

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if ((showCancel || !loading) && canSubmit) onSubmit()
      return
    }

    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      insertTextAtSelection('\n')
      return
    }

    if (event.key !== 'Backspace' && event.key !== 'Delete') return

    const editor = editorRef.current
    if (
      !editor ||
      !removeComposerTokenAtCaret(editor, event.key === 'Backspace' ? 'backward' : 'forward')
    )
      return
    event.preventDefault()
    syncDraftFromEditor()
    ensureEditorHasCaretTarget()
    closeMention()
  }

  // 不钳到 100：超过压缩阈值时（等待 compaction）要能看出已经越线。
  const contextUsagePercent = Math.max(0, Math.round((contextUsage?.ratio || 0) * 100))
  const contextUsageTitle = contextUsage
    ? t(($) => $.workbench.used, { value1: contextUsagePercent })
    : t(($) => $.workbench.contextUsageUnavailable)
  const contextUsageTooltip = contextUsage ? (
    <div className="space-y-1 text-xs leading-5">
      <div className="font-medium text-[var(--notion-text)]">
        {t(($) => $.workbench.contextUsage)}
      </div>
      <div>
        {t(($) => $.workbench.used2)}
        {contextUsagePercent}%
      </div>
      <div className="text-[var(--notion-text-soft)]">
        {contextUsage.usedContextTokens.toLocaleString(getRendererRuntime().locale)} /{' '}
        {contextUsage.contextWindowTokens.toLocaleString(getRendererRuntime().locale)} tokens
      </div>
    </div>
  ) : (
    t(($) => $.workbench.contextUsageUnavailable)
  )
  const currentAttachments = useMemo(() => draftValue.attachments || [], [draftValue.attachments])

  useEffect(() => {
    const imageAttachments = currentAttachments.filter((attachment) => attachment.kind === 'image')
    const imageIds = new Set(imageAttachments.map((attachment) => attachment.id))
    const nextUrls = { ...attachmentPreviewUrlsRef.current }
    let changed = false

    Object.entries(nextUrls).forEach(([attachmentId, url]) => {
      if (imageIds.has(attachmentId)) return
      URL.revokeObjectURL(url)
      delete nextUrls[attachmentId]
      changed = true
    })

    if (changed) {
      attachmentPreviewUrlsRef.current = nextUrls
      setAttachmentPreviewUrls(nextUrls)
    }

    imageAttachments.forEach((attachment) => {
      if (attachmentPreviewUrlsRef.current[attachment.id]) return
      void window.api
        .readFile(attachment.path)
        .then((bytes) => {
          if (attachmentPreviewUrlsRef.current[attachment.id]) return
          const arrayBuffer = new ArrayBuffer(bytes.byteLength)
          new Uint8Array(arrayBuffer).set(bytes)
          const blob = new Blob([arrayBuffer], { type: attachment.mimeType || 'image/png' })
          const url = URL.createObjectURL(blob)
          attachmentPreviewUrlsRef.current = {
            ...attachmentPreviewUrlsRef.current,
            [attachment.id]: url
          }
          setAttachmentPreviewUrls(attachmentPreviewUrlsRef.current)
        })
        .catch(() => {
          // Sending still uses the original file path; preview failure should not block it.
        })
    })
  }, [currentAttachments])

  useEffect(() => {
    return () => {
      Object.values(attachmentPreviewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url))
      attachmentPreviewUrlsRef.current = {}
    }
  }, [])

  const sendingWhileRunning = showCancel && !cancelling && canSubmit
  const stoppingRun = showCancel && !sendingWhileRunning
  const sendButtonDisabled = cancelling || (!showCancel && (loading || !canSubmit))
  const sendButtonTooltip = cancelling
    ? t(($) => $.workbench.stoppingThisRun)
    : !showCancel && loading
      ? t(($) => $.workbench.processingThePreviousRequest)
      : !showCancel && !canSubmit
        ? submitDisabledReason || t(($) => $.workbench.sendingIsCurrentlyUnavailable)
        : ''
  const composerHint =
    !showCancel && !loading && !canSubmit && submitDisabledReason ? sendButtonTooltip : ''

  return (
    <div className="relative" inert={locked || undefined}>
      <WorkbenchPlanProgress plan={plan} running={loading && showCancel && !cancelling} />
      {mention.query !== null ? (
        <ReferenceMentionPanel
          {...mention}
          onSelect={insertMentionScope}
          onLoadMore={loadMoreMentionOptions}
        />
      ) : null}

      <div
        className="nc-floating-composer nc-timeline-layout-anchor px-4 pb-2.5 pt-3 transition-all duration-200"
        data-testid={workbenchSelectors.referenceField}
        onMouseDown={(event) => {
          const target = event.target
          if (!(target instanceof HTMLElement)) return
          if (target.closest('[contenteditable="true"]')) return
          if (target.closest('button') || target.closest('[data-workbench-select-root="true"]')) {
            return
          }
          event.preventDefault()
          focusEditorAtEnd()
        }}
      >
        {currentAttachments.length > 0 ? (
          <div className="mb-1.5 flex max-h-[72px] gap-1.5 overflow-x-auto overflow-y-hidden pb-0.5 pr-0.5">
            {currentAttachments.map((attachment) => (
              <button
                key={attachment.id}
                type="button"
                className={`group relative h-[44px] shrink-0 rounded-[8px] border border-[var(--notion-line-strong)] bg-[var(--notion-page)] text-left shadow-[0_1px_2px_rgba(15,15,15,0.04)] transition hover:border-[var(--notion-line-strong)] ${
                  attachment.kind === 'image'
                    ? 'w-[44px] overflow-hidden p-0'
                    : 'flex w-[200px] items-center gap-1.5 px-1.5 py-1 pr-6'
                }`}
                data-testid={`${workbenchSelectors.attachmentCardPrefix}-${attachment.id}`}
                onClick={() => {
                  if (attachment.kind === 'image') {
                    const src = attachmentPreviewUrls[attachment.id]
                    if (src) onPreviewImage?.({ name: attachment.name, src })
                    return
                  }
                  if (attachment.kind === 'directory') {
                    void window.api.openPath(attachment.path)
                    return
                  }
                  if (isAttachmentDocumentPreviewable(attachment)) {
                    if (onPreviewFile) {
                      onPreviewFile({
                        path: attachment.path,
                        fileName: attachment.name,
                        origin: 'preview'
                      })
                    } else {
                      void window.api.revealPath(attachment.path)
                    }
                    return
                  }
                  void window.api.revealPath(attachment.path)
                }}
                title={attachment.name}
              >
                {attachment.kind === 'image' ? (
                  <span className="flex h-full w-full items-center justify-center bg-[var(--notion-surface)] text-[var(--notion-text-soft)]">
                    {attachmentPreviewUrls[attachment.id] ? (
                      <img
                        src={attachmentPreviewUrls[attachment.id]}
                        alt={attachment.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <HiPhoto className="h-5 w-5" />
                    )}
                  </span>
                ) : attachment.kind === 'directory' ? (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--notion-surface)] text-[var(--notion-text-soft)]">
                    <FileIcon
                      kind="directory"
                      className="h-[21px] w-[21px] text-[var(--notion-text-soft)]"
                    />
                  </span>
                ) : (
                  <AttachmentFileIcon fileName={attachment.name} />
                )}
                {attachment.kind !== 'image' ? (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium leading-5 text-[var(--notion-text)]">
                      {attachment.name}
                    </span>
                  </span>
                ) : null}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={t(($) => $.workbench.removeAttachment)}
                  className="absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-[var(--notion-accent)] text-[var(--notion-accent-contrast)] shadow group-hover:flex"
                  data-testid={`${workbenchSelectors.attachmentRemoveButtonPrefix}-${attachment.id}`}
                  onClick={(event) => {
                    const videoToken =
                      event.target instanceof Element
                        ? event.target.closest<HTMLElement>('[data-role="video-feedback-token"]')
                        : null
                    const feedback = videos?.nodes.find(
                      (node) => node.id === videoToken?.dataset.feedbackId
                    )
                    if (feedback) {
                      videos?.navigate(feedback)
                      return
                    }
                    event.preventDefault()
                    event.stopPropagation()
                    removeAttachment(attachment.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    event.stopPropagation()
                    removeAttachment(attachment.id)
                  }}
                >
                  <HiXMark className="h-2.5 w-2.5" />
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="relative min-h-[46px]">
          <span
            ref={editorRef}
            contentEditable={!locked}
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            tabIndex={0}
            spellCheck={false}
            className="block max-h-[min(240px,30dvh)] min-h-[32px] w-full overflow-x-hidden overflow-y-auto overscroll-y-contain whitespace-pre-wrap break-words bg-transparent text-[15px] leading-6 text-[var(--notion-text)] outline-none [&_[data-role='scope-token']]:align-baseline"
            data-testid={workbenchSelectors.input}
            onClick={(event) => {
              const token =
                event.target instanceof Element
                  ? event.target.closest<HTMLElement>('[data-role="document-selection-token"]')
                  : null
              const node = documentSelections?.selections.find(
                (item) => item.id === token?.dataset.selectionId
              )
              if (node) documentSelections?.navigate(node)
            }}
            onInput={handleEditorInput}
            onKeyDown={handleEditorKeyDown}
            onPaste={handleEditorPaste}
            onFocus={handleEditorFocus}
            onKeyUp={(event) => {
              if (isComposingRef.current) return
              if (
                getCurrentMention().query !== null &&
                (event.key === 'ArrowDown' ||
                  event.key === 'ArrowUp' ||
                  event.key === 'Enter' ||
                  event.key === 'Escape')
              ) {
                return
              }
              scheduleMentionRefresh()
            }}
            onCompositionStart={() => {
              isComposingRef.current = true
              compositionJustEndedRef.current = false
              if (compositionGuardTimeoutRef.current !== null) {
                window.clearTimeout(compositionGuardTimeoutRef.current)
                compositionGuardTimeoutRef.current = null
              }
              if (mentionRefreshFrameRef.current !== null) {
                window.cancelAnimationFrame(mentionRefreshFrameRef.current)
                mentionRefreshFrameRef.current = null
              }
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
              compositionJustEndedRef.current = true
              if (compositionGuardTimeoutRef.current !== null) {
                window.clearTimeout(compositionGuardTimeoutRef.current)
              }
              compositionGuardTimeoutRef.current = window.setTimeout(() => {
                compositionJustEndedRef.current = false
                compositionGuardTimeoutRef.current = null
              }, 120)
              syncDraftFromEditor()
              scheduleMentionRefresh()
            }}
          ></span>

          <div
            className={`pointer-events-none absolute inset-x-0 top-0 text-[15px] leading-6 text-[var(--notion-text-faint)] ${
              hasContent ? 'hidden' : ''
            }`}
          >
            {buildComposerPlaceholder(partnerName)}
          </div>
        </div>

        <div className="mx-[-4px] mt-1.5 flex items-center justify-between gap-2 px-1">
          <div className="flex shrink-0 items-center gap-1.5 text-[var(--notion-text-faint)]">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--notion-text-soft)] transition hover:bg-[var(--notion-surface)] hover:text-[var(--notion-text)]"
              aria-label={t(($) => $.workbench.addAttachment)}
              data-testid={workbenchSelectors.attachmentAddButton}
              onClick={() => void handlePickAttachments()}
            >
              <LuPlus className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>

            <WorkbenchSelect
              value={aiPreference}
              options={AI_PREFERENCE_OPTIONS}
              onChange={(nextValue) => {
                onAiPreferenceChange(nextValue as WorkbenchAiPreference)
                focusEditorAfterControlChange()
              }}
              placeholder={t(($) => $.workbench.preferences)}
              compact
              noDrag
              hideChevron
              triggerClassName="workbench-composer-pill"
              menuClassName="workbench-composer-menu"
              minMenuWidth={220}
              data-testid={workbenchSelectors.aiPreferenceSwitch}
            />
            <WorkbenchSelect
              value={executionPermission}
              options={EXECUTION_PERMISSION_OPTIONS}
              onChange={(nextValue) => {
                onExecutionPermissionChange(nextValue as WorkbenchExecutionPermission)
                focusEditorAfterControlChange()
              }}
              placeholder={t(($) => $.workbench.permissions)}
              compact
              noDrag
              hideChevron
              triggerClassName="workbench-composer-pill"
              menuClassName="workbench-composer-menu"
              minMenuWidth={220}
              showDescriptions
              data-testid={workbenchSelectors.executionPermissionSwitch}
            />
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <UsageRing
              ratio={contextUsage?.ratio ?? null}
              label={contextUsageTitle}
              tooltip={contextUsageTooltip}
              testId={workbenchSelectors.contextRing}
            />

            <WorkbenchModelSelector
              configs={modelConfigs}
              modelListsByConfigId={modelListsByConfigId}
              modelListErrorsByConfigId={modelListErrorsByConfigId}
              modelListsLoading={modelListsLoading}
              value={modelSelection}
              onChange={onModelSelectionChange}
              onAfterChange={focusEditorAfterControlChange}
              onRefreshModelLists={onRefreshModelLists}
              onAddManualModel={onAddManualModel}
              partnerAvatar={partnerAvatar}
              onFreeModelsChange={onFreeModelsChange}
              noDrag
              hideTriggerIcon
              className="workbench-composer-model-select"
              data-testid={workbenchSelectors.modelSelect}
            />

            <Tooltip title={sendButtonDisabled ? sendButtonTooltip : ''}>
              <span className="inline-flex h-7 w-7 shrink-0">
                <button
                  type="button"
                  onClick={stoppingRun ? onCancel : onSubmit}
                  disabled={sendButtonDisabled || locked}
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${
                    showCancel
                      ? cancelling
                        ? 'border-[var(--notion-line-strong)] bg-[var(--notion-surface)] text-[var(--notion-text-faint)]'
                        : stoppingRun
                          ? 'border-[var(--notion-red)] bg-[var(--notion-red)] text-[var(--notion-accent-contrast)] hover:bg-[var(--notion-red)]'
                          : 'border-[var(--notion-accent)] bg-[var(--notion-accent)] text-[var(--notion-accent-contrast)] hover:bg-[var(--notion-accent)]'
                      : sendButtonDisabled
                        ? 'border-[var(--notion-line-strong)] bg-[var(--notion-surface)] text-[var(--notion-text-faint)]'
                        : 'border-[var(--notion-accent)] bg-[var(--notion-accent)] text-[var(--notion-accent-contrast)] hover:bg-[var(--notion-accent)]'
                  }`}
                  data-testid={workbenchSelectors.sendButton}
                  aria-label={
                    cancelling
                      ? t(($) => $.workbench.stoppingThisRun)
                      : stoppingRun
                        ? t(($) => $.workbench.stopThisRun)
                        : t(($) => $.workbench.send)
                  }
                >
                  {cancelling ? (
                    <Spin size="small" />
                  ) : stoppingRun ? (
                    <HiStop className="h-3 w-3" />
                  ) : loading && !sendingWhileRunning ? (
                    <Spin size="small" />
                  ) : (
                    <HiArrowUp className="h-3 w-3" />
                  )}
                </button>
              </span>
            </Tooltip>
          </div>
        </div>
      </div>

      {composerHint ? (
        <div
          className="mt-1 px-1 text-[12px] leading-5 text-[var(--notion-yellow)]"
          data-testid={workbenchSelectors.composerHint}
        >
          {composerHint}
        </div>
      ) : null}
    </div>
  )
}

export default WorkbenchComposer
