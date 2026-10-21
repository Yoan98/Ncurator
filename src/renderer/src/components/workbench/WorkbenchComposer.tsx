import { t, getRendererRuntime } from '../../i18n'
import FileIcon from '../FileIcon'
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
import { HiArrowUp, HiPhoto, HiPlus, HiStop, HiXMark } from 'react-icons/hi2'
import type {
  ChatAttachment,
  LLMConfig,
  LlmRemoteModel,
  ReferenceKind,
  SelectedReference,
  WorkbenchModelSelection
} from '../../../../shared/types'
import { REFERENCE_ITEM_PAGE_SIZE } from '../../../../shared/types'
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
import { buildComposerPlaceholder, COMPOSER_REFERENCE_KINDS } from './composer/constants'
import AttachmentFileIcon from './composer/AttachmentFileIcon'
import { isAttachmentDocumentPreviewable } from './composer/attachmentPresentation'
import ReferenceMentionPanel from './composer/ReferenceMentionPanel'
import type { ComposerDraftValue, ComposerNode } from './composer/types'
import {
  createComposerNodesFromDraftValue,
  createScopeTokenElement,
  extractComposerDraftValue,
  getScopeKey,
  hasComposerContent,
  moveCaretToEnd,
  moveCaretToTextNode,
  readComposerNodesFromEditor,
  removeComposerTokenAtCaret,
  renderComposerNodesToEditor,
  syncComposerTokens
} from './composer/utils'
import WorkbenchSelect from './WorkbenchSelect'
import WorkbenchModelSelector from './WorkbenchModelSelector'
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
  aiPreference: WorkbenchAiPreference
  onAiPreferenceChange: (preference: WorkbenchAiPreference) => void
  executionPermission: WorkbenchExecutionPermission
  onExecutionPermissionChange: (permission: WorkbenchExecutionPermission) => void
  modelConfigs: LLMConfig[]
  modelListsByConfigId: Record<string, LlmRemoteModel[]>
  modelSelection: WorkbenchModelSelection
  onModelSelectionChange: (selection: WorkbenchModelSelection) => void
  onRefreshModelLists?: () => void | Promise<void>
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
    editor.textContent ||
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
  aiPreference,
  onAiPreferenceChange,
  executionPermission,
  onExecutionPermissionChange,
  modelConfigs,
  modelListsByConfigId,
  modelSelection,
  onModelSelectionChange,
  onRefreshModelLists,
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
  const locked = Boolean(documentSelections?.locked)
  const { message } = AntdApp.useApp()
  const editorRef = useRef<HTMLSpanElement | null>(null)
  const draftNodesRef = useRef<ComposerNode[]>([])
  const draftValueRef = useRef<ComposerDraftValue>(draftValue)
  const knownScopesRef = useRef(new Map<string, SelectedReference>())
  const mentionRefreshFrameRef = useRef<number | null>(null)
  const mentionQueryRef = useRef<string | null>(null)
  const mentionSessionSequenceRef = useRef(0)
  const mentionRequestSeqRef = useRef(0)
  const mentionHasMoreRef = useRef(false)
  const mentionLoadingMoreRef = useRef(false)
  const mentionNextOffsetRef = useRef(0)
  const mentionOptionsRef = useRef<SelectedReference[]>([])
  const mentionActiveIndexRef = useRef(0)
  const controlFocusTimeoutRef = useRef<number | null>(null)
  const compositionGuardTimeoutRef = useRef<number | null>(null)
  const isComposingRef = useRef(false)
  const compositionJustEndedRef = useRef(false)
  const attachmentPreviewUrlsRef = useRef<Record<string, string>>({})
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionSessionId, setMentionSessionId] = useState<number | null>(null)
  const [mentionOptions, setMentionOptions] = useState<SelectedReference[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [mentionLoadingMore, setMentionLoadingMore] = useState(false)
  const [mentionHasMore, setMentionHasMore] = useState(false)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [hasContent, setHasContent] = useState(false)
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<Record<string, string>>({})

  mentionOptionsRef.current = mentionOptions
  mentionActiveIndexRef.current = mentionActiveIndex

  useEffect(() => {
    draftValueRef.current = draftValue
    setHasContent(hasComposerContent(draftValue.contentNodes))
  }, [draftValue])

  useLayoutEffect(() => {
    if (editorRef.current) syncComposerTokens(editorRef.current, draftValue.contentNodes)
  })

  const closeMention = useCallback(() => {
    mentionQueryRef.current = null
    setMentionQuery(null)
    setMentionSessionId(null)
    setMentionOptions([])
    mentionOptionsRef.current = []
    setMentionHasMore(false)
    mentionHasMoreRef.current = false
    mentionNextOffsetRef.current = 0
    setMentionLoadingMore(false)
    mentionLoadingMoreRef.current = false
    mentionActiveIndexRef.current = 0
    setMentionActiveIndex(0)
  }, [])

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

  const fetchMentionPage = useCallback(
    async (input: { query: string; offset: number; append: boolean }): Promise<void> => {
      const requestSeq = ++mentionRequestSeqRef.current
      if (input.append) {
        setMentionLoadingMore(true)
        mentionLoadingMoreRef.current = true
      } else {
        setMentionLoading(true)
      }
      try {
        const referenceKinds: ReferenceKind[] = COMPOSER_REFERENCE_KINDS
        const response = await window.api.referenceItemList({
          referenceKinds,
          query: input.query || undefined,
          offset: input.offset,
          limit: REFERENCE_ITEM_PAGE_SIZE
        })
        if (requestSeq !== mentionRequestSeqRef.current) return
        const inserted = getInsertedScopeKeys()
        const pageItems = response.items.filter((scope) => !inserted.has(getScopeKey(scope)))
        pageItems.forEach((scope) => {
          knownScopesRef.current.set(getScopeKey(scope), scope)
        })
        setMentionOptions((current) => {
          const next = input.append ? [...current, ...pageItems] : pageItems
          mentionOptionsRef.current = next
          return next
        })
        setMentionHasMore(Boolean(response.hasMore))
        mentionHasMoreRef.current = Boolean(response.hasMore)
        mentionNextOffsetRef.current = response.offset + response.items.length
        // Keep the user's keyboard selection across late/same-query refetches.
        // Only clamp so a shorter result list cannot leave activeIndex out of range.
        if (!input.append) {
          setMentionActiveIndex((current) => {
            const next = pageItems.length === 0 ? 0 : Math.min(current, pageItems.length - 1)
            mentionActiveIndexRef.current = next
            return next
          })
        }
      } finally {
        if (requestSeq === mentionRequestSeqRef.current) {
          setMentionLoading(false)
          setMentionLoadingMore(false)
          mentionLoadingMoreRef.current = false
        }
      }
    },
    [getInsertedScopeKeys]
  )

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
    if (!context) {
      closeMention()
      return
    }
    if (mentionQueryRef.current === context.query) return
    const isNewMentionSession = mentionQueryRef.current === null
    mentionQueryRef.current = context.query
    setMentionQuery(context.query)
    if (isNewMentionSession) {
      mentionSessionSequenceRef.current += 1
      setMentionOptions([])
      mentionOptionsRef.current = []
      setMentionSessionId(mentionSessionSequenceRef.current)
    }
    mentionActiveIndexRef.current = 0
    setMentionActiveIndex(0)
  }, [closeMention, getMentionContext])

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
      refreshMentionContext()
    },
    [focusEditorAtEnd, refreshMentionContext, syncDraftFromEditor]
  )

  const insertMentionScope = useCallback(
    (scope: SelectedReference) => {
      const editor = editorRef.current
      const context = getMentionContext()
      if (!editor || !context) return

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

      moveCaretToTextNode(trailingTextNode, Math.min(1, trailingTextNode.data.length))
      closeMention()
      syncDraftFromEditor()
    },
    [closeMention, getMentionContext, syncDraftFromEditor]
  )

  useEffect(() => {
    const nextNodes = createComposerNodesFromDraftValue(draftValueRef.current)
    renderDraftNodes(nextNodes)
    closeMention()
  }, [closeMention, draftKey, renderDraftNodes])

  useEffect(() => {
    if (mentionSessionId === null || mentionQuery === null) return
    void fetchMentionPage({
      query: mentionQuery,
      offset: 0,
      append: false
    })
  }, [fetchMentionPage, mentionQuery, mentionSessionId])

  const loadMoreMentionOptions = useCallback(() => {
    if (mentionQuery === null) return
    if (!mentionHasMoreRef.current || mentionLoadingMoreRef.current || mentionLoading) return
    void fetchMentionPage({
      query: mentionQuery,
      offset: mentionNextOffsetRef.current,
      append: true
    })
  }, [fetchMentionPage, mentionLoading, mentionQuery])

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
      const hasText = Boolean(editor?.textContent)
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
      if (mentionQueryRef.current === null) return false
      if (event.isComposing || isComposingRef.current) return false
      // Same native event can reach both the window capture listener and the editor handler.
      if (event.defaultPrevented) return true
      const options = mentionOptionsRef.current
      if (event.key === 'ArrowDown' && options.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        setMentionActiveIndex((current) => {
          const next = (current + 1) % options.length
          mentionActiveIndexRef.current = next
          return next
        })
        return true
      }
      if (event.key === 'ArrowUp' && options.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        setMentionActiveIndex((current) => {
          const next = current === 0 ? options.length - 1 : current - 1
          mentionActiveIndexRef.current = next
          return next
        })
        return true
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        const nextOption = options[mentionActiveIndexRef.current]
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
    [closeMention, insertMentionScope]
  )

  useEffect(() => {
    if (mentionQuery === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      handleMentionKeyDown(event)
    }
    // Capture on window so ArrowDown/Up still move the highlight when focus left the editor
    // (e.g. mention option buttons), which matches the packaged E2E failure mode.
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [handleMentionKeyDown, mentionQuery])

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

  const contextUsagePercent = Math.max(
    0,
    Math.min(100, Math.round((contextUsage?.ratio || 0) * 100))
  )
  const contextUsageVisiblePercent = contextUsage
    ? Math.max(contextUsage.usedContextTokens > 0 ? 1 : 0, contextUsagePercent)
    : 0
  const contextUsageStroke =
    contextUsagePercent >= 90 ? '#B3261E' : contextUsagePercent >= 70 ? '#B26A00' : '#787774'
  const contextUsageTitle = contextUsage
    ? t(($) => $.workbench.used, { value1: contextUsagePercent })
    : t(($) => $.workbench.contextUsageUnavailable)
  const contextUsageTooltip = contextUsage ? (
    <div className="space-y-1 text-xs leading-5">
      <div className="font-medium text-[#37352F]">{t(($) => $.workbench.contextUsage)}</div>
      <div>
        {t(($) => $.workbench.used2)}
        {contextUsagePercent}%
      </div>
      <div className="text-[#787774]">
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
      <WorkbenchPlanProgress plan={plan} />
      {mentionQuery !== null ? (
        <ReferenceMentionPanel
          loading={mentionLoading}
          loadingMore={mentionLoadingMore}
          options={mentionOptions}
          activeIndex={mentionActiveIndex}
          hasMore={mentionHasMore}
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
                className={`group relative h-[44px] shrink-0 rounded-[8px] border border-[#E5E4E0] bg-white text-left shadow-[0_1px_2px_rgba(15,15,15,0.04)] transition hover:border-[#D8D7D3] ${
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
                  <span className="flex h-full w-full items-center justify-center bg-[#F4F4F2] text-[#787774]">
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
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#F4F4F2] text-[#787774]">
                    <FileIcon kind="directory" className="h-[21px] w-[21px] text-[#787774]" />
                  </span>
                ) : (
                  <AttachmentFileIcon fileName={attachment.name} />
                )}
                {attachment.kind !== 'image' ? (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium leading-5 text-[#37352F]">
                      {attachment.name}
                    </span>
                  </span>
                ) : null}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={t(($) => $.workbench.removeAttachment)}
                  className="absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-[#37352F] text-white shadow group-hover:flex"
                  data-testid={`${workbenchSelectors.attachmentRemoveButtonPrefix}-${attachment.id}`}
                  onClick={(event) => {
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
            className="block min-h-[32px] w-full whitespace-pre-wrap break-words bg-transparent text-[15px] leading-6 text-[#37352F] outline-none [&_[data-role='scope-token']]:align-baseline"
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
                mentionQueryRef.current !== null &&
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
            className={`pointer-events-none absolute inset-x-0 top-0 text-[15px] leading-6 text-[#91918E] ${
              hasContent ? 'hidden' : ''
            }`}
          >
            {buildComposerPlaceholder(partnerName)}
          </div>
        </div>

        <div className="mx-[-4px] mt-1.5 flex items-center justify-between gap-2 px-1">
          <div className="flex shrink-0 items-center gap-1.5 text-[#91918E]">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#787774] transition hover:bg-[#F4F4F2] hover:text-[#37352F]"
              aria-label={t(($) => $.workbench.addAttachment)}
              data-testid={workbenchSelectors.attachmentAddButton}
              onClick={() => void handlePickAttachments()}
            >
              <HiPlus className="h-5 w-5" />
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
            <Tooltip title={contextUsageTooltip}>
              <div
                className="workbench-context-ring relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                aria-label={contextUsageTitle}
                data-testid={workbenchSelectors.contextRing}
              >
                <svg className="h-4 w-4 -rotate-90" viewBox="0 0 16 16">
                  <circle
                    className="workbench-context-ring-track"
                    cx="8"
                    cy="8"
                    r="6.5"
                    fill="none"
                    stroke="#E8E7E4"
                    strokeWidth="1.5"
                  />
                  <circle
                    className="workbench-context-ring-progress"
                    cx="8"
                    cy="8"
                    r="6.5"
                    fill="none"
                    stroke={contextUsageStroke}
                    strokeWidth="1.5"
                    strokeDasharray={`${2 * Math.PI * 6.5}`}
                    strokeDashoffset={`${2 * Math.PI * 6.5 * (1 - contextUsageVisiblePercent / 100)}`}
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </Tooltip>

            <WorkbenchModelSelector
              configs={modelConfigs}
              modelListsByConfigId={modelListsByConfigId}
              value={modelSelection}
              onChange={onModelSelectionChange}
              onAfterChange={focusEditorAfterControlChange}
              onRefreshModelLists={onRefreshModelLists}
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
                        ? 'border-[#E5E4E0] bg-[#F4F4F2] text-[#B5B3AD]'
                        : stoppingRun
                          ? 'border-[#B3261E] bg-[#B3261E] text-white hover:bg-[#8F3028]'
                          : 'border-[#37352F] bg-[#37352F] text-white hover:bg-[#2F3437]'
                      : sendButtonDisabled
                        ? 'border-[#E5E4E0] bg-[#F4F4F2] text-[#B5B3AD]'
                        : 'border-[#37352F] bg-[#37352F] text-white hover:bg-[#2F3437]'
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
          className="mt-1 px-1 text-[12px] leading-5 text-[#9B6A1A]"
          data-testid={workbenchSelectors.composerHint}
        >
          {composerHint}
        </div>
      ) : null}
    </div>
  )
}

export default WorkbenchComposer
