import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const tex = new TeX({ packages: AllPackages })
const svgOutput = new SVG({ fontCache: 'none' })
const document = mathjax.document('', { InputJax: tex, OutputJax: svgOutput })

export const renderLatexToSvg = (latex: string): string => {
  const node = document.convert(String(latex || '').trim(), {
    display: true,
    em: 16,
    ex: 8,
    containerWidth: 1200
  })
  const markup = adaptor.outerHTML(node)
  const start = markup.indexOf('<svg')
  const end = markup.lastIndexOf('</svg>')
  if (start < 0 || end < start) throw new Error('Formula SVG rendering failed')
  return markup.slice(start, end + '</svg>'.length)
}
