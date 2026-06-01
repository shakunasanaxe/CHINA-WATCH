# China Watch — Research Intelligence Platform

A full-stack research tool for monitoring Chinese official media and government sources.  
AI-powered crawling, translation, and analysis via the Anthropic API.

## Architecture

```
china-watch/
├── backend/           # Python FastAPI
│   ├── main.py        # API server + crawl orchestration
│   ├── scraper.py     # HTTP crawler (HTML + RSS, encoding-aware)
│   ├── ai_processor.py # Anthropic API: web search + analysis
│   ├── database.py    # SQLite cache layer
│   ├── config.py      # All 15 target sites + domain config
│   └── venv/          # Python virtualenv
├── frontend/          # React + Tailwind + Vite
│   └── src/App.jsx    # Dashboard UI
├── start.sh           # Launch script
└── README.md
```

## Quick Start

### 1. Prerequisites
- Python 3.10+ 
- Node.js 18+
- Anthropic API key (`sk-ant-...`)

### 2. Launch

```bash
# Option A: with API key in environment (recommended)
export ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
bash start.sh

# Option B: enter key in browser UI
bash start.sh
```

Open **http://localhost:3000** — you'll be prompted for your API key on first visit.

### 3. Usage

1. Click **"Refresh Feed"** to trigger a crawl
2. The crawler uses the Anthropic web_search tool to find recent articles from all 15 sources
3. Each article is AI-analyzed: translated, bullet-pointed, and contextualized
4. Results are cached in SQLite — no re-crawl until you click Refresh again
5. Click any article card to expand summaries and significance analysis

## The 5 Domains

| Domain | Sources |
|--------|---------|
| Economy | NDRC, NBS, MOFCOM |
| Technology | SASAC, MIIT, CAC |
| Military | 81.cn, CCTV Military, Guancha |
| Local & Governance | State Council, People's Daily, NPC |
| Foreign Policy | MFA, Xinhua, Global Times |

## Notes on Scraping

Chinese government sites block raw HTTP scrapers from cloud/server IPs.  
This tool uses the Anthropic API's built-in web search capability to fetch content,  
which routes through Anthropic's infrastructure and reliably accesses these sources.

Each crawl processes ~15 sites × 5 articles = ~75 articles, with full AI analysis.  
Estimated time: 3–8 minutes per full crawl.

## Manual Backend-Only Commands

```bash
# Run backend only
cd backend
ANTHROPIC_API_KEY=sk-ant-... venv/bin/python main.py

# Run frontend only (needs backend running)
cd frontend
npm run dev
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/articles` | GET | List cached articles (filter by `?category=economy`) |
| `/api/stats` | GET | Article counts by domain |
| `/api/crawl/trigger` | POST | Start a crawl (pass `X-Api-Key` header) |
| `/api/crawl/status` | GET | Crawl progress |
| `/api/docs` | GET | Auto-generated Swagger docs |
