import os
import json
import re
import time
import logging
import feedparser
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse
from typing import Optional

logger = logging.getLogger(__name__)

# Default models per provider
PROVIDER_MODELS = {
    "groq":        "llama-3.1-8b-instant",
    "openrouter":  "meta-llama/llama-3.1-8b-instruct:free",
    "anthropic":   "claude-haiku-4-5",
    "ollama":      "llama3.2",  # user can override via OLLAMA_MODEL env var
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

ANALYSIS_SYSTEM = """You are a specialist analyst fluent in Chinese and English for an academic China studies unit.

Respond with ONLY a JSON object. No markdown, no code fences, no explanation. Start with { and end with }.

Required keys:
- "english_title": English translation of the title (string)
- "summary_bullets": exactly 2 bullet points as a JSON array of strings
- "significance": 2-3 sentence analysis of policy significance (string)"""


def _call_ai(prompt: str, system: str, provider: str, api_key: str) -> str:
    """Call the appropriate AI provider and return the raw text response."""

    if provider == "groq":
        from groq import Groq
        client = Groq(api_key=api_key or os.environ.get("GROQ_API_KEY", ""))
        resp = client.chat.completions.create(
            model=PROVIDER_MODELS["groq"],
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=800,
        )
        return resp.choices[0].message.content

    elif provider == "openrouter":
        from openai import OpenAI
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key or os.environ.get("OPENROUTER_API_KEY", ""),
        )
        resp = client.chat.completions.create(
            model=PROVIDER_MODELS["openrouter"],
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=800,
        )
        return resp.choices[0].message.content

    elif provider == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=api_key or os.environ.get("ANTHROPIC_API_KEY", ""))
        resp = client.messages.create(
            model=PROVIDER_MODELS["anthropic"],
            system=system,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=800,
        )
        return resp.content[0].text

    elif provider == "ollama":
        from openai import OpenAI
        ollama_url = os.environ.get("OLLAMA_URL", "http://localhost:11434")
        model = os.environ.get("OLLAMA_MODEL", PROVIDER_MODELS["ollama"])
        client = OpenAI(base_url=f"{ollama_url}/v1", api_key="ollama")
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=800,
        )
        return resp.choices[0].message.content

    else:
        raise ValueError(f"Unknown provider: {provider}")


# ── RSS fetching ──────────────────────────────────────────────────────────────

def _fetch_rss(url: str) -> list:
    try:
        r = requests.get(url, headers=HEADERS, timeout=12)
        feed = feedparser.parse(r.content)
        return feed.entries or []
    except Exception as e:
        logger.warning(f"RSS fetch failed {url}: {e}")
        try:
            return feedparser.parse(url).entries or []
        except Exception:
            return []


def _entry_to_article(entry, site_code: str, category: str, filter_keywords: list = None) -> Optional[dict]:
    title = entry.get("title", "").strip()
    link = entry.get("link", "").strip()
    if not title or not link:
        return None

    summary = ""
    if entry.get("summary"):
        summary = re.sub(r"<[^>]+>", "", entry["summary"]).strip()
    elif entry.get("content"):
        summary = re.sub(r"<[^>]+>", "", entry["content"][0].get("value", "")).strip()

    if filter_keywords:
        combined = (title + " " + summary).lower()
        if not any(kw.lower() in combined for kw in filter_keywords):
            return None

    publish_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for attr in ("published_parsed", "updated_parsed"):
        if entry.get(attr):
            try:
                publish_date = datetime(*entry[attr][:3]).strftime("%Y-%m-%d")
                break
            except Exception:
                pass

    return {
        "original_title": title,
        "english_title": title,
        "original_url": link,
        "raw_text": summary[:1000],
        "publish_date": publish_date,
        "source_site": site_code,
        "domain_category": category,
        "processed": 0,
    }


# ── HTML scraping ─────────────────────────────────────────────────────────────

def _scrape_listing(scrape_url: str, base_url: str, link_selector: str, encoding: str = "utf-8", filter_path: str = None) -> list:
    """Scrape a listing page and return raw article dicts (title + url only)."""
    try:
        r = requests.get(scrape_url, headers=HEADERS, timeout=15)
        r.encoding = encoding
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.warning(f"Scrape failed {scrape_url}: {e}")
        return []

    articles = []
    seen_urls = set()

    for selector in link_selector.split(","):
        selector = selector.strip()
        try:
            for tag in soup.select(selector):
                href = tag.get("href", "").strip()
                title = tag.get_text(strip=True)
                if not href or not title or len(title) < 5:
                    continue
                # Handle protocol-relative URLs
                if href.startswith("//"):
                    scheme = urlparse(base_url).scheme or "https"
                    href = scheme + ":" + href
                full_url = urljoin(base_url, href)
                # Skip pagination links, anchors, javascript
                if full_url in seen_urls:
                    continue
                if any(x in full_url for x in ["javascript:", "#", "mailto:"]):
                    continue
                # Must be same domain or subdomain
                base_domain = urlparse(base_url).netloc.lstrip("www.")
                link_domain = urlparse(full_url).netloc.lstrip("www.")
                if base_domain not in link_domain and link_domain not in base_domain:
                    continue
                # Optional path filter
                if filter_path and filter_path not in full_url:
                    continue
                seen_urls.add(full_url)
                articles.append({"title": title, "url": full_url})
        except Exception:
            continue

    return articles[:10]


