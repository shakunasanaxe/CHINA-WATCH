import os
import sys
import asyncio
import logging
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from jose import JWTError, jwt
from passlib.context import CryptContext
from apscheduler.schedulers.background import BackgroundScheduler

sys.path.insert(0, os.path.dirname(__file__))

from database import (
    init_db, get_articles, get_total_count, get_stats, get_article_by_id,
    insert_article, update_article_summary, log_crawl_start, log_crawl_finish,
    create_user, get_user_by_username, get_all_users, set_user_status
)
from ai_processor import run_ai_search_crawl, save_articles, ai_analyze_article

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Auth config ───────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get("SECRET_KEY", "change-me-in-production-please")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7  # 1 week

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "chinawatch2024")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def create_access_token(data: dict):
    to_encode = data.copy()
    to_encode["exp"] = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
        return username
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

def require_admin(username: str = Depends(verify_token)):
    if username != ADMIN_USERNAME:
        raise HTTPException(status_code=403, detail="Admin access required")
    return username

# ── Crawl state ───────────────────────────────────────────────────────────────
executor = ThreadPoolExecutor(max_workers=2)
crawl_status = {
    "running": False, "progress": 0, "total": 0,
    "current_site": "", "last_error": None, "phase": "",
    "last_auto_crawl": None,
}

def _run_crawl_sync():
    global crawl_status
    crawl_status.update({"running": True, "progress": 0, "last_error": None, "phase": "searching"})
    log_id = log_crawl_start()
    total_saved = 0
    try:
        def progress_cb(done, total, site):
            crawl_status.update({"progress": done, "total": total, "current_site": site})

        logger.info("Crawling: scraping all sources...")
        articles = run_ai_search_crawl(progress_callback=progress_cb)
        logger.info(f"Found {len(articles)} articles. Saving to DB...")
        crawl_status["phase"] = "saving"
        crawl_status["current_site"] = "Saving articles..."
        total_saved = save_articles(articles, db_insert_fn=insert_article)
        log_crawl_finish(log_id, total_saved)
        crawl_status["last_auto_crawl"] = datetime.utcnow().isoformat()
        logger.info(f"Done. {total_saved} articles saved.")
    except Exception as e:
        crawl_status["last_error"] = str(e)
        log_crawl_finish(log_id, total_saved, error=str(e))
        logger.error(f"Crawl failed: {e}")
    finally:
        crawl_status.update({"running": False, "current_site": "", "phase": "idle"})

# ── App startup ───────────────────────────────────────────────────────────────
scheduler = BackgroundScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("China Watch API started.")
    # Auto-crawl every 6 hours
    scheduler.add_job(_run_crawl_sync, "interval", hours=6, id="auto_crawl",
                      next_run_time=datetime.now())
    scheduler.start()
    logger.info("Scheduler started: crawling every 6 hours.")
    yield
    scheduler.shutdown()

app = FastAPI(title="China Watch API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth endpoints ────────────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str

class SignupRequest(BaseModel):
    name: str
    email: str
    username: str
    password: str
    institution: str = ""
    reason: str = ""

@app.post("/api/auth/signup")
async def signup(data: SignupRequest):
    if len(data.username) < 3 or len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Username must be 3+ chars, password 6+ chars")
    if get_user_by_username(data.username):
        raise HTTPException(status_code=400, detail="Username already taken")
    hashed = pwd_context.hash(data.password)
    try:
        create_user(data.name, data.email, data.username, hashed, data.institution, data.reason)
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=400, detail="Email or username already registered")
        raise HTTPException(status_code=500, detail="Registration failed")
    return {"status": "pending", "message": "Request submitted. You will be notified when approved."}

