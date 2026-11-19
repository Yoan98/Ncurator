import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  cloneKnowledgeEntries,
  digestObject,
  snapshotFixtureInputs,
  snapshotModelAssets,
  verifyLocalFixtureCacheCoverage,
  withSeedLock,
  writeSeedJsonAtomic
} from '../../../scripts/test/knowledge-seed-store.mjs'
import { launchElectronApp } from './electronApp'
import { E2E_MODEL_REPO_ID } from './modelFixture'
import { isSupportedLocalFilePath } from '../../../src/main/services/ingestion/loader'
import type { WorkspaceIndexJobRecord } from '../../../src/shared/types'

type EntryRef = { kind: string; key: string; checksum: string }

export const isCompleteSeedJob = (job: WorkspaceIndexJobRecord | undefined): boolean =>
  Boolean(
    job &&
    job.action === 'prepare' &&
    job.source_kind === 'file' &&
    job.status === 'succeeded' &&
    job.phase === 'complete' &&
    !job.last_error &&
    Number.isSafeInteger(job.total_count) &&
    job.total_count >= 0 &&
    job.processed_count === job.total_count &&
    job.failed_count === 0
  )

export const withSeedPreparationDeadline = async <T>(
  work: Promise<T>,
  timeoutMs = 600_000
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Seed preparation exceeded its time limit')),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Preparation is not test evidence. Only immutable computation results cross this boundary. */
export const prepareIsolatedKnowledgeSeed = async (input: {
  fixtures: readonly string[]
  env: Readonly<Record<string, string>>
  sourceAppPath?: string
  fixtureRoot?: string
  prepareMissing?: boolean
}): Promise<{ cachePath: string; dispose: () => Promise<void> }> => {
  const seedRoot = process.env.NCURATOR_E2E_KNOWLEDGE_SEED_ROOT
  const pipeline = process.env.NCURATOR_E2E_KNOWLEDGE_SEED_IDENTITY
  if (!seedRoot || !pipeline) throw new Error('Missing verified target identity for knowledge seed')
  const fixtures = await snapshotFixtureInputs(input.fixtures, input.fixtureRoot)
  const supported = fixtures.files.filter((file) => isSupportedLocalFilePath(file.source))
  const targetPipeline = JSON.parse(pipeline)
  const modelsRoot = input.env.NCURATOR_MODELS_PATH
  if (!modelsRoot) throw new Error('Knowledge seed requires an explicit model asset directory')
  const model = await snapshotModelAssets(path.join(modelsRoot, E2E_MODEL_REPO_ID), seedRoot)
  const identity = digestObject({
    schema: 1,
    fixtures: fixtures.fingerprint,
    pipeline: JSON.parse(pipeline),
    model
  })
  const pool = path.join(seedRoot, 'entries')
  const manifestPath = path.join(seedRoot, 'manifests', `${identity}.json`)
  const local = await mkdtemp(
    path.join(process.env.NCURATOR_E2E_TEMP_ROOT || os.tmpdir(), 'ncurator-case-knowledge-')
  )
  const dispose = () => rm(local, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  try {
    if (input.prepareMissing === false) {
      // Immutable atomic entries need no publisher lock for a read/copy. A different
      // cold preflight must not consume this case's timeout while holding that lock.
      const covered = await verifyLocalFixtureCacheCoverage(pool, supported, targetPipeline, model)
      await cloneKnowledgeEntries(pool, local, covered.entries)
      console.info(
        `[knowledge-seed] preflight copy: ${covered.entries.length} entries; ${covered.missing.length} inputs remain for actual case execution`
      )
      return { cachePath: local, dispose }
    }
    await withSeedLock(seedRoot, async () => {
      const covered = await verifyLocalFixtureCacheCoverage(pool, supported, targetPipeline, model)
      if (covered.missing.length === 0) {
        // Verify actual entries rather than trusting a completion marker, including migrations.
        await writeSeedJsonAtomic(manifestPath, { identity, entries: covered.entries })
        await cloneKnowledgeEntries(pool, local, covered.entries)
        console.info(
          `[knowledge-seed] verified unchanged fixture and target: ${identity.slice(0, 12)}; copied ${covered.entries.length} entries`
        )
        return
      }
      // This disposable directory is owned by the preparer, not by any test case.
      const stage = await mkdtemp(
        path.join(process.env.NCURATOR_E2E_TEMP_ROOT || os.tmpdir(), 'ncurator-seed-build-')
      )
      const cachePath = path.join(stage, 'cache')
      const workspace = path.join(stage, 'workspace')
      let app: Awaited<ReturnType<typeof launchElectronApp>> | undefined
      let published = false
      try {
        await cloneKnowledgeEntries(pool, cachePath)
        await mkdir(workspace, { recursive: true })
        for (const file of fixtures.files) {
          const destination = path.join(workspace, file.relativePath)
          await mkdir(path.dirname(destination), { recursive: true })
          await copyFile(file.source, destination)
          if (
            createHash('sha256')
              .update(await readFile(destination))
              .digest('hex') !== file.sha256
          )
            throw new Error(`Fixture changed during seed copy: ${file.relativePath}`)
        }
        let failedFiles = 0
        let complete = fixtures.files.length === 0
        if (fixtures.files.length > 0) {
          app = await launchElectronApp({
            serviceMode: 'real',
            windowMode: 'background',
            sourceAppPath: input.sourceAppPath,
            extraEnv: {
              ...input.env,
              NCURATOR_WORKSPACE_KNOWLEDGE_CACHE: '1',
              NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH: cachePath,
              NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_STATS_PATH: path.join(cachePath, 'stats.json')
            }
          })
          const result = await withSeedPreparationDeadline(
            app.page.evaluate(
              async ({ rootPath, modelId }) => {
                const model = await window.api.embeddingModelsGet()
                if (model.activeModelId !== modelId)
                  throw new Error('Seed preparer model does not match the declared local baseline')
                const created = await window.api.workspaceCreate({ rootPath })
                if (!created.success || !created.workspace)
                  throw new Error(created.error || 'Seed workspace creation failed')
                const workspaceId = created.workspace.id
                const waitIdle = async () => {
                  const deadline = Date.now() + 600_000
                  for (;;) {
                    const current = await window.api.workspaceIndexJobGet({
                      workspaceId,
                      sourceKind: 'file'
                    })
                    if (!current.success) throw new Error(current.error || 'Seed job query failed')
                    if (current.job?.status !== 'running') return current.job
                    if (Date.now() > deadline)
                      throw new Error('Seed preparation exceeded ten minutes')
                    await new Promise((resolve) => setTimeout(resolve, 100))
                  }
                }
                await waitIdle()
                const started = await window.api.workspacePrepare({ workspaceId })
                if (
                  !started.success ||
                  !started.job ||
                  started.job.action !== 'prepare' ||
                  started.cancelled
                )
                  throw new Error(started.error || 'Seed preparation could not start')
                // workspacePrepare awaits and returns the terminal record. The job-get
                // endpoint returns ACTIVE jobs only, so an idle response has no record.
                const active = await waitIdle()
                if (
                  active ||
                  started.job.status === 'running' ||
                  started.job.status === 'cancelled'
                )
                  throw new Error('Seed preparation did not complete the requested job')
                return started.job
              },
              { rootPath: workspace, modelId: `local:${E2E_MODEL_REPO_ID}` }
            )
          )
          failedFiles = result.failed_count
          complete = isCompleteSeedJob(result)
          if (
            !complete &&
            (result.last_error ||
              result.processed_count !== result.total_count ||
              result.failed_count === 0)
          )
            throw new Error(
              result.last_error || 'Seed preparation failed before all files were processed'
            )
          await app.close()
          app = undefined
        }
        const finalModel = await snapshotModelAssets(
          path.join(modelsRoot, E2E_MODEL_REPO_ID),
          seedRoot
        )
        if (finalModel.fingerprint !== model.fingerprint)
          throw new Error('Model assets changed during seed preparation')
        // Publish only complete, checked computation entries. No case data is ever merged back.
        const coverage = await verifyLocalFixtureCacheCoverage(
          cachePath,
          supported,
          targetPipeline,
          model
        )
        if (complete && coverage.missing.length)
          throw new Error(
            `Seed preparation produced no valid target cache for: ${coverage.missing.join(', ')}`
          )
        // Keep valid partial computations too: a failed vector must not discard its split.
        await cloneKnowledgeEntries(cachePath, pool)
        const entries = coverage.entries as EntryRef[]
        published = true
        if (complete) await writeSeedJsonAtomic(manifestPath, { identity, entries })
        else
          console.warn(
            `[knowledge-seed] ${failedFiles} fixture file(s) could not be prepared; copied successes only, no completed seed manifest; actual tests still execute failures`
          )
        await cloneKnowledgeEntries(pool, local, entries)
        console.info(
          `[knowledge-seed] prepared changed/missing fixture results: ${identity.slice(0, 12)}; copied ${entries.length} entries`
        )
      } finally {
        try {
          await app?.close()
        } finally {
          try {
            // An interrupted seed build may still have completed valid immutable entries.
            // Never publish a completion manifest here; the next run rechecks and fills gaps.
            if (!published) await cloneKnowledgeEntries(cachePath, pool)
          } finally {
            await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
          }
        }
      }
    })
    return { cachePath: local, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}
