import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { UserSkillService } from '../../../../../src/main/services/skills/UserSkillService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  createSkillManagementToolHarness,
  createTextFileToolHarness
} from '../../../../harness/backend/aiToolHarness'

describe('skill management real tools', () => {
  it(
    'skill-read-publish-and-current-partner-binding',
    async () =>
      runBackendCase({
        caseId: 'skill-read-publish-and-current-partner-binding',
        harnessMode: 'tool-real',
        domain: 'ai',
        suite: 'tool',
        groups: ['skill-management'],
        fixtures: [],
        runMode: 'single',
        description: '真实工具发布、读取、完整更新、启停及大结果续读，保留当前伙伴其他绑定。',
        execute: async (runtime) => {
          for (const id of ['a', 'b'])
            await runtime.partnerStore.savePartner({
              id,
              name: id,
              avatar_shape: 'circle',
              avatar_color: 'blue',
              created_at: 1,
              updated_at: 1,
              last_viewed_at: 1,
              pinned: false,
              pinned_at: null
            })
          const service = new UserSkillService(
            runtime.storageService.userSkill,
            path.join(runtime.workspaceRoot, '.managed')
          )
          const other = service.create({ name: 'other', description: 'Keep', body: 'Keep' })
          service.setEnabled('a', [other.id])
          service.setEnabled('b', [other.id])
          const tools = createSkillManagementToolHarness(runtime, {
            partnerId: 'a',
            userSkillService: service
          })
          const source = path.join(runtime.workspaceRoot, 'draft')
          await fs.mkdir(path.join(source, 'scripts'), { recursive: true })
          const md = (name: string, body: string) =>
            `---\nname: ${name}\ndescription: Report\nlicense: MIT\n---\n${body}`
          await fs.writeFile(path.join(source, 'SKILL.md'), md('report', 'Initial'))
          await fs.writeFile(
            path.join(source, 'scripts', 'report.py'),
            'raise Exception("must not execute on publish")'
          )
          const created = await tools.invoke<{ id: string; name: string }>('skill_edit', {
            sourcePath: source,
            enabled: true
          })
          const detail = await tools.invoke<{
            id: string
            path: string
            content: string
            enabled: boolean
          }>('skill_read', { id: created.id })
          await fs.writeFile(path.join(source, 'SKILL.md'), md('renamed', 'Updated'))
          const updated = await tools.invoke<{ id: string; name: string }>('skill_edit', {
            id: created.id,
            sourcePath: source
          })
          const conflict = await tools.invoke('skill_edit', { sourcePath: source }).then(
            () => '',
            (error: Error) => error.message
          )
          const managedSource = await tools
            .invoke('skill_edit', {
              id: created.id,
              sourcePath: service.resourceDirectory({ id: created.id })
            })
            .then(
              () => '',
              (error: Error) => error.message
            )
          await tools.invoke('skill_edit', { id: created.id, enabled: false })
          const final = service.readForPartner('a', created.id)
          await fs.writeFile(
            path.join(source, 'SKILL.md'),
            md(
              'renamed',
              Array.from({ length: 1000 }, (_, i) => `${i} ${'x'.repeat(75)}`).join('\n') +
                '\nTAIL-MARKER'
            )
          )
          await tools.invoke('skill_edit', { id: created.id, sourcePath: source })
          const long = await tools.invoke<{
            id: string
            path: string
            enabled: boolean
            content?: string
          }>('skill_read', { id: created.id })
          const reader = createTextFileToolHarness(runtime, { partnerId: 'a' })
          const tail = await reader.invoke('text_file_read', {
            sourcePath: path.join(long.path, 'SKILL.md'),
            startLine: 990,
            lineCount: 20
          })
          for (let index = 0; index < 60; index++)
            service.create({
              name: `catalog-${index}`,
              description: 'd'.repeat(1024),
              body: 'Read'
            })
          const list = await tools.invoke<{ filePath: string }>('skill_read', {})
          const listed = await fs.readFile(list.filePath, 'utf8')
          await fs.rm(source, { recursive: true })
          return {
            created,
            updated,
            detail,
            final,
            conflict,
            managedSource,
            long,
            tail,
            listed,
            a: service.listEnabled('a').map((item) => item.id),
            b: service.listEnabled('b').map((item) => item.id),
            other: other.id,
            resources: service.getDocument(created.id).resources,
            events: runtime.eventCollector
              .snapshot()
              .filter((event) => event.type === 'tool_call_result')
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.created.id === result.updated.id &&
              result.updated.name === 'renamed' &&
              result.detail.enabled &&
              result.detail.content.includes('license: MIT') &&
              'content' in result.final &&
              result.final.content.includes('Updated'),
            { name: 'directory-roundtrip', message: '真实读取包含原始 YAML，重命名更新保留 ID。' }
          )
          runtime.assertThat(
            result.a.join() === result.other &&
              result.b.join() === result.other &&
              result.conflict.includes('already exists') &&
              result.managedSource.includes('managed skill storage') &&
              result.resources.includes('scripts/report.py'),
            {
              name: 'binding-and-publish-boundary',
              message: '只停用当前伙伴单项，保留其他选择与资源，拒绝同名和托管源。'
            }
          )
          runtime.assertThat(
            !result.long.content &&
              JSON.stringify(result.tail).includes('TAIL-MARKER') &&
              result.listed.includes('catalog-59') &&
              result.events.some(
                (event) => event.type === 'tool_call_result' && event.result?.ok === false
              ),
            {
              name: 'large-read-and-events',
              message: '大正文与清单可通过真实文件续读，事件包含真实失败。'
            }
          )
        }
      }),
    120_000
  )
})
