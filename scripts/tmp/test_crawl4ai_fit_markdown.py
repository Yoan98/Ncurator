#!/usr/bin/env python3

import argparse
import asyncio
import json
import re
from collections import Counter
from typing import Any
from urllib.parse import urlparse

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
from crawl4ai.content_filter_strategy import PruningContentFilter
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator


MARKDOWN_LINK_RE = re.compile(r"!?\[[^\]]*]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HTTP_URL_RE = re.compile(r"https?://[^\s)>\"]+")


def normalize_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    return "" if value is None else str(value)


def extract_markdown_urls(markdown: str) -> list[str]:
    urls = [match.group(1).strip() for match in MARKDOWN_LINK_RE.finditer(markdown)]
    urls.extend(match.group(0).strip() for match in HTTP_URL_RE.finditer(markdown))
    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if not url or url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return deduped


def classify_url(url: str, page_host: str) -> str:
    try:
        parsed = urlparse(url)
    except Exception:
        return "invalid"
    host = (parsed.netloc or "").lower()
    path = parsed.path or ""
    if not host:
        return "relative_or_other"
    if host.endswith(page_host):
        if any(token in path for token in ("/login", "/register", "/usercenter", "/account")):
            return "account_or_auth"
        if any(token in path for token in ("/about", "/contact", "/feedback", "/jobs", "/rss")):
            return "footer_or_info"
        if any(token in path for token in ("/video", "/live", "/activity", "/topics", "/tags")):
            return "nav_or_channel"
        if re.search(r"/p/\d+", path):
            return "article"
        if "/user/" in path:
            return "author_or_profile"
        return "same_site_other"
    if host.startswith("img.") or host.startswith("static") or any(
        host.endswith(domain) for domain in ("cdn.com", "qpic.cn", "alicdn.com", "36krcdn.com")
    ):
        return "image_or_static"
    if "weibo.com" in host or "weixin.qq.com" in host or "mp.weixin.qq.com" in host:
        return "social_or_source"
    return "external_other"


def flatten_links(value: Any) -> list[dict[str, str]]:
    if isinstance(value, list):
        items: list[dict[str, str]] = []
        for item in value:
            items.extend(flatten_links(item))
        return items
    if not isinstance(value, dict):
        return []

    href = value.get("href") or value.get("url") or value.get("link")
    if isinstance(href, str) and href.strip():
        text = value.get("text") or value.get("title") or value.get("context")
        item = {"href": href.strip()}
        if isinstance(text, str) and text.strip():
            item["text"] = text.strip()
        return [item]

    items: list[dict[str, str]] = []
    for nested in value.values():
        items.extend(flatten_links(nested))
    return items


def ratio(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(numerator / denominator, 4)


def summarize_result(url: str, result: Any) -> dict[str, Any]:
    markdown_obj = result.markdown
    raw_markdown = normalize_text(getattr(markdown_obj, "raw_markdown", ""))
    fit_markdown = normalize_text(getattr(markdown_obj, "fit_markdown", ""))
    links = flatten_links(result.links)
    deduped_links: list[dict[str, str]] = []
    seen_link_urls: set[str] = set()
    for item in links:
      href = item["href"]
      if href in seen_link_urls:
          continue
      seen_link_urls.add(href)
      deduped_links.append(item)

    raw_urls = extract_markdown_urls(raw_markdown)
    fit_urls = extract_markdown_urls(fit_markdown)
    link_urls = [item["href"] for item in deduped_links]
    raw_url_set = set(raw_urls)
    fit_url_set = set(fit_urls)
    link_url_set = set(link_urls)

    page_host = (urlparse(url).netloc or "").lower()
    class_counter = Counter(classify_url(link, page_host) for link in link_urls)

    return {
        "url": url,
        "title": normalize_text(getattr(result, "metadata", {}).get("title") if getattr(result, "metadata", None) else ""),
        "raw_markdown_chars": len(raw_markdown),
        "fit_markdown_chars": len(fit_markdown),
        "raw_markdown_lines": len(raw_markdown.splitlines()),
        "fit_markdown_lines": len(fit_markdown.splitlines()),
        "raw_markdown_urls": len(raw_urls),
        "fit_markdown_urls": len(fit_urls),
        "links_total": len(deduped_links),
        "links_in_raw_markdown_count": len(link_url_set & raw_url_set),
        "links_in_fit_markdown_count": len(link_url_set & fit_url_set),
        "links_in_raw_markdown_ratio": ratio(len(link_url_set & raw_url_set), len(link_url_set)),
        "links_in_fit_markdown_ratio": ratio(len(link_url_set & fit_url_set), len(link_url_set)),
        "fit_urls_covered_by_links_count": len(fit_url_set & link_url_set),
        "fit_urls_covered_by_links_ratio": ratio(len(fit_url_set & link_url_set), len(fit_url_set)),
        "raw_urls_covered_by_links_count": len(raw_url_set & link_url_set),
        "raw_urls_covered_by_links_ratio": ratio(len(raw_url_set & link_url_set), len(raw_url_set)),
        "link_type_breakdown": dict(class_counter.most_common()),
        "samples": {
            "raw_markdown_head": raw_markdown[:2000],
            "fit_markdown_head": fit_markdown[:2000],
            "first_30_links": deduped_links[:30],
            "raw_only_links_sample": sorted((raw_url_set - fit_url_set))[:30],
            "fit_only_links_sample": sorted((fit_url_set - raw_url_set))[:30],
            "links_not_in_fit_sample": [
                item for item in deduped_links if item["href"] not in fit_url_set
            ][:30],
            "links_in_fit_sample": [
                item for item in deduped_links if item["href"] in fit_url_set
            ][:30],
        },
    }


async def crawl_url(url: str, threshold: float) -> dict[str, Any]:
    browser_config = BrowserConfig(headless=True)
    crawler_config = CrawlerRunConfig(
        markdown_generator=DefaultMarkdownGenerator(
            content_filter=PruningContentFilter(user_query="", threshold=threshold)
        )
    )
    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=crawler_config)
        return summarize_result(url, result)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="+")
    parser.add_argument("--threshold", type=float, default=0.48)
    args = parser.parse_args()

    reports = []
    for url in args.url:
        reports.append(await crawl_url(url, args.threshold))
    print(json.dumps({"reports": reports}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
