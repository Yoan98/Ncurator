import path from 'node:path'
import type {
  BackendHarnessMode,
  BackendTestRuntime,
  TestLogEvent
} from './test-types'
import type { EventCollector } from '../core/eventCollector'
import type { FixtureBinding } from './test-types'
import { createRealAiDepsFactory } from './realAiDepsFactory'
import { seedKbFixture } from './seedKbFixture'
import { seedChatHistory } from './seedChatHistory'
import { seedWorkspaceKb } from './workspaceKbSeed'
import { flushLangChainTracing } from './utils/langchainTracing'
import {
  appendSeedKbDocuments,
  appendSeedWorkspaceFile,
  cloneBackendSeedManifest,
  createEmptyBackendSeedManifest
} from './seedManifest'

export const createRealAiHarness = async (input: {
  definition: {
    harnessMode: BackendHarnessMode
    runtimeModelName?: string | null
    visionModel?: { configId: string; modelName: string }
  }
  runId: string
  taskId: string
  workspaceRoot: string
  fixtureBindings: FixtureBinding[]
  eventCollector: EventCollector
  recordEvent: (input: Omit<TestLogEvent, 'ts'>) => void
}): Promise<{
  runtime: BackendTestRuntime
  dispose: () => Promise<void>
}> => {
  const depsFactory = await createRealAiDepsFactory({
    mode: input.definition.harnessMode,
    runId: input.runId,
    runtimeModelName: input.definition.runtimeModelName,
    workspaceRoot: input.workspaceRoot,
    eventCollector: input.eventCollector
  })

  const seedManifest = createEmptyBackendSeedManifest()

  const runtime: BackendTestRuntime = {
    mode: input.definition.harnessMode,
    runId: input.runId,
    taskId: input.taskId,
    runtimeModelName: input.definition.runtimeModelName,
    workspaceRoot: input.workspaceRoot,
    fixtureBindings: input.fixtureBindings,
    eventCollector: input.eventCollector,
    storageService: depsFactory.storageService,
    workspaceSourceService: depsFactory.workspaceSourceService,
    workspaceKnowledgePrepareService: depsFactory.workspaceKnowledgePrepareService,
    documentsStore: depsFactory.storageService.documents,
    chatStore: depsFactory.storageService.chat,
    docxApplyStore: depsFactory.storageService.docxApply,
    llmStore: depsFactory.storageService.llm,
    embeddingService: depsFactory.embeddingService,
    docxApplyService: depsFactory.docxApplyService,
    recordEvent: input.recordEvent,
    assertThat: (condition, assertion) => {
      input.recordEvent({
        type: 'assertion',
        name: assertion.name,
        status: condition ? 'ok' : 'failed',
        message: assertion.message,
        data: assertion.data
      })
      if (!condition) {
        throw new Error(assertion.message)
      }
    },
    getFixtureWorkspacePath: (sourcePath: string) => {
      const absoluteSource = path.resolve(sourcePath)
      const matched = input.fixtureBindings.find(
        (binding) => binding.sourcePath === absoluteSource
      )
      if (!matched) {
        throw new Error(`fixture not bound into workspace: ${absoluteSource}`)
      }
      return matched.workspacePath
    },
    recordSeedWorkspaceFile: (record) => {
      appendSeedWorkspaceFile(seedManifest, record)
    },
    getSeedManifest: () => cloneBackendSeedManifest(seedManifest),
    createAiRunContext: (contextInput = {}) =>
      depsFactory.createAiRunContext({
        ...contextInput,
        visionModel: contextInput.visionModel || input.definition.visionModel
      }),
    createHumanTaskRunner: (contextInput = {}) =>
      depsFactory.createHumanTaskRunner({
        ...contextInput,
        visionModel: contextInput.visionModel || input.definition.visionModel
      }),
    ensureEmbeddingReady: async () => {
      await depsFactory.ensureEmbeddingReady()
    },
    seedKb: async (documents) => {
      await depsFactory.ensureEmbeddingReady()
      await seedKbFixture({
        documentsStore: depsFactory.storageService.documents,
        embeddingService: depsFactory.embeddingService,
        documents
      })
      appendSeedKbDocuments(seedManifest, documents)
    },
    seedWorkspaceKb: async (params) => {
      await depsFactory.ensureEmbeddingReady()
      const seeded = await seedWorkspaceKb({
        runtime,
        params
      })
      for (const result of seeded.results) {
        if (result.status !== 'indexed') continue
        appendSeedWorkspaceFile(seedManifest, {
          relativePath: result.relativePath,
          absolutePath: result.absolutePath,
          summary: `workspace KB indexed: ${result.name}`,
          metadata: {
            documentId: result.documentId,
            chunkCount: result.chunkCount,
            cache: result.cache
          }
        })
      }
      appendSeedKbDocuments(seedManifest, seeded.kbDocuments)
      return seeded.results
    },
    seedChatHistory: async (payload) => {
      await seedChatHistory({
        chatStore: depsFactory.storageService.chat,
        payload
      })
    },
    seedLlmConfig: async (config) => {
      await depsFactory.seedLlmConfig(config)
    }
  }

  return {
    runtime,
    dispose: async () => {
      await flushLangChainTracing()
      await depsFactory.close()
    }
  }
}
