import { useState, useEffect, useMemo, useRef } from "react";
import {
  Globe, Cpu, Shield, Building2, TrendingUp,
  RefreshCw, Search, AlertCircle, Clock,
  ExternalLink, Loader2, Activity, Database, X,
  ChevronDown, ChevronUp, Sparkles,
} from "lucide-react";

const PAGE_SIZE = 20;

const DOMAINS = [
  { id: "all",            label: "All Sources",       icon: Globe,      color: "#0f172a" },
  { id: "economy",        label: "Economy",            icon: TrendingUp, color: "#2563eb" },
  { id: "technology",     label: "Technology",         icon: Cpu,        color: "#7c3aed" },
  { id: "military",       label: "Military",           icon: Shield,     color: "#dc2626" },
  { id: "governance",     label: "Local & Governance", icon: Building2,  color: "#059669" },
  { id: "foreign_policy", label: "Foreign Policy",     icon: Globe,      color: "#d97706" },
];

const DOMAIN_COLORS = {
  economy: "#2563eb", technology: "#7c3aed", military: "#dc2626",
  governance: "#059669", foreign_policy: "#d97706",
};

const PROVIDERS = [
  { id: "groq",       label: "Groq",       badge: "Free",           badgeColor: "bg-green-100 text-green-700",   placeholder: "gsk_...",    keyLink: "https://console.groq.com/keys",      needsKey: true  },
  { id: "openrouter", label: "OpenRouter", badge: "Free tier",      badgeColor: "bg-purple-100 text-purple-700", placeholder: "sk-or-...",  keyLink: "https://openrouter.ai/keys",         needsKey: true  },
  { id: "anthropic",  label: "Anthropic",  badge: "Best quality",   badgeColor: "bg-orange-100 text-orange-700", placeholder: "sk-ant-...", keyLink: "https://console.anthropic.com/keys", needsKey: true  },
];

// ── Client-side AI call (direct from browser) ─────────────────────────────────
const PROVIDER_MODELS = {
  groq:       "llama-3.1-8b-instant",
  openrouter: "meta-llama/llama-3.1-8b-instruct:free",
  anthropic:  "claude-haiku-4-5-20251001",
};

const ANALYSIS_SYSTEM = `You are a specialist analyst fluent in Chinese and English.
Respond with ONLY a JSON object. No markdown, no code fences. Start with { and end with }.
Required keys:
- "english_title": English translation of the title (string)
- "summary_bullets": exactly 2 bullet points as a JSON array of strings
- "significance": 2-3 sentence analysis of policy significance (string)`;

async function callAI(provider, apiKey, title, text, source) {
  const content = `SOURCE: ${source}\nTITLE: ${title}\n\nCONTENT:\n${text.slice(0, 2000)}`;
  const messages = [
    { role: "system", content: ANALYSIS_SYSTEM },
    { role: "user",   content: `Analyze this article:\n\n${content}` },
  ];

  let url, headers, body;

  if (provider === "groq") {
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    body = { model: PROVIDER_MODELS.groq, messages, temperature: 0.1, max_tokens: 800 };
  } else if (provider === "openrouter") {
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    body = { model: PROVIDER_MODELS.openrouter, messages, temperature: 0.1, max_tokens: 800 };
  } else if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    body = {
      model: PROVIDER_MODELS.anthropic,
      system: ANALYSIS_SYSTEM,
      messages: [{ role: "user", content: `Analyze this article:\n\n${content}` }],
      max_tokens: 800,
    };
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  let raw = provider === "anthropic"
    ? data.content[0].text
    : data.choices[0].message.content;

  raw = raw.trim().replace(/```(?:json)?/g, "").trim().replace(/`+$/, "").trim();
  const start = raw.indexOf("{");
  const end   = raw.lastIndexOf("}") + 1;
  return JSON.parse(raw.slice(start, end));
}

