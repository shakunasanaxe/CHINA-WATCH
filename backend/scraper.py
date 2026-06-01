import requests
import time
import re
import feedparser
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from urllib.parse import urljoin, urlparse
from charset_normalizer import from_bytes
from typing import Optional
import logging

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
}

REQUEST_DELAY = 2.5  # seconds between requests
TIMEOUT = 15
MAX_ARTICLES_PER_SITE = 10
DAYS_LOOKBACK = 7


def smart_decode(raw_bytes: bytes, hint: str = "utf-8") -> str:
    """Decode bytes handling Chinese GB2312/GBK/UTF-8 encodings."""
    # Try hinted encoding first
    hints = [hint, "utf-8", "gb2312", "gbk", "gb18030", "big5"]
    for enc in hints:
        try:
            return raw_bytes.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    # Fall back to charset_normalizer
    result = from_bytes(raw_bytes).best()
    if result:
        return str(result)
    return raw_bytes.decode("utf-8", errors="replace")


def fetch_page(url: str, encoding_hint: str = "utf-8") -> Optional[str]:
    """Fetch a page and return decoded text."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT, verify=False)
        resp.raise_for_status()
        # Check content-type charset
        content_type = resp.headers.get("Content-Type", "")
        charset_match = re.search(r"charset=([^\s;]+)", content_type, re.I)
        if charset_match:
            encoding_hint = charset_match.group(1).strip()
        return smart_decode(resp.content, encoding_hint)
    except Exception as e:
        logger.warning(f"Failed to fetch {url}: {e}")
        return None


def extract_text_from_article(url: str, encoding_hint: str = "utf-8") -> str:
    """Extract clean article text from a URL."""
    html = fetch_page(url, encoding_hint)
    if not html:
        return ""
    soup = BeautifulSoup(html, "lxml")
    # Remove script/style
    for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
        tag.decompose()
    # Try common article body selectors
    for selector in [
        "div.article-content", "div#article-content", "div.content",
        "div.article", "div#content", "div.text", "article",
        "div.detail-content", "div.news-content", "div.main-content",
    ]:
        body = soup.select_one(selector)
        if body and len(body.get_text(strip=True)) > 100:
            return body.get_text(separator="\n", strip=True)[:3000]
    # Fallback: biggest text block
    paragraphs = soup.find_all("p")
    text = "\n".join(p.get_text(strip=True) for p in paragraphs if len(p.get_text(strip=True)) > 30)
    return text[:3000]


def is_recent(date_str: str) -> bool:
    """Check if date string is within DAYS_LOOKBACK."""
    if not date_str:
        return True  # include if date unknown
    cutoff = datetime.utcnow() - timedelta(days=DAYS_LOOKBACK)
    formats = [
        "%Y-%m-%d", "%Y/%m/%d", "%Y年%m月%d日",
        "%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S",
        "%Y%m%d", "%d/%m/%Y",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str[:25].strip(), fmt)
            return dt.replace(tzinfo=None) >= cutoff
        except (ValueError, TypeError):
            continue
    return True


def normalize_date(date_str: str) -> str:
    """Return normalized ISO date or original string."""
    if not date_str:
        return datetime.utcnow().strftime("%Y-%m-%d")
    formats = [
        "%Y-%m-%d", "%Y/%m/%d", "%Y年%m月%d日",
        "%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S",
        "%Y%m%d", "%d/%m/%Y",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str[:25].strip(), fmt)
            return dt.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            continue
    # Extract date-like pattern from string
    m = re.search(r"(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})", date_str)
    if m:
        return f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
    return datetime.utcnow().strftime("%Y-%m-%d")


def scrape_rss(rss_url: str, target: dict, category: str) -> list:
    """Scrape articles from RSS feed."""
    articles = []
    try:
        feed = feedparser.parse(rss_url)
        for entry in feed.entries[:MAX_ARTICLES_PER_SITE]:
            pub = entry.get("published", entry.get("updated", ""))
            if not is_recent(pub):
                continue
            link = entry.get("link", "")
            title = entry.get("title", "")
            summary = entry.get("summary", entry.get("description", ""))
            # Strip HTML from summary
            if summary:
                soup = BeautifulSoup(summary, "lxml")
                summary = soup.get_text(strip=True)[:1000]
            articles.append({
                "domain_category": category,
                "source_site": target["site"],
                "original_title": title,
                "english_title": None,
                "original_url": link,
                "raw_text": summary,
                "publish_date": normalize_date(pub),
                "processed": 0,
            })
            time.sleep(0.5)
    except Exception as e:
        logger.warning(f"RSS error {rss_url}: {e}")
    return articles


def scrape_html_list(target: dict, category: str) -> list:
    """Scrape article links from HTML listing page."""
    articles = []
    html = fetch_page(target["url"], target.get("encoding_hint", "utf-8"))
    if not html:
        return []
    soup = BeautifulSoup(html, "lxml")
    # Try each selector
    links = []
    for selector in target["list_selector"].split(","):
        selector = selector.strip()
        found = soup.select(selector)
        if found:
            links.extend(found)
    if not links:
        # Fallback: grab all anchor tags with non-trivial text
        links = [a for a in soup.find_all("a", href=True) if len(a.get_text(strip=True)) > 8]

    seen_urls = set()
    count = 0
    for link in links:
        if count >= MAX_ARTICLES_PER_SITE:
            break
        href = link.get("href", "")
        title = link.get_text(strip=True)
        if not href or not title or len(title) < 5:
            continue
        # Skip navigation/category links
        if any(x in href for x in ["javascript:", "mailto:", "#", "index.html"]):
            continue
        full_url = urljoin(target["base_url"], href)
        # Stay on domain
        if urlparse(full_url).netloc not in target["base_url"]:
            pass  # Allow cross-subdomain
        if full_url in seen_urls:
            continue
        seen_urls.add(full_url)

        # Try to find date near this link
        parent = link.parent
        date_str = ""
        for _ in range(3):
            if parent is None:
                break
            text = parent.get_text()
            m = re.search(r"(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})", text)
            if m:
                date_str = f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
                break
            parent = parent.parent

        articles.append({
            "domain_category": category,
            "source_site": target["site"],
            "original_title": title,
            "english_title": None,
            "original_url": full_url,
            "raw_text": None,  # will fetch if needed for AI
            "publish_date": normalize_date(date_str) if date_str else datetime.utcnow().strftime("%Y-%m-%d"),
            "processed": 0,
        })
        count += 1
        time.sleep(0.3)

    return articles


def fetch_article_text(article: dict, encoding_hint: str = "utf-8") -> str:
    """Fetch full article text for AI processing."""
    if article.get("raw_text") and len(article["raw_text"]) > 100:
        return article["raw_text"]
    url = article.get("original_url", "")
    if not url:
        return ""
    time.sleep(REQUEST_DELAY)
    return extract_text_from_article(url, encoding_hint)


def scrape_target(target: dict, category: str) -> list:
    """Scrape a single target, trying RSS first then HTML."""
    logger.info(f"Scraping {target['site']} ({category})")
    articles = []

    # Try RSS if available
    if target.get("rss"):
        try:
            articles = scrape_rss(target["rss"], target, category)
            if articles:
                logger.info(f"  RSS: got {len(articles)} from {target['site']}")
                time.sleep(REQUEST_DELAY)
                return articles
        except Exception as e:
            logger.warning(f"  RSS failed for {target['site']}: {e}")

    # Fall back to HTML scraping
    try:
        articles = scrape_html_list(target, category)
        logger.info(f"  HTML: got {len(articles)} from {target['site']}")
    except Exception as e:
        logger.warning(f"  HTML scrape failed for {target['site']}: {e}")

    time.sleep(REQUEST_DELAY)
    return articles


def run_full_crawl(progress_callback=None) -> list:
    """Run a full crawl across all targets. Returns list of raw article dicts."""
    from config import CRAWL_TARGETS
    all_articles = []
    total_sites = sum(len(v) for v in CRAWL_TARGETS.values())
    done = 0

    for category, targets in CRAWL_TARGETS.items():
        for target in targets:
            try:
                arts = scrape_target(target, category)
                all_articles.extend(arts)
            except Exception as e:
                logger.error(f"Error scraping {target['site']}: {e}")
            done += 1
            if progress_callback:
                progress_callback(done, total_sites, target["site"])

    return all_articles
