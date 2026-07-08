import asyncio
import json
import os
import random
import sys
from typing import Any

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "0")

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, LinkPreviewConfig
from crawl4ai.content_filter_strategy import PruningContentFilter
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
from ddgs import DDGS


MAX_SEARCH_RESULTS = 8
MAX_SEARCH_ATTEMPTS = 3
SEARCH_RETRY_BASE_DELAY_SECONDS = 0.4
SEARCH_RETRY_MAX_DELAY_SECONDS = 1.5
SEARCH_RETRY_JITTER_SECONDS = 0.2
FIT_MARKDOWN_THRESHOLD = 0.48
LINK_PREVIEW_MAX_LINKS = 120
LINK_PREVIEW_TIMEOUT_SECONDS = 5


class CrawlFailure(Exception):
    def __init__(self, message: str, data: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.data = data or {}


def to_jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(item) for item in value]
    if hasattr(value, "model_dump"):
        return to_jsonable(value.model_dump(mode="json"))
    if hasattr(value, "dict"):
        return to_jsonable(value.dict())
    if hasattr(value, "__dict__"):
        return to_jsonable(vars(value))
    return str(value)


def read_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def read_nested_string(obj: dict[str, Any] | None, key: str) -> str | None:
    if not isinstance(obj, dict):
        return None
    return read_string(obj.get(key))


def read_nested_int(obj: dict[str, Any] | None, key: str) -> int | None:
    if not isinstance(obj, dict):
        return None
    value = obj.get(key)
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def extract_markdown(raw: dict[str, Any]) -> str:
    candidates = [raw.get("fit_markdown"), raw.get("fitMarkdown"), raw.get("markdown")]
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
        if isinstance(candidate, dict):
            for nested_key in (
                "fit_markdown",
                "fitMarkdown",
                "raw_markdown",
                "rawMarkdown",
                "markdown",
                "content",
            ):
                nested_value = candidate.get(nested_key)
                if isinstance(nested_value, str) and nested_value.strip():
                    return nested_value.strip()
    return ""


def extract_raw_links(raw: dict[str, Any]) -> dict[str, Any]:
    links = raw.get("links")
    return links if isinstance(links, dict) else {"internal": [], "external": []}


def resolve_result_url(raw: dict[str, Any], fallback_url: str | None = None) -> str | None:
    return (
        read_nested_string(raw, "final_url")
        or read_nested_string(raw, "finalUrl")
        or read_nested_string(raw, "redirected_url")
        or read_nested_string(raw, "redirectedUrl")
        or read_nested_string(raw, "url")
        or fallback_url
    )


def resolve_status_code(raw: dict[str, Any]) -> int | None:
    return (
        read_nested_int(raw, "status_code")
        or read_nested_int(raw, "statusCode")
        or read_nested_int(raw, "http_status")
        or read_nested_int(raw, "httpStatus")
        or read_nested_int(raw, "status")
    )


def resolve_error_message(raw: dict[str, Any]) -> str | None:
    return (
        read_nested_string(raw, "error")
        or read_nested_string(raw, "error_message")
        or read_nested_string(raw, "errorMessage")
        or read_nested_string(raw, "message")
    )


def build_failure_data(
    raw: dict[str, Any], requested_url: str, message: str
) -> dict[str, Any]:
    final_url = resolve_result_url(raw, requested_url)
    status_code = resolve_status_code(raw)
    data: dict[str, Any] = {
        "raw": raw,
        "requested_url": requested_url,
    }
    if final_url:
        data["final_url"] = final_url
    if status_code is not None:
        data["status_code"] = status_code
    if message:
        data["message"] = message
    return data


def build_crawler_run_config(topic: str) -> CrawlerRunConfig:
    return CrawlerRunConfig(
        markdown_generator=DefaultMarkdownGenerator(
            content_filter=PruningContentFilter(
                user_query="",
                threshold=FIT_MARKDOWN_THRESHOLD,
            )
        ),
        score_links=True,
        link_preview_config=LinkPreviewConfig(
            include_internal=True,
            include_external=True,
            query=topic,
            max_links=LINK_PREVIEW_MAX_LINKS,
            timeout=LINK_PREVIEW_TIMEOUT_SECONDS,
        ),
    )


def normalize_crawl_success(raw: dict[str, Any], requested_url: str) -> dict[str, Any]:
    final_url = resolve_result_url(raw, requested_url)
    if not final_url:
        raise CrawlFailure(
            "crawl4ai returned no final url",
            build_failure_data(raw, requested_url, "crawl4ai returned no final url"),
        )

    result: dict[str, Any] = {
        "requested_url": requested_url,
        "final_url": final_url,
        "markdown": extract_markdown(raw),
        "links": extract_raw_links(raw),
        "raw": raw,
    }
    title = read_nested_string(raw, "title") or read_nested_string(
        raw.get("metadata") if isinstance(raw.get("metadata"), dict) else None,
        "title",
    )
    published_at = (
        read_nested_string(raw, "published_at")
        or read_nested_string(raw, "publishedAt")
        or read_nested_string(
            raw.get("metadata") if isinstance(raw.get("metadata"), dict) else None,
            "article:published_time",
        )
        or read_nested_string(
            raw.get("metadata") if isinstance(raw.get("metadata"), dict) else None,
            "published_time",
        )
    )
    if title:
        result["title"] = title
    if published_at:
        result["published_at"] = published_at
    return result


