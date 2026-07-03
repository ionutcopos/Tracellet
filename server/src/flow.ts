import type {
  WalletTransfers,
  CounterpartyFlow,
  FlowReport,
} from "./types.ts";

// Deterministic fund-flow computation. Like signals.ts, this is the part that must
// be CORRECT: pure (no I/O, no LLM), the only thing that produces numbers. It
// aggregates a wallet's transfers (both directions, all assets) by counterparty,
// valued in USD so SOL/USDC/tokens rank together. The LLM only narrates this output.

// A counterparty counts as "single-large" if one outbound transfer to it is a big
// slug of the wallet's total USD outflow — the kind of move worth calling out.
const SINGLE_LARGE_PCT = 0.15;
// Many transfers to the same counterparty = a consolidation / repeated pattern.
const REPEATED_TX_COUNT = 5;
const MIXER_LABELS = new Set(["Tornado Cash", "Tornado.Cash"]);

export function buildFlowReport(o: WalletTransfers): FlowReport {
  let totalOutUsd = 0;
  let totalInUsd = 0;
  let outCount = 0;
  let inCount = 0;

  const byParty = new Map<string, CounterpartyFlow>();
  const largestOutUsd = new Map<string, number>();

  for (const t of o.transfers) {
    const usd = t.usd ?? 0;
    if (t.direction === "out") { totalOutUsd += usd; outCount++; }
    else { totalInUsd += usd; inCount++; }

    let c = byParty.get(t.counterparty);
    if (!c) {
      c = {
        counterparty: t.counterparty,
        label: t.counterpartyLabel,
        labelType: t.labelType,
        labelConfident: t.labelConfident,
        isExchange: t.isExchange,
        outUsd: 0, inUsd: 0, netUsd: 0, totalUsd: 0,
        outTxCount: 0, inTxCount: 0, txCount: 0,
        pctOfOut: 0,
        assets: [],
        firstUnix: t.unixTime,
        lastUnix: t.unixTime,
        flags: [],
        txs: [],
      };
      byParty.set(t.counterparty, c);
    }
    if (t.direction === "out") {
      c.outUsd += usd;
      c.outTxCount++;
      largestOutUsd.set(t.counterparty, Math.max(largestOutUsd.get(t.counterparty) ?? 0, usd));
    } else {
      c.inUsd += usd;
      c.inTxCount++;
    }
    c.txCount++;
    c.firstUnix = Math.min(c.firstUnix, t.unixTime);
    c.lastUnix = Math.max(c.lastUnix, t.unixTime);
    c.txs.push({ direction: t.direction, amount: t.amount, asset: t.asset, usd: t.usd, unixTime: t.unixTime, signature: t.signature });
    if (!c.assets.includes(t.asset)) c.assets.push(t.asset);
    if (!c.label && t.counterpartyLabel) { c.label = t.counterpartyLabel; c.labelType = t.labelType; c.labelConfident = t.labelConfident; }
    if (t.counterpartyLabel && t.labelConfident) c.labelConfident = true;
    if (t.isExchange) c.isExchange = true;
  }

  const counterparties = [...byParty.values()];
  const outDenom = totalOutUsd > 0 ? totalOutUsd : 1;

  for (const c of counterparties) {
    c.outUsd = +c.outUsd.toFixed(2);
    c.inUsd = +c.inUsd.toFixed(2);
    c.netUsd = +(c.outUsd - c.inUsd).toFixed(2);
    c.totalUsd = +(c.outUsd + c.inUsd).toFixed(2);
    c.pctOfOut = +((c.outUsd / outDenom) * 100).toFixed(1);
    c.txs.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)); // largest USD first

    if (c.isExchange && c.outUsd > 0) c.flags.push("cash-out");
    if ((largestOutUsd.get(c.counterparty) ?? 0) / outDenom >= SINGLE_LARGE_PCT) c.flags.push("single-large");
    if (c.txCount >= REPEATED_TX_COUNT) c.flags.push("repeated");
    if (c.label && MIXER_LABELS.has(c.label)) c.flags.push("mixer");
  }

  // Default rank: biggest USD outflow sink first (the UI re-ranks per active metric).
  counterparties.sort((a, b) => b.outUsd - a.outUsd);

  const exchangeOutUsd = +counterparties
    .filter((c) => c.isExchange)
    .reduce((s, c) => s + c.outUsd, 0)
    .toFixed(2);

  const topRecipientPct = counterparties.length ? counterparties[0].pctOfOut : 0;

  return {
    wallet: o.wallet,
    chain: o.chain,
    totalOutUsd: +totalOutUsd.toFixed(2),
    totalInUsd: +totalInUsd.toFixed(2),
    netUsd: +(totalInUsd - totalOutUsd).toFixed(2),
    transferCount: o.transfers.length,
    outCount,
    inCount,
    counterpartyCount: counterparties.length,
    topRecipientPct,
    exchangeOutUsd,
    counterparties,
    allTransfers: o.transfers,
  };
}

// Deterministic fallback verdict, used when there's no LLM key. Also gives the
// LLM a baseline it must justify or override. "Concentration" = how much of the
// wallet's USD OUTFLOW funneled into its single biggest destination.
export function concentrationVerdict(r: FlowReport): "low" | "medium" | "high" {
  if (r.topRecipientPct >= 60 || r.counterpartyCount <= 2) return "high";
  if (r.topRecipientPct >= 35 || r.counterpartyCount <= 5) return "medium";
  return "low";
}
