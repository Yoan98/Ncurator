import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const outputPath = path.join(root, 'tests/fixtures/workspace/docx-visual-kinds.docx')

const svg = (
  label,
  color,
  detail
) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="280" viewBox="0 0 640 280">
  <rect width="640" height="280" fill="#ffffff"/>
  <rect x="18" y="18" width="604" height="244" rx="12" fill="${color}" opacity="0.12" stroke="${color}" stroke-width="4"/>
  <text x="44" y="72" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="${color}">${label}</text>
  ${detail}
</svg>`

const previews = {
  chart: svg(
    'CHART',
    '#176B87',
    '<rect x="70" y="180" width="72" height="48" fill="#176B87"/><rect x="180" y="132" width="72" height="96" fill="#2E8A99"/><rect x="290" y="92" width="72" height="136" fill="#64CCC5"/><path d="M70 214 L216 150 L326 112 L530 58" fill="none" stroke="#D9485F" stroke-width="8"/>'
  ),
  diagram: svg(
    'DIAGRAM',
    '#3F7D58',
    '<rect x="48" y="132" width="132" height="64" rx="8" fill="#3F7D58"/><rect x="254" y="132" width="132" height="64" rx="8" fill="#5C9E72"/><rect x="460" y="132" width="132" height="64" rx="8" fill="#82C091"/><path d="M180 164 H254 M386 164 H460" stroke="#1F5135" stroke-width="8"/>'
  ),
  shape: svg(
    'SHAPE',
    '#8B4A9C',
    '<circle cx="174" cy="170" r="58" fill="#8B4A9C"/><polygon points="320,100 384,220 256,220" fill="#C07BD1"/><rect x="452" y="112" width="118" height="118" rx="22" fill="#633273"/>'
  )
}

const png = (label, color) => {
  const canvas = createCanvas(640, 280)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, 640, 280)
  context.fillStyle = '#e8f1f5'
  context.fillRect(18, 18, 604, 244)
  context.strokeStyle = color
  context.lineWidth = 4
  context.strokeRect(18, 18, 604, 244)
  context.fillStyle = color
  context.font = 'bold 42px Arial'
  context.fillText(label, 44, 78)
  context.fillRect(54, 124, 220, 92)
  context.beginPath()
  context.arc(390, 170, 62, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#d9485f'
  context.fillRect(486, 112, 94, 116)
  return canvas.toBuffer('image/png')
}

const imagePng = png('IMAGE', '#176b87')
const olePng = png('EMBEDDED OBJECT', '#6b4f8a')

const picture = (relationshipId, name) => `<w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="6096000" cy="2667000"/>
    <wp:docPr id="1" name="${name}"/>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
      <pic:pic>
        <pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>
        <pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
        <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="2667000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
      </pic:pic>
    </a:graphicData></a:graphic>
  </wp:inline>
</w:drawing>`

const alternateVisual = (requires, choice, fallbackRelationshipId, name) =>
  `<mc:AlternateContent><mc:Choice Requires="${requires}">${choice}</mc:Choice><mc:Fallback>${picture(
    fallbackRelationshipId,
    `${name} preview`
  )}</mc:Fallback></mc:AlternateContent>`

const chartChoice = `<w:drawing><wp:inline><wp:extent cx="6096000" cy="2667000"/><wp:docPr id="2" name="Chart"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rChart"/></a:graphicData></a:graphic></wp:inline></w:drawing>`
const diagramChoice = `<w:drawing><wp:inline><wp:extent cx="6096000" cy="2667000"/><wp:docPr id="3" name="Diagram"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds r:dm="rDiagramData" r:lo="rDiagramLayout" r:qs="rDiagramStyle" r:cs="rDiagramColors"/></a:graphicData></a:graphic></wp:inline></w:drawing>`
const shapeChoice = `<w:drawing><wp:inline><wp:extent cx="6096000" cy="2667000"/><wp:docPr id="4" name="Shape"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Shape textbox</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>`

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  mc:Ignorable="wps">
  <w:body>
    <w:p><w:r><w:t>DOCX visual kinds fixture</w:t></w:r></w:p>
    <w:p><w:r>${picture('rImage', 'Image')}</w:r></w:p>
    <w:p><w:r>${alternateVisual('c', chartChoice, 'rChartPreview', 'Chart')}</w:r></w:p>
    <w:p><w:r>${alternateVisual('dgm', diagramChoice, 'rDiagramPreview', 'Diagram')}</w:r></w:p>
    <w:p><w:r>${alternateVisual('wps', shapeChoice, 'rShapePreview', 'Shape')}</w:r></w:p>
    <w:p><w:r><w:object>
      <v:shape id="ole-preview" style="width:240pt;height:120pt"><v:imagedata r:id="rOlePreview"/></v:shape>
      <o:OLEObject Type="Embed" ProgID="Package" ShapeID="ole-preview" r:id="rOle"/>
    </w:object></w:r></w:p>
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>
  </w:body>
</w:document>`

const relationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/>
  <Relationship Id="rChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/>
  <Relationship Id="rChartPreview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.svg"/>
  <Relationship Id="rDiagramData" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="diagrams/data1.xml"/>
  <Relationship Id="rDiagramLayout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout" Target="diagrams/layout1.xml"/>
  <Relationship Id="rDiagramStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle" Target="diagrams/quickStyle1.xml"/>
  <Relationship Id="rDiagramColors" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors" Target="diagrams/colors1.xml"/>
  <Relationship Id="rDiagramPreview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/diagram.svg"/>
  <Relationship Id="rShapePreview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/shape.svg"/>
  <Relationship Id="rOlePreview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/ole.png"/>
  <Relationship Id="rOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/>
</Relationships>`

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
  <Override PartName="/word/diagrams/data1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml"/>
  <Override PartName="/word/diagrams/layout1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml"/>
  <Override PartName="/word/diagrams/quickStyle1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml"/>
  <Override PartName="/word/diagrams/colors1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml"/>
</Types>`

const zip = new JSZip()
zip.file('[Content_Types].xml', contentTypesXml)
zip.file(
  '_rels/.rels',
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
)
zip.file('word/document.xml', documentXml)
zip.file('word/_rels/document.xml.rels', relationshipsXml)
zip.file(
  'word/charts/chart1.xml',
  '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/></c:barChart></c:plotArea></c:chart></c:chartSpace>'
)
zip.file(
  'word/diagrams/data1.xml',
  '<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:ptLst/><dgm:cxnLst/></dgm:dataModel>'
)
zip.file(
  'word/diagrams/layout1.xml',
  '<dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" uniqueId="fixture"><dgm:title val="Fixture"/></dgm:layoutDef>'
)
zip.file(
  'word/diagrams/quickStyle1.xml',
  '<dgm:styleDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" uniqueId="fixture"/>'
)
zip.file(
  'word/diagrams/colors1.xml',
  '<dgm:colorsDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" uniqueId="fixture"/>'
)
zip.file('word/media/image.png', imagePng)
zip.file('word/media/chart.svg', previews.chart)
zip.file('word/media/diagram.svg', previews.diagram)
zip.file('word/media/shape.svg', previews.shape)
zip.file('word/media/ole.png', olePng)
zip.file('word/embeddings/oleObject1.bin', Buffer.from('NCurator embedded object fixture'))

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(
  outputPath,
  await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  })
)
console.log(outputPath)