// ── AI Summary modal ──────────────────────────────────────────────────────────
function SummarizeModal({ article, onClose, onDone }) {
  const [selectedProvider, setSelectedProvider] = useState("groq");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("cw_ai_key") || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const provider = PROVIDERS.find(p => p.id === selectedProvider);

  const handleSummarize = async () => {
    setLoading(true);
    setError("");
    try {
      localStorage.setItem("cw_ai_key", apiKey);
      const result = await callAI(
        selectedProvider, apiKey,
        article.english_title || article.original_title,
        article.raw_text || "",
        article.source_site,
      );
      const bullets = result.summary_bullets || [];
      onDone({
        english_title: result.english_title || article.english_title,
        summary: bullets.map(b => `• ${b}`).join("\n"),
        significance: result.significance || "",
      });
    } catch (e) {
      setError(e.message || "AI analysis failed. Check your API key.");
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
        <div className="grid grid-cols-3 gap-2 mb-4">
          {PROVIDERS.map(p => (
            <button key={p.id} onClick={() => setSelectedProvider(p.id)}
              className={`text-left p-3 rounded-xl border-2 transition-all ${selectedProvider === p.id ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}>
              <div className="font-semibold text-slate-900 text-sm">{p.label}</div>
              <div className={`text-[10px] px-1 py-0.5 rounded-full font-medium mt-1 inline-block ${p.badgeColor}`}>{p.badge}</div>
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500 mb-1.5">
          <a href={provider.keyLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
            Get a free {provider.label} key →
          </a>
        </p>
        <input
          type="password"
          placeholder={provider.placeholder}
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 mb-4"
        />

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <button
          onClick={handleSummarize}
          disabled={apiKey.length < 10 || loading}
          className="w-full bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-40 hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {loading ? "Analysing..." : "Generate AI Summary"}
        </button>
        <p className="text-slate-400 text-xs mt-3 text-center">API key stored in your browser only — never sent to us</p>
      </div>
    </div>
  );
}

// ── Article card ──────────────────────────────────────────────────────────────
function ArticleCard({ article: initialArticle }) {
  const [article, setArticle] = useState(initialArticle);
  const [expanded, setExpanded] = useState(false);
  const [showSummarize, setShowSummarize] = useState(false);
  const color = DOMAIN_COLORS[article.domain_category] || "#64748b";

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all">
        <button className="w-full text-left px-4 py-3.5" onClick={() => setExpanded(e => !e)}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color, background: color + "18" }}>
                  {article.source_site}
                </span>
                {article.publish_date && (
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Clock size={9} /> {article.publish_date}
                  </span>
                )}
                {article.summary && (
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
            {article.summary ? (
              <>
                <div className="mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Summary</p>
                  <div className="text-sm text-slate-700 space-y-1 leading-relaxed">
                    {article.summary.split("\n").map((b, i) => <p key={i}>{b}</p>)}
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
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Content</p>
                <p className="text-sm text-slate-600 leading-relaxed line-clamp-6">{article.raw_text}</p>
              </div>
            ) : null}

            <div className="flex items-center gap-2 mt-3">
              {article.original_url && (
                <a href={article.original_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium">
                  <ExternalLink size={11} /> View Source
                </a>
              )}
              <button onClick={() => setShowSummarize(true)}
                className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 font-medium ml-auto bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors">
                <Sparkles size={11} />
                {article.summary ? "Re-analyse" : "AI Summary"}
              </button>
            </div>
          </div>
        )}
      </div>

      {showSummarize && (
        <SummarizeModal
          article={article}
          onClose={() => setShowSummarize(false)}
          onDone={(result) => {
            setArticle(a => ({ ...a, ...result }));
            setShowSummarize(false);
            setExpanded(true);
          }}
        />
      )}
    </>
  );
}

// ── Domain grouped view ───────────────────────────────────────────────────────
function DomainGroupedView({ articles }) {
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
              {arts.map(a => <ArticleCard key={a.id || a.original_url} article={a} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function App() {
  const [allArticles, setAllArticles] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const searchTimer = useRef(null);

  // Load articles.json on mount
  useEffect(() => {
    fetch("articles.json")
      .then(r => { if (!r.ok) throw new Error("articles.json not found"); return r.json(); })
      .then(data => {
        setAllArticles(data.articles || []);
        setUpdatedAt(data.updated_at || null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Reset page when tab/search changes
  useEffect(() => { setPage(1); }, [activeTab, searchQuery]);

  // Client-side filter
  const filtered = useMemo(() => {
    let list = allArticles;
    if (activeTab !== "all") list = list.filter(a => a.domain_category === activeTab);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(a =>
        (a.english_title || "").toLowerCase().includes(q) ||
        (a.original_title || "").toLowerCase().includes(q) ||
        (a.raw_text || "").toLowerCase().includes(q) ||
        (a.source_site || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [allArticles, activeTab, searchQuery]);

  const paginated = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = paginated.length < filtered.length;

  const handleSearchInput = (val) => {
    setSearchInput(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchQuery(val), 300);
  };

  const total = allArticles.length;
  const byCategory = {};
  DOMAINS.slice(1).forEach(d => { byCategory[d.id] = allArticles.filter(a => a.domain_category === d.id).length; });

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
                <button key={d.id}
                  onClick={() => { setActiveTab(d.id); setSearchInput(""); setSearchQuery(""); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    active ? "bg-white text-slate-900" : "text-slate-400 hover:text-white hover:bg-slate-800"
                  }`}>
                  <Icon size={12} /> {d.label}
                </button>
              );
            })}
          </nav>

          {updatedAt && (
            <div className="hidden lg:flex items-center gap-1.5 text-slate-500 text-xs">
              <RefreshCw size={11} />
              Updated {new Date(updatedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-5">
        {/* Stat bar */}
        <div className="flex items-center gap-4 flex-wrap mb-5">
          <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-100 px-4 py-2">
            <Database size={13} className="text-slate-400" />
            <span className="text-sm font-bold text-slate-800">{total.toLocaleString()}</span>
            <span className="text-xs text-slate-500">articles archived</span>
          </div>
          <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-100 px-4 py-2 ml-auto">
            <Activity size={13} className="text-green-500" />
            <span className="text-xs text-slate-500">Auto-crawl every 6 hours via GitHub Actions</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4">
            <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">{error} — run the crawler first to generate articles.json</p>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-5">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Search all archived articles..."
            value={searchInput} onChange={e => handleSearchInput(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(""); setSearchQuery(""); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={28} className="animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center max-w-sm">
              <Database size={32} className="text-slate-300 mx-auto mb-4" />
              <h3 className="font-semibold text-slate-700 mb-2">
                {searchQuery ? `No results for "${searchQuery}"` : "No articles yet"}
              </h3>
              {!searchQuery && <p className="text-slate-500 text-sm">GitHub Actions crawls every 6 hours.</p>}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <p className="text-xs text-slate-500">
                Showing <span className="font-semibold text-slate-700">{paginated.length}</span> of{" "}
                <span className="font-semibold text-slate-700">{filtered.length}</span> articles
                {searchQuery && <span> matching "<em>{searchQuery}</em>"</span>}
              </p>
            </div>

            {activeTab === "all" && !searchQuery ? (
              <DomainGroupedView articles={paginated} />
            ) : (
              <div className="grid gap-2">
                {paginated.map(a => <ArticleCard key={a.id || a.original_url} article={a} />)}
              </div>
            )}

            {hasMore && (
              <div className="flex justify-center mt-6">
                <button onClick={() => setPage(p => p + 1)}
                  className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-sm font-medium text-slate-700 transition-colors">
                  Load more ({filtered.length - paginated.length} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
