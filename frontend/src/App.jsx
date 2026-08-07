import { useState, useEffect, useMemo, useRef } from "react";

const PAGE_SIZE = 20;

const DOMAINS = [
  { id: "all",            label: "All Sources",       code: "ALL" },
  { id: "economy",        label: "Economy",            code: "ECO" },
  { id: "technology",     label: "Technology",         code: "TEC" },
  { id: "military",       label: "Military",           code: "MIL" },
  { id: "governance",     label: "Governance",         code: "GOV" },
  { id: "foreign_policy", label: "Foreign Policy",     code: "FP"  },
];

const DOMAIN_CODES = {
  economy: "ECO", technology: "TEC", military: "MIL",
  governance: "GOV", foreign_policy: "FP",
};

const PROVIDERS = [
  { id: "groq",       label: "Groq",      badge: "Free",         placeholder: "gsk_...",    keyLink: "https://console.groq.com/keys"          },
  { id: "openrouter", label: "OpenRouter", badge: "Free tier",    placeholder: "sk-or-...",  keyLink: "https://openrouter.ai/keys"             },
  { id: "anthropic",  label: "Anthropic",  badge: "Best quality", placeholder: "sk-ant-...", keyLink: "https://console.anthropic.com/keys"     },
];

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
    { role: "user",   content: `Analyse this article:\n\n${content}` },
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
      messages: [{ role: "user", content: `Analyse this article:\n\n${content}` }],
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

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ animation: "spin 0.8s linear infinite" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="12" />
    </svg>
  );
}

