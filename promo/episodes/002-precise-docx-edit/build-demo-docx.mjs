import fs from 'node:fs/promises'
import path from 'node:path'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType
} from 'docx'

const episodeDir = path.resolve(path.dirname(new URL(import.meta.url).pathname))
const outputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(episodeDir, 'assets', 'raw', 'demo-workspace', '星桥项目实施方案.docx')

const COLORS = {
  navy: '1F4D78',
  blue: '2E74B5',
  ink: '24313E',
  body: '37352F',
  muted: '6F7782',
  line: 'D9DEE5',
  tableHeader: 'F2F4F7',
  softBlue: 'EAF2FA',
  white: 'FFFFFF'
}

const PAGE = {
  width: 12240,
  height: 15840,
  margin: 1440,
  header: 708,
  footer: 708,
  contentWidth: 9360
}

const baseFont = {
  ascii: 'Calibri',
  hAnsi: 'Calibri',
  eastAsia: 'Microsoft YaHei',
  cs: 'Calibri'
}

const bodyRun = (text, options = {}) =>
  new TextRun({
    text,
    font: baseFont,
    size: 22,
    color: COLORS.body,
    ...options
  })

const bodyParagraph = (children, options = {}) =>
  new Paragraph({
    children: Array.isArray(children) ? children : [bodyRun(children)],
    spacing: { before: 0, after: 120, line: 264 },
    ...options
  })

const heading = (text) =>
  new Paragraph({
    style: 'DemoHeading1',
    children: [new TextRun({ text, font: baseFont, size: 32, bold: true, color: COLORS.blue })]
  })

const sectionLabel = (text) =>
  new Paragraph({
    spacing: { before: 0, after: 100 },
    children: [
      new TextRun({
        text,
        font: baseFont,
        size: 20,
        bold: true,
        color: COLORS.blue,
        characterSpacing: 24
      })
    ]
  })

const borders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.line },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.line },
  left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.line },
  right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.line },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 3, color: COLORS.line },
  insideVertical: { style: BorderStyle.SINGLE, size: 3, color: COLORS.line }
}

const cellParagraph = (text, { bold = false, color = COLORS.body, alignment } = {}) =>
  new Paragraph({
    alignment,
    spacing: { before: 0, after: 0, line: 260 },
    children: [new TextRun({ text, font: baseFont, size: 21, bold, color })]
  })

const tableCell = (text, width, options = {}) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    verticalAlign: VerticalAlignTable.CENTER,
    shading: options.fill
      ? { type: ShadingType.CLEAR, color: 'auto', fill: options.fill }
      : undefined,
    children: [
      cellParagraph(text, {
        bold: options.bold,
        color: options.color,
        alignment: options.alignment
      })
    ]
  })

const header = new Header({
  children: [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 0 },
      children: [
        new TextRun({
          text: '星桥项目 · 实施方案',
          font: baseFont,
          size: 18,
          color: COLORS.muted
        })
      ]
    })
  ]
})

const footer = new Footer({
  children: [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 0 },
      children: [
        new TextRun({ text: '内部资料  |  ', font: baseFont, size: 18, color: COLORS.muted }),
        new TextRun({ children: [PageNumber.CURRENT], font: baseFont, size: 18, color: COLORS.muted })
      ]
    })
  ]
})

const divisionTable = new Table({
  width: { size: PAGE.contentWidth, type: WidthType.DXA },
  indent: { size: 120, type: WidthType.DXA },
  columnWidths: [2800, 2200, 4360],
  layout: TableLayoutType.FIXED,
  borders,
  rows: [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [
        tableCell('职责', 2800, { bold: true, fill: COLORS.tableHeader, color: COLORS.ink }),
        tableCell('负责人', 2200, {
          bold: true,
          fill: COLORS.tableHeader,
          color: COLORS.ink,
          alignment: AlignmentType.CENTER
        }),
        tableCell('主要交付物', 4360, { bold: true, fill: COLORS.tableHeader, color: COLORS.ink })
      ]
    }),
    new TableRow({
      cantSplit: true,
      children: [
        tableCell('项目统筹', 2800),
        tableCell('王静', 2200, { alignment: AlignmentType.CENTER }),
        tableCell('实施计划、跨团队协调与最终验收', 4360)
      ]
    }),
    new TableRow({
      cantSplit: true,
      children: [
        tableCell('技术负责人', 2800),
        tableCell('周航', 2200, { alignment: AlignmentType.CENTER }),
        tableCell('部署方案、监控配置与故障处理', 4360)
      ]
    }),
    new TableRow({
      cantSplit: true,
      children: [
        tableCell('测试负责人', 2800),
        tableCell('林桐', 2200, { alignment: AlignmentType.CENTER }),
        tableCell('回归测试、验收用例与上线检查', 4360)
      ]
    })
  ]
})

