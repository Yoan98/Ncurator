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
  embeddingInputBudget,
  MAX_EMBEDDING_INPUT_TOKENS,
  MIN_EMBEDDING_INPUT_TOKENS
} from '../../../../shared/embeddingModels'
import type {
  EmbeddingModelsSnapshot,
  EmbeddingModelMutationResponse,
  RemoteEmbeddingModelInput,
  RemoteEmbeddingModelSummary
} from '../../../../shared/embeddingModels'
import { HiCheckCircle, HiExclamationCircle, HiTrash } from 'react-icons/hi2'
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
  downloading: t(($) => $.settings.downloading),
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
  const draftMaxInputTokens = draft?.maxInputTokens ?? DEFAULT_EMBEDDING_INPUT_TOKENS
  const draftBudget =
    draft && isValidMaxInputTokens(draftMaxInputTokens)
      ? embeddingInputBudget(draftMaxInputTokens)
      : null

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
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.modelName.trim()) {
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

  const selectButton = (id: string, ready = true): React.ReactNode =>
    snapshot?.activeModelId === id ? (
      <Tag key={`select-${id}`} className="!m-0">
        {t(($) => $.settings.embedding.current)}
      </Tag>
    ) : (
      <Button
        key={`select-${id}`}
        size="small"
        disabled={
          !ready ||
          !snapshot ||
          Boolean(snapshotError) ||
          Boolean(pending) ||
          snapshot.index.running
        }
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

  const activeRemote = snapshot?.remoteModels.find((model) => model.id === snapshot.activeModelId)
  const activeLocal = models.find((model) => `local:${model.id}` === snapshot?.activeModelId)
  const activeLabel = activeRemote
    ? t(($) => $.settings.embedding.selectedRemote, { name: activeRemote.name })
    : activeLocal
      ? activeLocal.isDownloaded
        ? t(($) => $.settings.embedding.selectedLocal, { name: activeLocal.name })
        : t(($) => $.settings.embedding.selectedLocalMissing, { name: activeLocal.name })
      : snapshot
        ? t(($) => $.settings.embedding.selectionMissing)
        : t(($) => $.settings.checkingVectorModelStatus)
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
      <section className="nc-settings-panel shrink-0 p-4">
        <div
          className="break-words text-[14px] font-medium"
          data-testid={vectorSelectors.activeModel}
        >
          {activeLabel}
        </div>
        {snapshotError || operationError ? (
          <div
            role="alert"
            className="nc-notice nc-notice-danger mt-3 break-words"
            data-testid={vectorSelectors.modelError}
          >
            {snapshotError}
            {snapshotError && operationError ? ' · ' : ''}
            {operationError}
          </div>
        ) : null}
        {index?.running ? (
          <p className="mt-2 text-[12px] text-[#787774]">
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
      </section>
      <section className="nc-settings-panel flex shrink-0 flex-col overflow-hidden">
        <div className="nc-settings-panel-toolbar shrink-0">
          <h2>{t(($) => $.settings.embedding.localModels)}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-auto [&_.ant-list-item]:!border-[#EEEEEC] [&_.ant-list-item]:transition-colors [&_.ant-list-item:hover]:!bg-[#F7F7F5]">
          {catalogError ? (
            <div
              className="nc-notice nc-notice-danger my-3"
              data-testid={vectorSelectors.catalogError}
            >
              {catalogError}
            </div>
          ) : null}

          <List
            loading={loading}
            itemLayout="horizontal"
            dataSource={models}
            className="nc-settings-vector-list [&_.ant-list-item]:!flex-wrap [&_.ant-list-item-action]:!ml-0 [&_.ant-list-item-action]:!flex [&_.ant-list-item-action]:!flex-wrap [&_.ant-list-item-action]:!gap-2 [&_.ant-list-item-meta]:!min-w-[min(100%,260px)]"
            data-testid={vectorSelectors.list}
            renderItem={(item) => (
              <List.Item
                data-testid={`${vectorSelectors.cardPrefix}-${item.id}`}
                actions={[
                  selectButton(`local:${item.id}`, item.isDownloaded),
                  ...(item.isDownloaded
                    ? [
                        <div
                          key={`installed-${item.id}`}
                          className="flex items-center gap-2 font-medium text-[#2F6F4E]"
                          data-testid={`${vectorSelectors.installedBadgePrefix}-${item.id}`}
                        >
                          <HiCheckCircle className="text-lg" />
                          <span>{TEXT.installed}</span>
                        </div>,
                        <Popconfirm
                          key={`delete-confirm-${item.id}`}
                          title={TEXT.deleteConfirmTitle}
                          description={TEXT.deleteConfirmDescription}
                          okText={TEXT.confirmDelete}
                          cancelText={TEXT.cancelDelete}
                          onConfirm={() => handleDelete(item.id)}
                          disabled={
                            Boolean(pending) ||
                            Boolean(
                              snapshot?.index.running &&
                              snapshot.activeModelId === `local:${item.id}`
                            )
                          }
                          okButtonProps={{
                            'data-testid': `${vectorSelectors.deleteConfirmButtonPrefix}-${item.id}`
                          }}
                          cancelButtonProps={{
                            'data-testid': `${vectorSelectors.deleteCancelButtonPrefix}-${item.id}`
                          }}
                        >
                          <Button
                            type="text"
                            danger
                            disabled={
                              Boolean(pending) ||
                              Boolean(
                                snapshot?.index.running &&
                                snapshot.activeModelId === `local:${item.id}`
                              )
                            }
                            icon={<HiTrash className="h-4 w-4" />}
                            aria-label={TEXT.delete}
                            data-testid={`${vectorSelectors.deleteButtonPrefix}-${item.id}`}
                          />
                        </Popconfirm>
                      ]
                    : downloadingId === item.id
                      ? [
                          <Button key={`downloading-${item.id}`} disabled loading>
                            {TEXT.downloading}
                          </Button>,
                          <Popconfirm
                            key={`delete-confirm-${item.id}`}
                            title={TEXT.deleteConfirmTitle}
                            description={TEXT.deleteDuringDownloadDescription}
                            okText={TEXT.confirmDelete}
                            cancelText={TEXT.cancelDelete}
                            onConfirm={() => handleDelete(item.id)}
                            disabled={
                              Boolean(pending) ||
                              Boolean(
                                snapshot?.index.running &&
                                snapshot.activeModelId === `local:${item.id}`
                              )
                            }
                            okButtonProps={{
                              'data-testid': `${vectorSelectors.deleteConfirmButtonPrefix}-${item.id}`
                            }}
                            cancelButtonProps={{
                              'data-testid': `${vectorSelectors.deleteCancelButtonPrefix}-${item.id}`
                            }}
                          >
                            <Button
                              type="text"
                              danger
                              disabled={
                                Boolean(pending) ||
                                Boolean(
                                  snapshot?.index.running &&
                                  snapshot.activeModelId === `local:${item.id}`
                                )
                              }
                              icon={<HiTrash className="h-4 w-4" />}
                              aria-label={TEXT.delete}
                              data-testid={`${vectorSelectors.deleteButtonPrefix}-${item.id}`}
                            />
                          </Popconfirm>
                        ]
                      : [
                          <Button
                            key={`download-${item.id}`}
                            type="primary"
                            onClick={() => void handleDownload(item.id)}
                            className="!border-none !bg-[#37352F] shadow-none hover:!bg-[#2F3437]"
                            disabled={Boolean(downloadingId) || Boolean(pending)}
                            data-testid={`${vectorSelectors.downloadButtonPrefix}-${item.id}`}
                          >
                            {TEXT.download}
                          </Button>
                        ])
                ]}
              >
                <List.Item.Meta
                  title={
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium text-[#37352F]">{item.name}</span>
                      {item.tags.map((tag) => (
                        <Tag key={tag} className="mr-0 text-xs">
                          {tag}
                        </Tag>
                      ))}
                    </div>
                  }
                  description={
                    <div className="space-y-4">
                      <p className="text-[13px] leading-5 text-[#787774]">{item.description}</p>

                      {downloadingId === item.id ? (
                        <div
                          className="rounded-[8px] border border-[#EEEEEC] bg-[#FFFFFF] p-4"
                          data-testid={`${vectorSelectors.progressPrefix}-${item.id}`}
                        >
                          <div className="mb-2 flex justify-between text-sm">
                            <span className="font-medium text-[#37352F]">
                              {TEXT.downloadingLabel}
                            </span>
                            <span className="font-medium text-[#37352F]">{downloadProgress}%</span>
                          </div>
                          <Progress
                            percent={downloadProgress}
                            strokeColor="#37352F"
                            showInfo={false}
                            className="!mb-2"
                          />
                          <div className="flex justify-between text-xs text-[#9B9A97]">
                            <span
                              className="max-w-[200px] truncate"
                              data-testid={`${vectorSelectors.currentFilePrefix}-${item.id}`}
                            >
                              {currentFile}
                            </span>
                            <span>
                              {fileProgress.completed}/{fileProgress.total} {TEXT.fileUnit}
                            </span>
                          </div>
                        </div>
                      ) : null}

                      {errorMsg && errorRepoId === item.id ? (
                        <div
                          className="flex flex-wrap items-center gap-2 text-sm text-[#B3261E]"
                          data-testid={`${vectorSelectors.errorPrefix}-${item.id}`}
                        >
                          <HiExclamationCircle />
                          <span className="font-medium">{TEXT.downloadFailed}</span>
                          <span className="break-words">{errorMsg}</span>
                          <Button
                            type="link"
                            size="small"
                            className="!h-auto !p-0 !text-[#37352F]"
                            onClick={() => handleOpenSwitchSource(item.id)}
                            disabled={Boolean(pending) || Boolean(downloadingId)}
                            data-testid={`${vectorSelectors.switchSourceButtonPrefix}-${item.id}`}
                          >
                            {TEXT.switchSource}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        </div>
      </section>

      <section className="nc-settings-panel shrink-0 overflow-hidden">
        <div className="nc-settings-panel-toolbar flex flex-wrap items-center justify-between gap-2">
          <h2>{t(($) => $.settings.embedding.remoteModels)}</h2>
          <Button
            size="small"
            disabled={!snapshot || Boolean(snapshotError) || Boolean(pending)}
            onClick={() => openEditor()}
            data-testid={vectorSelectors.remoteAddButton}
          >
            {t(($) => $.settings.embedding.addRemote)}
          </Button>
        </div>
        <div data-testid={vectorSelectors.remoteList}>
          {snapshot?.remoteModels.length ? (
            snapshot.remoteModels.map((model) => (
              <div
                key={model.id}
                className="nc-list-row flex flex-wrap items-center justify-between gap-3 px-4 py-4"
                data-testid={`${vectorSelectors.remoteCardPrefix}-${model.id}`}
              >
                <div className="min-w-0 flex-1 basis-48">
                  <div className="break-words text-[14px] font-medium">{model.name}</div>
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
          draft?.id
            ? t(($) => $.settings.embedding.editRemote)
            : t(($) => $.settings.embedding.addRemote)
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
                ['name', t(($) => $.settings.embedding.name), vectorSelectors.remoteNameInput],
                [
                  'baseUrl',
                  t(($) => $.settings.embedding.baseUrl),
                  vectorSelectors.remoteBaseUrlInput
                ],
                [
                  'modelName',
                  t(($) => $.settings.embedding.modelName),
                  vectorSelectors.remoteModelNameInput
                ]
              ] as const
            ).map(([field, label, testId]) => (
              <div key={field}>
                <label htmlFor={`embedding-${field}`} className="mb-1 block text-[13px]">
                  {label}
                </label>
                <Input
                  id={`embedding-${field}`}
                  value={draft[field]}
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
              <label htmlFor="embedding-maxInputTokens" className="mb-1 block text-[13px]">
                {t(($) => $.settings.embedding.maxInputTokens)}
              </label>
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
                aria-describedby="embedding-max-input-hint embedding-budget-hint"
                onChange={updateMaxInputTokens}
                onInput={(value) => updateMaxInputTokens(value.trim() ? Number(value) : undefined)}
                data-testid={vectorSelectors.remoteMaxInputTokensInput}
              />
              <p id="embedding-max-input-hint" className="mt-1 text-[12px] text-[#787774]">
                {t(($) => $.settings.embedding.maxInputTokensHint, {
                  default: DEFAULT_EMBEDDING_INPUT_TOKENS,
                  min: MIN_EMBEDDING_INPUT_TOKENS,
                  max: MAX_EMBEDDING_INPUT_TOKENS
                })}
              </p>
              <p
                id="embedding-budget-hint"
                className="mt-1 text-[12px] text-[#787774]"
                aria-live="polite"
                data-testid={vectorSelectors.budgetHint}
              >
                {draftBudget ? t(($) => $.settings.embedding.budgetHint, draftBudget) : null}{' '}
                {t(($) => $.settings.embedding.lengthEstimateHint)}
              </p>
            </div>
            <div>
              <label htmlFor="embedding-apiKey" className="mb-1 block text-[13px]">
                {t(($) => $.settings.embedding.apiKey)}
              </label>
              <Input.Password
                id="embedding-apiKey"
                value={draft.apiKey || ''}
                disabled={
                  Boolean(pending) ||
                  Boolean(snapshot?.index.running && snapshot.activeModelId === draft.id)
                }
                autoComplete="new-password"
                aria-describedby="embedding-key-hint"
                onChange={(event) => {
                  setDraft({ ...draft, apiKey: event.target.value })
                  setTestResult('')
                  setDraftError('')
                }}
                data-testid={vectorSelectors.remoteApiKeyInput}
              />
              <p id="embedding-key-hint" className="mt-1 text-[12px] text-[#787774]">
                {t(($) => $.settings.embedding.keyHint)}
              </p>
            </div>
            <p className="text-[12px] text-[#787774]">
              {draft.id && draft.id === snapshot?.activeModelId
                ? t(($) => $.settings.embedding.activeEditHint)
                : t(($) => $.settings.embedding.saveHint)}
            </p>
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
