import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const DOCX_FILE_NAME = '云枢智服-9月第2周经营周报.docx'
export const EXCEL_FILE_NAME = '云枢智服-9月费用预算.xlsx'
export const PPT_FILE_NAME = 'Q2经营复盘.pptx'

export const DOCX_CREATE_PROMPT =
  '@站会纪要-0908.txt @客户风险-星河.txt @本周数字.md 写一份这周经营周报，能直接给领导。进展、数字、风险、下周计划都要有。写到工作区，文件名用「云枢智服-9月第2周经营周报.docx」。'

export const DOCX_EDIT_PROMPT =
  '@云枢智服-9月第2周经营周报.docx 星河验收风险放到最前面，每条风险写上谁负责。'

export const EXCEL_CREATE_PROMPT =
  '做个 9 月费用预算，部门和汇总两张表，市场研发交付人事都写上，合计用公式。写到工作区，文件名用「云枢智服-9月费用预算.xlsx」。'

export const EXCEL_EDIT_PROMPT =
  '@云枢智服-9月费用预算.xlsx 品牌推广压到 5 万，每条科目补一列已经花了多少，没有报销数你先估一版。'

export const PPT_CREATE_PROMPT =
  '做份 Q2 经营复盘，能直接给领导开会。封面、数字、风险、下一步都要有。写到工作区，文件名用「Q2经营复盘.pptx」。'

export const PPT_EDIT_PROMPT =
  '@Q2经营复盘.pptx 封面改成内部通气会，KPI 没达标的标红。'

const STANDUP_NOTES = `云枢 9/8 站会 随便记一下

交付
- 星河项目验收又拖了，苏明远说客户还在改验收口径，原定 9/12 大概率赶不上
- 内部联调周四才完，文档还缺两页
- 方立群：Q3 新增 ARR 目前 380 万，比目标慢

回款
- 星河 2 期尾款 126 万卡在验收，何书婷催了两次
- 清和 48 万这周能进

其它
- 郑晓彤：续费两家在观望，一家明确要看星河验收结果再签
- 陈嘉禾让出一页能直接转管理层的周报，别再贴站会原文
`

const XINGHE_RISK = `客户风险备忘 星河 / 内部勿外发

项目：星河智能仓储一期+二期
合同额：一期已确认 860 万；二期尾款 126 万，验收通过后 10 个工作日内付款
我方承诺：按期交付率 95%（例会纪要 8/21，陈嘉禾在场）
现状：
1. 客户验收条款从“功能清单”改成“连续 7 天无 P1”
2. 对方法务还要补充违约金上限
3. 若 9 月内验收不掉，二期尾款和续费都会一起停

建议：本周给林总一版可执行的风险说明，负责人苏明远 / 何书婷，不要写“风险已解除”。
`

const WEEKLY_NUMBERS = `# 本周数字（财务草稿，未对外）

- 本周确认收入：186 万（含清和 48 万）
- 本月累计确认收入：612 万
- 毛利率（月累计）：67.1%
- 在手订单：星河二期尾款 126 万；清和已回款
- 续费率（滚动 12 个月）：124%
- 本周新增线索 11 个，其中 3 个进入方案阶段

口径：收入含订阅，不含未验收的实施尾款。
`

export const seedWordCreateWorkspace = async (): Promise<string> => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-showcase-docx-'))
  await fs.writeFile(path.join(rootPath, '站会纪要-0908.txt'), STANDUP_NOTES, 'utf8')
  await fs.writeFile(path.join(rootPath, '客户风险-星河.txt'), XINGHE_RISK, 'utf8')
  await fs.writeFile(path.join(rootPath, '本周数字.md'), WEEKLY_NUMBERS, 'utf8')
  return rootPath
}