def _fetch_article_text(url: str, encoding: str = "utf-8") -> str:
    """Fetch article page and extract main text content."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=6)
        r.encoding = encoding
        soup = BeautifulSoup(r.text, "html.parser")

        # Remove noise
        for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
            tag.decompose()

        # Try common article body selectors
        for sel in [".article-content", ".content", "#content", "article", ".main-content", "div.text", "p"]:
            container = soup.select_one(sel)
            if container:
                text = container.get_text(separator=" ", strip=True)
                if len(text) > 100:
                    return text[:1500]

        return soup.get_text(separator=" ", strip=True)[:1500]
    except Exception as e:
        logger.warning(f"Article fetch failed {url}: {e}")
        return ""


# ── Main fetch function ───────────────────────────────────────────────────────

def fetch_articles(category: str, target: dict) -> list:
    site_code = target["site"]
    rss_url = target.get("rss")
    scrape_url = target.get("scrape_url")
    filter_keywords = target.get("filter_keywords")

    # Try RSS first
    if rss_url:
        entries = _fetch_rss(rss_url)
        if entries:
            logger.info(f"[{site_code}] RSS returned {len(entries)} entries")
            articles = []
            for entry in entries[:10]:
                art = _entry_to_article(entry, site_code, category, filter_keywords)
                if art:
                    articles.append(art)
            logger.info(f"[{site_code}] -> {len(articles)} usable articles")
            return articles
        logger.warning(f"[{site_code}] RSS empty, falling back to scrape")

    # Fall back to HTML scraping
    if scrape_url:
        base_url = target.get("base_url", scrape_url)
        encoding = target.get("encoding", "utf-8")
        link_selector = target.get("link_selector", "ul li a, .list li a")

        filter_path = target.get("filter_path")
        raw = _scrape_listing(scrape_url, base_url, link_selector, encoding, filter_path)
        logger.info(f"[{site_code}] Scraped {len(raw)} links from {scrape_url}")

        articles = []
        for item in raw:
            body = _fetch_article_text(item["url"], encoding)
            articles.append({
                "original_title": item["title"],
                "english_title": item["title"],
                "original_url": item["url"],
                "raw_text": body if body and len(body) > 50 else item["title"],
                "publish_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "source_site": site_code,
                "domain_category": category,
                "processed": 0,
            })

        logger.info(f"[{site_code}] -> {len(articles)} scraped articles")
        return articles

    logger.warning(f"[{site_code}] No RSS or scrape URL configured")
    return []


# ── AI analysis ───────────────────────────────────────────────────────────────

def ai_analyze_article(title: str, text: str, source_site: str, api_key: str = None, provider: str = "groq") -> Optional[dict]:
    if not title and not text:
        return None

    content = f"SOURCE: {source_site}\nTITLE: {title}\n\nCONTENT:\n{text[:2000]}"

    try:
        raw = _call_ai(
            prompt=f"Analyze this article:\n\n{content}",
            system=ANALYSIS_SYSTEM,
            provider=provider,
            api_key=api_key or "",
        )
        raw = raw.strip()
        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start >= 0 and end > start:
            raw = raw[start:end]
        return json.loads(raw)
    except Exception as e:
        logger.error(f"AI analysis error for {source_site} ({provider}): {e}")
        return None


# ── Crawl pipeline ────────────────────────────────────────────────────────────

def run_ai_search_crawl(api_key: str = None, progress_callback=None) -> list:
    from config import CRAWL_TARGETS
    all_articles = []
    total = sum(len(v) for v in CRAWL_TARGETS.values())
    done = 0

    for category, targets in CRAWL_TARGETS.items():
        for target in targets:
            try:
                logger.info(f"Fetching {target['site']}...")
                arts = fetch_articles(category, target)
                logger.info(f"  -> {len(arts)} articles from {target['site']}")
                all_articles.extend(arts)
            except Exception as e:
                logger.error(f"Failed {target['site']}: {e}")
            done += 1
            if progress_callback:
                progress_callback(done, total, target["site"])

    logger.info(f"Total articles found: {len(all_articles)}")
    return all_articles


def save_articles(articles: list, db_insert_fn=None) -> int:
    """Save raw scraped articles to DB without AI processing. Fast."""
    saved = 0
    for art in articles:
        try:
            art["processed"] = 0
            art.setdefault("summary", "")
            art.setdefault("significance", "")
            if db_insert_fn:
                db_insert_fn(art)
            saved += 1
        except Exception as e:
            logger.error(f"Save error: {e}")
    logger.info(f"Saved {saved}/{len(articles)} articles to DB")
    return saved


def enrich_articles(articles: list, api_key: str = None, provider: str = "groq", db_insert_fn=None) -> int:
    """Legacy: save articles without AI (AI is now on-demand)."""
    return save_articles(articles, db_insert_fn)
