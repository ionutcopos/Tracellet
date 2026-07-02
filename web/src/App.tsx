import { useState, useEffect, useRef } from "react";

const API = "http://localhost:3000";

// ---- shared shapes (mirror server/src/types.ts) ----
interface ChainInfo {
  id: string;
  name: string;
  family: "evm" | "solana" | "bitcoin" | "tron";
  nativeAsset: string;
  explorerAddr: string;
  explorerTx: string;
}
interface RecipientTx {
  amount: number;
  unixTime: number;
  signature: string | null;
}
interface RecipientFlow {
  recipient: string;
  label: string | null;
  isExchange: boolean;
  totalAmount: number;
  txCount: number;
  pctOfTotal: number;
  firstUnix: number;
  lastUnix: number;
  flags: string[];
  txs: RecipientTx[];
}
interface TokenHolding {
  mint: string;
  symbol: string | null;
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
  transferCount: number;
  recipientCount: number;
  topRecipientPct: number;
  exchangeOut: number;
  recipients: RecipientFlow[];
  holdings?: WalletHoldings;
  summary?: string;
  concentration?: "low" | "medium" | "high";
}

// ---- palette (dark, neutral + blue→violet accent; validated via dataviz skill) ----
const C = {
  blue: "#3987e5",
  violet: "#9085e9",
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
  "cash-out": { color: C.good, title: "Sent to a known exchange deposit address" },
  "single-large": { color: C.blue, title: "One transfer here was ≥15% of total outflow" },
  repeated: { color: C.violet, title: "5+ separate transfers to this destination" },
  mixer: { color: C.critical, title: "Recipient is a known mixer" },
};

