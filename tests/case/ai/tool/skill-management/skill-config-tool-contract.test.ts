import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { UserSkillService } from '../../../../../src/main/services/skills/UserSkillService'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  createSkillConfigToolHarness,
  createTextFileToolHarness
} from '../../../../harness/backend/aiToolHarness'

describe('Skill configuration real tools', () => {
  it(
    'skill-config-and-current-partner-binding',
    async () =>
      runBackendCase({
        caseId: 'skill-config-and-current-partner-binding',
        harnessMode: 'tool-real',
        domain: 'ai',
        suite: 'tool',
        groups: ['skill-management'],
        fixtures: [],
        runMode: 'single',
        description: '目录自动发现、只读配置查询、当前伙伴批量启停、最终预算及真实长文件续读。',
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
            runtime.storageService.partnerSkills,
            path.join(runtime.workspaceRoot, 'skills')
          )
          const tools = createSkillConfigToolHarness(runtime, {
            partnerId: 'a',
            userSkillService: service
          })
          const reader = createTextFileToolHarness(runtime, { partnerId: 'a' })
          const empty = await tools.invoke('skill_config', { action: 'list' })
          const directory = path.join(service.getRootDirectory(), 'report')
          await fs.mkdir(path.join(directory, 'scripts'), { recursive: true })
          const markdown = (body: string) =>
            `---\nname: report\ndescription: Report\nlicense: MIT\n---\n${body}`
          const filename = path.join(directory, 'SKILL.md')
          await fs.writeFile(filename, markdown('Initial'))
          const script = path.join(directory, 'scripts/run.py')
          await fs.writeFile(script, 'raise Exception("must not execute while configuring")', {
            mode: 0o751
          })
          const discovered = await tools.invoke('skill_config', { action: 'list' })
          const enabled = await tools.invoke('skill_config', {
            action: 'update',
            skills: [{ name: 'report', enabled: true }]
          })
          service.create({ name: 'other', description: 'Keep', body: 'Keep' })
          service.setEnabled('a', ['other', 'report'])
          service.setEnabled('b', ['report'])
          await fs.writeFile(filename, markdown('Updated'))
          const detail = await reader.invoke('text_file_read', { sourcePath: filename })
          const body = service.loadEnabled('a', 'report').body
          await fs.writeFile(filename, 'invalid')
          const error = await tools
            .invoke('skill_config', {
              action: 'update',
              skills: [{ name: 'report', enabled: true }]
            })
            .then(
              () => '',
              (reason: Error) => reason.message
            )
          await fs.rm(directory, { recursive: true })
          const missing = await tools.invoke('skill_config', { action: 'list' })
          const disabled = await tools.invoke('skill_config', {
            action: 'update',
            skills: [{ name: 'report', enabled: false }]
          })
          const a = service.getSelection('a').skillNames
          const b = service.getSelection('b').skillNames
          await fs.mkdir(directory, { recursive: true })
          await fs.writeFile(
            filename,
            markdown(
              Array.from({ length: 1000 }, (_, i) => `${i} ${'x'.repeat(75)}`).join('\n') +
                '\nTAIL-MARKER'
            )
          )
          const tail = await reader.invoke('text_file_read', {
            sourcePath: filename,
            startLine: 990,
            lineCount: 20
          })
          service.create({ name: 'old', description: 'Old', body: 'x'.repeat(40 * 1024) })
          service.create({ name: 'new', description: 'New', body: 'y'.repeat(60 * 1024) })
          await tools.invoke('skill_config', {
            action: 'update',
            skills: [{ name: 'old', enabled: true }]
          })
          const swapped = await tools.invoke('skill_config', {
            action: 'update',
            skills: [
              { name: 'new', enabled: true },
              { name: 'old', enabled: false }
            ]
          })
          const finalSelection = service.getSelection('a').skillNames
          const rejected = await tools
            .invoke('skill_config', {
              action: 'update',
              skills: [
                { name: 'new', enabled: false },
                { name: 'old', enabled: true },
                { name: 'nonexistent', enabled: true }
              ]
            })
            .then(
              () => false,
              () => true
            )
          const afterRejected = service.getSelection('a').skillNames
          const overflow = await tools
            .invoke('skill_config', { action: 'update', skills: [{ name: 'old', enabled: true }] })
            .then(
              () => false,
              () => true
            )
          const afterOverflow = service.getSelection('a').skillNames
          for (let index = 0; index < 800; index++)
            service.create({
              name: `catalog-${String(index).padStart(4, '0')}-${'x'.repeat(48)}`,
              description: 'Keep',
              body: 'Read'
            })
          const list = await tools.invoke<{ filePath: string }>('skill_config', { action: 'list' })
          const listed = await reader.invoke('text_file_read', {
            sourcePath: list.filePath,
            startLine: 790,
            lineCount: 20
          })
          return {
            empty,
            discovered,
            enabled,
            detail,
            body,
            error,
            missing,
            disabled,
            a,
            b,
            tail,
            swapped,
            finalSelection,
            rejected,
            afterRejected,
            overflow,
            afterOverflow,
            listed,
            events: runtime.eventCollector.snapshot()
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            JSON.stringify(result.empty) === '[]' &&
              JSON.stringify(result.discovered) === '[{"name":"report","enabled":false}]' &&
              JSON.stringify(result.enabled) === '{}' &&
              result.body === 'Updated' &&
              JSON.stringify(result.detail).includes('license: MIT'),
            {
              name: 'immediate-discovery-and-current-content',
              message: '无需登记即可发现和配置；更新正文立即有效，文件通过真实工具读取。'
            }
          )
          runtime.assertThat(
            result.a.join() === 'other' &&
              result.b.join() === 'report' &&
              result.error.includes('frontmatter') &&
              JSON.stringify(result.missing).includes('"enabled":true') &&
              JSON.stringify(result.disabled) === '{}',
            {
              name: 'current-partner-and-missing-directory',
              message: '查询缺失配置仍可停用，其他伙伴及选择不变；非法内容不能启用。'
            }
          )
          runtime.assertThat(
            JSON.stringify(result.swapped) === '{}' &&
              result.finalSelection.join() === 'new,other' &&
              result.rejected &&
              result.overflow &&
              result.afterRejected.join() === result.finalSelection.join() &&
              result.afterOverflow.join() === result.finalSelection.join(),
            {
              name: 'atomic-final-selection',
              message: '按最终选择校验预算，非法项或超限整批回滚，其他选择保留。'
            }
          )
          runtime.assertThat(
            JSON.stringify(result.tail).includes('TAIL-MARKER') &&
              JSON.stringify(result.listed).includes('catalog-0799') &&
              result.events.some(
                (event) => event.type === 'tool_call_result' && event.result?.ok === false
              ),
            {
              name: 'large-real-file-reads',
              message: '长正文和超长配置清单使用真实文件续读，失败事件准确。'
            }
          )
        }
      }),
    120_000
  )
})
