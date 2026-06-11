import asyncio
import json
import re
import sys
from typing import Any
from urllib.parse import urljoin, urlparse

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig


MAX_VISITED_PAGES = 3
MAX_FOLLOW_LINKS = 2


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
    candidates = [raw.get("markdown"), raw.get("fit_markdown"), raw.get("fitMarkdown")]
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
        "url": requested_url,
    }
    if final_url:
        data["final_url"] = final_url
    if status_code is not None:
        data["status_code"] = status_code
    if message:
        data["message"] = message
    return data


def flatten_links(value: Any, base_url: str | None = None) -> list[dict[str, str]]:
    if isinstance(value, list):
        items: list[dict[str, str]] = []
        for item in value:
            items.extend(flatten_links(item, base_url))
        return items

    if not isinstance(value, dict):
        return []

    href = (
        read_nested_string(value, "href")
        or read_nested_string(value, "url")
        or read_nested_string(value, "link")
    )
    if href:
        normalized_href = urljoin(base_url, href) if base_url else href
        text = (
            read_nested_string(value, "text")
            or read_nested_string(value, "title")
            or read_nested_string(value, "context")
        )
        item = {"href": normalized_href}
        if text:
            item["text"] = text
        return [item]

    items: list[dict[str, str]] = []
    for nested in value.values():
        items.extend(flatten_links(nested, base_url))
    return items


def same_origin(url_a: str, url_b: str) -> bool:
    parsed_a = urlparse(url_a)
    parsed_b = urlparse(url_b)
    return parsed_a.scheme == parsed_b.scheme and parsed_a.netloc == parsed_b.netloc


def tokenize_topic(value: str | None) -> set[str]:
    if not value:
        return set()
    words = re.findall(r"[\u4e00-\u9fff]+|[A-Za-z0-9_]+", value.lower())
    tokens: set[str] = set()
    for word in words:
        tokens.add(word)
        if len(word) > 1 and re.fullmatch(r"[\u4e00-\u9fff]+", word):
            tokens.update(word[index : index + 2] for index in range(len(word) - 1))
    return tokens


def score_text(text: str, topic_tokens: set[str]) -> int:
    if not text or not topic_tokens:
        return 0
    lowered = text.lower()
    return sum(1 for token in topic_tokens if token and token in lowered)


def score_link(link: dict[str, str], topic_tokens: set[str]) -> int:
    return score_text(" ".join([link.get("href", ""), link.get("text", "")]), topic_tokens)


def score_page(raw: dict[str, Any], topic_tokens: set[str]) -> int:
    title = read_nested_string(raw, "title") or ""
    markdown = extract_markdown(raw)
    return score_text(f"{title}\n{markdown}", topic_tokens)


async def crawl_once(crawler: AsyncWebCrawler, url: str) -> dict[str, Any]:
    result = await crawler.arun(url=url, config=CrawlerRunConfig())
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
    error_message = resolve_error_message(raw_result)
    if status_code is not None and status_code >= 400:
        message = error_message or f"网页请求失败：{status_code}"
        raise CrawlFailure(message, build_failure_data(raw_result, url, message))
    if not success:
        raise CrawlFailure(
            error_message or f"web crawl failed for {url}",
            build_failure_data(raw_result, url, error_message or ""),
        )

    return raw_result


def read_visited_urls(results: list[dict[str, Any]]) -> set[str]:
    visited: set[str] = set()
    for result in results:
        resolved = resolve_result_url(result)
        if resolved:
            visited.add(resolved)
        requested = read_nested_string(result, "url")
        if requested:
            visited.add(requested)
    return visited


async def handle_crawl(
    crawler: AsyncWebCrawler, url: str, topic: str | None
) -> dict[str, Any]:
    visited_results: list[dict[str, Any]] = []
    topic_tokens = tokenize_topic(topic)
    seed_result = await crawl_once(crawler, url)
    visited_results.append(seed_result)
    selected_result = seed_result
    selected_score = score_page(seed_result, topic_tokens)

    if topic_tokens:
        seed_url = resolve_result_url(seed_result, url) or url
        seed_links = flatten_links(seed_result.get("links"), seed_url)
        internal_candidates = [
            link
            for link in seed_links
            if read_string(link.get("href")) and same_origin(seed_url, link.get("href", ""))
        ]
        scored_candidates = sorted(
            internal_candidates,
            key=lambda link: score_link(link, topic_tokens),
            reverse=True,
        )
        visited_urls = read_visited_urls(visited_results)
        for link in scored_candidates[:MAX_FOLLOW_LINKS]:
            if len(visited_results) >= MAX_VISITED_PAGES:
                break
            href = link.get("href")
            if not href or href in visited_urls:
                continue
            try:
                candidate_result = await crawl_once(crawler, href)
            except CrawlFailure:
                continue
            visited_results.append(candidate_result)
            visited_urls = read_visited_urls(visited_results)
            candidate_score = score_page(candidate_result, topic_tokens)
            if candidate_score > selected_score:
                selected_result = candidate_result
                selected_score = candidate_score

    return {
        "selected_result": selected_result,
        "visited_results": visited_results,
    }


async def process_requests() -> None:
    browser_config = BrowserConfig(headless=True, verbose=False)
    crawler = AsyncWebCrawler(config=browser_config)
    await crawler.start()
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
                if action != "crawl":
                    raise ValueError(f"unsupported action: {action}")
                input_payload = request.get("input", {})
                if not isinstance(input_payload, dict):
                    raise ValueError("invalid input payload")
                url = read_string(input_payload.get("url"))
                topic = read_string(input_payload.get("topic"))
                if not url:
                    raise ValueError("missing crawl url")

                data = await handle_crawl(crawler, url, topic)
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
        await crawler.close()


def main() -> None:
    asyncio.run(process_requests())


if __name__ == "__main__":
    main()