async def crawl_once(crawler: AsyncWebCrawler, url: str, topic: str) -> dict[str, Any]:
    result = await crawler.arun(url=url, config=build_crawler_run_config(topic))
    raw_result = to_jsonable(result)
    if not isinstance(raw_result, dict):
        raise CrawlFailure(
            "crawl4ai returned a non-object result",
            {"raw": raw_result, "url": url},
        )

    if "url" not in raw_result:
        raw_result["url"] = url
    if "final_url" not in raw_result and resolve_result_url(raw_result, None):
        raw_result["final_url"] = resolve_result_url(raw_result, url)

    markdown = extract_markdown(raw_result)
    success_value = raw_result.get("success")
    success = True if not isinstance(success_value, bool) else success_value
    status_code = resolve_status_code(raw_result)
    if status_code is not None and status_code >= 400:
        message = f"网页请求失败：{status_code}"
        raise CrawlFailure(message, build_failure_data(raw_result, url, message))
    error_message = resolve_error_message(raw_result)
    if not success:
        raise CrawlFailure(
            error_message or f"web crawl failed for {url}",
            build_failure_data(raw_result, url, error_message or ""),
        )

    normalized = normalize_crawl_success(raw_result, url)
    markdown = read_string(normalized.get("markdown"))
    if not markdown:
        raise CrawlFailure(
            "web crawl result missing fit_markdown",
            build_failure_data(raw_result, url, "web crawl result missing fit_markdown"),
        )

    return normalized


async def handle_crawl(crawler: AsyncWebCrawler, url: str, topic: str) -> dict[str, Any]:
    return await crawl_once(crawler, url, topic)


def normalize_search_result(item: dict[str, Any], rank: int) -> dict[str, Any] | None:
    title = read_string(item.get("title"))
    url = read_string(item.get("href")) or read_string(item.get("url"))
    if not title or not url:
        return None
    result: dict[str, Any] = {
        "rank": rank,
        "title": title,
        "url": url,
    }
    snippet = read_string(item.get("body")) or read_string(item.get("snippet"))
    if snippet:
        result["snippet"] = snippet
    return result


def normalize_search_results(raw_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized_results: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        normalized = normalize_search_result(item, len(normalized_results) + 1)
        if not normalized:
            continue
        url = normalized["url"]
        if url in seen_urls:
            continue
        seen_urls.add(url)
        normalized_results.append(normalized)
    return normalized_results


def run_search_once(query: str) -> list[dict[str, Any]]:
    with DDGS() as ddgs:
        return list(ddgs.text(query, max_results=MAX_SEARCH_RESULTS))


def resolve_search_retry_delay(attempt: int) -> float:
    base_delay = min(
        SEARCH_RETRY_MAX_DELAY_SECONDS,
        SEARCH_RETRY_BASE_DELAY_SECONDS * (2 ** max(0, attempt - 1)),
    )
    return base_delay + random.uniform(0, SEARCH_RETRY_JITTER_SECONDS)


def format_search_error(error: Exception | None) -> str:
    if error is None:
        return "unknown error"
    return str(error) or error.__class__.__name__


async def handle_search(query: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, MAX_SEARCH_ATTEMPTS + 1):
        try:
            raw_results = await asyncio.to_thread(run_search_once, query)
            normalized_results = normalize_search_results(raw_results)
            if normalized_results:
                return {
                    "query": query,
                    "results": normalized_results,
                }
            last_error = RuntimeError("web search returned no usable results")
        except Exception as error:
            last_error = error

        if attempt < MAX_SEARCH_ATTEMPTS:
            await asyncio.sleep(resolve_search_retry_delay(attempt))

    raise RuntimeError(
        f"web search failed after {MAX_SEARCH_ATTEMPTS} attempts: {format_search_error(last_error)}"
    )


async def process_requests() -> None:
    browser_config = BrowserConfig(headless=True, verbose=False)
    browser_config.chrome_channel = ""
    browser_config.channel = ""
    crawler: AsyncWebCrawler | None = None
    try:
        for line in sys.stdin:
            message = line.strip()
            if not message:
                continue

            request_id = ""
            try:
                request = json.loads(message)
                if not isinstance(request, dict):
                    raise ValueError("invalid request payload")
                request_id = str(request.get("id", "")).strip()
                action = str(request.get("action", "")).strip()
                if not request_id:
                    raise ValueError("missing request id")
                if action not in {"crawl", "search"}:
                    raise ValueError(f"unsupported action: {action}")
                input_payload = request.get("input", {})
                if not isinstance(input_payload, dict):
                    raise ValueError("invalid input payload")
                if action == "crawl":
                    url = read_string(input_payload.get("url"))
                    topic = read_string(input_payload.get("topic"))
                    if not url:
                        raise ValueError("missing crawl url")
                    if not topic:
                        raise ValueError("missing crawl topic")
                    if crawler is None:
                        crawler = AsyncWebCrawler(config=browser_config)
                        await crawler.start()
                    data = await handle_crawl(crawler, url, topic)
                else:
                    query = read_string(input_payload.get("query"))
                    if not query:
                        raise ValueError("missing search query")
                    data = await handle_search(query)
                response = {"id": request_id, "ok": True, "data": data}
            except CrawlFailure as error:
                response = {
                    "id": request_id,
                    "ok": False,
                    "error": str(error),
                    "data": error.data,
                }
            except Exception as error:
                response = {
                    "id": request_id,
                    "ok": False,
                    "error": str(error),
                }

            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    finally:
        if crawler is not None:
            await crawler.close()


def main() -> None:
    asyncio.run(process_requests())


if __name__ == "__main__":
    main()
