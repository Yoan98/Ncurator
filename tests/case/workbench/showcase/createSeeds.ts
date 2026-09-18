import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createElement } from 'react'
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer
} from '@react-pdf/renderer'

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

export const PDF_FILE_NAME = '星河项目服务合同.pdf'
export const PDF_PROMPT = '@星河项目服务合同.pdf 尾款什么时候付？'

export const COURT_SEARCH_PROMPT =
  '我最近在处理一个建设工程合同纠纷，想参考一下最高法有没有类似的典型案例。你帮我去最高人民法院官网找几个和建设工程施工合同纠纷比较接近的案例，重点看看法院对工程款结算、违约责任这些问题是怎么认定的，把比较有参考价值的几个案例整理给我。'
export const COURT_SEARCH_KEYWORDS = ['建设工程', '施工合同', '工程款']
export const COURT_SEARCH_HOST = 'www.court.gov.cn'

export const KB_PROMPT =
  '星河林总来问交付承诺和验收到底怎么算。你先在本地资料里对一下，按能对上的依据回一封，我直接转给他。对不上的别编，标出来。'

export const WEB_SEARCH_PROMPT =
  '帮我查一下企业员工国内差旅，住宿和交通税前扣除现在是什么口径。列出来源，写成财务能照着执行的注意点，不要编。'

export const KB_MEETING_FILE = '星河例会纪要-0821.txt'
export const KB_ACCEPTANCE_FILE = '星河验收口径.md'
export const KB_QUOTE_FILE = '星河报价口径.md'
export const KB_DISTRACTOR_FILE = '清和项目例会.txt'

export const KB_SOURCE_PAGES = [
  {
    fileName: KB_MEETING_FILE,
    label: '例会',
    title: '星河项目例会纪要（8月21日）'
  },
  {
    fileName: KB_ACCEPTANCE_FILE,
    label: '验收',
    title: '星河验收口径备忘'
  }
] as const

const KB_MEETING_NOTES = `星河项目例会 8/21 内部纪要
出席：陈嘉禾、苏明远、何书婷、交付一组

承诺
- 陈嘉禾当场对林总说：按期交付率 95%。这条已经写进纪要，后续对外口径以这次为准。
- 一期已上线模块按原计划走；二期验收另说，不和 95% 混在一起。

待办
- 苏明远本周把「按期」的统计口径发给林总助理，避免客户按自然日理解。
- 何书婷跟进二期尾款节点，验收没过之前不要承诺付款日。

备注：本纪要未讨论报价折扣，报价见单独口径文件。
`

const KB_ACCEPTANCE_NOTES = `# 星河验收口径备忘（内部）

客户把验收从「功能清单完成」改成「连续 7 天无 P1」。苏明远 9/3 同步。

## 现在怎么算通过
- 功能可以先按清单点完，但客户只认连续 7 个自然日没有 P1。
- 培训完成、数据迁移核对仍要做，但不替代这 7 天。
- 出现 P1 后重新起算，不要口头说「差不多就算过」。

## 还没写进合同的
- 违约金上限对方法务还在要。本地资料里没有最终数字，对外不要编。
`

const KB_QUOTE_NOTES = `# 星河报价口径（销售备忘）

- 一期合同额 860 万，已确认。
- 二期实施费不在本次回复范围，林总问交付时不要主动讲折扣。
- 续费折扣要等星河验收结果，郑晓彤那边两家在观望。
`

const KB_DISTRACTOR_NOTES = `清和项目例会 9/5

- 清和这周回款 48 万，何书婷说已经进账。
- 清和没有 95% 交付承诺，他们验收按功能清单，当天签字就算过。
- 不要把清和口径套到星河邮件里。
`

const CONTRACT_FONT_FAMILY = 'ContractFont'
const CONTRACT_FONT_PATH = '/Library/Fonts/Arial Unicode.ttf'
let contractFontRegistered = false

const registerContractFont = (): void => {
  if (contractFontRegistered) return
  Font.register({
    family: CONTRACT_FONT_FAMILY,
    src: CONTRACT_FONT_PATH
  })
  Font.registerHyphenationCallback((word) => {
    const parts: string[] = []
    for (const char of word) parts.push(char, '')
    parts.pop()
    return parts.length > 0 ? parts : [word]
  })
  contractFontRegistered = true
}

