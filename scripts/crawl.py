#!/usr/bin/env python3
"""
Standalone crawl script — no DB, no FastAPI.
Reads existing articles.json, merges new articles, writes back.
Run: python scripts/crawl.py
Output: frontend/public/articles.json
"""

import sys
import json
import logging
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Make backend importable
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from ai_processor import fetch_articles
from config import CRAWL_TARGETS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

OUT_FILE = Path(__file__).parent.parent / "frontend" / "public" / "articles.json"
MAX_ARTICLES = 2000          # keep newest 2000 articles total
DEDUP_DAYS   = 90            # drop articles older than 90 days


def load_existing() -> list:
    if OUT_FILE.exists():
        try:
            data = json.loads(OUT_FILE.read_text())
            # Handle both formats: plain list or {"articles": [...], ...}
            if isinstance(data, dict):
                data = data.get("articles", [])
            logger.info(f"Loaded {len(data)} existing articles")
            return data
        except Exception as e:
            logger.warning(f"Could not load existing articles: {e}")
    return []


def crawl_all() -> list:
    all_articles = []
    total = sum(len(v) for v in CRAWL_TARGETS.values())
    done = 0
    for category, targets in CRAWL_TARGETS.items():
        for target in targets:
            try:
                logger.info(f"Fetching {target['site']}...")
                arts = fetch_articles(category, target)
                logger.info(f"  -> {len(arts)} articles")
                all_articles.extend(arts)
            except Exception as e:
                logger.error(f"Failed {target['site']}: {e}")
            done += 1
            logger.info(f"Progress: {done}/{total}")
    return all_articles


def merge(existing: list, fresh: list) -> list:
    # Build URL index of existing articles to preserve AI summaries
    by_url = {a["original_url"]: a for a in existing if a.get("original_url")}

    added = 0
    for art in fresh:
        url = art.get("original_url")
        if not url:
            continue
        if url not in by_url:
            # Assign a stable numeric id
            art["id"] = abs(hash(url)) % (10**9)
            by_url[url] = art
            added += 1
        # If existing, keep AI summary if present
        # (don't overwrite a processed article with a fresh unprocessed one)

    merged = list(by_url.values())

    # Drop very old articles
    cutoff = (datetime.now(timezone.utc) - timedelta(days=DEDUP_DAYS)).strftime("%Y-%m-%d")
    merged = [a for a in merged if a.get("publish_date", "9999") >= cutoff]

    # Sort newest first
    merged.sort(key=lambda a: (a.get("publish_date", ""), a.get("id", 0)), reverse=True)

    # Cap total
    merged = merged[:MAX_ARTICLES]
    logger.info(f"Merged: {added} new, {len(merged)} total (dropped old/excess)")
    return merged


def main():
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    existing = load_existing()
    fresh    = crawl_all()
    merged   = merge(existing, fresh)

    # Write with metadata header
    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(merged),
        "articles": merged,
    }
    OUT_FILE.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    logger.info(f"Written {len(merged)} articles to {OUT_FILE}")


if __name__ == "__main__":
    main()
