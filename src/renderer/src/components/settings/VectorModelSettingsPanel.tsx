import { normalizeUserFacingError } from '../../utils/userFacingError'
import { t } from '../../i18n'
import { useNavigate } from 'react-router-dom'
import EmbeddingIndexNotice from './EmbeddingIndexNotice'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Tag,
  Tooltip,
  message
} from 'antd'
import {
  DEFAULT_EMBEDDING_INPUT_TOKENS,
  MAX_EMBEDDING_INPUT_TOKENS,
  MIN_EMBEDDING_INPUT_TOKENS
} from '../../../../shared/embeddingModels'
import type {
  EmbeddingModelsSnapshot,
  EmbeddingModelMutationResponse,
  RemoteEmbeddingModelInput,
  RemoteEmbeddingModelSummary
} from '../../../../shared/embeddingModels'
import {
  HiCheckCircle,
  HiExclamationCircle,
  HiOutlineQuestionMarkCircle,
  HiPlus,
  HiTrash
} from 'react-icons/hi2'
import { MODEL_SOURCES, type ModelSource } from '../../../../shared/modelSources'
import type {
  ModelInfo,
  DownloadProgressPayload,
  ActiveDownloadSnapshot,
  DownloadStatus
} from './types'
import { vectorSelectors } from '../../testing/selectors'

const modelSourceLabel: Record<ModelSource, string> = {
  modelscope: t(($) => $.preferences.modelScopeMirror),
  'huggingface-mirror': t(($) => $.preferences.huggingFaceMirror),
  huggingface: 'Hugging Face'
}

const TEXT = {
  catalogError: t(($) => $.settings.couldNotLoadTheModelList),
  downloadCompleted: t(($) => $.settings.modelDownloadCompleted),
  activeTaskWarning: t(($) => $.settings.anotherDownloadIsAlreadyRunning),
  startDownloadFailed: t(($) => $.settings.couldNotStartTheDownload),
  downloadFailed: t(($) => $.settings.downloadFailed),
  downloadFailedReason: t(($) => $.settings.downloadFailed2),
  unknownError: t(($) => $.common.unknownError),
  switchSource: t(($) => $.settings.downloadFromAnotherSource),
  switchSourceTitle: t(($) => $.settings.changeDownloadSource),
  switchSourceDescription: t(($) => $.settings.theModelWillBeDownloadedAgainInFullFrom),
  failedSourceTag: t(($) => $.settings.lastFailed),
  switchSourceStart: t(($) => $.settings.startDownload),
  switchSourceCancel: t(($) => $.common.cancel),
  deleteFailed: t(($) => $.settings.couldNotDeleteTheModel),
  deleteFailedPrefix: t(($) => $.common.couldNotDelete),
  deleteCompleted: t(($) => $.settings.modelDeleted),
  deleteConfirmTitle: t(($) => $.settings.deleteThisModel),
  deleteConfirmDescription: t(($) => $.settings.youWillNeedToDownloadItAgainBeforeUse),
  deleteDuringDownloadDescription: t(
    ($) => $.settings.deletingWillCancelTheDownloadAndRemoveDownloadedFiles
  ),
  confirmDelete: t(($) => $.settings.confirmDeletion),
  cancelDelete: t(($) => $.common.cancel),
  installed: t(($) => $.settings.installed),
  delete: t(($) => $.common.delete),
  cancelDownload: t(($) => $.settings.embedding.cancelDownload),
  cancelDownloadTitle: t(($) => $.settings.embedding.cancelDownloadTitle),
  cancelDownloadConfirm: t(($) => $.settings.embedding.cancelDownloadConfirm),
  downloadingLabel: t(($) => $.settings.downloading2),
  download: t(($) => $.common.download),
  fileUnit: t(($) => $.common.file)
} as const

const toErrorMessage = (error: Error | string): string =>
  error instanceof Error ? normalizeUserFacingError(error.message) : String(error)

const isValidMaxInputTokens = (value: number | undefined): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= MIN_EMBEDDING_INPUT_TOKENS &&
  value <= MAX_EMBEDDING_INPUT_TOKENS

