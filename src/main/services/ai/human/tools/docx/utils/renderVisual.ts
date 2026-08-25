import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { BrowserWindow } from 'electron'
import type { DocxVisualKind } from '../types'

type RenderRect = { x: number; y: number; width: number; height: number }

const require = createRequire(import.meta.url)

export const renderDocxVisualToPng = async (input: {
  sourcePath: string
  kind: DocxVisualKind
  nodeIndex: number
  visualIndexInNode: number
  visualCountInNode: number
}): Promise<{ data?: Buffer; error?: string }> => {
  if (typeof BrowserWindow !== 'function') {
    return { error: 'DOCX visual rendering requires the Electron browser runtime' }
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-docx-render-'))
  let window: BrowserWindow | undefined
  try {
    const scriptUrl = pathToFileURL(require.resolve('@js-preview/docx/lib/index.umd.js')).href
    const styleUrl = pathToFileURL(require.resolve('@js-preview/docx/lib/index.css')).href
    const htmlPath = path.join(tempDir, 'render.html')
    await fs.writeFile(
      htmlPath,
      `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${styleUrl}"><style>html,body{margin:0;background:#fff}#root{width:max-content;min-width:1200px}</style></head><body><div id="root"></div><script src="${scriptUrl}"></script><script>
window.renderDocxForCapture=async function(base64,binding){
  const binary=atob(base64); const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i);
  const preview=window.jsPreviewDocx.init(document.getElementById('root'),{breakPages:true,useBase64URL:true});
  await preview.preview(bytes.buffer);
  if(document.fonts&&document.fonts.ready) await document.fonts.ready;
  await new Promise(resolve=>setTimeout(resolve,100));
  const root=document.getElementById('root');
  let nodes=Array.from(root.querySelectorAll('section.docx > article')).flatMap(article=>
    Array.from(article.children).filter(element=>['P','TABLE'].includes(element.tagName))
  );
  if(nodes.length===0){
    nodes=Array.from(root.querySelectorAll('p,table')).filter(element=>{
      const parent=element.parentElement&&element.parentElement.closest('p,table');
      return !parent;
    });
  }
  const node=nodes[binding.nodeIndex];
  if(!node) return {error:'DOCX preview owner node was not found'};
  const candidates=Array.from(node.querySelectorAll('img,svg,canvas')).map((element)=>{
    const rect=element.getBoundingClientRect();
    return {x:rect.left+window.scrollX,y:rect.top+window.scrollY,width:rect.width,height:rect.height};
  }).filter(rect=>rect.width>=8&&rect.height>=8);
  if(candidates.length===binding.visualCountInNode){
    const rect=candidates[binding.visualIndexInNode];
    return rect?{rect}:{error:'DOCX preview visual binding was not found'};
  }
  if(binding.visualCountInNode===1){
    if(candidates.length===0){
      const rect=node.getBoundingClientRect();
      return {rect:{x:rect.left+window.scrollX,y:rect.top+window.scrollY,width:rect.width,height:rect.height}};
    }
    const left=Math.min(...candidates.map(rect=>rect.x));
    const top=Math.min(...candidates.map(rect=>rect.y));
    const right=Math.max(...candidates.map(rect=>rect.x+rect.width));
    const bottom=Math.max(...candidates.map(rect=>rect.y+rect.height));
    return {rect:{x:left,y:top,width:right-left,height:bottom-top}};
  }
  return {error:'DOCX preview visual binding is ambiguous'};
};
</script></body></html>`,
      'utf8'
    )
    window = new BrowserWindow({
      show: false,
      width: 1400,
      height: 1000,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    await window.loadFile(htmlPath)
    const base64 = (await fs.readFile(input.sourcePath)).toString('base64')
    const rendered = (await window.webContents.executeJavaScript(
      `window.renderDocxForCapture(${JSON.stringify(base64)},${JSON.stringify({
        kind: input.kind,
        nodeIndex: input.nodeIndex,
        visualIndexInNode: input.visualIndexInNode,
        visualCountInNode: input.visualCountInNode
      })})`,
      true
    )) as { rect?: RenderRect; error?: string }
    const rect = rendered.rect
    if (!rect) return { error: rendered.error || 'DOCX preview visual binding was not found' }
    const width = Math.max(1, Math.ceil(rect.width))
    const height = Math.max(1, Math.ceil(rect.height))
    window.setContentSize(
      Math.max(1400, Math.ceil(rect.x + width)),
      Math.max(1000, Math.ceil(rect.y + height))
    )
    const image = await window.webContents.capturePage({
      x: Math.max(0, Math.floor(rect.x)),
      y: Math.max(0, Math.floor(rect.y)),
      width,
      height
    })
    const data = image.toPNG()
    return data.byteLength > 0 ? { data } : { error: 'DOCX preview produced an empty visual image' }
  } catch (error) {
    return {
      error: `DOCX preview rendering failed: ${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    window?.destroy()
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}
