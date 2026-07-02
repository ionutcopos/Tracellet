import type {
  TokenActivity,
  WalletActivity,
  Trade,
  ChainInfo,
  WalletTransfers,
  Transfer,
  WalletHoldings,
  TokenHolding,
  LabelType,
} from "../types.ts";

// Deterministic-ish mock generator. Produces a realistic-looking early-buyer
// set for ANY mint string so the UI + signal engine + LLM all work with zero
// API keys. Same mint always yields the same data (seeded by the string).

function seeded(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeWallet(rnd: () => number) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
  let s = "";
  for (let i = 0; i < 44; i++) s += chars[Math.floor(rnd() * chars.length)];
  return s;
}

export function mockTokenActivity(mint: string): TokenActivity {
  const rnd = seeded(mint);
  const launchUnix = 1_700_000_000;
  const walletCount = 18 + Math.floor(rnd() * 6); // 18-23

  // create a couple of "funding sources" so some wallets look bundled
  const fundingSources = [fakeWallet(rnd), fakeWallet(rnd)];

  const wallets: WalletActivity[] = [];
  for (let i = 0; i < walletCount; i++) {
    const wallet = fakeWallet(rnd);

    // ~35% are snipers (buy in first 15s)
    const isSniper = rnd() < 0.35;
    const firstBuyT = isSniper
      ? Math.floor(rnd() * 15)
      : 20 + Math.floor(rnd() * 3600);

    // ~30% funded from a shared source (bundled look)
    const fundedBy =
      rnd() < 0.3 ? fundingSources[Math.floor(rnd() * fundingSources.length)] : null;

    const buySol = +(0.2 + rnd() * 4).toFixed(2);
    const trades: Trade[] = [
      { wallet, side: "buy", tSinceLaunch: firstBuyT, solAmount: buySol },
    ];

    // ~60% sell at some point
    if (rnd() < 0.6) {
      const holdT = firstBuyT + Math.floor(rnd() * 6000);
      // snipers who dump fast: sell within 2 min
      const dumpFast = isSniper && rnd() < 0.6;
      const sellT = dumpFast ? firstBuyT + Math.floor(rnd() * 110) : holdT;
      const sellSol = +(buySol * (0.3 + rnd() * 2.2)).toFixed(2);
      trades.push({ wallet, side: "sell", tSinceLaunch: sellT, solAmount: sellSol });
    }

    wallets.push({ wallet, fundedBy, trades });
  }

  return { mint, launchUnix, wallets };
}

// ---------------------------------------------------------------------------
// Wallet fund-flow mock. Produces a realistic set of OUTBOUND transfers for any
// address on any supported chain, seeded by the address so the same input always
// yields the same flow. Recipient addresses and amounts are chain-appropriate.
// ---------------------------------------------------------------------------

const HEX = "0123456789abcdef";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function chainAddress(rnd: () => number, chain: ChainInfo): string {
  if (chain.family === "evm") {
    let s = "0x";
    for (let i = 0; i < 40; i++) s += HEX[Math.floor(rnd() * 16)];
    return s;
  }
  if (chain.family === "bitcoin") {
    let s = "bc1q";
    for (let i = 0; i < 38; i++) s += "023456789acdefghjklmnpqrstuvwxyz"[Math.floor(rnd() * 32)];
    return s;
  }
  if (chain.family === "tron") {
    let s = "T";
    for (let i = 0; i < 33; i++) s += B58[Math.floor(rnd() * B58.length)];
    return s;
  }
  // solana
  let s = "";
  for (let i = 0; i < 44; i++) s += B58[Math.floor(rnd() * B58.length)];
  return s;
}

// Known-entity labels, per family, so some flows look like real cash-outs.
const EXCHANGES: Record<string, string[]> = {
  evm: ["Binance", "Coinbase", "Kraken", "OKX", "Bybit"],
  solana: ["Binance", "Coinbase", "Kraken", "OKX"],
  bitcoin: ["Binance", "Coinbase", "Kraken"],
  tron: ["Binance", "OKX", "Bybit"],
};
// [label, type] for non-CEX known entities; nulls = unlabeled fresh wallet.
const OTHER_LABELS: ([string, LabelType] | null)[] = [
  ["Uniswap Router", "dex"],
  ["Wormhole", "bridge"],
  ["Jito", "staking"],
  null, null, null,
];

// Typical native-asset transfer sizes, so ETH looks like ETH and BTC like BTC.
function baseAmount(rnd: () => number, chain: ChainInfo): number {
  const scale =
    chain.nativeAsset === "BTC" ? 0.4 :
    chain.nativeAsset === "ETH" ? 3 :
    chain.nativeAsset === "SOL" ? 40 :
    chain.nativeAsset === "TRX" ? 15000 :
    chain.nativeAsset === "BNB" ? 8 :
    chain.nativeAsset === "POL" ? 6000 : 5;
  return +(scale * (0.1 + rnd() * 3)).toFixed(chain.nativeAsset === "BTC" ? 4 : 3);
}

