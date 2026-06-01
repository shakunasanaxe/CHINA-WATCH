import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import {
  BarChart2, Globe, Cpu, Shield, Building2, TrendingUp,
  RefreshCw, Search, ChevronRight, AlertCircle, Clock,
  ExternalLink, Loader2, Activity, Database, ChevronDown, X
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8000") + "/api";

const DOMAINS = [
  { id: "all",           label: "All Sources",       icon: Globe,     color: "#0f172a",  bg: "#f8fafc"  },
  { id: "economy",       label: "Economy",            icon: TrendingUp, color: "#2563eb", bg: "#eff6ff"  },
  { id: "technology",    label: "Technology",         icon: Cpu,       color: "#7c3aed",  bg: "#f5f3ff"  },
  { id: "military",      label: "Military",           icon: Shield,    color: "#dc2626",  bg: "#fef2f2"  },
  { id: "governance",    label: "Local & Governance", icon: Building2, color: "#059669",  bg: "#f0fdf4"  },
  { id: "foreign_policy",label: "Foreign Policy",     icon: Globe,     color: "#d97706",  bg: "#fffbeb"  },
];

const DOMAIN_COLORS = {
  economy: "#2563eb",
  technology: "#7c3aed",
  military: "#dc2626",
  governance: "#059669",
  foreign_policy: "#d97706",
};

const SITE_NAMES = {
  NDRC: "NDRC", XINHUA_FIN: "Xinhua Finance", MOFCOM: "MOFCOM",
  SASAC: "SASAC", MIIT: "MIIT", CAC: "CAC",
  "81CN": "81.cn", GLOBALTIMES_MIL: "Global Times Mil", GUANCHA: "Guancha",
  GOVCH: "Gov.cn", PEOPLE: "People's Daily", NPC: "NPC",
  MFA: "MFA", XINHUA: "Xinhua", GLOBALTIMES: "Global Times", CGTN: "CGTN",
};

function useApiKey() {
  const [key, setKey] = useState(() => localStorage.getItem("cw_groq_api_key") || "");
  const save = (k) => { setKey(k); localStorage.setItem("cw_groq_api_key", k); };
  return [key, save];
}

function ApiKeyModal({ onSave }) {
  const [val, setVal] = useState("");
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center">
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900 text-lg">China Watch</h2>
            <p className="text-slate-500 text-xs">Research Intelligence Platform</p>
          </div>
        </div>
        <p className="text-slate-600 text-sm mb-5 leading-relaxed">
          Enter your free Groq API key to enable AI-powered analysis of Chinese official sources. Groq is free with 14,400 requests/day.{" "}
          <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Get a free key →</a>
        </p>
        <input
          type="password"
          placeholder="gsk_..."
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === "Enter" && val.length > 10 && onSave(val)}
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 mb-4"
        />
        <button
          onClick={() => onSave(val)}
          disabled={val.length < 10}
          className="w-full bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-40 hover:bg-slate-800 transition-colors"
        >
          Enter Platform
        </button>
        <p className="text-slate-400 text-xs mt-4 text-center">Key stored locally in your browser only</p>
      </div>
    </div>
  );
}

function StatBar({ stats }) {
  if (!stats) return null;
  const total = stats.total || 0;
  const cats = stats.by_category || {};
  const lastCrawl = stats.last_crawl;
  return (
    <div className="flex items-center gap-6 text-xs text-slate-500">
      <span className="flex items-center gap-1.5">
        <Database size={12} />
        <span className="font-semibold text-slate-700">{total}</span> articles cached
      </span>
      {Object.entries(DOMAIN_COLORS).map(([k, c]) => (
        <span key={k} className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />
          <span className="font-medium" style={{ color: c }}>{cats[k] || 0}</span>
        </span>
      ))}
      {lastCrawl && (
        <span className="flex items-center gap-1.5 ml-auto">
          <Clock size={12} />
          Last crawl: {lastCrawl.finished_at?.slice(0, 16) || "—"}
        </span>
      )}
    </div>
  );
}

