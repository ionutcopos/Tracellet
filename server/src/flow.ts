import type {
  WalletOutflows,
  RecipientFlow,
  FlowReport,
} from "./types.ts";

// Deterministic fund-flow computation. Like signals.ts, this is the part that must
// be CORRECT: pure (no I/O, no LLM), the only thing that produces numbers. It
// aggregates a wallet's outbound transfers by recipient and computes concentration.
// The LLM downstream only narrates what this outputs.

// A recipient counts as "single-large" if one transfer to it is a big slug of the
// wallet's total outflow — the kind of move worth calling out.
const SINGLE_LARGE_PCT = 0.15;
// Many small transfers to the same sink over time = a consolidation pattern.
const REPEATED_TX_COUNT = 5;

export function buildFlowReport(o: WalletOutflows): FlowReport {
  const totalOut = o.transfers.reduce((s, t) => s + t.amount, 0);

  // Aggregate by recipient address.
  const byRecipient = new Map<string, RecipientFlow>();
  const largestTx = new Map<string, number>();

  for (const t of o.transfers) {
    let r = byRecipient.get(t.to);
    if (!r) {
      r = {
        recipient: t.to,
        label: t.toLabel,
        isExchange: t.isExchange,
        totalAmount: 0,
        txCount: 0,
        pctOfTotal: 0,
        firstUnix: t.unixTime,
        lastUnix: t.unixTime,
        flags: [],
      };
      byRecipient.set(t.to, r);
    }
    r.totalAmount += t.amount;
    r.txCount += 1;
    r.firstUnix = Math.min(r.firstUnix, t.unixTime);
    r.lastUnix = Math.max(r.lastUnix, t.unixTime);
    // keep a label/exchange flag if any transfer to this recipient had one
    if (!r.label && t.toLabel) r.label = t.toLabel;
    if (t.isExchange) r.isExchange = true;
    largestTx.set(t.to, Math.max(largestTx.get(t.to) ?? 0, t.amount));
  }

  const recipients = [...byRecipient.values()];
  const denom = totalOut > 0 ? totalOut : 1;

  for (const r of recipients) {
    r.totalAmount = +r.totalAmount.toFixed(4);
    r.pctOfTotal = +((r.totalAmount / denom) * 100).toFixed(1);
    if (r.isExchange) r.flags.push("cash-out");
    if ((largestTx.get(r.recipient) ?? 0) / denom >= SINGLE_LARGE_PCT) r.flags.push("single-large");
    if (r.txCount >= REPEATED_TX_COUNT) r.flags.push("repeated");
    if (r.label === "Tornado Cash") r.flags.push("mixer");
  }

  // Rank by total sent, biggest sink first.
  recipients.sort((a, b) => b.totalAmount - a.totalAmount);

  const exchangeOut = +recipients
    .filter((r) => r.isExchange)
    .reduce((s, r) => s + r.totalAmount, 0)
    .toFixed(4);

  const topRecipientPct = recipients.length ? recipients[0].pctOfTotal : 0;

  return {
    wallet: o.wallet,
    chain: o.chain,
    totalOut: +totalOut.toFixed(4),
    transferCount: o.transfers.length,
    recipientCount: recipients.length,
    topRecipientPct,
    exchangeOut,
    recipients,
  };
}

// Deterministic fallback verdict, used when there's no LLM key. Also gives the
// LLM a baseline it must justify or override. "Concentration" = how much of the
// wallet's money funneled into its single biggest destination.
export function concentrationVerdict(r: FlowReport): "low" | "medium" | "high" {
  if (r.topRecipientPct >= 60 || r.recipientCount <= 2) return "high";
  if (r.topRecipientPct >= 35 || r.recipientCount <= 5) return "medium";
  return "low";
}