const MAX_ROWS = 30; // real wallets can have hundreds of recipients — cap the list

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
function dateRange(a: number, b: number) {
  const f = (u: number) => new Date(u * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return a === b ? f(a) : `${f(a)} – ${f(b)}`;
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
        if (!res.ok) {
          setDetectErr(data.error ?? "Unrecognized address");
          return;
        }
        setDetect(data);
        setChainId(data.chain.id);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setDetectErr(null);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [wallet]);

  async function trace() {
    if (!wallet.trim()) return;
    setError(null);
    setLoading(true);
    setReport(null);
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
  const maxAmt = report?.recipients[0]?.totalAmount ?? 1;
  const exchangePct = report && report.totalOut > 0 ? Math.round((report.exchangeOut / report.totalOut) * 100) : 0;

  return (
    <div className="min-h-screen text-[#f4f4f2]" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* ---- header ---- */}
        <header className="mb-10 flex items-center gap-3">
          <LogoMark />
          <div>
            <h1 className="text-2xl font-bold tracking-tight leading-none">
              <span
                style={{
                  background: `linear-gradient(90deg, ${C.blue}, ${C.violet})`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Tracellet
              </span>
            </h1>
            <p className="text-[13px] mt-1" style={{ color: C.muted }}>
              Trace the wallet — see where the money went, on any chain.
            </p>
          </div>
        </header>

        {/* ---- input ---- */}
        <div className="flex gap-2">
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && trace()}
            placeholder="Paste any wallet address — ETH, SOL, BTC, Tron…"
            spellCheck={false}
            className="flex-1 rounded-lg px-4 py-3 text-sm outline-none transition-colors"
            style={{
              background: C.card,
              border: `1px solid ${C.line}`,
              color: C.ink,
              fontFamily: "'JetBrains Mono', monospace",
            }}
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

        {/* ---- detection chip / chain selector ---- */}
        <div className="mt-2 h-6 flex items-center gap-2 text-xs" style={{ color: C.muted }}>
          {detect && (
            <>
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full"
                style={{ background: "rgba(57,135,229,0.12)", color: C.blue }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.blue }} />
                {detect.chain.family === "evm" ? "EVM detected" : `${detect.chain.name} detected`}
              </span>
              {detect.options.length > 1 && (
                <>
                  <span>chain:</span>
                  <select
                    value={chainId}
                    onChange={(e) => setChainId(e.target.value)}
                    className="rounded px-2 py-0.5 outline-none"
                    style={{ background: C.card, border: `1px solid ${C.line}`, color: C.ink2 }}
                  >
                    {detect.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </>
          )}
          {detectErr && <span style={{ color: C.warning }}>{detectErr}</span>}
          {!detect && !detectErr && wallet.trim().length >= 20 && <span>detecting…</span>}
        </div>

        {error && (
          <div
            className="mt-4 rounded-lg px-4 py-3 text-sm"
            style={{ border: `1px solid ${C.critical}55`, background: `${C.critical}0d`, color: C.critical }}
          >
            {error}
          </div>
        )}

        {/* ---- results ---- */}
        {report && (
          <div className="mt-8 space-y-4">
            {/* wallet + chain line */}
            <div className="flex items-center gap-2 text-xs" style={{ color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}>
              <span
                className="px-2 py-0.5 rounded"
                style={{ background: "rgba(144,133,233,0.12)", color: C.violet }}
              >
                {report.chain.name}
              </span>
              <a
                href={`${report.chain.explorerAddr}${report.wallet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
                style={{ color: C.ink2 }}
              >
                {short(report.wallet)} <ExtIcon />
              </a>
            </div>

            {/* stat tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label={`total out`}>
                <span className="text-2xl font-bold" style={{ color: C.ink }}>
                  {fmt(report.totalOut)}
                </span>
                <span className="text-xs ml-1" style={{ color: C.muted }}>
                  {asset}
                </span>
              </Tile>
              <Tile label="destinations">
                <span className="text-2xl font-bold" style={{ color: C.ink }}>
                  {report.recipientCount}
                </span>
                <span className="text-xs ml-1" style={{ color: C.muted }}>
                  / {report.transferCount} tx
                </span>
              </Tile>
              <Tile label="top-sink share">
                <span className="text-2xl font-bold" style={{ color: conc!.color }}>
                  {report.topRecipientPct}%
                </span>
              </Tile>
              <Tile label="to exchanges">
                <span className="text-2xl font-bold" style={{ color: C.ink }}>
                  {exchangePct}%
                </span>
                <span className="text-xs ml-1" style={{ color: C.muted }}>
                  {fmt(report.exchangeOut)} {asset}
                </span>
              </Tile>
            </div>

            {/* AI summary */}
            <div className="rounded-lg p-5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: `linear-gradient(90deg, ${C.blue}, ${C.violet})` }}
                />
                <span className="text-[10px] tracking-widest uppercase" style={{ color: C.muted }}>
                  AI summary
                </span>
                <span
                  className="ml-auto text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide font-semibold"
                  style={{ background: `${conc!.color}1a`, color: conc!.color }}
                >
                  {conc!.label} concentration
                </span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: C.ink2 }}>
                {report.summary}
              </p>
            </div>

            {/* current holdings */}
            {report.holdings && <HoldingsPanel h={report.holdings} chain={report.chain} />}

            {/* recipients ranked flow */}
            <div className="rounded-lg overflow-hidden" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <div className="px-5 pt-4 pb-3 flex items-baseline justify-between">
                <span className="text-[10px] tracking-widest uppercase" style={{ color: C.muted }}>
                  Where the money went
                </span>
                <span className="text-[10px]" style={{ color: C.muted }}>
                  ranked by {asset} received
                </span>
              </div>
              <div>
                {report.recipients.slice(0, MAX_ROWS).map((r, i) => (
                  <RecipientRow key={r.recipient} r={r} rank={i + 1} asset={asset} maxAmt={maxAmt} chain={report.chain} />
                ))}
              </div>
              {report.recipientCount > MAX_ROWS && (
                <div className="px-5 py-3 text-[11px]" style={{ color: C.muted, borderTop: `1px solid ${C.line}` }}>
                  + {report.recipientCount - MAX_ROWS} more destinations, each below{" "}
                  {report.recipients[MAX_ROWS - 1].pctOfTotal}% of outflow
                </div>
              )}
            </div>
          </div>
        )}

        {/* empty state */}
        {!report && !loading && !error && (
          <div
            className="mt-8 rounded-lg p-12 text-center"
            style={{ border: `1px dashed ${C.line}` }}
          >
            <p className="text-sm" style={{ color: C.muted }}>
              Paste a wallet address to trace where its funds were distributed.
              <br />
              Chain is detected automatically — Ethereum, Solana, Bitcoin, Tron and more.
            </p>
          </div>
        )}

        <footer className="mt-12 text-[11px] text-center" style={{ color: C.muted }}>
          Code computes the flow · AI narrates it · Solana is live via Helius, other chains on mock
        </footer>
      </div>
    </div>
  );
}

// ---- pieces ----

function LogoMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="40" y2="40">
          <stop offset="0" stopColor={C.blue} />
          <stop offset="1" stopColor={C.violet} />
        </linearGradient>
      </defs>
      {/* source node fanning out to three destinations */}
      <path d="M11 20 H21 M21 20 C26 20 26 10 31 10 M21 20 C26 20 26 20 31 20 M21 20 C26 20 26 30 31 30"
        stroke="url(#g)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
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
      <span className="text-[10px] tracking-widest uppercase block mb-1.5" style={{ color: C.muted }}>
        {label}
      </span>
      <div style={{ fontVariantNumeric: "tabular-nums" }}>{children}</div>
    </div>
  );
}

// External-link glyph, inline so it inherits currentColor.
function ExtIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className="inline-block opacity-70" aria-hidden>
      <path d="M14 4h6v6M20 4l-9 9M9 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

function RecipientRow({ r, rank, asset, maxAmt, chain }: { r: RecipientFlow; rank: number; asset: string; maxAmt: number; chain: ChainInfo }) {
  const [open, setOpen] = useState(false);
  const width = Math.max(2, (r.totalAmount / maxAmt) * 100);
  const canExpand = r.txs.length > 0;
  return (
    <div style={{ borderTop: `1px solid ${C.line}` }}>
      <div
        onClick={() => canExpand && setOpen((o) => !o)}
        className="group px-5 py-3 transition-colors hover:bg-white/[0.02]"
        style={{ cursor: canExpand ? "pointer" : "default" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-[11px] w-4 text-right" style={{ color: C.muted, fontVariantNumeric: "tabular-nums" }}>
            {rank}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {canExpand && (
                <span
                  className="text-[9px] transition-transform"
                  style={{ color: C.muted, transform: open ? "rotate(90deg)" : "none" }}
                >
                  ▶
                </span>
              )}
              {r.label ? (
                <span className="text-sm font-medium truncate" style={{ color: C.ink }}>
                  {r.label}
                </span>
              ) : (
                <span className="text-sm truncate" style={{ color: C.ink2, fontFamily: "'JetBrains Mono', monospace" }}>
                  {short(r.recipient)}
                </span>
              )}
              {/* explorer link for the recipient address — stops the row toggle */}
              <a
                href={`${chain.explorerAddr}${r.recipient}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`View ${short(r.recipient)} on explorer`}
                className="shrink-0 hover:opacity-100"
                style={{ color: C.blue }}
              >
                <ExtIcon />
              </a>
              {r.flags.map((f) => (
                <span
                  key={f}
                  title={FLAG_STYLE[f]?.title}
                  className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide"
                  style={{ color: FLAG_STYLE[f]?.color ?? C.muted, background: `${FLAG_STYLE[f]?.color ?? C.muted}14` }}
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
          <div className="text-right shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
            <span className="text-sm font-semibold" style={{ color: C.ink }}>
              {fmt(r.totalAmount)}
            </span>
            <span className="text-[11px] ml-1" style={{ color: C.muted }}>
              {asset}
            </span>
            <span className="text-[11px] ml-2" style={{ color: C.muted }}>
              {r.pctOfTotal}%
            </span>
          </div>
        </div>
        {/* proportional flow bar — magnitude, one blue→violet hue, rounded data-end */}
        <div className="mt-2 ml-7 h-[6px] rounded-full overflow-hidden" style={{ background: C.track }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${width}%`, background: `linear-gradient(90deg, ${C.blue}, ${C.violet})` }}
          />
        </div>
      </div>

      {/* drill-down: individual transfers to this recipient, largest first */}
      {open && (
        <div className="px-5 pb-3 ml-7" style={{ background: "rgba(255,255,255,0.015)" }}>
          <div className="text-[10px] uppercase tracking-widest pt-2 pb-1.5" style={{ color: C.muted }}>
            {r.txCount} transfer{r.txCount > 1 ? "s" : ""} · {dateRange(r.firstUnix, r.lastUnix)}
          </div>
          <div className="space-y-1">
            {r.txs.slice(0, 20).map((t, i) => {
              const inner = (
                <>
                  <span style={{ color: C.muted }}>Tx {i + 1}</span>
                  <span className="ml-auto" style={{ color: C.ink }}>
                    {fmt(t.amount)} {asset}
                  </span>
                  <span className="w-24 text-right" style={{ color: C.muted }}>
                    {new Date(t.unixTime * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  {t.signature && <span style={{ color: C.blue }}><ExtIcon /></span>}
                </>
              );
              return t.signature ? (
                <a
                  key={i}
                  href={`${chain.explorerTx}${t.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-3 text-xs py-1 px-2 rounded hover:bg-white/[0.03]"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {inner}
                </a>
              ) : (
                <div key={i} className="flex items-center gap-3 text-xs py-1 px-2" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {inner}
                </div>
              );
            })}
            {r.txs.length > 20 && (
              <div className="text-[10px] px-2 pt-1" style={{ color: C.muted }}>
                + {r.txs.length - 20} more transfers
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HoldingsPanel({ h, chain }: { h: WalletHoldings; chain: ChainInfo }) {
  return (
    <div className="rounded-lg p-5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] tracking-widest uppercase" style={{ color: C.muted }}>
          Current holdings
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-4">
        <div style={{ fontVariantNumeric: "tabular-nums" }}>
          <span className="text-2xl font-bold" style={{ color: C.ink }}>
            {fmt(h.nativeBalance)}
          </span>
          <span className="text-xs ml-1" style={{ color: C.muted }}>
            {h.nativeAsset}
          </span>
          {h.nativeUsd != null && (
            <span className="text-xs ml-2" style={{ color: C.muted }}>
              {fmtUsd(h.nativeUsd)}
            </span>
          )}
        </div>
        <div className="text-xs" style={{ color: C.muted }}>
          <span style={{ color: C.ink2 }}>{h.tokenCount}</span> tokens ·{" "}
          <span style={{ color: C.ink2 }}>{h.nftCount}</span> NFTs
        </div>
      </div>
      {h.tokens.length > 0 && (
        <div className="space-y-1">
          {h.tokens.slice(0, 8).map((t) => (
            <a
              key={t.mint}
              href={`${chain.explorerAddr}${t.mint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 text-xs py-1.5 px-2 rounded hover:bg-white/[0.03]"
              style={{ fontVariantNumeric: "tabular-nums", borderTop: `1px solid ${C.line}` }}
            >
              <span className="font-medium" style={{ color: t.symbol ? C.ink : C.ink2, fontFamily: t.symbol ? "inherit" : "'JetBrains Mono', monospace" }}>
                {t.symbol ?? short(t.mint)}
              </span>
              <ExtIcon />
              <span className="ml-auto" style={{ color: C.ink2 }}>
                {fmt(t.amount)}
              </span>
              {t.usd != null && (
                <span className="w-20 text-right" style={{ color: C.muted }}>
                  {fmtUsd(t.usd)}
                </span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
