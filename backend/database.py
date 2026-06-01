import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "china_watch.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
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
    cursor.execute("""
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
    cursor = conn.cursor()
    try:
        cursor.execute("""
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
        return cursor.lastrowid
    except Exception as e:
        print(f"DB insert error: {e}")
        return None
    finally:
        conn.close()

def get_articles(category: str = None, limit: int = 50, offset: int = 0):
    conn = get_db()
    cursor = conn.cursor()
    if category:
        cursor.execute(
            "SELECT * FROM articles WHERE domain_category = ? ORDER BY crawled_at DESC LIMIT ? OFFSET ?",
            (category, limit, offset)
        )
    else:
        cursor.execute(
            "SELECT * FROM articles ORDER BY crawled_at DESC LIMIT ? OFFSET ?",
            (limit, offset)
        )
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def get_stats():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT domain_category, COUNT(*) as count FROM articles GROUP BY domain_category")
    stats = {r["domain_category"]: r["count"] for r in cursor.fetchall()}
    cursor.execute("SELECT COUNT(*) as total FROM articles")
    total = cursor.fetchone()["total"]
    cursor.execute("SELECT started_at, finished_at, total_fetched, status FROM crawl_log ORDER BY id DESC LIMIT 1")
    last_crawl = cursor.fetchone()
    conn.close()
    return {
        "by_category": stats,
        "total": total,
        "last_crawl": dict(last_crawl) if last_crawl else None
    }

def log_crawl_start():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO crawl_log (started_at, status) VALUES (?, 'running')",
        (datetime.utcnow().isoformat(),)
    )
    conn.commit()
    log_id = cursor.lastrowid
    conn.close()
    return log_id

def log_crawl_finish(log_id: int, total: int, error: str = None):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE crawl_log SET finished_at=?, total_fetched=?, status=?, error_msg=? WHERE id=?",
        (datetime.utcnow().isoformat(), total, "error" if error else "success", error, log_id)
    )
    conn.commit()
    conn.close()
