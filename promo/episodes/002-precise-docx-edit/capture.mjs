import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import electronPath from 'electron'
import mammoth from 'mammoth'
import { _electron as electron } from 'playwright'
import { syncEpisodeManifest } from '../../scripts/manifest.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve('../../..')
const episodeDir = process.cwd()
const outputDir = path.join(episodeDir, 'assets', 'captured', 'stills')
const workDir = path.join(episodeDir, '.work', 'capture')
const workspaceDir = path.join(workDir, 'demo-workspace')
const userDataDir = path.join(workDir, 'user-data')
const videoTempDir = path.join(workDir, 'playwright-video')
const sourceName = '星桥项目实施方案.docx'
const sourcePath = path.join(workspaceDir, sourceName)
const workspaceName = '星桥项目方案'
const prompt = [
  '请直接修改我刚选中的《星桥项目实施方案.docx》，只做以下三处修改，其他内容和排版都不要动：',
  '1. 将上线日期从“2026 年 8 月 1 日”改为“2026 年 8 月 15 日”；',
  '2. 在“二、项目分工”的表格里，将项目统筹负责人从“王静”改为“陈晨”；',
  '3. 在“三、风险与应对”的列表末尾新增一项：“上线前完成全量数据备份。”',
  '完成后直接写回原文件，并简短告诉我已完成。'
].join('\n')
const persistentDbCandidates = [
  path.join(process.env.HOME || '', 'Library', 'Application Support', 'ncurator', 'app.sqlite'),
  path.join(
    process.env.HOME || '',
    'Library',
    'Application Support',
    'ncurator-desktop',
    'app.sqlite'
  )
]
const nativeBinding = path.join(
  repoRoot,
  'node_modules',
  '.native-cache',
  'better-sqlite3',
  `node-v${process.versions.modules}-${process.platform}-${process.arch}`,
  'better_sqlite3.node'
)

await rm(outputDir, { recursive: true, force: true })
await rm(userDataDir, { recursive: true, force: true })
await rm(videoTempDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })
await mkdir(videoTempDir, { recursive: true })
await execFileAsync(process.execPath, [path.join(episodeDir, 'build-demo-docx.mjs'), sourcePath], {
  cwd: repoRoot
})

const readDocxText = async () => {
  const buffer = await readFile(sourcePath)
  const result = await mammoth.extractRawText({ buffer })
  return result.value.replace(/\s+/g, ' ').trim()
}

const beforeText = await readDocxText()
for (const expected of ['2026 年 8 月 1 日', '王静', '出现异常时由技术负责人统一协调']) {
  if (!beforeText.includes(expected)) throw new Error(`演示文档缺少预期原文：${expected}`)
}

const allocateFreePort = async () => {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法分配调试端口')
  const port = address.port
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

const launchApp = async ({ recordVideo = false } = {}) => {
  console.log(recordVideo ? '启动录屏应用…' : '启动准备应用…')
  const port = await allocateFreePort()
  const launchedAt = Date.now()
  const app = await electron.launch({
    executablePath: electronPath,
    args: [repoRoot],
    cwd: repoRoot,
    recordVideo: recordVideo
      ? { dir: videoTempDir, size: { width: 1600, height: 1000 } }
      : undefined,
    env: {
      ...process.env,
      NCURATOR_E2E_OBSERVER: '1',
      NCURATOR_E2E_WINDOW_MODE: 'background',
      NCURATOR_USER_DATA_PATH: userDataDir,
      NCURATOR_EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT: String(port)
    }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded', { timeout: 120_000 }).catch(() => {})
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 24, y: 24, width: 1600, height: 1000 })
  })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.locator('[data-testid="workbench-page"]').waitFor({
    state: 'visible',
    timeout: 120_000
  })
  return { app, page, launchedAt }
}

const waitForFileJob = async (page, workspaceId) => {
  const deadline = Date.now() + 300_000
  const startedAt = Date.now()
  let sawJob = false
  while (Date.now() < deadline) {
    const response = await page.evaluate(
      async (id) => await window.api.workspaceIndexJobGet({ workspaceId: id, sourceKind: 'file' }),
      workspaceId
    )
    if (!response.success) throw new Error(response.error || '读取索引任务失败')
    if (response.job) sawJob = true
    if (sawJob && !response.job) return
    if (!sawJob && !response.job && Date.now() - startedAt > 3000) return
    await page.waitForTimeout(500)
  }
  throw new Error('建立演示文档索引超时')
}

