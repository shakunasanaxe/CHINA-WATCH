import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import {
  BarChart2, Globe, Cpu, Shield, Building2, TrendingUp,
  RefreshCw, Search, AlertCircle, Clock,
  ExternalLink, Loader2, Activity, Database, X,
  LogOut, ChevronDown, ChevronUp, Sparkles, Lock
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8000") + "/api";
const PAGE_SIZE = 20;

const DOMAINS = [
  { id: "all",            label: "All Sources",       icon: Globe,      color: "#0f172a", bg: "#f8fafc"  },
  { id: "economy",        label: "Economy",            icon: TrendingUp, color: "#2563eb", bg: "#eff6ff"  },
  { id: "technology",     label: "Technology",         icon: Cpu,        color: "#7c3aed", bg: "#f5f3ff"  },
  { id: "military",       label: "Military",           icon: Shield,     color: "#dc2626", bg: "#fef2f2"  },
  { id: "governance",     label: "Local & Governance", icon: Building2,  color: "#059669", bg: "#f0fdf4"  },
  { id: "foreign_policy", label: "Foreign Policy",     icon: Globe,      color: "#d97706", bg: "#fffbeb"  },
];

const DOMAIN_COLORS = {
  economy: "#2563eb", technology: "#7c3aed", military: "#dc2626",
  governance: "#059669", foreign_policy: "#d97706",
};

const PROVIDERS = [
  { id: "groq",       label: "Groq",       badge: "Free",            badgeColor: "bg-green-100 text-green-700",  placeholder: "gsk_...",    keyLink: "https://console.groq.com/keys",        needsKey: true  },
  { id: "ollama",     label: "Ollama",     badge: "Local · No key",  badgeColor: "bg-blue-100 text-blue-700",    placeholder: null,         keyLink: "https://ollama.com/download",          needsKey: false },
  { id: "openrouter", label: "OpenRouter", badge: "Free tier",       badgeColor: "bg-purple-100 text-purple-700",placeholder: "sk-or-...",  keyLink: "https://openrouter.ai/keys",           needsKey: true  },
  { id: "anthropic",  label: "Anthropic",  badge: "Best quality",    badgeColor: "bg-orange-100 text-orange-700",placeholder: "sk-ant-...", keyLink: "https://console.anthropic.com/keys",   needsKey: true  },
];

// ── Auth helpers ──────────────────────────────────────────────────────────────
function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem("cw_token") || "");
  const login = (t) => { setToken(t); localStorage.setItem("cw_token", t); };
  const logout = () => { setToken(""); localStorage.removeItem("cw_token"); };
  return [token, login, logout];
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// ── Login screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("username", username);
      form.append("password", password);
      const res = await axios.post(`${API_BASE}/auth/login`, form);
      onLogin(res.data.access_token);
    } catch {
      setError("Incorrect username or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center">
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-white text-lg tracking-tight">CHINA WATCH</h1>
            <p className="text-slate-500 text-xs tracking-widest uppercase">Research Intelligence Platform</p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="bg-slate-900 rounded-2xl p-7 border border-slate-800">
          <h2 className="text-white font-semibold mb-5 flex items-center gap-2">
            <Lock size={15} className="text-slate-400" /> Sign in to continue
          </h2>

          {error && (
            <div className="bg-red-950 border border-red-800 text-red-300 text-sm px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <div className="space-y-3 mb-5">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        <p className="text-slate-600 text-xs text-center mt-4">Access restricted to authorised researchers</p>
      </div>
    </div>
  );
}

// ── AI Summary modal ──────────────────────────────────────────────────────────
function SummarizeModal({ article, token, onClose, onDone }) {
  const [selectedProvider, setSelectedProvider] = useState("groq");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("cw_ai_key") || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const provider = PROVIDERS.find(p => p.id === selectedProvider);
  const canSubmit = !provider.needsKey || apiKey.length > 10;

  const handleSummarize = async () => {
    setLoading(true);
    setError("");
    try {
      if (provider.needsKey) localStorage.setItem("cw_ai_key", apiKey);
      const res = await axios.post(
        `${API_BASE}/articles/${article.id}/summarize`,
        {},
        { headers: { ...authHeaders(token), "X-Api-Key": apiKey, "X-Provider": selectedProvider } }
      );
      onDone(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || "AI analysis failed. Check your API key.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-7 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-600" />
            <h3 className="font-bold text-slate-900">AI Analysis</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        <p className="text-slate-600 text-sm mb-5 line-clamp-2 bg-slate-50 rounded-lg px-3 py-2 font-medium">
          {article.english_title || article.original_title}
        </p>

        <p className="text-slate-600 text-sm mb-3">Choose AI provider:</p>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {PROVIDERS.map(p => (
            <button key={p.id} onClick={() => setSelectedProvider(p.id)}
              className={`text-left p-3 rounded-xl border-2 transition-all ${selectedProvider === p.id ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="font-semibold text-slate-900 text-sm">{p.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.badgeColor}`}>{p.badge}</span>
              </div>
            </button>
          ))}
        </div>

        {provider.needsKey ? (
          <>
            <p className="text-xs text-slate-500 mb-1.5">
              <a href={provider.keyLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Get a free {provider.label} key →</a>
            </p>
            <input
              type="password"
              placeholder={provider.placeholder}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 mb-4"
            />
          </>
        ) : (
          <div className="bg-blue-50 rounded-xl p-3 mb-4 text-sm text-blue-700">
            Make sure <a href={provider.keyLink} target="_blank" rel="noopener noreferrer" className="underline font-medium">Ollama</a> is running locally (<code className="bg-blue-100 px-1 rounded">ollama pull llama3.2</code>).
          </div>
        )}

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <button
          onClick={handleSummarize}
          disabled={!canSubmit || loading}
          className="w-full bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-40 hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {loading ? "Analysing..." : "Generate AI Summary"}
        </button>
        <p className="text-slate-400 text-xs mt-3 text-center">API key stored locally only</p>
      </div>
    </div>
  );
}

// ── Article card ──────────────────────────────────────────────────────────────
function ArticleCard({ article: initialArticle, token }) {
  const [article, setArticle] = useState(initialArticle);
  const [expanded, setExpanded] = useState(false);
  const [showSummarize, setShowSummarize] = useState(false);
  const color = DOMAIN_COLORS[article.domain_category] || "#64748b";

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all">
        <button
          className="w-full text-left px-4 py-3.5"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ color, background: color + "18" }}
                >
                  {article.source_site}
                </span>
                {article.publish_date && (
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Clock size={9} /> {article.publish_date}
                  </span>
                )}
                {article.processed === 1 && (
                  <span className="text-[10px] text-purple-600 flex items-center gap-1 bg-purple-50 px-1.5 py-0.5 rounded-full">
                    <Sparkles size={9} /> AI
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-slate-800 leading-snug">
                {article.english_title || article.original_title}
              </p>
              {article.original_title !== article.english_title && article.original_title && (
                <p className="text-xs text-slate-400 mt-0.5 truncate">{article.original_title}</p>
              )}
            </div>
            <div className="flex-shrink-0 text-slate-400 mt-0.5">
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </div>
          </div>
        </button>

        {expanded && (
          <div className="px-4 pb-4 border-t border-slate-50 pt-3">
            {article.processed === 1 && article.summary ? (
              <>
                <div className="mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Summary</p>
                  <div className="text-sm text-slate-700 space-y-1 leading-relaxed">
                    {article.summary.split("\n").map((b, i) => (
                      <p key={i}>{b}</p>
                    ))}
                  </div>
                </div>
                {article.significance && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Significance</p>
                    <p className="text-sm text-slate-600 leading-relaxed">{article.significance}</p>
                  </div>
                )}
              </>
            ) : article.raw_text ? (
              <div className="mb-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Raw Content</p>
                <p className="text-sm text-slate-600 leading-relaxed line-clamp-6">{article.raw_text}</p>
              </div>
            ) : null}

            <div className="flex items-center gap-2 mt-3">
              {article.original_url && (
                <a
                  href={article.original_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  <ExternalLink size={11} /> View Source
                </a>
              )}
              <button
                onClick={() => setShowSummarize(true)}
                className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 font-medium ml-auto bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Sparkles size={11} />
                {article.processed === 1 ? "Re-analyse" : "AI Summary"}
              </button>
            </div>
          </div>
        )}
      </div>

      {showSummarize && (
        <SummarizeModal
          article={article}
          token={token}
          onClose={() => setShowSummarize(false)}
          onDone={(result) => {
            setArticle(a => ({ ...a, ...result, processed: 1 }));
            setShowSummarize(false);
            setExpanded(true);
          }}
        />
      )}
    </>
  );
}

// ── Stat bar ──────────────────────────────────────────────────────────────────
function StatBar({ stats }) {
  if (!stats) return null;
  const total = stats.total || 0;
  const lastCrawl = stats.last_crawl;
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-100 px-4 py-2">
        <Database size={13} className="text-slate-400" />
        <span className="text-sm font-bold text-slate-800">{total.toLocaleString()}</span>
        <span className="text-xs text-slate-500">articles archived</span>
      </div>
      {lastCrawl && (
        <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-100 px-4 py-2">
          <Clock size={13} className="text-slate-400" />
          <span className="text-xs text-slate-500">Last crawl: {lastCrawl.started_at?.slice(0, 10)}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${lastCrawl.status === "success" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {lastCrawl.status}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-100 px-4 py-2 ml-auto">
        <Activity size={13} className="text-green-500" />
        <span className="text-xs text-slate-500">Auto-crawl every 6 hours</span>
      </div>
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function App() {
  const [token, login, logout] = useAuth();
  const [activeTab, setActiveTab] = useState("all");
  const [articles, setArticles] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [crawlStatus, setCrawlStatus] = useState({ running: false });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [errorMsg, setErrorMsg] = useState(null);
  const pollRef = useRef(null);
  const searchTimer = useRef(null);

  const fetchArticles = useCallback(async (cat, search, off = 0, append = false) => {
    if (!token) return;
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const params = { limit: PAGE_SIZE, offset: off };
      if (cat !== "all") params.category = cat;
      if (search) params.search = search;
      const res = await axios.get(`${API_BASE}/articles`, { params, headers: authHeaders(token) });
      if (append) {
        setArticles(a => [...a, ...res.data.articles]);
      } else {
        setArticles(res.data.articles);
        setOffset(0);
      }
      setTotal(res.data.total);
    } catch (e) {
      if (e.response?.status === 401) logout();
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token]);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API_BASE}/stats`, { headers: authHeaders(token) });
      setStats(res.data);
    } catch {}
  }, [token]);

  const loadMore = () => {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    fetchArticles(activeTab, searchQuery, newOffset, true);
  };

  const pollCrawlStatus = useCallback(async () => {
    if (!token) return;
    try {
      const res = await axios.get(`${API_BASE}/crawl/status`, { headers: authHeaders(token) });
      setCrawlStatus(res.data);
      if (!res.data.running) {
        clearInterval(pollRef.current);
        fetchArticles(activeTab, searchQuery, 0, false);
        fetchStats();
      }
    } catch {}
  }, [token, activeTab, searchQuery]);

  const triggerCrawl = async () => {
    try {
      await axios.post(`${API_BASE}/crawl/trigger`, {}, { headers: authHeaders(token) });
      setCrawlStatus({ running: true, phase: "searching", progress: 0, total: 16, current_site: "" });
      pollRef.current = setInterval(pollCrawlStatus, 3000);
    } catch (e) {
      setErrorMsg(e.response?.data?.detail || "Crawl trigger failed");
    }
  };

  // Debounced search
  const handleSearchInput = (val) => {
    setSearchInput(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearchQuery(val);
      setOffset(0);
      fetchArticles(activeTab, val, 0, false);
    }, 400);
  };

  useEffect(() => {
    if (token) {
      fetchArticles(activeTab, searchQuery, 0, false);
      fetchStats();
    }
  }, [token, activeTab]);

  useEffect(() => {
    return () => clearInterval(pollRef.current);
  }, []);

  if (!token) return <LoginScreen onLogin={login} />;

  const hasMore = articles.length < total;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50" style={{ fontFamily: "Century Gothic, Century, CenturyGothic, AppleGothic, sans-serif" }}>
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

          <nav className="hidden md:flex items-center gap-1">
            {DOMAINS.map(d => {
              const Icon = d.icon;
              const active = activeTab === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => { setActiveTab(d.id); setOffset(0); setSearchInput(""); setSearchQuery(""); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    active ? "bg-white text-slate-900" : "text-slate-400 hover:text-white hover:bg-slate-800"
                  }`}
                >
                  <Icon size={12} />
                  {d.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={triggerCrawl}
              disabled={crawlStatus.running}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              {crawlStatus.running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {crawlStatus.running ? `${crawlStatus.current_site || "Crawling"}...` : "Refresh"}
            </button>
            <button onClick={logout} className="text-slate-500 hover:text-slate-300 p-2" title="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-5">
        {stats && <div className="mb-4"><StatBar stats={stats} /></div>}

        {errorMsg && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4">
            <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">{errorMsg}</p>
            <button onClick={() => setErrorMsg(null)} className="ml-auto"><X size={14} className="text-amber-400" /></button>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-5">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search all archived articles..."
            value={searchInput}
            onChange={e => handleSearchInput(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(""); handleSearchInput(""); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={28} className="animate-spin text-slate-400" />
          </div>
        ) : articles.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center max-w-sm">
              <Database size={32} className="text-slate-300 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 mb-2">
                {searchQuery ? `No results for "${searchQuery}"` : "No articles yet"}
              </h3>
              {!searchQuery && (
                <p className="text-slate-500 text-sm mb-5">Articles are crawled automatically every 6 hours. Click Refresh to crawl now.</p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-500">
                Showing <span className="font-semibold text-slate-700">{articles.length}</span> of{" "}
                <span className="font-semibold text-slate-700">{total}</span> articles
                {searchQuery && <span> matching "<em>{searchQuery}</em>"</span>}
              </p>
            </div>

            {activeTab === "all" && !searchQuery ? (
              <DomainGroupedView articles={articles} token={token} />
            ) : (
              <div className="grid gap-2">
                {articles.map(a => <ArticleCard key={a.id} article={a} token={token} />)}
              </div>
            )}

            {hasMore && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-sm font-medium text-slate-700 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
                  {loadingMore ? "Loading..." : `Load more (${total - articles.length} remaining)`}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function DomainGroupedView({ articles, token }) {
  const byDomain = {};
  DOMAINS.slice(1).forEach(d => { byDomain[d.id] = []; });
  articles.forEach(a => { if (byDomain[a.domain_category]) byDomain[a.domain_category].push(a); });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {DOMAINS.slice(1).map(domain => {
        const arts = byDomain[domain.id] || [];
        if (!arts.length) return null;
        const Icon = domain.icon;
        return (
          <div key={domain.id}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: domain.color }}>
                <Icon size={12} className="text-white" />
              </div>
              <h2 className="font-semibold text-sm text-slate-800">{domain.label}</h2>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto"
                style={{ color: domain.color, background: domain.color + "18" }}>
                {arts.length}
              </span>
            </div>
            <div className="grid gap-2">
              {arts.map(a => <ArticleCard key={a.id} article={a} token={token} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