const contractStyles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 54,
    paddingHorizontal: 52,
    fontFamily: CONTRACT_FONT_FAMILY,
    fontSize: 11,
    lineHeight: 1.65,
    color: '#1F1F1F'
  },
  title: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 6
  },
  meta: {
    fontSize: 10,
    color: '#5F5B55',
    textAlign: 'center',
    marginBottom: 18
  },
  parties: {
    marginBottom: 12
  },
  party: {
    marginBottom: 4
  },
  heading: {
    fontSize: 12,
    marginTop: 12,
    marginBottom: 6
  },
  p: {
    marginBottom: 6
  },
  item: {
    paddingLeft: 16,
    marginBottom: 5
  },
  emphasize: {
    marginTop: 4,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 0.8,
    borderColor: '#C9C4BB',
    backgroundColor: '#F7F4EE'
  },
  signRow: {
    marginTop: 28,
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  signBlock: {
    width: '46%'
  },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 52,
    right: 52,
    fontSize: 9,
    color: '#8D8880',
    textAlign: 'center'
  }
})

const ContractPageFooter = ({ pageNumber }: { pageNumber: number }) =>
  createElement(
    Text,
    { style: contractStyles.footer, fixed: true },
    `星河智能仓储项目技术服务合同  第 ${pageNumber} 页 / 共 2 页  密级：内部`
  )

