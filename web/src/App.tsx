import { useState, useEffect, useMemo } from "react";

const API = "http://localhost:3000";

// ---- shared shapes (mirror server/src/types.ts) ----
type Direction = "in" | "out";
type LabelType = "cex" | "dex" | "bridge" | "staking" | "program" | "burn";

interface ChainInfo {
  id: string;
  name: string;
  family: "evm" | "solana" | "bitcoin" | "tron";
  nativeAsset: string;
  explorerAddr: string;
  explorerTx: string;
}
interface CounterpartyTx {
  direction: Direction;
  amount: number;
  unixTime: number;
  signature: string | null;
}
interface CounterpartyFlow {
  counterparty: string;
  label: string | null;
  labelType: LabelType | null;
  isExchange: boolean;
  outAmount: number;
  inAmount: number;
  netAmount: number;
  totalAmount: number;
  outTxCount: number;
  inTxCount: number;
  txCount: number;
  pctOfOut: number;
  firstUnix: number;
  lastUnix: number;
  flags: string[];
  txs: CounterpartyTx[];
}
interface Transfer {
  direction: Direction;
  counterparty: string;
  amount: number;
  asset: string;
  unixTime: number;
  signature: string | null;
  counterpartyLabel: string | null;
  labelType: LabelType | null;
  isExchange: boolean;
}
interface TokenHolding {
  mint: string;
  symbol: string | null;
  name: string | null;
  amount: number;
  usd: number | null;
}
interface WalletHoldings {
  nativeBalance: number;
  nativeAsset: string;
  nativeUsd: number | null;
  tokenCount: number;
  nftCount: number;
  tokens: TokenHolding[];
}
interface FlowReport {
  wallet: string;
  chain: ChainInfo;
  totalOut: number;
  totalIn: number;
  netTotal: number;
  transferCount: number;
  outCount: number;
  inCount: number;
  counterpartyCount: number;
  topRecipientPct: number;
  exchangeOut: number;
  counterparties: CounterpartyFlow[];
  allTransfers: Transfer[];
  holdings?: WalletHoldings;
  summary?: string;
  concentration?: "low" | "medium" | "high";
}

type View = "out" | "in" | "both";

// ---- palette (dark, neutral + blue→violet accent; validated via dataviz skill) ----
const C = {
  blue: "#3987e5",     // out
  violet: "#9085e9",
  aqua: "#1fb182",     // in
  good: "#17b417",
  critical: "#e05555",
  warning: "#fab219",
  ink: "#f4f4f2",
  ink2: "#b4b3ab",
  muted: "#7f7e78",
  line: "rgba(255,255,255,0.08)",
  track: "#26262b",
  card: "#141416",
} as const;

const CONC = {
  low: { label: "LOW", color: C.good },
  medium: { label: "MEDIUM", color: C.warning },
  high: { label: "HIGH", color: C.critical },
} as const;

const FLAG_STYLE: Record<string, { color: string; title: string }> = {
  "cash-out": { color: C.good, title: "Sent to a known exchange" },
  "single-large": { color: C.blue, title: "One outbound transfer here was ≥15% of total outflow" },
  repeated: { color: C.violet, title: "5+ transfers with this counterparty" },
  mixer: { color: C.critical, title: "Counterparty is a known mixer" },
};

const LABEL_TYPE_STYLE: Record<LabelType, { color: string }> = {
  cex: { color: C.good },
  dex: { color: C.blue },
  bridge: { color: C.violet },
  staking: { color: C.warning },
  program: { color: C.muted },
  burn: { color: C.critical },
};

const RANK_OPTIONS = [
  { id: "amount", label: "amount" },
  { id: "txCount", label: "tx count" },
  { id: "recent", label: "most recent" },
] as const;
type RankBy = (typeof RANK_OPTIONS)[number]["id"];

const MAX_ROWS = 30;

