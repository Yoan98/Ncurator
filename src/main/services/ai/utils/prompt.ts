import { renderLineList, renderNamedSections } from './render'

export const renderPromptSections = (sections: Array<{ label: string; value: string }>) => {
  return renderNamedSections(sections, {
    fallback: '(none)',
    style: 'plain'
  })
}

export const renderEvidenceLines = (lines: string[]) => {
  return renderLineList(lines, {
    fallback: '(none)',
    style: 'plain'
  })
}