export const generateXingheContractPdf = async (): Promise<Buffer> => {
  registerContractFont()
  const document = createElement(
    Document,
    { title: '星河智能仓储项目技术服务合同', author: '武汉云枢智服科技有限公司' },
    createElement(
      Page,
      { size: 'A4', style: contractStyles.page },
      createElement(Text, { style: contractStyles.title }, '星河智能仓储项目技术服务合同'),
      createElement(
        Text,
        { style: contractStyles.meta },
        '合同编号：YSZF-XH-2026-0912    签订地：武汉    签订日期：2026年6月18日'
      ),
      createElement(
        View,
        { style: contractStyles.parties },
        createElement(
          Text,
          { style: contractStyles.party },
          '甲方（委托方）：星河智能仓储有限公司'
        ),
        createElement(
          Text,
          { style: contractStyles.party },
          '地址：上海市浦东新区张江路 88 号    联系人：林总 / 法务部'
        ),
        createElement(
          Text,
          { style: contractStyles.party },
          '乙方（服务方）：武汉云枢智服科技有限公司'
        ),
        createElement(
          Text,
          { style: contractStyles.party },
          '地址：武汉市东湖高新区光谷大道 77 号    联系人：陈嘉禾 / 苏明远'
        )
      ),
      createElement(Text, { style: contractStyles.heading }, '第一条  项目内容'),
      createElement(
        Text,
        { style: contractStyles.p },
        '1.1 甲方委托乙方实施「星河智能仓储」一期及二期软件交付、联调、培训与上线支持。一期含仓储主数据、出入库与盘点；二期含波次调度、异常闭环与经营看板。'
      ),
      createElement(
        Text,
        { style: contractStyles.p },
        '1.2 工作地点以甲方指定仓库及远程支持相结合。未经甲方书面同意，乙方不得将本项目转包。'
      ),
      createElement(Text, { style: contractStyles.heading }, '第二条  合同金额'),
      createElement(
        Text,
        { style: contractStyles.p },
        '2.1 本合同含税总价为人民币玖佰捌拾陆万元整（¥9,860,000.00），其中一期人民币捌佰陆拾万元整，二期人民币壹佰贰拾陆万元整。'
      ),
      createElement(
        Text,
        { style: contractStyles.p },
        '2.2 上述价格已包含实施、培训、质保期内缺陷修复，不含甲方原因导致的范围变更。'
      ),
      createElement(Text, { style: contractStyles.heading }, '第三条  付款方式'),
      createElement(
        Text,
        { style: contractStyles.item },
        '3.1 首付款：本合同签署后五个工作日内，甲方支付合同总额百分之四十，即人民币叁佰玖拾肆万肆仟元整（¥3,944,000.00）。'
      ),
      createElement(
        Text,
        { style: contractStyles.item },
        '3.2 进度款：一期上线确认后十个工作日内，甲方支付合同总额百分之四十，即人民币叁佰玖拾肆万肆仟元整（¥3,944,000.00）。'
      ),
      createElement(
        View,
        { style: contractStyles.emphasize },
        createElement(
          Text,
          null,
          '3.3 尾款：项目终验通过后十个工作日内，甲方一次性支付剩余合同总额百分之二十，即人民币壹佰玖拾柒万贰仟元整（¥1,972,000.00）。尾款支付前，乙方应提交终验报告、问题关闭清单及质保承诺函。'
        )
      ),
      createElement(
        Text,
        { style: contractStyles.p },
        '3.4 甲方以银行转账方式付款。如因验收争议暂停付款，应在五个工作日内书面说明理由。'
      ),
      ContractPageFooter({ pageNumber: 1 })
    ),
    createElement(
      Page,
      { size: 'A4', style: contractStyles.page },
      createElement(Text, { style: contractStyles.heading }, '第四条  验收'),
      createElement(
        Text,
        { style: contractStyles.p },
        '4.1 验收以双方确认的功能清单为准。终验标准为：核心流程连续七个自然日无 P1 故障，培训完成，并完成数据迁移核对。'
      ),
      createElement(
        Text,
        { style: contractStyles.p },
        '4.2 甲方应在收到终验申请后十个工作日内组织验收；逾期未书面提出异议的，视为终验通过。'
      ),
      createElement(
        Text,
        { style: contractStyles.p },
        '4.3 因甲方资料、接口或现场环境造成的延误，工期相应顺延，不视为乙方逾期。'
      ),
      createElement(Text, { style: contractStyles.heading }, '第五条  违约责任'),
      createElement(
        Text,
        { style: contractStyles.p },
        '5.1 乙方逾期交付的，每逾期一日按合同总额万分之三支付违约金，累计不超过合同总额百分之十。'
      ),
      createElement(
        Text,
        { style: contractStyles.p },
        '5.2 甲方逾期付款的，每逾期一日按应付未付金额万分之三支付违约金。尾款逾期超过三十日的，乙方可暂停质保支持。'
      ),
      createElement(Text, { style: contractStyles.heading }, '第六条  其他'),
      createElement(
        Text,
        { style: contractStyles.p },
        '6.1 本合同一式两份，双方各执一份，自盖章之日起生效。未尽事宜另行签订补充协议。'
      ),
      createElement(
        Text,
        { style: contractStyles.p },
        '6.2 因本合同引起的争议，双方先协商；协商不成的，提交武汉仲裁委员会仲裁。'
      ),
      createElement(
        View,
        { style: contractStyles.signRow },
        createElement(
          View,
          { style: contractStyles.signBlock },
          createElement(Text, { style: contractStyles.p }, '甲方（盖章）：星河智能仓储有限公司'),
          createElement(Text, { style: contractStyles.p }, '授权代表：林  启'),
          createElement(Text, { style: contractStyles.p }, '日期：2026年6月18日')
        ),
        createElement(
          View,
          { style: contractStyles.signBlock },
          createElement(Text, { style: contractStyles.p }, '乙方（盖章）：武汉云枢智服科技有限公司'),
          createElement(Text, { style: contractStyles.p }, '授权代表：陈嘉禾'),
          createElement(Text, { style: contractStyles.p }, '日期：2026年6月18日')
        )
      ),
      ContractPageFooter({ pageNumber: 2 })
    )
  )
  return Buffer.from(await renderToBuffer(document))
}

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

export const seedPdfContractWorkspace = async (): Promise<string> => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-showcase-pdf-'))
  await fs.writeFile(path.join(rootPath, PDF_FILE_NAME), await generateXingheContractPdf())
  return rootPath
}

export const seedKnowledgeWorkspace = async (): Promise<string> => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-showcase-kb-'))
  await fs.writeFile(path.join(rootPath, KB_MEETING_FILE), KB_MEETING_NOTES, 'utf8')
  await fs.writeFile(path.join(rootPath, KB_ACCEPTANCE_FILE), KB_ACCEPTANCE_NOTES, 'utf8')
  await fs.writeFile(path.join(rootPath, KB_QUOTE_FILE), KB_QUOTE_NOTES, 'utf8')
  await fs.writeFile(path.join(rootPath, KB_DISTRACTOR_FILE), KB_DISTRACTOR_NOTES, 'utf8')
  return rootPath
}