function ModelFieldLabel({
  htmlFor,
  label,
  hint,
  helpTestId,
  required = false
}: {
  htmlFor: string
  label: string
  hint?: React.ReactNode
  helpTestId?: string
  required?: boolean
}): React.JSX.Element {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px]">
        {required ? (
          <span className="mr-1 text-[#ff4d4f]" aria-hidden="true">
            *
          </span>
        ) : null}
        {label}
      </label>
      {hint ? (
        <Tooltip title={hint} trigger={['hover', 'focus']} fresh destroyTooltipOnHide>
          <button
            type="button"
            className="inline-flex items-center text-[#9B9A97] transition-colors hover:text-[#37352F]"
            aria-label={t(($) => $.settings.embedding.fieldHelp, { field: label })}
            data-testid={helpTestId}
          >
            <HiOutlineQuestionMarkCircle className="h-4 w-4 cursor-help" aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  )
}

const VectorModelSettingsPanel: React.FC = () => {
  const navigate = useNavigate()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [errorRepoId, setErrorRepoId] = useState<string | null>(null)
  const [failedSource, setFailedSource] = useState<ModelSource | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [currentFile, setCurrentFile] = useState('')
  const [fileProgress, setFileProgress] = useState({ completed: 0, total: 0 })
  const [errorMsg, setErrorMsg] = useState('')
  const [switchSourceRepoId, setSwitchSourceRepoId] = useState<string | null>(null)
  const [switchSourceValue, setSwitchSourceValue] = useState<ModelSource | null>(null)
  const [snapshot, setSnapshot] = useState<EmbeddingModelsSnapshot | null>(null)
  const [snapshotError, setSnapshotError] = useState('')
  const [operationError, setOperationError] = useState('')
  const [pending, setPending] = useState('')
  const pendingRef = useRef(false)
  const snapshotVersion = useRef(0)
  const mounted = useRef(false)
  const [draft, setDraft] = useState<RemoteEmbeddingModelInput | null>(null)
  const [draftError, setDraftError] = useState('')
  const [testResult, setTestResult] = useState('')
  useEffect(() => {
    mounted.current = true
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    // 轮询只更新快照；版本号丢弃修改前发出的旧请求，编辑草稿始终独立保存。
    //
    // Polling only updates snapshots; the version discards reads started before a mutation,
    // while the editor draft remains independent.
    const poll = async (): Promise<void> => {
      const version = snapshotVersion.current
      try {
        if (!pendingRef.current) {
          const next = await window.api.embeddingModelsGet()
          if (!disposed && version === snapshotVersion.current) {
            setSnapshot(next)
            setSnapshotError('')
          }
        }
      } catch (error) {
        if (!disposed && version === snapshotVersion.current) {
          setSnapshotError(
            `${t(($) => $.settings.embedding.loadFailed)} ${toErrorMessage(error instanceof Error ? error : String(error))}`
          )
        }
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(), 2000)
      }
    }
    void poll()
    return () => {
      disposed = true
      mounted.current = false
      clearTimeout(timer)
    }
  }, [])

  const mutate = async (
    key: string,
    action: () => Promise<EmbeddingModelMutationResponse>
  ): Promise<boolean> => {
    if (pendingRef.current) return false
    pendingRef.current = true
    snapshotVersion.current += 1
    setPending(key)
    setOperationError('')
    try {
      const response = await action()
      if (!response.success)
        throw new Error(response.error || t(($) => $.settings.embedding.requestFailed))
      const next = response.snapshot || (await window.api.embeddingModelsGet())
      if (mounted.current) {
        setSnapshot(next)
        setSnapshotError('')
      }
      return true
    } catch (error) {
      if (mounted.current)
        setOperationError(toErrorMessage(error instanceof Error ? error : String(error)))
      return false
    } finally {
      pendingRef.current = false
      if (mounted.current) setPending('')
    }
  }

  const openEditor = (model?: RemoteEmbeddingModelSummary): void => {
    setDraft(
      model
        ? {
            id: model.id,
            name: model.name,
            baseUrl: model.baseUrl,
            modelName: model.modelName,
            maxInputTokens: model.maxInputTokens ?? DEFAULT_EMBEDDING_INPUT_TOKENS,
            apiKey: ''
          }
        : {
            name: '',
            baseUrl: '',
            modelName: '',
            maxInputTokens: DEFAULT_EMBEDDING_INPUT_TOKENS,
            apiKey: ''
          }
    )
    setDraftError('')
    setTestResult('')
    setOperationError('')
  }

  const updateMaxInputTokens = (value: number | null | undefined): void => {
    setDraft((current) => (current ? { ...current, maxInputTokens: value ?? undefined } : null))
    setTestResult('')
    setDraftError('')
  }

  const submitDraft = async (test: boolean): Promise<void> => {
    if (!draft || pendingRef.current) return
    if (
      !draft.name.trim() ||
      !draft.baseUrl.trim() ||
      !draft.modelName.trim() ||
      (!draft.id && !draft.apiKey?.trim())
    ) {
      setDraftError(t(($) => $.settings.embedding.required))
      return
    }
    const maxInputTokens = draft.maxInputTokens ?? DEFAULT_EMBEDDING_INPUT_TOKENS
    if (!isValidMaxInputTokens(maxInputTokens)) {
      setDraftError(
        t(($) => $.settings.embedding.invalidMaxInputTokens, {
          min: MIN_EMBEDDING_INPUT_TOKENS,
          max: MAX_EMBEDDING_INPUT_TOKENS
        })
      )
      return
    }
    const input = {
      ...draft,
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      modelName: draft.modelName.trim(),
      maxInputTokens,
      apiKey: draft.apiKey?.trim() || undefined
    }
    setDraftError('')
    setTestResult('')
    if (!test) {
      const saved = await mutate('save', () => window.api.embeddingModelSave(input))
      if (saved && mounted.current) {
        setDraft(null)
        message.success(
          draft.id === snapshot?.activeModelId
            ? t(($) => $.settings.embedding.savedActive)
            : t(($) => $.settings.embedding.saved)
        )
      }
      return
    }
    pendingRef.current = true
    setPending('test')
    setOperationError('')
    try {
      const response = await window.api.embeddingModelTest(input)
      if (!response.success)
        throw new Error(response.error || t(($) => $.settings.embedding.requestFailed))
      if (mounted.current)
        setTestResult(
          t(($) => $.settings.embedding.testSuccess, { dimension: response.dimension ?? '—' })
        )
    } catch (error) {
      if (mounted.current)
        setDraftError(toErrorMessage(error instanceof Error ? error : String(error)))
    } finally {
      pendingRef.current = false
      if (mounted.current) setPending('')
    }
  }

  const selectedBadge = (id: string): React.ReactNode =>
    snapshot?.activeModelId === id ? (
      <Tag className="!m-0 !border-none !bg-[#F4F4F2] !text-[12px] !font-normal !text-[#787774]">
        {t(($) => $.settings.embedding.current)}
      </Tag>
    ) : null

  const selectButton = (id: string, ready = true): React.ReactNode =>
    !ready || snapshot?.activeModelId === id ? null : (
      <Button
        size="small"
        disabled={!snapshot || Boolean(snapshotError) || Boolean(pending) || snapshot.index.running}
        loading={pending === `select-${id}`}
        onClick={() => void mutate(`select-${id}`, () => window.api.embeddingModelSelect(id))}
        data-testid={`${vectorSelectors.selectButtonPrefix}-${id}`}
      >
        {t(($) => $.settings.embedding.use)}
      </Button>
    )

  const fetchModels = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.api.getModels()
      setModels(list)
      setCatalogError('')
    } catch (error) {
      console.error(error)
      setModels([])
      setCatalogError(TEXT.catalogError)
      message.error(TEXT.catalogError)
    } finally {
      setLoading(false)
    }
  }, [])

  const applyDownloadState = useCallback(
    (
      data: DownloadProgressPayload | ActiveDownloadSnapshot,
      status: DownloadStatus = 'downloading'
    ): void => {
      if (status === 'downloading') {
        setDownloadingId(data.repoId)
        setErrorRepoId(null)
        setFailedSource(null)
        setErrorMsg('')
        setDownloadProgress(data.progress)
        setCurrentFile('currentFile' in data ? data.currentFile : data.file || '')
        setFileProgress({
          completed: data.completedFiles || 0,
          total: data.totalFiles || 0
        })
        return
      }

      if (status === 'completed') {
        setDownloadingId(null)
        setErrorRepoId(null)
        setFailedSource(null)
        setErrorMsg('')
        setDownloadProgress(100)
        void fetchModels()
        message.success(TEXT.downloadCompleted)
        return
      }

      if (status === 'cancelled') {
        setDownloadingId(null)
        setErrorRepoId(null)
        setFailedSource(null)
        setErrorMsg('')
        setDownloadProgress(0)
        setCurrentFile('')
        setFileProgress({ completed: 0, total: 0 })
        void fetchModels()
        return
      }

      const nextError =
        'error' in data
          ? normalizeUserFacingError(data.error, '') || TEXT.unknownError
          : TEXT.unknownError
      setDownloadingId(null)
      setErrorRepoId(data.repoId)
      setFailedSource('failedSource' in data ? (data.failedSource ?? null) : null)
      setErrorMsg(nextError)
      if ('file' in data && data.file) {
        setCurrentFile(data.file)
      }
      message.error(`${TEXT.downloadFailedReason}${nextError}`)
    },
    [fetchModels]
  )

  useEffect(() => {
    let disposed = false

    const handleProgress = (data: DownloadProgressPayload) => {
      if (disposed) return
      applyDownloadState(data, data.status)
    }

    window.api.onDownloadProgress(handleProgress)

    void (async () => {
      try {
        await fetchModels()
        const activeDownload = await window.api.getActiveDownload()
        if (!disposed && activeDownload) applyDownloadState(activeDownload)
      } catch (error) {
        if (!disposed)
          setOperationError(toErrorMessage(error instanceof Error ? error : String(error)))
      }
    })()

    return () => {
      disposed = true
      window.api.removeDownloadProgressListeners()
    }
  }, [applyDownloadState, fetchModels])

  const handleDownload = async (repoId: string, source?: ModelSource): Promise<void> => {
    if (pendingRef.current) return
    if (downloadingId) {
      message.warning(TEXT.activeTaskWarning)
      return
    }

    setDownloadingId(repoId)
    setErrorRepoId(null)
    setFailedSource(null)
    setDownloadProgress(0)
    setCurrentFile('')
    setFileProgress({ completed: 0, total: 0 })
    setErrorMsg('')

    try {
      const response = await window.api.downloadModel(repoId, source)
      if (!response.success) {
        const messageText = normalizeUserFacingError(response.error, '') || TEXT.startDownloadFailed
        setDownloadingId(null)
        setErrorRepoId(repoId)
        setFailedSource((previous) => previous ?? source ?? null)
        setErrorMsg(messageText)
        message.error(`${TEXT.downloadFailedReason}${messageText}`)
      }
    } catch (error) {
      const messageText = toErrorMessage(error instanceof Error ? error : String(error))
      setDownloadingId(null)
      setErrorRepoId(repoId)
      setFailedSource((previous) => previous ?? source ?? null)
      setErrorMsg(messageText)
      message.error(`${TEXT.downloadFailedReason}${messageText}`)
    }
  }

  const handleOpenSwitchSource = (repoId: string): void => {
    const preferred =
      failedSource && MODEL_SOURCES.length > 1
        ? (MODEL_SOURCES.find((source) => source !== failedSource) ?? failedSource)
        : (MODEL_SOURCES[0] ?? null)
    setSwitchSourceValue(preferred)
    setSwitchSourceRepoId(repoId)
  }

  const handleConfirmSwitchSource = async (): Promise<void> => {
    const repoId = switchSourceRepoId
    const source = switchSourceValue
    setSwitchSourceRepoId(null)
    setSwitchSourceValue(null)
    if (repoId && source) {
      await handleDownload(repoId, source)
    }
  }

  const handleDelete = async (repoId: string): Promise<void> => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(`delete-${repoId}`)
    setOperationError('')
    try {
      const response = await window.api.deleteModel(repoId)
      if (!response.success)
        throw new Error(normalizeUserFacingError(response.error, '') || TEXT.deleteFailed)
      if (errorRepoId === repoId) {
        setErrorRepoId(null)
        setErrorMsg('')
        setFailedSource(null)
      }
      message.success(TEXT.deleteCompleted)
      await fetchModels()
    } catch (error) {
      setOperationError(toErrorMessage(error instanceof Error ? error : String(error)))
    } finally {
      pendingRef.current = false
      if (mounted.current) setPending('')
    }
  }

  const index = snapshot?.index
  const restoreRemote = snapshot?.remoteModels.find((model) => model.id === index?.restoreModelId)
  const restoreLocal = models.find(
    (model) => `local:${model.id}` === index?.restoreModelId && model.isDownloaded
  )
  const restoreName = restoreRemote?.name || restoreLocal?.name

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto"
      data-testid={vectorSelectors.page}
    >
      {snapshotError || operationError ? (
        <div
          role="alert"
          className="nc-notice nc-notice-danger shrink-0 break-words"
          data-testid={vectorSelectors.modelError}
        >
          {snapshotError}
          {snapshotError && operationError ? ' · ' : ''}
          {operationError}
        </div>
      ) : null}
      {index?.running ? (
        <p className="shrink-0 text-[12px] text-[#787774]">
          {t(($) => $.settings.embedding.indexingGuard)}
        </p>
      ) : null}
      {index ? (
        <EmbeddingIndexNotice
          index={index}
          onNavigate={() =>
            navigate(
              `/settings/workspace?source=${index.staleFileCount > 0 ? 'files' : 'web'}&focus=index`
            )
          }
          restoreName={restoreName}
          onRestore={
            restoreName && index.restoreModelId
              ? () => {
                  void mutate(`select-${index.restoreModelId}`, () =>
                    window.api.embeddingModelSelect(index.restoreModelId!)
                  )
                }
              : undefined
          }
          disabled={Boolean(pending) || Boolean(snapshotError)}
        />
      ) : null}
      <section className="nc-settings-panel shrink-0 overflow-hidden">
        <div className="nc-settings-panel-toolbar">
          <h2>{t(($) => $.settings.embedding.localModels)}</h2>
        </div>
        <div>
          {catalogError ? (
            <div
              className="nc-notice nc-notice-danger m-4"
              data-testid={vectorSelectors.catalogError}
            >
              {catalogError}
            </div>
          ) : null}
          <List
            loading={loading}
            dataSource={models}
            className="[&_.ant-list-item]:!border-[#EEEEEC]"
            data-testid={vectorSelectors.list}
            renderItem={(item) => {
              const id = `local:${item.id}`
              const isSelected = snapshot?.activeModelId === id
              const isDownloading = downloadingId === item.id
              const hasError = Boolean(errorMsg && errorRepoId === item.id)
              const deleteDisabled =
                Boolean(pending) || Boolean(snapshot?.index.running && isSelected)
              return (
                <List.Item
                  className="!block !px-5 !py-5"
                  data-testid={`${vectorSelectors.cardPrefix}-${item.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <div
                        className="flex min-h-8 flex-wrap items-center gap-2 text-[14px] font-medium text-[#37352F]"
                        data-testid={isSelected ? vectorSelectors.activeModel : undefined}
                      >
                        <span>{item.name}</span>
                        {selectedBadge(id)}
                      </div>
                      <p className="mt-1 text-[13px] leading-5 text-[#787774]">
                        {item.description}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[#787774]">
                        {item.tags.length ? <span>{item.tags.join(' · ')}</span> : null}
                        {item.isDownloaded ? (
                          <>
                            {item.tags.length ? <span aria-hidden="true">·</span> : null}
                            <span
                              className="inline-flex items-center gap-1 text-[#2F6F4E]"
                              data-testid={`${vectorSelectors.installedBadgePrefix}-${item.id}`}
                            >
                              <HiCheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              {TEXT.installed}
                            </span>
                          </>
                        ) : !isDownloading && !hasError ? (
                          <>
                            {item.tags.length ? <span aria-hidden="true">·</span> : null}
                            <span>{t(($) => $.settings.embedding.notDownloaded)}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {selectButton(id, item.isDownloaded)}
                      {item.isDownloaded || isDownloading ? (
                        <Popconfirm
                          title={isDownloading ? TEXT.cancelDownloadTitle : TEXT.deleteConfirmTitle}
                          description={
                            isDownloading
                              ? TEXT.deleteDuringDownloadDescription
                              : TEXT.deleteConfirmDescription
                          }
                          okText={isDownloading ? TEXT.cancelDownloadConfirm : TEXT.confirmDelete}
                          cancelText={TEXT.cancelDelete}
                          onConfirm={() => handleDelete(item.id)}
                          disabled={deleteDisabled}
                          okButtonProps={{
                            'data-testid': `${vectorSelectors.deleteConfirmButtonPrefix}-${item.id}`
                          }}
                          cancelButtonProps={{
                            'data-testid': `${vectorSelectors.deleteCancelButtonPrefix}-${item.id}`
                          }}
                        >
                          <Button
                            size="small"
                            type={isDownloading ? 'default' : 'text'}
                            danger={!isDownloading}
                            disabled={deleteDisabled}
                            loading={pending === `delete-${item.id}`}
                            icon={
                              isDownloading ? undefined : (
                                <HiTrash className="h-4 w-4" aria-hidden="true" />
                              )
                            }
                            data-testid={`${vectorSelectors.deleteButtonPrefix}-${item.id}`}
                          >
                            {isDownloading ? TEXT.cancelDownload : TEXT.delete}
                          </Button>
                        </Popconfirm>
                      ) : hasError ? (
                        <Button
                          size="small"
                          onClick={() => handleOpenSwitchSource(item.id)}
                          disabled={Boolean(pending) || Boolean(downloadingId)}
                          data-testid={`${vectorSelectors.switchSourceButtonPrefix}-${item.id}`}
                        >
                          {TEXT.switchSource}
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => void handleDownload(item.id)}
                          disabled={Boolean(downloadingId) || Boolean(pending)}
                          data-testid={`${vectorSelectors.downloadButtonPrefix}-${item.id}`}
                        >
                          {TEXT.download}
                        </Button>
                      )}
                    </div>
                  </div>
                  {isDownloading ? (
                    <div
                      className="mt-5"
                      data-testid={`${vectorSelectors.progressPrefix}-${item.id}`}
                    >
                      <div className="flex justify-between gap-3 text-[13px] text-[#37352F]">
                        <span>{TEXT.downloadingLabel}</span>
                        <span className="tabular-nums">{downloadProgress}%</span>
                      </div>
                      <Progress
                        percent={downloadProgress}
                        strokeColor="#37352F"
                        strokeWidth={4}
                        showInfo={false}
                        className="!my-2"
                      />
                      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12px] text-[#91918E]">
                        <span
                          className="min-w-0 flex-1 break-all"
                          data-testid={`${vectorSelectors.currentFilePrefix}-${item.id}`}
                        >
                          {currentFile}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {fileProgress.completed}/{fileProgress.total} {TEXT.fileUnit}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  {hasError ? (
                    <div
                      className="mt-4 flex items-start gap-2 text-[13px] text-[#B3261E]"
                      data-testid={`${vectorSelectors.errorPrefix}-${item.id}`}
                    >
                      <HiExclamationCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 break-words">
                        {TEXT.downloadFailed} · {errorMsg}
                      </span>
                    </div>
                  ) : null}
                </List.Item>
              )
            }}
          />
        </div>
      </section>

      <section className="nc-settings-panel shrink-0 overflow-hidden">
        <div className="nc-settings-panel-toolbar">
          <div className="flex flex-wrap items-center gap-3">
            <h2>{t(($) => $.settings.embedding.remoteModels)}</h2>
            <span className="text-[12px] text-[#787774]">
              {t(($) => $.settings.serviceConnectionCount, {
                count: snapshot?.remoteModels.length ?? 0
              })}
            </span>
          </div>
          <Button
            type="primary"
            icon={<HiPlus className="h-4 w-4" aria-hidden="true" />}
            className="border-none !bg-[#37352F] shadow-none hover:!bg-[#2F3437]"
            disabled={!snapshot || Boolean(snapshotError) || Boolean(pending)}
            onClick={() => openEditor()}
            data-testid={vectorSelectors.remoteAddButton}
          >
            {t(($) => $.settings.addConfiguration)}
          </Button>
        </div>
        <div data-testid={vectorSelectors.remoteList}>
          {snapshot?.remoteModels.length ? (
            snapshot.remoteModels.map((model) => (
              <div
                key={model.id}
                className="nc-list-row flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-5"
                data-testid={`${vectorSelectors.remoteCardPrefix}-${model.id}`}
              >
                <div className="min-w-0 flex-1 basis-48">
                  <div
                    className="flex min-h-8 flex-wrap items-center gap-2 break-words text-[14px] font-medium"
                    data-testid={
                      snapshot.activeModelId === model.id ? vectorSelectors.activeModel : undefined
                    }
                  >
                    <span>{model.name}</span>
                    {selectedBadge(model.id)}
                  </div>
                  <div className="mt-1 break-all text-[12px] text-[#787774]">
                    {model.modelName} · {model.baseUrl}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectButton(model.id)}
                  <Button
                    size="small"
                    disabled={
                      Boolean(pending) ||
                      Boolean(snapshotError) ||
                      Boolean(snapshot.index.running && snapshot.activeModelId === model.id)
                    }
                    onClick={() => openEditor(model)}
                    data-testid={`${vectorSelectors.remoteEditButtonPrefix}-${model.id}`}
                  >
                    {t(($) => $.common.edit)}
                  </Button>
                  <Tooltip
                    title={
                      snapshot.activeModelId === model.id
                        ? t(($) => $.settings.embedding.switchBeforeDelete)
                        : undefined
                    }
                  >
                    <span>
                      <Popconfirm
                        title={t(($) => $.settings.embedding.deleteTitle)}
                        disabled={
                          Boolean(pending) ||
                          Boolean(snapshotError) ||
                          snapshot.activeModelId === model.id
                        }
                        onConfirm={() =>
                          mutate(`delete-${model.id}`, () =>
                            window.api.embeddingModelDelete(model.id)
                          )
                        }
                        okText={t(($) => $.common.delete)}
                        cancelText={t(($) => $.common.cancel)}
                        okButtonProps={{
                          'data-testid': `${vectorSelectors.remoteDeleteConfirmButtonPrefix}-${model.id}`
                        }}
                      >
                        <Button
                          size="small"
                          danger
                          disabled={
                            Boolean(pending) ||
                            Boolean(snapshotError) ||
                            snapshot.activeModelId === model.id
                          }
                          data-testid={`${vectorSelectors.remoteDeleteButtonPrefix}-${model.id}`}
                        >
                          {t(($) => $.common.delete)}
                        </Button>
                      </Popconfirm>
                    </span>
                  </Tooltip>
                </div>
              </div>
            ))
          ) : (
            <p className="px-4 py-4 text-[13px] text-[#787774]">
              {snapshot
                ? t(($) => $.settings.embedding.noRemote)
                : t(($) => $.settings.checkingVectorModelStatus)}
            </p>
          )}
        </div>
      </section>

      <Modal
        title={
          draft?.id ? t(($) => $.settings.editConfiguration) : t(($) => $.settings.addConfiguration)
        }
        open={Boolean(draft)}
        maskClosable={false}
        closable={!pending}
        keyboard={!pending}
        onCancel={() => {
          if (!pendingRef.current) setDraft(null)
        }}
        footer={null}
        data-testid={vectorSelectors.remoteModal}
      >
        {draft ? (
          <form
            className="space-y-4 pt-2"
            onSubmit={(event) => {
              event.preventDefault()
              void submitDraft(false)
            }}
          >
            {(
              [
                [
                  'name',
                  t(($) => $.settings.embedding.name),
                  vectorSelectors.remoteNameInput,
                  t(($) => $.settings.embedding.namePlaceholder)
                ],
                [
                  'baseUrl',
                  t(($) => $.settings.embedding.baseUrl),
                  vectorSelectors.remoteBaseUrlInput,
                  t(($) => $.settings.embedding.baseUrlPlaceholder)
                ],
                [
                  'modelName',
                  t(($) => $.settings.embedding.modelName),
                  vectorSelectors.remoteModelNameInput,
                  t(($) => $.settings.embedding.modelNamePlaceholder)
                ]
              ] as const
            ).map(([field, label, testId, placeholder]) => (
              <div key={field}>
                <ModelFieldLabel htmlFor={`embedding-${field}`} label={label} required />
                <Input
                  id={`embedding-${field}`}
                  value={draft[field]}
                  placeholder={placeholder}
                  aria-required="true"
                  disabled={
                    Boolean(pending) ||
                    Boolean(snapshot?.index.running && snapshot.activeModelId === draft.id)
                  }
                  autoFocus={field === 'name'}
                  autoComplete="off"
                  onChange={(event) => {
                    setDraft({ ...draft, [field]: event.target.value })
                    setTestResult('')
                    setDraftError('')
                  }}
                  data-testid={testId}
                />
              </div>
            ))}
            <div>
              <ModelFieldLabel
                htmlFor="embedding-maxInputTokens"
                label={t(($) => $.settings.embedding.maxInputTokens)}
                helpTestId={vectorSelectors.remoteMaxInputTokensHelp}
                hint={t(($) => $.settings.embedding.maxInputTokensHint)}
              />
              <InputNumber<number>
                id="embedding-maxInputTokens"
                className="!w-full"
                value={draft.maxInputTokens ?? null}
                disabled={
                  Boolean(pending) ||
                  Boolean(snapshot?.index.running && snapshot.activeModelId === draft.id)
                }
                step={1}
                inputMode="numeric"
                placeholder={t(($) => $.settings.embedding.defaultInputTokens, {
                  tokens: DEFAULT_EMBEDDING_INPUT_TOKENS
                })}
                aria-valuemin={MIN_EMBEDDING_INPUT_TOKENS}
                aria-valuemax={MAX_EMBEDDING_INPUT_TOKENS}
                onChange={updateMaxInputTokens}
                onInput={(value) => updateMaxInputTokens(value.trim() ? Number(value) : undefined)}
                data-testid={vectorSelectors.remoteMaxInputTokensInput}
              />
            </div>
            <div>
              <ModelFieldLabel
                htmlFor="embedding-apiKey"
                label={t(($) => $.settings.embedding.apiKey)}
                required={!draft.id}
              />
              <Input.Password
                id="embedding-apiKey"
                value={draft.apiKey || ''}
                aria-required={!draft.id}
                placeholder={
                  draft.id
                    ? t(($) => $.settings.embedding.apiKeyEditPlaceholder)
                    : t(($) => $.settings.embedding.apiKeyPlaceholder)
                }
                disabled={
                  Boolean(pending) ||
                  Boolean(snapshot?.index.running && snapshot.activeModelId === draft.id)
                }
                autoComplete="new-password"
                onChange={(event) => {
                  setDraft({ ...draft, apiKey: event.target.value })
                  setTestResult('')
                  setDraftError('')
                }}
                data-testid={vectorSelectors.remoteApiKeyInput}
              />
            </div>
            {draftError || operationError || testResult ? (
              <div
                role={draftError || operationError ? 'alert' : 'status'}
                className={`break-words text-[13px] ${draftError || operationError ? 'text-[#B3261E]' : 'text-[#2F6F4E]'}`}
                data-testid={vectorSelectors.remoteFeedback}
              >
                {draftError || operationError || testResult}
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                disabled={
                  Boolean(pending) ||
                  Boolean(snapshot?.index.running && snapshot.activeModelId === draft.id)
                }
                loading={pending === 'test'}
                onClick={() => void submitDraft(true)}
                data-testid={vectorSelectors.remoteTestButton}
              >
                {t(($) => $.settings.embedding.test)}
              </Button>
              <Button
                disabled={
                  Boolean(pending) ||
                  Boolean(snapshot?.index.running && snapshot.activeModelId === draft.id)
                }
                onClick={() => setDraft(null)}
                data-testid={vectorSelectors.remoteCancelButton}
              >
                {t(($) => $.common.cancel)}
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                disabled={
                  Boolean(pending) ||
                  Boolean(snapshot?.index.running && snapshot.activeModelId === draft.id)
                }
                loading={pending === 'save'}
                data-testid={vectorSelectors.remoteSaveButton}
              >
                {t(($) => $.common.save)}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        title={TEXT.switchSourceTitle}
        open={Boolean(switchSourceRepoId)}
        maskClosable={false}
        onCancel={() => {
          setSwitchSourceRepoId(null)
          setSwitchSourceValue(null)
        }}
        onOk={() => void handleConfirmSwitchSource()}
        okText={TEXT.switchSourceStart}
        cancelText={TEXT.switchSourceCancel}
        okButtonProps={{ 'data-testid': vectorSelectors.sourceConfirmButton }}
        cancelButtonProps={{ 'data-testid': vectorSelectors.sourceCancelButton }}
        className="[&_.ant-modal-content]:!rounded-[8px]"
      >
        <div data-testid={vectorSelectors.sourceModal}>
          <p className="mb-3 text-[#787774]">{TEXT.switchSourceDescription}</p>
          <Radio.Group
            value={switchSourceValue}
            onChange={(event) => setSwitchSourceValue(event.target.value as ModelSource)}
            className="flex flex-col gap-2"
          >
            {MODEL_SOURCES.map((source) => (
              <Radio
                key={source}
                value={source}
                className="!flex items-center gap-1"
                data-testid={`${vectorSelectors.sourceRadioPrefix}-${source}`}
              >
                <span>{modelSourceLabel[source]}</span>
                {failedSource === source ? (
                  <Tag
                    color="orange"
                    className="ml-1 !text-xs"
                    data-testid={`${vectorSelectors.failedSourceTagPrefix}-${source}`}
                  >
                    {TEXT.failedSourceTag}
                  </Tag>
                ) : null}
              </Radio>
            ))}
          </Radio.Group>
        </div>
      </Modal>
    </div>
  )
}

export default VectorModelSettingsPanel