const doc = new Document({
  creator: '馆长演示素材',
  title: '星桥项目实施方案',
  subject: 'DOCX 精细修改演示',
  description: '用于馆长宣传视频的虚构项目实施方案。',
  styles: {
    default: {
      document: {
        run: { font: baseFont, size: 22, color: COLORS.body },
        paragraph: { spacing: { after: 120, line: 264 } }
      }
    },
    paragraphStyles: [
      {
        id: 'DemoHeading1',
        name: 'Demo Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: baseFont, size: 32, bold: true, color: COLORS.blue },
        paragraph: { spacing: { before: 320, after: 160, line: 300 }, keepNext: true, outlineLevel: 0 }
      }
    ]
  },
  numbering: {
    config: [
      {
        reference: 'risk-bullets',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 540, hanging: 260 },
                spacing: { after: 100, line: 280 }
              },
              run: { font: baseFont, size: 22, color: COLORS.body }
            }
          }
        ]
      }
    ]
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE.width, height: PAGE.height },
          margin: {
            top: PAGE.margin,
            right: PAGE.margin,
            bottom: PAGE.margin,
            left: PAGE.margin,
            header: PAGE.header,
            footer: PAGE.footer
          }
        }
      },
      headers: { default: header },
      footers: { default: footer },
      children: [
        new Paragraph({ spacing: { before: 1160, after: 160 } }),
        sectionLabel('项目实施方案'),
        new Paragraph({
          spacing: { before: 0, after: 160, line: 620 },
          children: [
            new TextRun({
              text: '星桥项目上线实施方案',
              font: baseFont,
              size: 60,
              bold: true,
              color: COLORS.navy
            })
          ]
        }),
        new Paragraph({
          spacing: { before: 0, after: 520, line: 360 },
          children: [
            new TextRun({
              text: '从开发收口到生产上线的执行计划',
              font: baseFont,
              size: 28,
              color: COLORS.muted
            })
          ]
        }),
        new Table({
          width: { size: PAGE.contentWidth, type: WidthType.DXA },
          indent: { size: 120, type: WidthType.DXA },
          columnWidths: [4680, 4680],
          layout: TableLayoutType.FIXED,
          borders: {
            top: { style: BorderStyle.NONE, size: 0, color: COLORS.white },
            bottom: { style: BorderStyle.NONE, size: 0, color: COLORS.white },
            left: { style: BorderStyle.NONE, size: 0, color: COLORS.white },
            right: { style: BorderStyle.NONE, size: 0, color: COLORS.white },
            insideHorizontal: { style: BorderStyle.NONE, size: 0, color: COLORS.white },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: COLORS.white }
          },
          rows: [
            new TableRow({
              children: [
                tableCell('文档版本\nV1.0', 4680, { fill: COLORS.softBlue, bold: true, color: COLORS.navy }),
                tableCell('编制日期\n2026 年 7 月', 4680, {
                  fill: COLORS.softBlue,
                  bold: true,
                  color: COLORS.navy
                })
              ]
            })
          ]
        }),
        new Paragraph({ children: [new PageBreak()] }),
        heading('一、项目概览'),
        bodyParagraph([
          bodyRun('星桥项目已经完成核心功能开发和联调，当前进入上线准备阶段。项目计划于 '),
          bodyRun('2026 年 8 月 1 日', { bold: true, color: COLORS.navy }),
          bodyRun(' 完成正式上线，并在上线后一周内完成运行复盘。')
        ]),
        bodyParagraph('本阶段重点包括环境检查、数据准备、回归测试和上线值守，所有变更必须在验收清单中留痕。'),
        heading('二、项目分工'),
        bodyParagraph('各角色按照下表完成上线前准备，并在每日同步会上确认阻塞事项。'),
        divisionTable,
        heading('三、风险与应对'),
        bodyParagraph('上线前需要重点控制以下风险，任何一项未完成都不得进入正式发布窗口。'),
        new Paragraph({
          numbering: { reference: 'risk-bullets', level: 0 },
          children: [bodyRun('上线前一周完成全量回归测试。')]
        }),
        new Paragraph({
          numbering: { reference: 'risk-bullets', level: 0 },
          children: [bodyRun('关键接口准备降级方案，并明确恢复条件。')]
        }),
        new Paragraph({
          numbering: { reference: 'risk-bullets', level: 0 },
          children: [bodyRun('出现异常时由技术负责人统一协调，避免多人重复操作。')]
        })
      ]
    }
  ]
})

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, await Packer.toBuffer(doc))
console.log(outputPath)
