import type {
  WalletTransfers,
  CounterpartyFlow,
  FlowReport,
} from "./types.ts";

// Deterministic fund-flow computation. Like signals.ts, this is the part that must
// be CORRECT: pure (no I/O, no LLM), the only thing that produces numbers. It
// aggregates a wallet's transfers (both directions) by counterparty and computes
// concentration. The LLM downstream only narrates what this outputs.

// A counterparty counts as "single-large" if one outbound transfer to it is a big
// slug of the wallet's total outflow — the kind of move worth calling out.
const SINGLE_LARGE_PCT = 0.15;
// Many transfers to the same counterparty = a consolidation / repeated pattern.
const REPEATED_TX_COUNT = 5;
const MIXER_LABELS = new Set(["Tornado Cash", "Tornado.Cash"]);

export function buildFlowReport(o: WalletTransfers): FlowReport {
  let totalOut = 0;
  let totalIn = 0;
  let outCount = 0;
  let inCount = 0;

  const byParty = new Map<string, CounterpartyFlow>();
  const largestOutTx = new Map<string, number>();

  for (const t of o.transfers) {
    if (t.direction === "out") { totalOut += t.amount; outCount++; }
    else { totalIn += t.amount; inCount++; }

    let c = byParty.get(t.counterparty);
    if (!c) {
      c = {
        counterparty: t.counterparty,
        label: t.counterpartyLabel,
        labelType: t.labelType,
        labelConfident: t.labelConfident,
        isExchange: t.isExchange,
        outAmount: 0, inAmount: 0, netAmount: 0, totalAmount: 0,
        outTxCount: 0, inTxCount: 0, txCount: 0,
        pctOfOut: 0,
        firstUnix: t.unixTime,
        lastUnix: t.unixTime,
        flags: [],
        txs: [],
      };
      byParty.set(t.counterparty, c);
    }
    if (t.direction === "out") {
      c.outAmount += t.amount;
      c.outTxCount++;
      largestOutTx.set(t.counterparty, Math.max(largestOutTx.get(t.counterparty) ?? 0, t.amount));
    } else {
      c.inAmount += t.amount;
      c.inTxCount++;
    }
    c.txCount++;
    c.firstUnix = Math.min(c.firstUnix, t.unixTime);
    c.lastUnix = Math.max(c.lastUnix, t.unixTime);
    c.txs.push({ direction: t.direction, amount: t.amount, unixTime: t.unixTime, signature: t.signature });
    // keep a label/type if any transfer to/from this counterparty had one
    if (!c.label && t.counterpartyLabel) { c.label = t.counterpartyLabel; c.labelType = t.labelType; c.labelConfident = t.labelConfident; }
    if (t.counterpartyLabel && t.labelConfident) c.labelConfident = true; // any confirmed leg confirms it
    if (t.isExchange) c.isExchange = true;
  }

  const counterparties = [...byParty.values()];
  const outDenom = totalOut > 0 ? totalOut : 1;

  for (const c of counterparties) {
    c.outAmount = +c.outAmount.toFixed(4);
    c.inAmount = +c.inAmount.toFixed(4);
    c.netAmount = +(c.outAmount - c.inAmount).toFixed(4);
    c.totalAmount = +(c.outAmount + c.inAmount).toFixed(4);
    c.pctOfOut = +((c.outAmount / outDenom) * 100).toFixed(1);
    c.txs.sort((a, b) => b.amount - a.amount); // largest transfer first

    if (c.isExchange && c.outAmount > 0) c.flags.push("cash-out");
    if ((largestOutTx.get(c.counterparty) ?? 0) / outDenom >= SINGLE_LARGE_PCT) c.flags.push("single-large");
    if (c.txCount >= REPEATED_TX_COUNT) c.flags.push("repeated");
    if (c.label && MIXER_LABELS.has(c.label)) c.flags.push("mixer");
  }

  // Default rank: biggest outflow sink first (the UI re-ranks per the active metric).
  counterparties.sort((a, b) => b.outAmount - a.outAmount);

  const exchangeOut = +counterparties
    .filter((c) => c.isExchange)
    .reduce((s, c) => s + c.outAmount, 0)
    .toFixed(4);

  const topRecipientPct = counterparties.length ? counterparties[0].pctOfOut : 0;

  return {
    wallet: o.wallet,
    chain: o.chain,
    totalOut: +totalOut.toFixed(4),
    totalIn: +totalIn.toFixed(4),
    netTotal: +(totalIn - totalOut).toFixed(4),
    transferCount: o.transfers.length,
    outCount,
    inCount,
    counterpartyCount: counterparties.length,
    topRecipientPct,
    exchangeOut,
    counterparties,
    allTransfers: o.transfers,
  };
}

// Deterministic fallback verdict, used when there's no LLM key. Also gives the
// LLM a baseline it must justify or override. "Concentration" = how much of the
// wallet's OUTFLOW funneled into its single biggest destination.
export function concentrationVerdict(r: FlowReport): "low" | "medium" | "high" {
  if (r.topRecipientPct >= 60 || r.counterpartyCount <= 2) return "high";
  if (r.topRecipientPct >= 35 || r.counterpartyCount <= 5) return "medium";
  return "low";
}
