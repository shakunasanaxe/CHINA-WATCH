import sqlite3
import os
from datetime import datetime

_data_dir = os.environ.get("DATA_DIR", os.path.dirname(__file__))
os.makedirs(_data_dir, exist_ok=True)
DB_PATH = os.path.join(_data_dir, "china_watch.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            institution TEXT,
            reason TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain_category TEXT NOT NULL,
            source_site TEXT NOT NULL,
            original_title TEXT,
            english_title TEXT,
            original_url TEXT UNIQUE,
            raw_text TEXT,
            summary TEXT,
            significance TEXT,
            publish_date TEXT,
            crawled_at TEXT DEFAULT (datetime('now')),
            processed INTEGER DEFAULT 0
        )
    """)
    # Full-text search virtual table
    c.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts
        USING fts5(english_title, raw_text, summary, source_site, content=articles, content_rowid=id)
    """)
    # Trigger to keep FTS in sync
    c.execute("""
        CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
            INSERT INTO articles_fts(rowid, english_title, raw_text, summary, source_site)
            VALUES (new.id, new.english_title, new.raw_text, new.summary, new.source_site);
        END
    """)
    c.execute("""
        CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
            INSERT INTO articles_fts(articles_fts, rowid, english_title, raw_text, summary, source_site)
            VALUES ('delete', old.id, old.english_title, old.raw_text, old.summary, old.source_site);
            INSERT INTO articles_fts(rowid, english_title, raw_text, summary, source_site)
            VALUES (new.id, new.english_title, new.raw_text, new.summary, new.source_site);
        END
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS crawl_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT,
            finished_at TEXT,
            total_fetched INTEGER DEFAULT 0,
            status TEXT DEFAULT 'running',
            error_msg TEXT
        )
    """)
    conn.commit()
    conn.close()

def insert_article(data: dict):
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute("""
            INSERT OR IGNORE INTO articles
            (domain_category, source_site, original_title, english_title, original_url,
             raw_text, summary, significance, publish_date, processed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get("domain_category"),
            data.get("source_site"),
            data.get("original_title"),
            data.get("english_title"),
            data.get("original_url"),
            data.get("raw_text"),
            data.get("summary"),
            data.get("significance"),
            data.get("publish_date"),
            data.get("processed", 0),
        ))
        conn.commit()
        return c.lastrowid
    except Exception as e:
        print(f"DB insert error: {e}")
        return None
    finally:
        conn.close()

def create_user(name, email, username, password_hash, institution, reason):
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute("""
            INSERT INTO users (name, email, username, password_hash, institution, reason)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (name, email, username, password_hash, institution, reason))
        conn.commit()
        return c.lastrowid
    except Exception as e:
        raise e
    finally:
        conn.close()

def get_user_by_username(username):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE username=?", (username,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def get_all_users():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id, name, email, username, institution, reason, status, created_at FROM users ORDER BY created_at DESC")
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

def set_user_status(user_id, status):
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE users SET status=? WHERE id=?", (status, user_id))
    conn.commit()
    conn.close()

def update_article_summary(article_id: int, english_title: str, summary: str, significance: str):
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        UPDATE articles SET english_title=?, summary=?, significance=?, processed=1
        WHERE id=?
    """, (english_title, summary, significance, article_id))
    conn.commit()
    conn.close()

def get_article_by_id(article_id: int):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM articles WHERE id=?", (article_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None

def get_articles(category: str = None, limit: int = 50, offset: int = 0, search: str = None):
    conn = get_db()
    c = conn.cursor()

    if search and search.strip():
        # Full-text search
        if category:
            c.execute("""
                SELECT a.* FROM articles a
                JOIN articles_fts f ON a.id = f.rowid
                WHERE articles_fts MATCH ? AND a.domain_category = ?
                ORDER BY a.crawled_at DESC LIMIT ? OFFSET ?
            """, (search, category, limit, offset))
        else:
            c.execute("""
                SELECT a.* FROM articles a
                JOIN articles_fts f ON a.id = f.rowid
                WHERE articles_fts MATCH ?
                ORDER BY a.crawled_at DESC LIMIT ? OFFSET ?
            """, (search, limit, offset))
    elif category:
        c.execute(
            "SELECT * FROM articles WHERE domain_category=? ORDER BY crawled_at DESC LIMIT ? OFFSET ?",
            (category, limit, offset)
        )
    else:
        c.execute(
            "SELECT * FROM articles ORDER BY crawled_at DESC LIMIT ? OFFSET ?",
            (limit, offset)
        )

    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

def get_total_count(category: str = None, search: str = None) -> int:
    conn = get_db()
    c = conn.cursor()
    if search and search.strip():
        if category:
            c.execute("""
                SELECT COUNT(*) FROM articles a
                JOIN articles_fts f ON a.id = f.rowid
                WHERE articles_fts MATCH ? AND a.domain_category = ?
            """, (search, category))
        else:
            c.execute("""
                SELECT COUNT(*) FROM articles a
                JOIN articles_fts f ON a.id = f.rowid
                WHERE articles_fts MATCH ?
            """, (search,))
    elif category:
        c.execute("SELECT COUNT(*) FROM articles WHERE domain_category=?", (category,))
    else:
        c.execute("SELECT COUNT(*) FROM articles")
    total = c.fetchone()[0]
    conn.close()
    return total

def get_stats():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT domain_category, COUNT(*) as count FROM articles GROUP BY domain_category")
    stats = {r["domain_category"]: r["count"] for r in c.fetchall()}
    c.execute("SELECT COUNT(*) as total FROM articles")
    total = c.fetchone()["total"]
    c.execute("SELECT started_at, finished_at, total_fetched, status FROM crawl_log ORDER BY id DESC LIMIT 1")
    last_crawl = c.fetchone()
    conn.close()
    return {
        "by_category": stats,
        "total": total,
        "last_crawl": dict(last_crawl) if last_crawl else None
    }

def log_crawl_start():
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO crawl_log (started_at, status) VALUES (?, 'running')", (datetime.utcnow().isoformat(),))
    conn.commit()
    log_id = c.lastrowid
    conn.close()
    return log_id

def log_crawl_finish(log_id: int, total: int, error: str = None):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "UPDATE crawl_log SET finished_at=?, total_fetched=?, status=?, error_msg=? WHERE id=?",
        (datetime.utcnow().isoformat(), total, "error" if error else "success", error, log_id)
    )
    conn.commit()
    conn.close()
