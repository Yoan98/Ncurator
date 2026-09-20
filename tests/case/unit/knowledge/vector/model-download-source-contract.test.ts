import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelService, type ModelDownloadProgress } from '../../../../../src/main/services/model/ModelService'
import { DEFAULT_MODEL_SOURCE } from '../../../../../src/shared/modelSources'

const REPO_ID = 'jinaai/jina-embeddings-v2-base-zh'

const REQUIRED_FILES = [
  '1_Pooling/config.json',
  'config.json',
  'config_sentence_transformers.json',
  'merges.txt',
  'modules.json',
  'onnx/model.onnx',
  'sentence_bert_config.json',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json'
]

const MODELSCOPE_METADATA_URL = `https://www.modelscope.cn/api/v1/models/${REPO_ID}/repo/files?Revision=master&Recursive=true`
const HF_METADATA_URL = `https://hf-mirror.com/api/models/${REPO_ID}`

let isolatedModelsPath = ''

const modelDir = (): string => path.join(isolatedModelsPath, REPO_ID)

const realSetTimeout = globalThis.setTimeout

const flushTimersUntilSettled = async (promise: Promise<unknown>): Promise<void> => {
  let done = false
  void promise.then(
    () => {
      done = true
    },
    () => {
      done = true
    }
  )
  for (let i = 0; i < 500 && !done; i += 1) {
    await vi.runAllTimersAsync()
    if (!done) {
      await new Promise<void>((resolve) => realSetTimeout(resolve, 0))
    }
  }
}

const fileResponse = (): unknown => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: new Headers({ 'content-length': '4' }),
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data'))
      controller.close()
    }
  })
})

const metadataResponse = (modelscope: boolean): unknown => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () =>
    modelscope
      ? {
          Data: {
            Files: REQUIRED_FILES.map((file) => ({
              Path: file,
              Type: 'blob',
              Size: 4,
              Sha256: 'expected-sha256'
            }))
          }
        }
      : {
          siblings: REQUIRED_FILES.map((file) => ({ rfilename: file }))
        }
})

const mockFetch = (overrides: { failMetadata?: boolean; failFiles?: boolean } = {}): {
  calls: string[]
} => {
  const calls: string[] = []
  const impl = vi.fn(async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/api/models/') || url.includes('/repo/files')) {
      if (overrides.failMetadata) {
        throw new Error('metadata network down')
      }
      return metadataResponse(url.includes('www.modelscope.cn'))
    }
    if (overrides.failFiles) {
      throw new Error('file network down')
    }
    return fileResponse()
  })
  vi.stubGlobal('fetch', impl)
  return { calls }
}

beforeEach(() => {
  isolatedModelsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-model-source-'))
  process.env.NCURATOR_MODELS_PATH = isolatedModelsPath
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.NCURATOR_MODELS_PATH
  fs.rmSync(isolatedModelsPath, { recursive: true, force: true })
})

describe('unit vector model download source', () => {
  it('uses modelscope metadata and file endpoints when source=modelscope', async () => {
    const { calls } = mockFetch()
    const events: ModelDownloadProgress[] = []
    const result = await ModelService.getInstance().downloadModel(
      REPO_ID,
      (event) => events.push(event),
      undefined,
      'modelscope'
    )

    expect(result.success).toBe(true)
    expect(calls[0]).toBe(MODELSCOPE_METADATA_URL)
    for (const file of REQUIRED_FILES) {
      expect(calls).toContain(
        `https://www.modelscope.cn/api/v1/models/${REPO_ID}/repo?Revision=master&FilePath=${file}`
      )
    }
    expect(calls.some((url) => url.includes('hf-mirror.com'))).toBe(false)
    expect(fs.existsSync(path.join(modelDir(), '.download-complete.json'))).toBe(true)
    expect(events.some((event) => event.status === 'completed' && event.source === 'modelscope')).toBe(
      true
    )
  })

  it('uses huggingface-mirror metadata and file endpoints when source=huggingface-mirror', async () => {
    const { calls } = mockFetch()
    const result = await ModelService.getInstance().downloadModel(
      REPO_ID,
      undefined,
      undefined,
      'huggingface-mirror'
    )

    expect(result.success).toBe(true)
    expect(calls[0]).toBe(HF_METADATA_URL)
    for (const file of REQUIRED_FILES) {
      expect(calls).toContain(`https://hf-mirror.com/${REPO_ID}/resolve/main/${file}`)
    }
    expect(calls.some((url) => url.includes('www.modelscope.cn'))).toBe(false)
  })

  it('defaults to the shared default source', async () => {
    const { calls } = mockFetch()
    await ModelService.getInstance().downloadModel(REPO_ID)
    expect(DEFAULT_MODEL_SOURCE).toBe('modelscope')
    expect(calls[0]).toBe(MODELSCOPE_METADATA_URL)
  })

  it('cleans up the partial model directory and reports failedSource when a file download fails', async () => {
    vi.useFakeTimers()
    try {
      mockFetch({ failFiles: true })
      const events: ModelDownloadProgress[] = []
      const pending = ModelService.getInstance().downloadModel(
        REPO_ID,
        (event) => events.push(event),
        undefined,
        'modelscope'
      )
      await flushTimersUntilSettled(pending)
      await expect(pending).rejects.toMatchObject({
        name: 'ModelDownloadError',
        source: 'modelscope'
      })

      expect(fs.existsSync(modelDir())).toBe(false)
      const errorEvent = events.find((event) => event.status === 'error')
      expect(errorEvent?.failedSource).toBe('modelscope')
      expect(errorEvent?.source).toBe('modelscope')
    } finally {
      vi.useRealTimers()
    }
  })

  it('wraps metadata failures as ModelDownloadError with the attempted source', async () => {
    vi.useFakeTimers()
    try {
      mockFetch({ failMetadata: true })
      const pending = ModelService.getInstance().downloadModel(
        REPO_ID,
        undefined,
        undefined,
        'huggingface-mirror'
      )
      await flushTimersUntilSettled(pending)
      await expect(pending).rejects.toMatchObject({
        name: 'ModelDownloadError',
        source: 'huggingface-mirror'
      })
      expect(fs.existsSync(modelDir())).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws ModelDownloadError when metadata misses required files and cleans up', async () => {
    mockFetch()
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/repo/files')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            Data: {
              Files: [
                { Path: 'config.json', Type: 'blob', Size: 4 },
                { Path: 'modules.json', Type: 'blob', Size: 4 }
              ]
            }
          })
        }
      }
      return fileResponse()
    })

    const pending = ModelService.getInstance().downloadModel(
      REPO_ID,
      undefined,
      undefined,
      'modelscope'
    )
    await expect(pending).rejects.toMatchObject({
      name: 'ModelDownloadError',
      source: 'modelscope'
    })
    expect(fs.existsSync(modelDir())).toBe(false)
  })
})