@app.post("/api/auth/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    # Admin login
    if form_data.username == ADMIN_USERNAME and form_data.password == ADMIN_PASSWORD:
        token = create_access_token({"sub": form_data.username, "role": "admin"})
        return {"access_token": token, "token_type": "bearer"}
    # Regular user login
    user = get_user_by_username(form_data.username)
    if not user or not pwd_context.verify(form_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if user["status"] == "pending":
        raise HTTPException(status_code=403, detail="Your access request is pending approval")
    if user["status"] == "denied":
        raise HTTPException(status_code=403, detail="Your access request was not approved")
    token = create_access_token({"sub": user["username"], "role": "user"})
    return {"access_token": token, "token_type": "bearer"}

@app.get("/api/auth/me")
async def me(username: str = Depends(verify_token)):
    is_admin = username == ADMIN_USERNAME
    return {"username": username, "is_admin": is_admin}

# ── Admin endpoints ───────────────────────────────────────────────────────────
@app.get("/api/admin/users")
def admin_list_users(_: str = Depends(require_admin)):
    return {"users": get_all_users()}

@app.post("/api/admin/users/{user_id}/approve")
def admin_approve(user_id: int, _: str = Depends(require_admin)):
    set_user_status(user_id, "approved")
    return {"status": "approved"}

@app.post("/api/admin/users/{user_id}/deny")
def admin_deny(user_id: int, _: str = Depends(require_admin)):
    set_user_status(user_id, "denied")
    return {"status": "denied"}

# ── Public ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "China Watch API"}

# ── Articles (requires auth) ──────────────────────────────────────────────────
@app.get("/api/articles")
def list_articles(
    category: Optional[str] = Query(None),
    limit: int = Query(20, le=100),
    offset: int = Query(0),
    search: Optional[str] = Query(None),
    _: str = Depends(verify_token),
):
    articles = get_articles(category=category, limit=limit, offset=offset, search=search)
    total = get_total_count(category=category, search=search)
    return {"articles": articles, "count": len(articles), "total": total, "offset": offset, "limit": limit}

@app.get("/api/articles/{article_id}")
def get_article(article_id: int, _: str = Depends(verify_token)):
    art = get_article_by_id(article_id)
    if not art:
        raise HTTPException(status_code=404, detail="Article not found")
    return art

@app.post("/api/articles/{article_id}/summarize")
async def summarize_article(
    article_id: int,
    x_api_key: Optional[str] = Header(None, alias="X-Api-Key"),
    x_provider: Optional[str] = Header(None, alias="X-Provider"),
    _: str = Depends(verify_token),
):
    """On-demand AI summary for a single article."""
    art = get_article_by_id(article_id)
    if not art:
        raise HTTPException(status_code=404, detail="Article not found")

    if art.get("processed") == 1 and art.get("summary"):
        return {"summary": art["summary"], "significance": art["significance"],
                "english_title": art["english_title"], "cached": True}

    provider = (x_provider or "groq").lower()
    api_key = x_api_key or ""

    if provider != "ollama" and not api_key:
        raise HTTPException(status_code=400, detail="API key required for this provider")

    result = ai_analyze_article(
        art.get("english_title") or art.get("original_title", ""),
        art.get("raw_text", ""),
        art.get("source_site", ""),
        api_key=api_key,
        provider=provider,
    )

    if not result:
        raise HTTPException(status_code=500, detail="AI analysis failed")

    bullets = result.get("summary_bullets", [])
    summary = "\n".join(f"• {b}" for b in bullets)
    significance = result.get("significance", "")
    english_title = result.get("english_title", art.get("english_title", ""))

    update_article_summary(article_id, english_title, summary, significance)
    return {"summary": summary, "significance": significance,
            "english_title": english_title, "cached": False}

# ── Stats ─────────────────────────────────────────────────────────────────────
from config import DOMAIN_LABELS, DOMAIN_COLORS

@app.get("/api/stats")
def stats(_: str = Depends(verify_token)):
    s = get_stats()
    return {**s, "domain_labels": DOMAIN_LABELS, "domain_colors": DOMAIN_COLORS}

@app.get("/api/domains")
def domains():
    return {"domains": DOMAIN_LABELS, "colors": DOMAIN_COLORS}

# ── Crawl (requires auth) ─────────────────────────────────────────────────────
@app.post("/api/crawl/trigger")
async def trigger_crawl(_: str = Depends(verify_token)):
    if crawl_status["running"]:
        return {"status": "already_running", "message": "Crawl already in progress"}
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, _run_crawl_sync)
    return {"status": "started", "message": "Crawl initiated"}

@app.get("/api/crawl/status")
def crawl_status_endpoint(_: str = Depends(verify_token)):
    return crawl_status

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