const chooseRealModel = async (page) =>
  await page.evaluate(async () => {
    const configs = await window.api.llmConfigList()
    const ordered = [...configs].sort((a, b) => {
      const score = (item) => {
        if (item.name === 'test') return 0
        if (item.providerKind === 'deepseek' || /deep/iu.test(item.name)) return 1
        if (/豆包|doubao/iu.test(item.name)) return 3
        return 2
      }
      return score(a) - score(b)
    })
    for (const config of ordered) {
      const response = await Promise.race([
        window.api.llmConfigModelList(config.id),
        new Promise((resolve) => setTimeout(() => resolve({ success: false, items: [] }), 30_000))
      ])
      if (!response.success || !response.items?.length) continue
      const usable = response.items.filter(
        (item) =>
          !/embed|embedding|rerank|vision|image|tts|speech|audio/iu.test(item.id) &&
          /chat|deepseek|doubao|seed|pro|lite|gpt|qwen|kimi|glm/iu.test(item.id)
      )
      const preferred =
        usable.find((item) => item.id === 'deepseek-v4-flash') ||
        usable.find((item) => /deepseek-chat|chat/iu.test(item.id)) ||
        usable.find((item) => /doubao-seed-1-6|doubao.*pro/iu.test(item.id)) ||
        usable[0]
      if (preferred)
        return { configId: config.id, configName: config.name, modelName: preferred.id }
    }
    throw new Error('现有模型配置都无法提供可用的对话模型')
  })

const selectWorkspaceThroughUi = async (page) => {
  const workspaceSelect = page.locator('[data-testid="workbench-workspace-select"]')
  if (((await workspaceSelect.textContent()) || '').includes(workspaceName)) return
  await workspaceSelect.click()
  const option = page
    .locator(
      '.workbench-select-menu [role="option"], .workspace-quick-select-popup [role="option"]'
    )
    .filter({ hasText: workspaceName })
    .first()
  await option.waitFor({ state: 'visible' })
  await option.click()
}

const selectModelThroughUi = async (page, modelName) => {
  const modelSelect = page.locator('[data-testid="workbench-model-select"]')
  if (((await modelSelect.textContent()) || '').includes(modelName)) return
  await modelSelect.click()
  const rootMenu = page.locator('.workbench-select-menu.workbench-composer-menu').last()
  await rootMenu.getByRole('button', { name: /^主模型/u }).click()
  const modelMenu = page.locator('.workbench-select-menu.workbench-composer-menu').last()
  const search = modelMenu.locator('input[placeholder="搜索模型"]')
  await search.waitFor({ state: 'visible', timeout: 60_000 })
  await search.fill(modelName)
  const option = modelMenu.getByRole('option').filter({ hasText: modelName }).first()
  await option.waitFor({ state: 'visible', timeout: 60_000 })
  await option.click()
}

const insertReferenceToken = async (page) => {
  const input = page.locator('[data-testid="workbench-input"]')
  await input.click()
  await page.keyboard.insertText(`@${sourceName}`)
  const panel = page.locator('[data-testid="workbench-mention-panel"]')
  await panel.waitFor({ state: 'visible', timeout: 60_000 })
  const option = panel.getByRole('button').filter({ hasText: sourceName }).first()
  await option.waitFor({ state: 'visible', timeout: 60_000 })
  await option.click()
  await page.waitForFunction(
    ({ testId, name }) => {
      const editor = document.querySelector(`[data-testid="${testId}"]`)
      return Array.from(editor?.querySelectorAll('[data-role="scope-token"]') || []).some((node) =>
        node.textContent?.includes(name)
      )
    },
    { testId: 'workbench-input', name: sourceName }
  )
}

const bootstrap = await launchApp()
await bootstrap.app.close()
console.log('基础数据库已创建')

const persistentDbPath = persistentDbCandidates.find((candidate) => {
  try {
    const db = new Database(candidate, { readonly: true, nativeBinding })
    const count = Number(db.prepare('SELECT COUNT(*) AS count FROM llm_config').get().count)
    db.close()
    return count > 0
  } catch {
    return false
  }
})

if (!persistentDbPath) throw new Error('没有找到本机已经配置好的真实模型，无法进行真实录制')

