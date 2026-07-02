import type {
  TokenActivity,
  WalletActivity,
  WalletSignals,
  TokenReport,
} from "./types.ts";

// Deterministic signal computation. This is the part that must be CORRECT, so it
// is written and tested by hand, kept pure (no I/O, no LLM), and is the only thing
// that produces numbers. The LLM downstream only narrates what this outputs.

const SNIPE_WINDOW_SECONDS = 15;
const FAST_DUMP_SECONDS = 120;

function walletSignals(w: WalletActivity): WalletSignals {
  const buys = w.trades.filter((t) => t.side === "buy").sort((a, b) => a.tSinceLaunch - b.tSinceLaunch);
  const sells = w.trades.filter((t) => t.side === "sell").sort((a, b) => a.tSinceLaunch - b.tSinceLaunch);

  const firstBuyT = buys.length ? buys[0].tSinceLaunch : Infinity;
  const isSniper = firstBuyT <= SNIPE_WINDOW_SECONDS;

  const firstSellT = sells.length ? sells[0].tSinceLaunch : null;
  const holdSeconds = firstSellT !== null ? firstSellT - firstBuyT : null;
  const soldWithinTwoMin = holdSeconds !== null && holdSeconds <= FAST_DUMP_SECONDS;

  const spent = buys.reduce((s, t) => s + t.solAmount, 0);
  const received = sells.reduce((s, t) => s + t.solAmount, 0);
  const realizedPnlSol = +(received - spent).toFixed(3);

  const flags: string[] = [];
  if (isSniper) flags.push("sniper");
  if (soldWithinTwoMin) flags.push("fast-dump");
  if (w.fundedBy) flags.push("funded-together");
  if (realizedPnlSol > spent && spent > 0) flags.push("2x+ realized");

  return {
    wallet: w.wallet,
    firstBuyTSinceLaunch: firstBuyT === Infinity ? -1 : firstBuyT,
    isSniper,
    holdSeconds,
    soldWithinTwoMin,
    realizedPnlSol,
    fundedTogetherGroup: null, // assigned below across the whole set
    flags,
  };
}

export function buildReport(activity: TokenActivity): TokenReport {
  const wallets = activity.wallets.map(walletSignals);

  // group wallets by shared funding source -> "bundled" groups
  const groupByFunder = new Map<string, number>();
  let nextGroup = 0;
  for (const w of activity.wallets) {
    if (!w.fundedBy) continue;
    if (!groupByFunder.has(w.fundedBy)) groupByFunder.set(w.fundedBy, nextGroup++);
  }
  for (let i = 0; i < wallets.length; i++) {
    const funder = activity.wallets[i].fundedBy;
    wallets[i].fundedTogetherGroup = funder ? groupByFunder.get(funder)! : null;
  }

  const sniperCount = wallets.filter((w) => w.isSniper).length;
  const bundledGroupCount = groupByFunder.size;

  // sort most suspicious first: snipers, then fast dumps, then by earliest buy
  wallets.sort((a, b) => {
    if (a.isSniper !== b.isSniper) return a.isSniper ? -1 : 1;
    if (a.soldWithinTwoMin !== b.soldWithinTwoMin) return a.soldWithinTwoMin ? -1 : 1;
    return a.firstBuyTSinceLaunch - b.firstBuyTSinceLaunch;
  });

  return {
    mint: activity.mint,
    walletCount: wallets.length,
    sniperCount,
    bundledGroupCount,
    wallets,
  };
}

// Deterministic fallback verdict, used when there's no LLM key. Also gives the
// LLM a baseline it must justify or override.
export function heuristicVerdict(r: TokenReport): "low" | "medium" | "high" {
  const sniperRatio = r.sniperCount / Math.max(r.walletCount, 1);
  if (sniperRatio > 0.4 || r.bundledGroupCount >= 2) return "high";
  if (sniperRatio > 0.2 || r.bundledGroupCount >= 1) return "medium";
  return "low";
}
