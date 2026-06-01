import os
import sys
import asyncio
import logging
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

sys.path.insert(0, os.path.dirname(__file__))

from database import init_db, get_articles, get_stats, insert_article, log_crawl_start, log_crawl_finish
from ai_processor import run_ai_search_crawl, enrich_articles
from config import DOMAIN_LABELS, DOMAIN_COLORS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

executor = ThreadPoolExecutor(max_workers=2)
crawl_status = {
    "running": False,
    "progress": 0,
    "total": 0,
    "current_site": "",
    "last_error": None,
    "phase": "",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("China Watch API started. DB initialized.")
    yield


app = FastAPI(title="China Watch API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _run_crawl_sync(api_key: str, provider: str = "groq"):
    global crawl_status
    crawl_status.update({"running": True, "progress": 0, "last_error": None, "phase": "searching"})
    log_id = log_crawl_start()
    total_saved = 0

    try:
        def progress_cb(done, total, site):
            crawl_status.update({"progress": done, "total": total, "current_site": site})

        logger.info("Phase 1: AI web search crawl...")
        articles = run_ai_search_crawl(api_key=api_key, progress_callback=progress_cb)
        logger.info(f"Found {len(articles)} articles. Phase 2: Enriching + saving...")

        crawl_status["phase"] = "analyzing"
        crawl_status["current_site"] = "Analyzing with AI..."
        total_saved = enrich_articles(articles, api_key=api_key, provider=provider, db_insert_fn=insert_article)
        log_crawl_finish(log_id, total_saved)
        logger.info(f"Done. {total_saved} articles saved.")
    except Exception as e:
        crawl_status["last_error"] = str(e)
        log_crawl_finish(log_id, total_saved, error=str(e))
        logger.error(f"Crawl failed: {e}")
    finally:
        crawl_status.update({"running": False, "current_site": "", "phase": "idle"})


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "China Watch API"}


@app.get("/api/articles")
def list_articles(
    category: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
):
    articles = get_articles(category=category, limit=limit, offset=offset)
    return {"articles": articles, "count": len(articles)}


@app.get("/api/stats")
def stats():
    s = get_stats()
    return {**s, "domain_labels": DOMAIN_LABELS, "domain_colors": DOMAIN_COLORS}


@app.post("/api/crawl/trigger")
async def trigger_crawl(
    x_api_key: Optional[str] = Header(None, alias="X-Api-Key"),
    x_provider: Optional[str] = Header(None, alias="X-Provider"),
):
    if crawl_status["running"]:
        return {"status": "already_running", "message": "Crawl already in progress"}
    provider = (x_provider or "groq").lower()
    if provider == "ollama":
        api_key = "ollama"  # no real key needed
    else:
        api_key = x_api_key or os.environ.get("GROQ_API_KEY", "")
        if not api_key:
            raise HTTPException(status_code=400, detail="No API key provided")
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, _run_crawl_sync, api_key, provider)
    return {"status": "started", "message": f"Crawl initiated with provider: {provider}"}


@app.get("/api/crawl/status")
def crawl_status_endpoint():
    return crawl_status


@app.get("/api/domains")
def domains():
    return {"domains": DOMAIN_LABELS, "colors": DOMAIN_COLORS}


@app.get("/api/debug/test-rss")
def debug_test_rss():
    """Test RSS fetch from Global Times and Groq analysis."""
    from ai_processor import fetch_rss_articles, ai_analyze_article
    articles = fetch_rss_articles("foreign_policy", {
        "site": "GLOBALTIMES",
        "name": "Global Times",
        "rss": "https://www.globaltimes.cn/rss/outbrain.xml",
        "base_url": "https://www.globaltimes.cn",
    })
    return {"articles_found": len(articles), "sample": articles[:2]}


@app.get("/api/debug/test-groq")
def debug_test_groq(x_api_key: Optional[str] = Header(None, alias="X-Api-Key")):
    """Test Groq API connection."""
    from ai_processor import get_groq_client
    api_key = x_api_key or os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        return {"error": "No API key"}
    try:
        client = get_groq_client(api_key)
        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": "Say hello in 5 words."}],
            max_tokens=20,
        )
        return {"response": resp.choices[0].message.content, "status": "ok"}
    except Exception as e:
        return {"error": str(e), "type": type(e).__name__}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