// ── AI Summary modal ──────────────────────────────────────────────────────────
function SummarizeModal({ article, onClose, onDone }) {
  const [selectedProvider, setSelectedProvider] = useState("groq");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("cw_ai_key") || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const provider = PROVIDERS.find(p => p.id === selectedProvider);

  const handleSummarise = async () => {
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
      setError(e.message || "Analysis failed. Check your API key.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(23,20,19,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: "0 var(--tk-pad-x)",
    }}>
      <div style={{
        background: "var(--tk-bg)", border: "var(--tk-rule)",
        width: "100%", maxWidth: 520,
      }}>
        {/* Modal header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", borderBottom: "var(--tk-rule)",
        }}>
          <span style={{ fontFamily: "var(--tk-mono)", fontSize: 11, letterSpacing: "0.14em", color: "var(--tk-ink-50)" }}>
            AI ANALYSIS
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--tk-ink-50)", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: "24px" }}>
          {/* Article title */}
          <p style={{
            fontSize: 14, fontWeight: 500, color: "var(--tk-ink)", lineHeight: 1.4,
            borderLeft: "2px solid var(--tk-primary)", paddingLeft: 12, marginBottom: 20,
            textWrap: "pretty",
          }}>
            {article.english_title || article.original_title}
          </p>

          {/* Provider selector */}
          <p className="tk-meta" style={{ marginBottom: 10 }}>CHOOSE PROVIDER</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderTop: "var(--tk-rule)", borderLeft: "var(--tk-rule)", marginBottom: 20 }}>
            {PROVIDERS.map(p => (
              <button key={p.id} onClick={() => setSelectedProvider(p.id)} style={{
                padding: "10px 12px", textAlign: "left", cursor: "pointer",
                borderRight: "var(--tk-rule)", borderBottom: "var(--tk-rule)",
                background: selectedProvider === p.id ? "var(--tk-primary)" : "var(--tk-bg)",
                color: selectedProvider === p.id ? "#fff" : "var(--tk-ink)",
                border: "none", borderRight: "var(--tk-rule)", borderBottom: "var(--tk-rule)",
                outline: selectedProvider === p.id ? "none" : "none",
              }}>
                <div style={{ fontFamily: "var(--tk-sans)", fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{p.label}</div>
                <div style={{ fontFamily: "var(--tk-mono)", fontSize: 10, letterSpacing: "0.08em", opacity: 0.7 }}>{p.badge}</div>
              </button>
            ))}
          </div>
          {/* Recreate grid border */}
          <style>{`.provider-grid button { border: none; border-right: var(--tk-rule); border-bottom: var(--tk-rule); }`}</style>

          {/* API key */}
          <p style={{ fontSize: 12, color: "var(--tk-ink-50)", marginBottom: 6 }}>
            <a href={provider.keyLink} target="_blank" rel="noopener noreferrer"
              style={{ color: "var(--tk-primary)", textDecoration: "underline" }}>
              Get a free {provider.label} key ↗
            </a>
          </p>
          <input
            type="password"
            placeholder={provider.placeholder}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            style={{
              width: "100%", padding: "10px 12px",
              border: "var(--tk-rule)", background: "var(--tk-bg)",
              fontFamily: "var(--tk-mono)", fontSize: 13,
              color: "var(--tk-ink)", outline: "none",
              borderRadius: 0, marginBottom: 16,
            }}
          />

          {error && (
            <p style={{ fontSize: 13, color: "#c0392b", marginBottom: 12,
              borderLeft: "2px solid #c0392b", paddingLeft: 10 }}>{error}</p>
          )}

          <button
            onClick={handleSummarise}
            disabled={apiKey.length < 10 || loading}
            style={{
              width: "100%", padding: "12px 24px",
              background: "var(--tk-primary)", color: "#fff",
              border: "none", cursor: apiKey.length < 10 || loading ? "not-allowed" : "pointer",
              opacity: apiKey.length < 10 ? 0.4 : 1,
              fontFamily: "var(--tk-mono)", fontSize: 12, letterSpacing: "0.1em",
              textTransform: "uppercase", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 8,
            }}
          >
            {loading && <Spinner />}
            {loading ? "Analysing..." : "Generate AI Summary →"}
          </button>
          <p style={{ fontFamily: "var(--tk-mono)", fontSize: 10, color: "var(--tk-ink-50)", marginTop: 10, textAlign: "center", letterSpacing: "0.06em" }}>
            API KEY STORED IN YOUR BROWSER ONLY
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Article row ───────────────────────────────────────────────────────────────
function ArticleRow({ article: initialArticle, index }) {
  const [article, setArticle] = useState(initialArticle);
  const [expanded, setExpanded] = useState(false);
  const [showSummarise, setShowSummarise] = useState(false);
  const code = DOMAIN_CODES[article.domain_category] || "—";
  const num = String(index + 1).padStart(2, "0");

  return (
    <>
      <div style={{
        borderBottom: "var(--tk-rule)",
        background: expanded ? "var(--tk-bg-deep)" : "var(--tk-bg)",
        transition: "background 0.15s ease",
      }}>
        {/* Row header */}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            width: "100%", display: "grid",
            gridTemplateColumns: "40px 56px 1fr auto",
            alignItems: "baseline", gap: "0 16px",
            padding: "14px var(--tk-pad-x)", textAlign: "left",
            background: "none", border: "none", cursor: "pointer",
          }}
        >
          {/* Number */}
          <span style={{ fontFamily: "var(--tk-mono)", fontSize: 11, color: "var(--tk-primary)", letterSpacing: "0.06em" }}>
            {num}
          </span>
          {/* Category code */}
          <span style={{ fontFamily: "var(--tk-mono)", fontSize: 10, letterSpacing: "0.12em", color: "var(--tk-ink-50)", textTransform: "uppercase" }}>
            {code}
          </span>
          {/* Title */}
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--tk-ink)", lineHeight: 1.4, textWrap: "pretty" }}>
            {article.english_title || article.original_title}
            {article.original_title && article.original_title !== article.english_title && (
              <span style={{ display: "block", fontFamily: "var(--tk-mono)", fontSize: 10, color: "var(--tk-ink-50)", fontWeight: 400, marginTop: 3, letterSpacing: "0.04em" }}>
                {article.original_title}
              </span>
            )}
          </span>
          {/* Date + source */}
          <span style={{ fontFamily: "var(--tk-mono)", fontSize: 10, color: "var(--tk-ink-50)", letterSpacing: "0.08em", whiteSpace: "nowrap", textAlign: "right" }}>
            {article.source_site}
            {article.publish_date && <><br />{article.publish_date}</>}
            {article.summary && <><br /><span style={{ color: "var(--tk-primary)" }}>AI ✓</span></>}
          </span>
        </button>

        {/* Expanded content */}
        {expanded && (
          <div style={{ padding: "0 var(--tk-pad-x) 20px", borderTop: "var(--tk-rule)" }}>
            <div style={{ paddingTop: 16 }}>
              {article.summary ? (
                <>
                  <p className="tk-meta" style={{ marginBottom: 8 }}>SUMMARY</p>
                  <div style={{ borderLeft: "2px solid var(--tk-primary)", paddingLeft: 16, marginBottom: 16 }}>
                    {article.summary.split("\n").map((b, i) => (
                      <p key={i} style={{ fontSize: 14, color: "var(--tk-ink-70)", lineHeight: 1.6, marginBottom: 4 }}>{b}</p>
                    ))}
                  </div>
                  {article.significance && (
                    <>
                      <p className="tk-meta" style={{ marginBottom: 8 }}>SIGNIFICANCE</p>
                      <p style={{ fontSize: 14, color: "var(--tk-ink-70)", lineHeight: 1.6, marginBottom: 16, textWrap: "pretty" }}>
                        {article.significance}
                      </p>
                    </>
                  )}
                </>
              ) : article.raw_text ? (
                <>
                  <p className="tk-meta" style={{ marginBottom: 8 }}>CONTENT</p>
                  <p style={{ fontSize: 14, color: "var(--tk-ink-70)", lineHeight: 1.65, marginBottom: 16,
                    display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {article.raw_text}
                  </p>
                </>
              ) : null}

              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                {article.original_url && (
                  <a href={article.original_url} target="_blank" rel="noopener noreferrer"
                    style={{ fontFamily: "var(--tk-mono)", fontSize: 11, color: "var(--tk-primary)",
                      letterSpacing: "0.08em", textTransform: "uppercase", textDecoration: "underline" }}>
                    View source ↗
                  </a>
                )}
                <button onClick={() => setShowSummarise(true)} style={{
                  marginLeft: "auto", background: "none", border: "var(--tk-rule)",
                  padding: "6px 14px", cursor: "pointer",
                  fontFamily: "var(--tk-mono)", fontSize: 11, letterSpacing: "0.08em",
                  textTransform: "uppercase", color: "var(--tk-primary)",
                  transition: "background 0.15s ease",
                }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--tk-primary-soft)"}
                  onMouseLeave={e => e.currentTarget.style.background = "none"}
                >
                  {article.summary ? "Re-analyse →" : "AI Summary →"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {showSummarise && (
        <SummarizeModal
          article={article}
          onClose={() => setShowSummarise(false)}
          onDone={result => {
            setArticle(a => ({ ...a, ...result }));
            setShowSummarise(false);
            setExpanded(true);
          }}
        />
      )}
    </>
  );
}

// ── Domain section (grouped view) ─────────────────────────────────────────────
function DomainSection({ domain, articles, globalOffset }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div style={{ borderBottom: "2px solid var(--tk-ink)" }}>
      {/* Section header */}
      <button onClick={() => setExpanded(e => !e)} style={{
        width: "100%", display: "flex", alignItems: "baseline", justifyContent: "space-between",
        padding: "18px var(--tk-pad-x)", background: "none", border: "none", cursor: "pointer",
        borderBottom: expanded ? "var(--tk-rule)" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <span style={{ fontFamily: "var(--tk-mono)", fontSize: 11, color: "var(--tk-primary)", letterSpacing: "0.1em" }}>
            {domain.code}
          </span>
          <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.005em", color: "var(--tk-ink)" }}>
            {domain.label}
          </span>
        </div>
        <span style={{ fontFamily: "var(--tk-mono)", fontSize: 10, color: "var(--tk-ink-50)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {articles.length} articles · {expanded ? "collapse ↑" : "expand ↓"}
        </span>
      </button>
      {expanded && articles.map((a, i) => (
        <ArticleRow key={a.id || a.original_url} article={a} index={globalOffset + i} />
      ))}
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function App() {
  const [allArticles, setAllArticles] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const searchTimer = useRef(null);

  useEffect(() => {
    fetch("articles.json")
      .then(r => { if (!r.ok) throw new Error("articles.json not found"); return r.json(); })
      .then(data => { setAllArticles(data.articles || []); setUpdatedAt(data.updated_at || null); })
      .catch(e => setFetchError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { setPage(1); }, [activeTab, searchQuery]);

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

  const handleSearch = val => {
    setSearchInput(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchQuery(val), 300);
  };

  // Grouped by domain for "all" view
  const byDomain = useMemo(() => {
    const map = {};
    DOMAINS.slice(1).forEach(d => { map[d.id] = []; });
    paginated.forEach(a => { if (map[a.domain_category]) map[a.domain_category].push(a); });
    return map;
  }, [paginated]);

  return (
    <div style={{ minHeight: "100vh", background: "#FDFDFD" }}>

      {/* ── Navbar ── */}
      <header style={{ background: "var(--tk-primary)", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: "var(--tk-max)", margin: "0 auto", padding: "0 var(--tk-pad-x)", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
          {/* Wordmark */}
          <div>
            <div style={{ color: "#fff", fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.1 }}>
              China Watch
            </div>
            <div style={{ fontFamily: "var(--tk-mono)", fontSize: 9.5, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)", textTransform: "uppercase", marginTop: 2 }}>
              Takshashila Institution
            </div>
          </div>

          {/* Domain tabs */}
          <nav style={{ display: "flex", alignItems: "center", gap: 0, borderLeft: "1px solid rgba(255,255,255,0.15)" }}>
            {DOMAINS.map(d => (
              <button key={d.id} onClick={() => { setActiveTab(d.id); setSearchInput(""); setSearchQuery(""); }}
                style={{
                  padding: "0 16px", height: 64, background: "none",
                  border: "none", borderLeft: "none",
                  borderRight: "1px solid rgba(255,255,255,0.15)",
                  cursor: "pointer",
                  fontFamily: "var(--tk-mono)", fontSize: 10.5, letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: activeTab === d.id ? "var(--tk-gold)" : "rgba(255,255,255,0.7)",
                  borderBottom: activeTab === d.id ? "2px solid var(--tk-gold)" : "2px solid transparent",
                  transition: "color 0.15s ease",
                  whiteSpace: "nowrap",
                }}
              >
                {d.code}
              </button>
            ))}
          </nav>

          {/* Updated at */}
          {updatedAt && (
            <span style={{ fontFamily: "var(--tk-mono)", fontSize: 10, letterSpacing: "0.08em", color: "rgba(255,255,255,0.45)", whiteSpace: "nowrap" }}>
              {new Date(updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase()}
            </span>
          )}
        </div>
      </header>

      {/* ── Page header band ── */}
      <div style={{ borderBottom: "2px solid var(--tk-ink)", background: "var(--tk-bg)" }}>
        <div style={{ maxWidth: "var(--tk-max)", margin: "0 auto", padding: "32px var(--tk-pad-x) 28px" }}>
          <p className="tk-eyebrow" style={{ marginBottom: 12 }}>Research Intelligence Platform</p>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 32, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.2, textWrap: "balance" }}>
              Chinese government &amp; media — monitored{" "}
              <em style={{ fontStyle: "italic", color: "var(--tk-primary)" }}>continuously</em>
            </h1>
            <div style={{ display: "flex", gap: 32 }}>
              <div>
                <div style={{ fontSize: 36, fontWeight: 400, letterSpacing: "-0.02em", color: "var(--tk-ink)", lineHeight: 1 }}>
                  {allArticles.length.toLocaleString()}
                </div>
                <div className="tk-meta" style={{ marginTop: 4 }}>ARTICLES ARCHIVED</div>
              </div>
              <div>
                <div style={{ fontSize: 36, fontWeight: 400, letterSpacing: "-0.02em", color: "var(--tk-ink)", lineHeight: 1 }}>
                  {DOMAINS.slice(1).length}
                </div>
                <div className="tk-meta" style={{ marginTop: 4 }}>DOMAINS TRACKED</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Search bar ── */}
      <div style={{ borderBottom: "var(--tk-rule)", background: "var(--tk-bg-deep)" }}>
        <div style={{ maxWidth: "var(--tk-max)", margin: "0 auto", padding: "0 var(--tk-pad-x)" }}>
          <div style={{ display: "flex", alignItems: "center", borderLeft: "var(--tk-rule)", borderRight: "var(--tk-rule)" }}>
            <span style={{ fontFamily: "var(--tk-mono)", fontSize: 11, color: "var(--tk-primary)", padding: "0 14px", letterSpacing: "0.1em" }}>⌕</span>
            <input
              type="text"
              placeholder="Search all archived articles…"
              value={searchInput}
              onChange={e => handleSearch(e.target.value)}
              style={{
                flex: 1, padding: "14px 0", border: "none", background: "transparent",
                fontFamily: "var(--tk-sans)", fontSize: 14, color: "var(--tk-ink)",
                outline: "none",
              }}
            />
            {searchInput && (
              <button onClick={() => { setSearchInput(""); setSearchQuery(""); }}
                style={{ padding: "0 16px", background: "none", border: "none", cursor: "pointer",
                  fontFamily: "var(--tk-mono)", fontSize: 11, color: "var(--tk-ink-50)", letterSpacing: "0.08em" }}>
                CLEAR ×
              </button>
            )}
            {searchQuery && (
              <span style={{ fontFamily: "var(--tk-mono)", fontSize: 10, color: "var(--tk-ink-50)", padding: "0 16px", letterSpacing: "0.08em", borderLeft: "var(--tk-rule)", whiteSpace: "nowrap" }}>
                {filtered.length} RESULTS
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <main style={{ maxWidth: "var(--tk-max)", margin: "0 auto" }}>

        {fetchError && (
          <div style={{ padding: "20px var(--tk-pad-x)", borderBottom: "var(--tk-rule)", borderLeft: "2px solid #c0392b" }}>
            <p style={{ fontSize: 13, color: "var(--tk-ink-70)" }}>
              {fetchError} — the crawler may not have run yet. Check GitHub Actions.
            </p>
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", color: "var(--tk-ink-50)" }}>
            <Spinner />
            <span style={{ fontFamily: "var(--tk-mono)", fontSize: 11, letterSpacing: "0.1em", marginLeft: 12, textTransform: "uppercase" }}>Loading</span>
          </div>

        ) : filtered.length === 0 ? (
          <div style={{ padding: "80px var(--tk-pad-x)", borderBottom: "var(--tk-rule)" }}>
            <p className="tk-meta" style={{ marginBottom: 8 }}>NO RESULTS</p>
            <p style={{ fontSize: 15, color: "var(--tk-ink-70)" }}>
              {searchQuery
                ? `No articles match "${searchQuery}".`
                : "No articles yet. The crawler runs every 6 hours via GitHub Actions."}
            </p>
          </div>

        ) : activeTab === "all" && !searchQuery ? (
          // Grouped by domain
          DOMAINS.slice(1).map(domain => {
            const arts = byDomain[domain.id] || [];
            if (!arts.length) return null;
            const offset = DOMAINS.slice(1)
              .slice(0, DOMAINS.slice(1).indexOf(domain))
              .reduce((s, d) => s + (byDomain[d.id]?.length || 0), 0);
            return (
              <DomainSection key={domain.id} domain={domain} articles={arts} globalOffset={offset} />
            );
          })

        ) : (
          // Flat list
          <>
            <div style={{ borderBottom: "2px solid var(--tk-ink)" }}>
              {paginated.map((a, i) => (
                <ArticleRow key={a.id || a.original_url} article={a} index={i} />
              ))}
            </div>
            {hasMore && (
              <div style={{ padding: "24px var(--tk-pad-x)", borderBottom: "var(--tk-rule)" }}>
                <button onClick={() => setPage(p => p + 1)} style={{
                  background: "none", border: "var(--tk-rule)", padding: "10px 24px",
                  cursor: "pointer", fontFamily: "var(--tk-mono)", fontSize: 11,
                  letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--tk-ink)",
                  transition: "background 0.15s ease",
                }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--tk-bg-deep)"}
                  onMouseLeave={e => e.currentTarget.style.background = "none"}
                >
                  Load more → ({filtered.length - paginated.length} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Footer ── */}
      <footer style={{ background: "var(--tk-primary)", marginTop: 80, padding: "48px var(--tk-pad-x)" }}>
        <div style={{ maxWidth: "var(--tk-max)", margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 24 }}>
            <div>
              <p style={{ color: "#fff", fontSize: 16, fontWeight: 500, marginBottom: 6 }}>China Watch</p>
              <p style={{ fontFamily: "var(--tk-mono)", fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase" }}>
                Takshashila Institution · Geostrategy Programme
              </p>
            </div>
            <div style={{ display: "flex", gap: 24 }}>
              <a href="https://takshashila.org.in" target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: "var(--tk-mono)", fontSize: 11, letterSpacing: "0.08em", color: "var(--tk-gold)", textTransform: "uppercase" }}>
                Takshashila.org.in ↗
              </a>
              <a href="https://github.com/shakunasanaxe/CHINA-WATCH" target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: "var(--tk-mono)", fontSize: 11, letterSpacing: "0.08em", color: "rgba(255,255,255,0.55)", textTransform: "uppercase" }}>
                GitHub ↗
              </a>
            </div>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.15)", marginTop: 32, paddingTop: 20 }}>
            <p style={{ fontFamily: "var(--tk-mono)", fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em" }}>
              UPDATED AUTOMATICALLY EVERY 6 HOURS VIA GITHUB ACTIONS · SOURCES: XINHUA, GLOBALTIMES, CGTN, MFA, NDRC, MIIT, CAC, MOFCOM, GOVCH, 81CN AND OTHERS
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