const tempDb = new Database(path.join(userDataDir, 'app.sqlite'), { nativeBinding })
tempDb.prepare('ATTACH DATABASE ? AS persistent').run(persistentDbPath)
tempDb.exec(`
  INSERT OR REPLACE INTO llm_config (id, name, providerKind, base_url, api_key)
  SELECT id, name, providerKind, base_url, api_key FROM persistent.llm_config;
`)
tempDb.exec(`
  INSERT OR REPLACE INTO llm_strategy_preference (
    config_id, model_name, preferred_transport, preferred_structured_output_mode, updated_at
  )
  SELECT config_id, model_name, preferred_transport, preferred_structured_output_mode, updated_at
  FROM persistent.llm_strategy_preference;
`)
tempDb.exec('DETACH DATABASE persistent')
tempDb.close()

const setup = await launchApp()
let model
let workspaceId
try {
  model = await chooseRealModel(setup.page)
  const seeded = await setup.page.evaluate(
    async ({ rootPath, modelInput, name }) => {
      const workspaceResponse = await window.api.workspaceCreate({ name })
      const nextWorkspaceId = workspaceResponse.workspace?.id
      if (!workspaceResponse.success || !nextWorkspaceId) {
        throw new Error(workspaceResponse.error || '创建演示工作空间失败')
      }
      const rootResponse = await window.api.workspaceSetRootPath({
        workspaceId: nextWorkspaceId,
        rootPath
      })
      if (!rootResponse.success) throw new Error(rootResponse.error || '绑定演示文档失败')
      window.localStorage.setItem('workbench.preference.workspace-id', nextWorkspaceId)
      window.localStorage.setItem('workbench.preference.ai-preference', 'local_sources_strict')
      window.localStorage.setItem(
        'workbench.preference.model',
        JSON.stringify({
          mainModel: { configId: modelInput.configId, modelName: modelInput.modelName },
          visionModel: null
        })
      )
      return { workspaceId: nextWorkspaceId }
    },
    { rootPath: workspaceDir, modelInput: model, name: workspaceName }
  )
  workspaceId = seeded.workspaceId
  const prepareResponse = await setup.page.evaluate(
    async (id) => await window.api.workspacePrepare({ workspaceId: id }),
    workspaceId
  )
  if (!prepareResponse.success) throw new Error(prepareResponse.error || '启动文档索引失败')
  await waitForFileJob(setup.page, workspaceId)
  console.log('演示工作空间和文档索引已准备')
} finally {
  await setup.app.close()
}

const recording = await launchApp()
const events = { launch: 0 }
let answerText = ''
let applyEntryText = ''
let recordingError

