import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const resolveSidecarPython = (): string => {
  const override = String(process.env.NCURATOR_SIDECAR_BUILD_PYTHON || '').trim()
  if (override) return override

  const venvRoot = path.join(
    process.cwd(),
    '.runvenv',
    `web_crawler_sidecar-${process.platform}-${process.arch}`
  )
  const candidates =
    process.platform === 'win32'
      ? [path.join(venvRoot, 'Scripts', 'python.exe'), 'python']
      : [path.join(venvRoot, 'bin', 'python'), 'python3']

  return candidates.find((candidate) => !path.isAbsolute(candidate) || fs.existsSync(candidate))!
}

describe('web crawler sidecar search retry', () => {
  it('connects Crawl4AI to Electron CDP with an isolated browser context', async () => {
    const script = String.raw`
import importlib.util
import json
import os
import sys
import types
from pathlib import Path

class DependencyStub:
    pass

class BrowserConfigStub:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

crawl4ai = types.ModuleType("crawl4ai")
crawl4ai.AsyncWebCrawler = DependencyStub
crawl4ai.BrowserConfig = BrowserConfigStub
crawl4ai.CrawlerRunConfig = DependencyStub
crawl4ai.LinkPreviewConfig = DependencyStub
content_filter_strategy = types.ModuleType("crawl4ai.content_filter_strategy")
content_filter_strategy.PruningContentFilter = DependencyStub
markdown_generation_strategy = types.ModuleType("crawl4ai.markdown_generation_strategy")
markdown_generation_strategy.DefaultMarkdownGenerator = DependencyStub
async_crawler_strategy = types.ModuleType("crawl4ai.async_crawler_strategy")
async_crawler_strategy.AsyncPlaywrightCrawlerStrategy = DependencyStub
browser_manager = types.ModuleType("crawl4ai.browser_manager")
browser_manager.BrowserManager = DependencyStub
ddgs = types.ModuleType("ddgs")
ddgs.DDGS = DependencyStub
sys.modules["crawl4ai"] = crawl4ai
sys.modules["crawl4ai.content_filter_strategy"] = content_filter_strategy
sys.modules["crawl4ai.markdown_generation_strategy"] = markdown_generation_strategy
sys.modules["crawl4ai.async_crawler_strategy"] = async_crawler_strategy
sys.modules["crawl4ai.browser_manager"] = browser_manager
sys.modules["ddgs"] = ddgs

os.environ["NCURATOR_WEB_CRAWLER_CDP_URL"] = "ws://127.0.0.1:9222/devtools/browser/test"
os.environ["NCURATOR_WEB_CRAWLER_CDP_CONTEXT_MARKER_URL"] = "about:blank#ncurator-web-crawler-test"

sidecar_path = Path("resources/web_crawler_sidecar/web_crawler_sidecar.py").resolve()
spec = importlib.util.spec_from_file_location("web_crawler_sidecar_cdp_test", sidecar_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps(module.build_browser_config().kwargs))
`
    const { stdout } = await execFileAsync(resolveSidecarPython(), ['-c', script], {
      cwd: process.cwd(),
      timeout: 30_000
    })

    expect(JSON.parse(stdout.trim())).toEqual({
      browser_mode: 'cdp',
      cdp_url: 'ws://127.0.0.1:9222/devtools/browser/test',
      cache_cdp_connection: true,
      create_isolated_context: false,
      cdp_cleanup_on_close: true,
      cdp_close_delay: 0,
      headless: true,
      verbose: false
    })
  })

  it('retries transient ddgs failures without exposing attempts in the result', async () => {
    const script = String.raw`
import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

class DependencyStub:
    pass

crawl4ai = types.ModuleType("crawl4ai")
crawl4ai.AsyncWebCrawler = DependencyStub
crawl4ai.BrowserConfig = DependencyStub
crawl4ai.CrawlerRunConfig = DependencyStub
crawl4ai.LinkPreviewConfig = DependencyStub
content_filter_strategy = types.ModuleType("crawl4ai.content_filter_strategy")
content_filter_strategy.PruningContentFilter = DependencyStub
markdown_generation_strategy = types.ModuleType("crawl4ai.markdown_generation_strategy")
markdown_generation_strategy.DefaultMarkdownGenerator = DependencyStub
async_crawler_strategy = types.ModuleType("crawl4ai.async_crawler_strategy")
async_crawler_strategy.AsyncPlaywrightCrawlerStrategy = DependencyStub
browser_manager = types.ModuleType("crawl4ai.browser_manager")
browser_manager.BrowserManager = DependencyStub
ddgs = types.ModuleType("ddgs")
ddgs.DDGS = DependencyStub
sys.modules["crawl4ai"] = crawl4ai
sys.modules["crawl4ai.content_filter_strategy"] = content_filter_strategy
sys.modules["crawl4ai.markdown_generation_strategy"] = markdown_generation_strategy
sys.modules["crawl4ai.async_crawler_strategy"] = async_crawler_strategy
sys.modules["crawl4ai.browser_manager"] = browser_manager
sys.modules["ddgs"] = ddgs

sidecar_path = Path("resources/web_crawler_sidecar/web_crawler_sidecar.py").resolve()
spec = importlib.util.spec_from_file_location("web_crawler_sidecar_under_test", sidecar_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.resolve_search_retry_delay = lambda attempt: 0

class FakeDDGS:
    attempts = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query, max_results):
        FakeDDGS.attempts += 1
        if FakeDDGS.attempts < 3:
            raise RuntimeError("transient ddgs failure")
        return [
            {
                "title": "DeepSeek funding round",
                "href": "https://example.com/deepseek-funding",
                "body": "DeepSeek financing details",
            }
        ]

module.DDGS = FakeDDGS

async def main():
    result = await module.handle_search("DeepSeek funding")
    print(json.dumps({"attempts": FakeDDGS.attempts, "result": result}, ensure_ascii=False))

asyncio.run(main())
`
    const { stdout } = await execFileAsync(resolveSidecarPython(), ['-c', script], {
      cwd: process.cwd(),
      timeout: 30_000
    })
    const payload = JSON.parse(stdout.trim()) as {
      attempts: number
      result: {
        query: string
        results: Array<{ rank: number; title: string; url: string; snippet?: string }>
      }
    }

    expect(payload.attempts).toBe(3)
    expect(payload.result.query).toBe('DeepSeek funding')
    expect(payload.result.results).toEqual([
      {
        rank: 1,
        title: 'DeepSeek funding round',
        url: 'https://example.com/deepseek-funding',
        snippet: 'DeepSeek financing details'
      }
    ])
    expect(Object.keys(payload.result)).toEqual(['query', 'results'])
  })

  it('fails after the configured internal retry limit', async () => {
    const script = String.raw`
import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

class DependencyStub:
    pass

crawl4ai = types.ModuleType("crawl4ai")
crawl4ai.AsyncWebCrawler = DependencyStub
crawl4ai.BrowserConfig = DependencyStub
crawl4ai.CrawlerRunConfig = DependencyStub
crawl4ai.LinkPreviewConfig = DependencyStub
content_filter_strategy = types.ModuleType("crawl4ai.content_filter_strategy")
content_filter_strategy.PruningContentFilter = DependencyStub
markdown_generation_strategy = types.ModuleType("crawl4ai.markdown_generation_strategy")
markdown_generation_strategy.DefaultMarkdownGenerator = DependencyStub
async_crawler_strategy = types.ModuleType("crawl4ai.async_crawler_strategy")
async_crawler_strategy.AsyncPlaywrightCrawlerStrategy = DependencyStub
browser_manager = types.ModuleType("crawl4ai.browser_manager")
browser_manager.BrowserManager = DependencyStub
ddgs = types.ModuleType("ddgs")
ddgs.DDGS = DependencyStub
sys.modules["crawl4ai"] = crawl4ai
sys.modules["crawl4ai.content_filter_strategy"] = content_filter_strategy
sys.modules["crawl4ai.markdown_generation_strategy"] = markdown_generation_strategy
sys.modules["crawl4ai.async_crawler_strategy"] = async_crawler_strategy
sys.modules["crawl4ai.browser_manager"] = browser_manager
sys.modules["ddgs"] = ddgs

sidecar_path = Path("resources/web_crawler_sidecar/web_crawler_sidecar.py").resolve()
spec = importlib.util.spec_from_file_location("web_crawler_sidecar_under_test", sidecar_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.resolve_search_retry_delay = lambda attempt: 0

class FakeDDGS:
    attempts = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def text(self, query, max_results):
        FakeDDGS.attempts += 1
        raise RuntimeError("ddgs still unavailable")

module.DDGS = FakeDDGS

async def main():
    try:
        await module.handle_search("DeepSeek funding")
    except Exception as error:
        print(json.dumps({"attempts": FakeDDGS.attempts, "error": str(error)}, ensure_ascii=False))
        return
    raise RuntimeError("handle_search unexpectedly succeeded")

asyncio.run(main())
`
    const { stdout } = await execFileAsync(resolveSidecarPython(), ['-c', script], {
      cwd: process.cwd(),
      timeout: 30_000
    })
    const payload = JSON.parse(stdout.trim()) as { attempts: number; error: string }

    expect(payload.attempts).toBe(3)
    expect(payload.error).toContain('web search failed after 3 attempts')
    expect(payload.error).toContain('ddgs still unavailable')
  })
})