interface MockParty {
  addr: string;
  label: string | null;
  labelType: LabelType | null;
  isExchange: boolean;
}

export function mockWalletTransfers(wallet: string, chain: ChainInfo): WalletTransfers {
  const rnd = seeded(wallet + chain.id);
  const now = 1_720_000_000; // fixed "today" so mock output is stable
  const spanDays = 20 + Math.floor(rnd() * 40);
  const firstSeenUnix = now - spanDays * 86400;

  const partyCount = 6 + Math.floor(rnd() * 9); // 6-14 distinct counterparties
  const exPool = EXCHANGES[chain.family] ?? EXCHANGES.evm;

  // Build the counterparty set: a few labeled entities, the rest fresh wallets.
  const parties: MockParty[] = Array.from({ length: partyCount }, () => {
    const addr = chainAddress(rnd, chain);
    const roll = rnd();
    if (roll < 0.35) {
      return { addr, label: exPool[Math.floor(rnd() * exPool.length)], labelType: "cex", isExchange: true };
    }
    if (roll < 0.5) {
      const pick = OTHER_LABELS[Math.floor(rnd() * OTHER_LABELS.length)];
      return { addr, label: pick?.[0] ?? null, labelType: pick?.[1] ?? null, isExchange: false };
    }
    return { addr, label: null, labelType: null, isExchange: false };
  });

  // One counterparty often dominates outflow (a consolidation / cash-out sink).
  const dominantIdx = Math.floor(rnd() * parties.length);

  const transferCount = partyCount + Math.floor(rnd() * 30);
  const transfers: Transfer[] = [];
  let lastSeenUnix = firstSeenUnix;

  for (let i = 0; i < transferCount; i++) {
    // Weight some transfers toward the dominant sink to create concentration.
    const idx = rnd() < 0.4 ? dominantIdx : Math.floor(rnd() * parties.length);
    const p = parties[idx];
    // ~35% inbound, ~65% outbound — most tracer subjects are net spenders.
    const direction: "in" | "out" = rnd() < 0.35 ? "in" : "out";
    const mult = idx === dominantIdx && direction === "out" ? 1.5 + rnd() * 3 : 0.3 + rnd() * 1.5;
    const amount = +(baseAmount(rnd, chain) * mult).toFixed(chain.nativeAsset === "BTC" ? 4 : 3);
    const unixTime = firstSeenUnix + Math.floor(rnd() * spanDays * 86400);
    lastSeenUnix = Math.max(lastSeenUnix, unixTime);
    transfers.push({
      direction,
      counterparty: p.addr,
      amount,
      asset: chain.nativeAsset,
      unixTime,
      signature: fakeSignature(rnd, chain),
      counterpartyLabel: p.label,
      labelType: p.labelType,
      labelConfident: true, // mock labels are curated-style
      isExchange: p.isExchange,
    });
  }

  transfers.sort((a, b) => a.unixTime - b.unixTime);
  return { wallet, chain, firstSeenUnix, lastSeenUnix, transfers };
}

// A plausible-looking tx hash for the mock (base58 for Solana-ish, 0x-hex for EVM).
function fakeSignature(rnd: () => number, chain: ChainInfo): string {
  if (chain.family === "evm") {
    let s = "0x";
    for (let i = 0; i < 64; i++) s += HEX[Math.floor(rnd() * 16)];
    return s;
  }
  let s = "";
  for (let i = 0; i < 64; i++) s += B58[Math.floor(rnd() * B58.length)];
  return s;
}

// Mock current holdings for chains not yet wired to live data.
export function mockWalletHoldings(wallet: string, chain: ChainInfo): WalletHoldings {
  const rnd = seeded(wallet + chain.id + "holdings");
  const nativeBalance = +(rnd() * 40).toFixed(4);
  const price =
    chain.nativeAsset === "ETH" ? 3200 :
    chain.nativeAsset === "SOL" ? 150 :
    chain.nativeAsset === "BTC" ? 65000 :
    chain.nativeAsset === "BNB" ? 600 : 1;
  const tokenMeta: [string, string][] = [
    ["USDC", "USD Coin"], ["JUP", "Jupiter"], ["BONK", "Bonk"], ["WIF", "dogwifhat"],
    ["PEPE", "Pepe"], ["PYTH", "Pyth Network"], ["JTO", "Jito"], ["RAY", "Raydium"],
  ];
  const tokenCount = Math.floor(rnd() * 5); // 0-4 tokens
  const tokens: TokenHolding[] = Array.from({ length: tokenCount }, () => {
    const [symbol, name] = tokenMeta[Math.floor(rnd() * tokenMeta.length)];
    const amount = +(rnd() * 5000).toFixed(2);
    const usd = +(amount * (0.01 + rnd() * 3)).toFixed(2);
    return { mint: chainAddress(rnd, chain), symbol, name, amount, usd };
  }).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  return {
    nativeBalance,
    nativeAsset: chain.nativeAsset,
    nativeUsd: +(nativeBalance * price).toFixed(2),
    tokenCount,
    nftCount: Math.floor(rnd() * 6),
    tokens,
  };
}