try {
  const elapsed = () => (Date.now() - recording.launchedAt) / 1000
  await recording.page.reload()
  await recording.page.locator('[data-testid="workbench-page"]').waitFor({ state: 'visible' })
  const notice = recording.page.locator('[data-testid="workbench-llm-config-missing-notification"]')
  if (await notice.count())
    await notice
      .getByRole('button', { name: '稍后' })
      .click()
      .catch(() => {})
  await selectWorkspaceThroughUi(recording.page)
  await selectModelThroughUi(recording.page, model.modelName)

  const input = recording.page.locator('[data-testid="workbench-input"]')
  await input.waitFor({ state: 'visible' })
  events.typingStart = elapsed()
  console.log('开始输入三项修改要求')
  await insertReferenceToken(recording.page)
  await recording.page.keyboard.insertText(' ')
  for (let offset = 0; offset < prompt.length; offset += 3) {
    await recording.page.keyboard.insertText(prompt.slice(offset, offset + 3))
    await recording.page.waitForTimeout(42)
  }
  await recording.page.waitForTimeout(900)
  await recording.page.screenshot({ path: path.join(outputDir, 'prompt.png') })

  const sendButton = recording.page.locator('[data-testid="workbench-send-button"]')
  if (await sendButton.isDisabled()) throw new Error('真实模型或工作空间没有正确选中')
  events.submit = elapsed()
  await sendButton.click()
  console.log('修改要求已发送，等待真实模型写回')
  await recording.page.waitForTimeout(1800)
  await recording.page.screenshot({ path: path.join(outputDir, 'processing.png') })

  const finalAnswer = recording.page
    .locator('[data-testid^="workbench-assistant-final-answer-"]')
    .last()
  const applyEntry = recording.page
    .locator('[data-testid^="workbench-assistant-turn-apply-"]')
    .last()
  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    const approve = recording.page.locator('[data-testid="chat-approval-batch-approve-button"]')
    if (await approve.count()) {
      events.approval = events.approval || elapsed()
      await approve.click().catch(() => {})
    }
    if (
      (await finalAnswer.count()) > 0 &&
      (await finalAnswer.textContent())?.trim() &&
      (await applyEntry.count()) > 0
    ) {
      break
    }
    await recording.page.waitForTimeout(250)
  }
  if ((await applyEntry.count()) === 0) throw new Error('真实 AI 没有生成修改文件入口')
  if ((await finalAnswer.count()) === 0 || !(await finalAnswer.textContent())?.trim()) {
    throw new Error('真实 AI 修改没有在十分钟内完成')
  }

  events.answer = elapsed()
  console.log('真实模型已完成修改')
  answerText = ((await finalAnswer.textContent()) || '').replace(/\s+/g, ' ').trim()
  applyEntryText = ((await applyEntry.textContent()) || '').replace(/\s+/g, ' ').trim()
  await applyEntry.scrollIntoViewIfNeeded()
  await recording.page.waitForTimeout(1500)
  await recording.page.screenshot({ path: path.join(outputDir, 'result.png') })
  events.applyOpen = elapsed()
  await applyEntry.click()

  const applyPanel = recording.page.locator('[data-testid="workbench-apply-panel"]')
  const docxViewer = recording.page.locator('[data-testid="workbench-docx-viewer"]')
  await applyPanel.waitFor({ state: 'visible', timeout: 60_000 })
  await docxViewer.waitFor({ state: 'visible', timeout: 60_000 })
  await applyPanel
    .getByText('上线前完成全量数据备份')
    .waitFor({ state: 'visible', timeout: 60_000 })
  events.diffReady = elapsed()
  console.log('变更预览已打开')
  await recording.page.waitForTimeout(1800)
  const docxScroll = docxViewer.locator('.docx-content')
  await docxScroll.evaluate((element) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.68
  })
  await recording.page.waitForTimeout(900)
  await recording.page.screenshot({ path: path.join(outputDir, 'diff-overview.png') })
  await docxScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await recording.page.waitForTimeout(900)
  await recording.page.screenshot({ path: path.join(outputDir, 'diff.png') })

  const toggle = recording.page.locator('[data-testid="workbench-docx-preview-mode-toggle"]')
  if ((await toggle.getAttribute('aria-label')) !== '查看文件') {
    throw new Error('DOCX 修改入口没有默认打开变更预览')
  }
  events.fileToggle = elapsed()
  await toggle.click()
  await recording.page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="workbench-docx-preview-mode-toggle"]')
    return button?.getAttribute('aria-label') === '查看变更'
  })
  await docxViewer.waitFor({ state: 'visible', timeout: 60_000 })
  await recording.page.waitForTimeout(1300)
  await docxViewer.locator('.docx-content').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  events.fileReady = elapsed()
  console.log('正常文件视图已打开')
  await recording.page.waitForTimeout(1000)
  await recording.page.screenshot({ path: path.join(outputDir, 'file.png') })
  events.end = elapsed()
} catch (error) {
  recordingError = error
} finally {
  await recording.app.close()
}

const afterText = await readDocxText()
const checks = {
  hasNewDate: afterText.includes('2026 年 8 月 15 日'),
  removedOldDate: !afterText.includes('2026 年 8 月 1 日'),
  hasNewOwner: afterText.includes('陈晨'),
  removedOldOwner: !afterText.includes('王静'),
  hasBackupItem: afterText.includes('上线前完成全量数据备份。')
}

await writeFile(
  path.join(workDir, 'capture-manifest.json'),
  `${JSON.stringify(
    {
      resolution: '1600x1000',
      continuousVideo: false,
      captures: {
        prompt: path.join(outputDir, 'prompt.png'),
        processing: path.join(outputDir, 'processing.png'),
        result: path.join(outputDir, 'result.png'),
        diffOverview: path.join(outputDir, 'diff-overview.png'),
        diff: path.join(outputDir, 'diff.png'),
        file: path.join(outputDir, 'file.png')
      },
      modelConfig: model?.configName,
      modelName: model?.modelName,
      workspaceId,
      prompt,
      sourceName,
      answerText,
      applyEntryText,
      checks,
      events
    },
    null,
    2
  )}\n`,
  'utf8'
)

await rm(userDataDir, { recursive: true, force: true })
if (recordingError) throw recordingError
if (!Object.values(checks).every(Boolean)) {
  throw new Error(`修改结果未通过校验：${JSON.stringify(checks)}`)
}
await syncEpisodeManifest(episodeDir)

console.log(`真实模型：${model.configName} / ${model.modelName}`)
console.log(`真实回答：${answerText}`)
console.log(`修改校验：${JSON.stringify(checks)}`)
console.log(`真实界面截图：${outputDir}`)