function ArticleCard({ article, expanded, onToggle }) {
  const color = DOMAIN_COLORS[article.domain_category] || "#64748b";
  const bullets = article.summary
    ? article.summary.split("\n").filter(l => l.trim())
    : [];

  return (
    <div
      className="bg-white border border-slate-100 rounded-xl overflow-hidden hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer group"
      onClick={onToggle}
    >
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ color, background: color + "18" }}
              >
                {SITE_NAMES[article.source_site] || article.source_site}
              </span>
              <span className="text-[11px] text-slate-400">{article.publish_date}</span>
              {article.processed === 1 && (
                <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-medium">AI</span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-slate-800 leading-snug group-hover:text-slate-900">
              {article.english_title || article.original_title || "Untitled"}
            </h3>
            {article.original_title && article.english_title && article.original_title !== article.english_title && (
              <p className="text-xs text-slate-400 mt-0.5 font-light truncate">
                {article.original_title}
              </p>
            )}
          </div>
          <div className="flex-shrink-0 flex items-center gap-1.5 mt-0.5">
            <a
              href={article.original_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-slate-300 hover:text-slate-600 transition-colors"
            >
              <ExternalLink size={13} />
            </a>
            <ChevronDown
              size={14}
              className={`text-slate-300 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </div>
        </div>

        {/* Summary preview (always visible) */}
        {!expanded && bullets.length > 0 && (
          <p className="text-xs text-slate-500 mt-2 line-clamp-2">
            {bullets[0].replace("• ", "")}
          </p>
        )}
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-slate-50 px-5 py-4 bg-slate-50/50">
          {bullets.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Key Summary</p>
              <ul className="space-y-1.5">
                {bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span style={{ color }} className="mt-1 text-xs">▸</span>
                    <span>{b.replace("• ", "")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {article.significance && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Significance</p>
              <p className="text-sm text-slate-600 leading-relaxed">{article.significance}</p>
            </div>
          )}
          {!bullets.length && !article.significance && article.summary && (
            <p className="text-sm text-slate-600">{article.summary}</p>
          )}
        </div>
      )}
    </div>
  );
}

function CrawlProgressBanner({ status, onDismiss }) {
  if (!status.running && !status.last_error) return null;
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm mb-4 ${
      status.last_error
        ? "bg-red-50 border border-red-100 text-red-700"
        : "bg-blue-50 border border-blue-100 text-blue-700"
    }`}>
      {status.running
        ? <Loader2 size={14} className="animate-spin flex-shrink-0" />
        : <AlertCircle size={14} className="flex-shrink-0" />
      }
      <div className="flex-1">
        {status.running ? (
          <>
            <span className="font-semibold">Crawling</span>
            <span className="text-blue-600 ml-2">{status.phase === "analyzing" ? "AI analyzing articles..." : `Searching ${status.current_site || "sources"}...`}</span>
            {status.total > 0 && (
              <span className="ml-2 text-blue-500">{status.progress}/{status.total}</span>
            )}
          </>
        ) : (
          <span className="font-semibold">{status.last_error}</span>
        )}
      </div>
      {!status.running && (
        <button onClick={onDismiss} className="text-current opacity-60 hover:opacity-100">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useApiKey();
  const [activeTab, setActiveTab] = useState("all");
  const [articles, setArticles] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [crawlStatus, setCrawlStatus] = useState({ running: false });
  const [expandedId, setExpandedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [errorMsg, setErrorMsg] = useState(null);
  const pollRef = useRef(null);

  const fetchArticles = useCallback(async (cat) => {
    setLoading(true);
    try {
      const params = cat !== "all" ? { category: cat, limit: 100 } : { limit: 100 };
      const res = await axios.get(`${API_BASE}/articles`, { params });
      setArticles(res.data.articles || []);
    } catch (e) {
      setErrorMsg("Backend unavailable. Start the server with: cd backend && venv/bin/python main.py");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/stats`);
      setStats(res.data);
    } catch {}
  }, []);

  const pollCrawlStatus = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/crawl/status`);
      setCrawlStatus(res.data);
      if (!res.data.running) {
        clearInterval(pollRef.current);
        fetchArticles(activeTab);
        fetchStats();
      }
    } catch {}
  }, [activeTab, fetchArticles, fetchStats]);

  const triggerCrawl = async () => {
    try {
      await axios.post(`${API_BASE}/crawl/trigger`, {}, {
        headers: { "X-Api-Key": apiKey }
      });
      setCrawlStatus({ running: true, phase: "searching", progress: 0, total: 15, current_site: "" });
      pollRef.current = setInterval(pollCrawlStatus, 3000);
    } catch (e) {
      setErrorMsg(e.response?.data?.detail || "Crawl trigger failed");
    }
  };

  useEffect(() => {
    if (apiKey) {
      fetchArticles(activeTab);
      fetchStats();
    }
    return () => clearInterval(pollRef.current);
  }, [apiKey, activeTab]);

  const filtered = articles.filter(a => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (a.english_title || "").toLowerCase().includes(q) ||
      (a.original_title || "").toLowerCase().includes(q) ||
      (a.summary || "").toLowerCase().includes(q) ||
      (a.significance || "").toLowerCase().includes(q)
    );
  });

  if (!apiKey) return <ApiKeyModal onSave={setApiKey} />;

  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily: "Century Gothic, Century, CenturyGothic, AppleGothic, sans-serif" }}>
      {/* Header */}
      <header className="bg-slate-900 text-white sticky top-0 z-40 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center flex-shrink-0">
              <Activity size={15} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight leading-none">CHINA WATCH</h1>
              <p className="text-slate-400 text-[10px] tracking-widest uppercase">Research Intelligence Platform</p>
            </div>
          </div>

          {/* Tabs */}
          <nav className="hidden md:flex items-center gap-1">
            {DOMAINS.map(d => {
              const Icon = d.icon;
              const active = activeTab === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => { setActiveTab(d.id); setExpandedId(null); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    active
                      ? "bg-white text-slate-900"
                      : "text-slate-400 hover:text-white hover:bg-slate-800"
                  }`}
                >
                  <Icon size={12} />
                  {d.label}
                </button>
              );
            })}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={triggerCrawl}
              disabled={crawlStatus.running}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              {crawlStatus.running
                ? <Loader2 size={12} className="animate-spin" />
                : <RefreshCw size={12} />
              }
              {crawlStatus.running ? "Crawling..." : "Refresh Feed"}
            </button>
            <button
              onClick={() => setApiKey("")}
              className="text-slate-500 hover:text-slate-300 text-xs px-2 py-2 transition-colors"
              title="Change API key"
            >
              ⚙
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-5">
        {/* Stats row */}
        {stats && <div className="mb-4"><StatBar stats={stats} /></div>}

        {/* Crawl progress */}
        <CrawlProgressBanner status={crawlStatus} onDismiss={() => setCrawlStatus(s => ({...s, last_error: null}))} />

        {/* Error */}
        {errorMsg && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4">
            <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">{errorMsg}</p>
            <button onClick={() => setErrorMsg(null)} className="ml-auto text-amber-400 hover:text-amber-600"><X size={14} /></button>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-5">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search articles, summaries, significance..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <Loader2 size={28} className="animate-spin text-slate-400 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Loading articles...</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center max-w-sm">
              <Database size={32} className="text-slate-300 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 mb-2">No articles yet</h3>
              <p className="text-slate-500 text-sm mb-5">
                {searchQuery
                  ? `No results for "${searchQuery}"`
                  : 'Click "Refresh Feed" to crawl Chinese official sources and generate AI summaries.'}
              </p>
              {!searchQuery && (
                <button
                  onClick={triggerCrawl}
                  disabled={crawlStatus.running}
                  className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={14} />
                  Start First Crawl
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-500">
                Showing <span className="font-semibold text-slate-700">{filtered.length}</span> articles
                {searchQuery && <span> matching "<em>{searchQuery}</em>"</span>}
              </p>
              {activeTab !== "all" && (
                <div
                  className="text-xs font-semibold px-3 py-1 rounded-full"
                  style={{ color: DOMAIN_COLORS[activeTab], background: DOMAIN_COLORS[activeTab] + "18" }}
                >
                  {DOMAINS.find(d => d.id === activeTab)?.label}
                </div>
              )}
            </div>

            {/* Group by domain if "all" */}
            {activeTab === "all" ? (
              <DomainGroupedView
                articles={filtered}
                expandedId={expandedId}
                setExpandedId={setExpandedId}
              />
            ) : (
              <div className="grid gap-2">
                {filtered.map(a => (
                  <ArticleCard
                    key={a.id}
                    article={a}
                    expanded={expandedId === a.id}
                    onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function DomainGroupedView({ articles, expandedId, setExpandedId }) {
  const byDomain = {};
  DOMAINS.slice(1).forEach(d => { byDomain[d.id] = []; });
  articles.forEach(a => {
    if (byDomain[a.domain_category]) byDomain[a.domain_category].push(a);
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {DOMAINS.slice(1).map(domain => {
        const arts = byDomain[domain.id] || [];
        if (!arts.length) return null;
        const Icon = domain.icon;
        return (
          <div key={domain.id}>
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ background: domain.color }}
              >
                <Icon size={12} className="text-white" />
              </div>
              <h2 className="font-semibold text-sm text-slate-800">{domain.label}</h2>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto"
                style={{ color: domain.color, background: domain.color + "18" }}
              >
                {arts.length}
              </span>
            </div>
            <div className="grid gap-2">
              {arts.slice(0, 6).map(a => (
                <ArticleCard
                  key={a.id}
                  article={a}
                  expanded={expandedId === a.id}
                  onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