function short(w: string) {
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}
function fmt(n: number) {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}
function fmtUsd(n: number | null) {
  if (n == null) return null;
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function day(u: number) {
  return new Date(u * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function dateRange(a: number, b: number) {
  return a === b ? day(a) : `${day(a)} – ${day(b)}`;
}

// ---------------------------------------------------------------------------

export default function App() {
  const [wallet, setWallet] = useState("");
  const [detect, setDetect] = useState<{ chain: ChainInfo; options: ChainInfo[] } | null>(null);
  const [detectErr, setDetectErr] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string>("");
  const [report, setReport] = useState<FlowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // view controls
  const [view, setView] = useState<View>("out");
  const [rankBy, setRankBy] = useState<RankBy>("amount");
  const [showAll, setShowAll] = useState(false);
  const [showTxPanel, setShowTxPanel] = useState(false);

  // Debounced deterministic chain detection as the user types.
  useEffect(() => {
    const w = wallet.trim();
    setDetect(null);
    setDetectErr(null);
    if (w.length < 20) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/detect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: w }),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!res.ok) { setDetectErr(data.error ?? "Unrecognized address"); return; }
        setDetect(data);
        setChainId(data.chain.id);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setDetectErr(null);
      }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [wallet]);

  async function trace() {
    if (!wallet.trim()) return;
    setError(null);
    setLoading(true);
    setReport(null);
    setShowAll(false);
    setShowTxPanel(false);
    try {
      const res = await fetch(`${API}/trace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: wallet.trim(), chainId: chainId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Trace failed");
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const conc = report?.concentration ? CONC[report.concentration] : null;
  const asset = report?.chain.nativeAsset ?? "";
  const exchangePct = report && report.totalOut > 0 ? Math.round((report.exchangeOut / report.totalOut) * 100) : 0;

  // Derive the visible counterparty list from the active view + ranking.
  const activeAmount = (c: CounterpartyFlow) => (view === "out" ? c.outAmount : view === "in" ? c.inAmount : c.totalAmount);
  const visible = useMemo(() => {
    if (!report) return [];
    const list = report.counterparties.filter((c) => activeAmount(c) > 0);
    list.sort((a, b) => {
      if (rankBy === "txCount") return b.txCount - a.txCount;
      if (rankBy === "recent") return b.lastUnix - a.lastUnix;
      return activeAmount(b) - activeAmount(a);
    });
    return list;
  }, [report, view, rankBy]);

  const maxAmt = visible.length ? Math.max(...visible.map(activeAmount)) : 1;
  const totalForPct = view === "out" ? report?.totalOut : view === "in" ? report?.totalIn : (report ? report.totalOut + report.totalIn : 0);
  const shown = showAll ? visible : visible.slice(0, MAX_ROWS);

  const sectionTitle = view === "out" ? "Where the money went" : view === "in" ? "Where the money came from" : "Money in & out";

  return (
    <div className="min-h-screen text-[#f4f4f2]" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
      <div className="max-w-3xl mx-auto px-6 py-12">
        <header className="mb-10 flex items-center gap-3">
          <LogoMark />
          <div>
            <h1 className="text-2xl font-bold tracking-tight leading-none">
              <span style={{ background: `linear-gradient(90deg, ${C.blue}, ${C.violet})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Tracellet
              </span>
            </h1>
            <p className="text-[13px] mt-1" style={{ color: C.muted }}>
              Trace the wallet — follow the money in and out, on any chain.
            </p>
          </div>
        </header>

        {/* input */}
        <div className="flex gap-2">
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && trace()}
            placeholder="Paste any wallet address — ETH, SOL, BTC, Tron…"
            spellCheck={false}
            className="flex-1 rounded-lg px-4 py-3 text-sm outline-none transition-colors"
            style={{ background: C.card, border: `1px solid ${C.line}`, color: C.ink, fontFamily: "'JetBrains Mono', monospace" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = `${C.blue}88`)}
            onBlur={(e) => (e.currentTarget.style.borderColor = C.line)}
          />
          <button
            onClick={trace}
            disabled={loading || !wallet.trim()}
            className="rounded-lg px-6 py-3 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{ background: `linear-gradient(90deg, ${C.blue}, ${C.violet})` }}
          >
            {loading ? "Tracing…" : "Trace"}
          </button>
        </div>

        {/* detection chip / chain selector */}
        <div className="mt-2 h-6 flex items-center gap-2 text-xs" style={{ color: C.muted }}>
          {detect && (
            <>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{ background: "rgba(57,135,229,0.12)", color: C.blue }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.blue }} />
                {detect.chain.family === "evm" ? "EVM detected" : `${detect.chain.name} detected`}
              </span>
              {detect.options.length > 1 && (
                <>
                  <span>chain:</span>
                  <select value={chainId} onChange={(e) => setChainId(e.target.value)} className="rounded px-2 py-0.5 outline-none" style={{ background: C.card, border: `1px solid ${C.line}`, color: C.ink2 }}>
                    {detect.options.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
                  </select>
                </>
              )}
            </>
          )}
          {detectErr && <span style={{ color: C.warning }}>{detectErr}</span>}
          {!detect && !detectErr && wallet.trim().length >= 20 && <span>detecting…</span>}
        </div>

        {error && (
          <div className="mt-4 rounded-lg px-4 py-3 text-sm" style={{ border: `1px solid ${C.critical}55`, background: `${C.critical}0d`, color: C.critical }}>
            {error}
          </div>
        )}

        {report && (
          <div className="mt-8 space-y-4">
            {/* wallet + chain line */}
            <div className="flex items-center gap-2 text-xs" style={{ color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}>
              <span className="px-2 py-0.5 rounded" style={{ background: "rgba(144,133,233,0.12)", color: C.violet }}>{report.chain.name}</span>
              <a href={`${report.chain.explorerAddr}${report.wallet}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: C.ink2 }}>
                {short(report.wallet)} <ExtIcon />
              </a>
            </div>

            {/* stat tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label="total out"><Amt v={report.totalOut} asset={asset} color={C.blue} /></Tile>
              <Tile label="total in"><Amt v={report.totalIn} asset={asset} color={C.aqua} /></Tile>
              <Tile label="counterparties">
                <span className="text-2xl font-bold" style={{ color: C.ink }}>{report.counterpartyCount}</span>
                <span className="text-xs ml-1" style={{ color: C.muted }}>/ {report.transferCount} tx</span>
              </Tile>
              <Tile label="top-sink share">
                <span className="text-2xl font-bold" style={{ color: conc!.color }}>{report.topRecipientPct}%</span>
                <span className="text-xs ml-1" style={{ color: C.muted }}>{exchangePct}% to CEX</span>
              </Tile>
            </div>

            {/* AI summary */}
            <div className="rounded-lg p-5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: `linear-gradient(90deg, ${C.blue}, ${C.violet})` }} />
                <span className="text-[10px] tracking-widest uppercase" style={{ color: C.muted }}>AI summary</span>
                <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide font-semibold" style={{ background: `${conc!.color}1a`, color: conc!.color }}>
                  {conc!.label} concentration
                </span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: C.ink2 }}>{report.summary}</p>
            </div>

            {report.holdings && <HoldingsPanel h={report.holdings} chain={report.chain} />}

            {/* counterparty flow */}
            <div className="rounded-lg overflow-hidden" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <div className="px-5 pt-4 pb-3 flex flex-wrap items-center gap-3 justify-between">
                <span className="text-[10px] tracking-widest uppercase" style={{ color: C.muted }}>{sectionTitle}</span>
                <div className="flex items-center gap-2">
                  <DirectionToggle view={view} setView={setView} />
                  <div className="flex items-center gap-1 text-[10px]" style={{ color: C.muted }}>
                    <span>rank</span>
                    <select value={rankBy} onChange={(e) => setRankBy(e.target.value as RankBy)} className="rounded px-1.5 py-0.5 outline-none" style={{ background: "#0f0f11", border: `1px solid ${C.line}`, color: C.ink2 }}>
                      {RANK_OPTIONS.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
                    </select>
                  </div>
                </div>
              </div>
              <div>
                {shown.map((c, i) => (
                  <CounterpartyRow key={c.counterparty} c={c} rank={i + 1} view={view} asset={asset} maxAmt={maxAmt} total={totalForPct || 1} chain={report.chain} />
                ))}
                {visible.length === 0 && (
                  <div className="px-5 py-6 text-sm text-center" style={{ color: C.muted }}>
                    No {view === "in" ? "inbound" : view === "out" ? "outbound" : ""} transfers found.
                  </div>
                )}
              </div>
              {visible.length > MAX_ROWS && (
                <button onClick={() => setShowAll((s) => !s)} className="w-full px-5 py-3 text-[11px] text-left hover:bg-white/[0.02]" style={{ color: C.blue, borderTop: `1px solid ${C.line}` }}>
                  {showAll ? "− show fewer" : `+ show all ${visible.length} counterparties`}
                </button>
              )}
            </div>

            {/* see all transactions */}
            <div className="rounded-lg overflow-hidden" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <button onClick={() => setShowTxPanel((s) => !s)} className="w-full px-5 py-3 flex items-center justify-between hover:bg-white/[0.02]">
                <span className="text-[10px] tracking-widest uppercase" style={{ color: C.muted }}>All transactions</span>
                <span className="text-[11px]" style={{ color: C.blue }}>{showTxPanel ? "− hide" : `+ see all ${report.transferCount}`}</span>
              </button>
              {showTxPanel && <TransactionsPanel transfers={report.allTransfers} chain={report.chain} view={view} setView={setView} />}
            </div>
          </div>
        )}

        {!report && !loading && !error && (
          <div className="mt-8 rounded-lg p-12 text-center" style={{ border: `1px dashed ${C.line}` }}>
            <p className="text-sm" style={{ color: C.muted }}>
              Paste a wallet address to trace its money in and out.
              <br />
              Chain is detected automatically — Ethereum, Solana, Bitcoin, Tron and more.
            </p>
          </div>
        )}

        <footer className="mt-12 text-[11px] text-center" style={{ color: C.muted }}>
          Code computes the flow · AI narrates it · Solana + EVM live, other chains on mock
        </footer>
      </div>
    </div>
  );
}

// ---- pieces ----

function Amt({ v, asset, color }: { v: number; asset: string; color: string }) {
  return (
    <>
      <span className="text-2xl font-bold" style={{ color }}>{fmt(v)}</span>
      <span className="text-xs ml-1" style={{ color: C.muted }}>{asset}</span>
    </>
  );
}

function DirectionToggle({ view, setView }: { view: View; setView: (v: View) => void }) {
  const opts: { id: View; label: string }[] = [
    { id: "out", label: "Out" },
    { id: "in", label: "In" },
    { id: "both", label: "In & Out" },
  ];
  return (
    <div className="inline-flex rounded-md overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
      {opts.map((o) => {
        const on = view === o.id;
        const accent = o.id === "in" ? C.aqua : o.id === "out" ? C.blue : C.violet;
        return (
          <button
            key={o.id}
            onClick={() => setView(o.id)}
            className="px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{ background: on ? `${accent}22` : "transparent", color: on ? accent : C.muted }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="40" y2="40">
          <stop offset="0" stopColor={C.blue} />
          <stop offset="1" stopColor={C.violet} />
        </linearGradient>
      </defs>
      <path d="M11 20 H21 M21 20 C26 20 26 10 31 10 M21 20 C26 20 26 20 31 20 M21 20 C26 20 26 30 31 30" stroke="url(#g)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <circle cx="9" cy="20" r="3.4" fill="url(#g)" />
      <circle cx="32" cy="10" r="2.2" fill={C.blue} />
      <circle cx="32" cy="20" r="2.2" fill="url(#g)" />
      <circle cx="32" cy="30" r="2.2" fill={C.violet} />
    </svg>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <span className="text-[10px] tracking-widest uppercase block mb-1.5" style={{ color: C.muted }}>{label}</span>
      <div style={{ fontVariantNumeric: "tabular-nums" }}>{children}</div>
    </div>
  );
}

function ExtIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block opacity-70" aria-hidden>
      <path d="M14 4h6v6M20 4l-9 9M9 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

function TypeChip({ type }: { type: LabelType }) {
  const s = LABEL_TYPE_STYLE[type];
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide" style={{ color: s.color, background: `${s.color}14` }}>
      {type}
    </span>
  );
}

// A directional flow bar: out (blue) and in (aqua). In "both" view it's split.
function FlowBar({ c, view, maxAmt }: { c: CounterpartyFlow; view: View; maxAmt: number }) {
  const scale = (v: number) => (v / maxAmt) * 100;
  return (
    <div className="mt-2 ml-7 h-[6px] rounded-full overflow-hidden flex gap-px" style={{ background: C.track }}>
      {(view === "out" || view === "both") && c.outAmount > 0 && (
        <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, scale(c.outAmount))}%`, background: `linear-gradient(90deg, ${C.blue}, ${C.violet})` }} />
      )}
      {(view === "in" || view === "both") && c.inAmount > 0 && (
        <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, scale(c.inAmount))}%`, background: C.aqua }} />
      )}
    </div>
  );
}

function CounterpartyRow({ c, rank, view, asset, maxAmt, total, chain }: { c: CounterpartyFlow; rank: number; view: View; asset: string; maxAmt: number; total: number; chain: ChainInfo }) {
  const [open, setOpen] = useState(false);
  const amount = view === "out" ? c.outAmount : view === "in" ? c.inAmount : c.totalAmount;
  const pct = total > 0 ? +((amount / total) * 100).toFixed(1) : 0;
  // drill-down txs filtered by the active view
  const txs = view === "both" ? c.txs : c.txs.filter((t) => t.direction === view);
  const canExpand = txs.length > 0;
  return (
    <div style={{ borderTop: `1px solid ${C.line}` }}>
      <div onClick={() => canExpand && setOpen((o) => !o)} className="group px-5 py-3 transition-colors hover:bg-white/[0.02]" style={{ cursor: canExpand ? "pointer" : "default" }}>
        <div className="flex items-center gap-3">
          <span className="text-[11px] w-4 text-right" style={{ color: C.muted, fontVariantNumeric: "tabular-nums" }}>{rank}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {canExpand && <span className="text-[9px] transition-transform" style={{ color: C.muted, transform: open ? "rotate(90deg)" : "none" }}>▶</span>}
              {c.label ? (
                <span className="text-sm font-medium truncate" style={{ color: C.ink }}>{c.label}</span>
              ) : (
                <span className="text-sm truncate" style={{ color: C.ink2, fontFamily: "'JetBrains Mono', monospace" }}>{short(c.counterparty)}</span>
              )}
              <a href={`${chain.explorerAddr}${c.counterparty}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={`View ${short(c.counterparty)} on explorer`} className="shrink-0" style={{ color: C.blue }}>
                <ExtIcon />
              </a>
              {c.labelType && <TypeChip type={c.labelType} />}
              {c.flags.map((f) => (
                <span key={f} title={FLAG_STYLE[f]?.title} className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide" style={{ color: FLAG_STYLE[f]?.color ?? C.muted, background: `${FLAG_STYLE[f]?.color ?? C.muted}14` }}>{f}</span>
              ))}
            </div>
          </div>
          <div className="text-right shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
            <span className="text-sm font-semibold" style={{ color: C.ink }}>{fmt(amount)}</span>
            <span className="text-[11px] ml-1" style={{ color: C.muted }}>{asset}</span>
            <span className="text-[11px] ml-2" style={{ color: C.muted }}>{pct}%</span>
            {view === "both" && (
              <div className="text-[10px]" style={{ color: C.muted }}>
                <span style={{ color: C.blue }}>↑{fmt(c.outAmount)}</span> · <span style={{ color: C.aqua }}>↓{fmt(c.inAmount)}</span>
              </div>
            )}
          </div>
        </div>
        <FlowBar c={c} view={view} maxAmt={maxAmt} />
      </div>

      {open && (
        <div className="px-5 pb-3 ml-7" style={{ background: "rgba(255,255,255,0.015)" }}>
          <div className="text-[10px] uppercase tracking-widest pt-2 pb-1.5" style={{ color: C.muted }}>
            {txs.length} transfer{txs.length > 1 ? "s" : ""} · {dateRange(c.firstUnix, c.lastUnix)}
          </div>
          <div className="space-y-1">
            {txs.slice(0, 20).map((t, i) => <TxRow key={i} t={t} idx={i} asset={asset} chain={chain} />)}
            {txs.length > 20 && <div className="text-[10px] px-2 pt-1" style={{ color: C.muted }}>+ {txs.length - 20} more transfers</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function TxRow({ t, idx, asset, chain }: { t: CounterpartyTx; idx: number; asset: string; chain: ChainInfo }) {
  const dirColor = t.direction === "out" ? C.blue : C.aqua;
  const inner = (
    <>
      <span style={{ color: dirColor }}>{t.direction === "out" ? "↑" : "↓"}</span>
      <span style={{ color: C.muted }}>Tx {idx + 1}</span>
      <span className="ml-auto" style={{ color: C.ink }}>{fmt(t.amount)} {asset}</span>
      <span className="w-20 text-right" style={{ color: C.muted }}>{day(t.unixTime)}</span>
      {t.signature && <span style={{ color: C.blue }}><ExtIcon /></span>}
    </>
  );
  return t.signature ? (
    <a href={`${chain.explorerTx}${t.signature}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-3 text-xs py-1 px-2 rounded hover:bg-white/[0.03]" style={{ fontVariantNumeric: "tabular-nums" }}>
      {inner}
    </a>
  ) : (
    <div className="flex items-center gap-3 text-xs py-1 px-2" style={{ fontVariantNumeric: "tabular-nums" }}>{inner}</div>
  );
}

function TransactionsPanel({ transfers, chain, view, setView }: { transfers: Transfer[]; chain: ChainInfo; view: View; setView: (v: View) => void }) {
  const [limit, setLimit] = useState(50);
  const filtered = useMemo(() => {
    const list = view === "both" ? transfers : transfers.filter((t) => t.direction === view);
    return [...list].sort((a, b) => b.unixTime - a.unixTime); // most recent first
  }, [transfers, view]);
  const rows = filtered.slice(0, limit);
  return (
    <div style={{ borderTop: `1px solid ${C.line}` }}>
      <div className="px-5 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.line}` }}>
        <span className="text-[10px]" style={{ color: C.muted }}>{filtered.length} transfers</span>
        <DirectionToggle view={view} setView={setView} />
      </div>
      <div>
        {rows.map((t, i) => {
          const dirColor = t.direction === "out" ? C.blue : C.aqua;
          const inner = (
            <>
              <span className="w-3" style={{ color: dirColor }}>{t.direction === "out" ? "↑" : "↓"}</span>
              <span className="truncate flex-1" style={{ color: t.counterpartyLabel ? C.ink2 : C.muted, fontFamily: t.counterpartyLabel ? "inherit" : "'JetBrains Mono', monospace" }}>
                {t.counterpartyLabel ?? short(t.counterparty)}
              </span>
              <span className="shrink-0" style={{ color: dirColor }}>{t.direction === "out" ? "−" : "+"}{fmt(t.amount)} {t.asset}</span>
              <span className="w-20 text-right shrink-0" style={{ color: C.muted }}>{day(t.unixTime)}</span>
              {t.signature && <span style={{ color: C.blue }}><ExtIcon /></span>}
            </>
          );
          return t.signature ? (
            <a key={i} href={`${chain.explorerTx}${t.signature}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-xs px-5 py-2 hover:bg-white/[0.02]" style={{ fontVariantNumeric: "tabular-nums", borderTop: i ? `1px solid ${C.line}` : "none" }}>
              {inner}
            </a>
          ) : (
            <div key={i} className="flex items-center gap-3 text-xs px-5 py-2" style={{ fontVariantNumeric: "tabular-nums", borderTop: i ? `1px solid ${C.line}` : "none" }}>{inner}</div>
          );
        })}
      </div>
      {filtered.length > limit && (
        <button onClick={() => setLimit((l) => l + 100)} className="w-full px-5 py-3 text-[11px] text-left hover:bg-white/[0.02]" style={{ color: C.blue, borderTop: `1px solid ${C.line}` }}>
          + load {Math.min(100, filtered.length - limit)} more
        </button>
      )}
    </div>
  );
}

function HoldingsPanel({ h, chain }: { h: WalletHoldings; chain: ChainInfo }) {
  return (
    <div className="rounded-lg p-5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] tracking-widest uppercase" style={{ color: C.muted }}>Current holdings</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-4">
        <div style={{ fontVariantNumeric: "tabular-nums" }}>
          <span className="text-2xl font-bold" style={{ color: C.ink }}>{fmt(h.nativeBalance)}</span>
          <span className="text-xs ml-1" style={{ color: C.muted }}>{h.nativeAsset}</span>
          {h.nativeUsd != null && <span className="text-xs ml-2" style={{ color: C.muted }}>{fmtUsd(h.nativeUsd)}</span>}
        </div>
        <div className="text-xs" style={{ color: C.muted }}>
          <span style={{ color: C.ink2 }}>{h.tokenCount}</span> tokens · <span style={{ color: C.ink2 }}>{h.nftCount}</span> NFTs
        </div>
      </div>
      {h.tokens.length > 0 && (
        <div className="space-y-1">
          {h.tokens.slice(0, 8).map((t) => {
            const named = t.symbol || t.name;
            return (
              <a key={t.mint} href={`${chain.explorerAddr}${t.mint}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 text-xs py-1.5 px-2 rounded hover:bg-white/[0.03]" style={{ fontVariantNumeric: "tabular-nums", borderTop: `1px solid ${C.line}` }}>
                <span className="font-medium" style={{ color: named ? C.ink : C.ink2, fontFamily: named ? "inherit" : "'JetBrains Mono', monospace" }}>{t.symbol ?? short(t.mint)}</span>
                {t.name && t.name !== t.symbol && <span className="truncate" style={{ color: C.muted }}>{t.name}</span>}
                <ExtIcon />
                <span className="ml-auto" style={{ color: C.ink2 }}>{fmt(t.amount)}</span>
                {t.usd != null && <span className="w-20 text-right" style={{ color: C.muted }}>{fmtUsd(t.usd)}</span>}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
