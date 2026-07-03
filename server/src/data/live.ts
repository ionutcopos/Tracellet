import type { ChainInfo, WalletTransfers, Transfer, WalletHoldings, TokenHolding } from "../types.ts";
import { entityLabel, sourceLabel, isExchangeType, type Label } from "../labels.ts";
import { fetchPrices, nativeKey, tokenKey, type PriceInfo } from "../prices.ts";

// Token transfers below this USD value are dropped as spam/dust. Native transfers
// keep their own lamport dust filter (rent). Priced stablecoin/token flows survive.
const MIN_TOKEN_USD = 1;
function short(a: string) { return `${a.slice(0, 4)}…${a.slice(-4)}`; }

// Live on-chain data. The job of this file is: raw provider JSON -> WalletTransfers.
// Nothing else in the app sees a raw provider response. Chain is already detected
// upstream, so this dispatches on chain.family. Solana is wired (Helius); the
// other families are stubbed with their provider plan.

const HELIUS_BASE = "https://api.helius.xyz/v0";
const HELIUS_RPC_BASE = "https://mainnet.helius-rpc.com";
const LAMPORTS_PER_SOL = 1_000_000_000;
// A personal wallet's account is owned by the System Program; protocol accounts
// (bonding curves, pools, fee vaults) are owned by their program.
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

// Real wallets are noisy. Outbound native transfers below this are rent-exemption
// deposits (~0.00204 SOL for a token account), fee dust, and tip crumbs — NOT
// "money the wallet sent someone". Filtering them is what makes the ranking mean
// something instead of surfacing rent accounts as top recipients.
const DUST_SOL = 0.005;
// Cap history depth so a hyperactive wallet can't spin forever (100 tx / page).
const MAX_PAGES = 10;

interface HeliusNativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number; // lamports
}
interface HeliusTokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  tokenAmount: number; // UI amount (decimals already applied)
  mint: string;
}
interface HeliusTx {
  timestamp: number;
  signature: string;
  source?: string; // PUMP_FUN, JUPITER, RAYDIUM, SYSTEM_PROGRAM…
  nativeTransfers?: HeliusNativeTransfer[];
  tokenTransfers?: HeliusTokenTransfer[];
}

// A transfer leg before pricing/labeling — collected first so we can batch-price
// every mint in one call, then finalize.
interface RawLeg {
  direction: "in" | "out";
  counterparty: string;
  amount: number;
  asset: string;            // "SOL" or a mint (replaced with symbol after pricing)
  assetAddress: string | null;
  unixTime: number;
  signature: string;
  source?: string;
}

async function heliusSolanaTransfers(wallet: string, chain: ChainInfo, key: string): Promise<WalletTransfers> {
  // Pass 1 — collect raw native + token legs (unpriced).
  const legs: RawLeg[] = [];
  let before: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${HELIUS_BASE}/addresses/${wallet}/transactions?api-key=${key}&limit=100` +
      (before ? `&before=${before}` : "");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Helius API error ${res.status}`);
    const txs = (await res.json()) as HeliusTx[];
    if (!Array.isArray(txs) || txs.length === 0) break;

    for (const tx of txs) {
      for (const nt of tx.nativeTransfers ?? []) {
        const out = nt.fromUserAccount === wallet;
        const inbound = nt.toUserAccount === wallet;
        if (out === inbound) continue;
        const counterparty = out ? nt.toUserAccount : nt.fromUserAccount;
        if (!counterparty) continue;
        const sol = nt.amount / LAMPORTS_PER_SOL;
        if (sol < DUST_SOL) continue; // drop rent/fee noise
        legs.push({ direction: out ? "out" : "in", counterparty, amount: +sol.toFixed(4), asset: "SOL", assetAddress: null, unixTime: tx.timestamp, signature: tx.signature, source: tx.source });
      }
      for (const tt of tx.tokenTransfers ?? []) {
        const out = tt.fromUserAccount === wallet;
        const inbound = tt.toUserAccount === wallet;
        if (out === inbound) continue;
        const counterparty = out ? tt.toUserAccount : tt.fromUserAccount;
        if (!counterparty || !tt.mint || !(tt.tokenAmount > 0)) continue;
        legs.push({ direction: out ? "out" : "in", counterparty, amount: tt.tokenAmount, asset: tt.mint, assetAddress: tt.mint, unixTime: tx.timestamp, signature: tx.signature, source: tx.source });
      }
    }

    before = txs[txs.length - 1].signature;
    if (txs.length < 100) break;
  }

  // Price everything: native SOL + every distinct token mint.
  const mints = [...new Set(legs.filter((l) => l.assetAddress).map((l) => l.assetAddress!))];
  const prices = await fetchPrices([nativeKey(chain), ...mints.map((m) => tokenKey(chain, m))]);
  const solPrice = prices.get(nativeKey(chain))?.price ?? null;

  // Pass 2 — value, filter, label.
  const transfers: Transfer[] = [];
  for (const l of legs) {
    let usd: number | null;
    let asset = l.asset;
    if (l.assetAddress) {
      const p: PriceInfo | undefined = prices.get(tokenKey(chain, l.assetAddress));
      usd = p ? +(l.amount * p.price).toFixed(2) : null;
      if (usd == null || usd < MIN_TOKEN_USD) continue; // drop unpriced/spam tokens
      asset = p!.symbol ? p!.symbol.toUpperCase() : short(l.assetAddress);
    } else {
      usd = solPrice != null ? +(l.amount * solPrice).toFixed(2) : null;
    }
    const entity = entityLabel("solana", l.counterparty);
    const meta: Label | null = entity ?? sourceLabel(l.source);
    transfers.push({
      direction: l.direction,
      counterparty: l.counterparty,
      amount: l.amount,
      asset,
      assetAddress: l.assetAddress,
      usd,
      unixTime: l.unixTime,
      signature: l.signature,
      counterpartyLabel: meta?.label ?? null,
      labelType: meta?.type ?? null,
      labelConfident: entity != null, // curated = confident; source = verify below
      isExchange: isExchangeType(meta?.type ?? null),
    });
  }

  if (transfers.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    return { wallet, chain, firstSeenUnix: now, lastSeenUnix: now, transfers: [] };
  }

  // Verify source-derived labels: a real protocol account is program-owned; a plain
  // wallet is owned by the System Program. Only confirm the label for the former.
  const toVerify = [...new Set(transfers.filter((t) => t.counterpartyLabel && !t.labelConfident).map((t) => t.counterparty))];
  if (toVerify.length) {
    const owners = await heliusOwners(toVerify, key);
    for (const t of transfers) {
      if (t.counterpartyLabel && !t.labelConfident) {
        const owner = owners.get(t.counterparty);
        if (owner && owner !== SYSTEM_PROGRAM) t.labelConfident = true;
      }
    }
  }

  transfers.sort((a, b) => a.unixTime - b.unixTime);
  return {
    wallet, chain,
    firstSeenUnix: transfers[0].unixTime,
    lastSeenUnix: transfers[transfers.length - 1].unixTime,
    transfers,
  };
}

// Look up the on-chain owner program of each account (batched, 100 per RPC call).
// Returns address -> owner (or null if the account doesn't exist on chain).
async function heliusOwners(addresses: string[], key: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const res = await fetch(`${HELIUS_RPC_BASE}/?api-key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "owners", method: "getMultipleAccounts",
        params: [chunk, { encoding: "base64" }],
      }),
    });
    if (!res.ok) { chunk.forEach((a) => out.set(a, null)); continue; }
    const json = (await res.json()) as { result?: { value?: ({ owner?: string } | null)[] } };
    const value = json.result?.value ?? [];
    chunk.forEach((a, j) => out.set(a, value[j]?.owner ?? null));
  }
  return out;
}

// ---- Current holdings: SOL balance + fungible tokens (Helius DAS) ----

const HELIUS_RPC = "https://mainnet.helius-rpc.com";

interface DasNativeBalance {
  lamports: number;
  total_price?: number; // USD
}
interface DasTokenInfo {
  symbol?: string;
  balance?: number;
  decimals?: number;
  price_info?: { total_price?: number };
}
interface DasItem {
  id: string;
  interface: string; // FungibleToken | FungibleAsset | V1_NFT | ProgrammableNFT…
  token_info?: DasTokenInfo;
  content?: { metadata?: { name?: string; symbol?: string } };
}

async function heliusSolanaHoldings(wallet: string, key: string): Promise<WalletHoldings> {
  const res = await fetch(`${HELIUS_RPC}/?api-key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "holdings",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: wallet,
        page: 1,
        limit: 1000,
        displayOptions: { showFungible: true, showNativeBalance: true },
      },
    }),
  });
  if (!res.ok) throw new Error(`Helius DAS error ${res.status}`);
  const json = (await res.json()) as { result?: { items?: DasItem[]; nativeBalance?: DasNativeBalance } };
  const result = json.result ?? {};
  const items = result.items ?? [];

  const native = result.nativeBalance;
  const nativeBalance = native ? +(native.lamports / LAMPORTS_PER_SOL).toFixed(4) : 0;
  const nativeUsd = native?.total_price != null ? +native.total_price.toFixed(2) : null;

  const isFungible = (i: DasItem) => i.interface === "FungibleToken" || i.interface === "FungibleAsset";
  const tokens: TokenHolding[] = items
    .filter((i) => isFungible(i) && (i.token_info?.balance ?? 0) > 0)
    .map((i) => {
      const ti = i.token_info!;
      const md = i.content?.metadata ?? {};
      const dec = ti.decimals ?? 0;
      const clean = (s?: string) => (s && s.trim() ? s.trim() : null);
      return {
        mint: i.id,
        symbol: clean(ti.symbol) ?? clean(md.symbol),
        name: clean(md.name),
        amount: +(ti.balance! / 10 ** dec).toFixed(4),
        usd: ti.price_info?.total_price != null ? +ti.price_info.total_price.toFixed(2) : null,
      };
    })
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || b.amount - a.amount);

  const nftCount = items.filter((i) => i.interface === "V1_NFT" || i.interface === "ProgrammableNFT").length;

  return {
    nativeBalance,
    nativeAsset: "SOL",
    nativeUsd,
    tokenCount: tokens.length,
    nftCount,
    tokens,
  };
}

// ---- EVM: native ETH/POL/BNB transfers + balance (Etherscan V2 unified API) ----
// One key works across all EVM chains; the chain is selected by `chainid`. We read
// both external (`txlist`) and internal (`txlistinternal`) transactions so contract-
// mediated value (DEX payouts, withdrawals) is counted, not just direct sends.

const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";
const WEI_PER_ETH = 1e18;
const EVM_CHAIN_IDS: Record<string, number> = {
  ethereum: 1, base: 8453, arbitrum: 42161, polygon: 137, bsc: 56,
};
const EVM_MAX_ROWS = 2000; // most recent N txs per list

interface EtherscanTx {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;          // wei (native) or raw token units (tokentx)
  isError?: string;
  contractAddress?: string; // tokentx only
  tokenSymbol?: string;     // tokentx only
  tokenDecimal?: string;    // tokentx only
}

async function etherscanList(chainId: number, action: string, wallet: string, key: string): Promise<EtherscanTx[]> {
  const url =
    `${ETHERSCAN_V2}?chainid=${chainId}&module=account&action=${action}&address=${wallet}` +
    `&startblock=0&endblock=99999999&page=1&offset=${EVM_MAX_ROWS}&sort=desc&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Etherscan API error ${res.status}`);
  const j = (await res.json()) as { status: string; message: string; result: EtherscanTx[] | string };
  if (Array.isArray(j.result)) return j.result;
  // status "0" with a "No transactions found" message is a normal empty result.
  if (/no transactions/i.test(j.message ?? "")) return [];
  throw new Error(`Etherscan: ${typeof j.result === "string" ? j.result : j.message}`);
}

async function evmWalletTransfers(wallet: string, chain: ChainInfo, key: string): Promise<WalletTransfers> {
  const chainId = EVM_CHAIN_IDS[chain.id];
  if (!chainId) throw new Error(`no Etherscan chainid for ${chain.id}`);
  const w = wallet.toLowerCase();

  // native external + internal, plus ERC-20 token transfers.
  const [ext, internal, tok] = await Promise.all([
    etherscanList(chainId, "txlist", wallet, key),
    etherscanList(chainId, "txlistinternal", wallet, key),
    etherscanList(chainId, "tokentx", wallet, key).catch(() => [] as EtherscanTx[]),
  ]);

  // Pass 1 — collect raw legs.
  const legs: RawLeg[] = [];
  const nativeLeg = (t: EtherscanTx) => {
    if (t.isError === "1") return;
    const val = Number(t.value) / WEI_PER_ETH;
    if (!(val > 0)) return; // skip 0-value contract calls
    const from = (t.from ?? "").toLowerCase();
    const to = (t.to ?? "").toLowerCase();
    const out = from === w, inbound = to === w;
    if (out === inbound) return;
    const counterparty = out ? t.to : t.from;
    if (!counterparty) return;
    legs.push({ direction: out ? "out" : "in", counterparty, amount: +val.toFixed(6), asset: chain.nativeAsset, assetAddress: null, unixTime: Number(t.timeStamp), signature: t.hash });
  };
  ext.forEach(nativeLeg);
  internal.forEach(nativeLeg);
  for (const t of tok) {
    const from = (t.from ?? "").toLowerCase();
    const to = (t.to ?? "").toLowerCase();
    const out = from === w, inbound = to === w;
    if (out === inbound || !t.contractAddress) continue;
    const counterparty = out ? t.to : t.from;
    if (!counterparty) continue;
    const amount = Number(t.value) / 10 ** Number(t.tokenDecimal ?? 18);
    if (!(amount > 0)) continue;
    legs.push({ direction: out ? "out" : "in", counterparty, amount, asset: t.tokenSymbol ?? "?", assetAddress: t.contractAddress.toLowerCase(), unixTime: Number(t.timeStamp), signature: t.hash });
  }

  // Price native + every token contract.
  const contracts = [...new Set(legs.filter((l) => l.assetAddress).map((l) => l.assetAddress!))];
  const prices = await fetchPrices([nativeKey(chain), ...contracts.map((c) => tokenKey(chain, c))]);
  const nativePrice = prices.get(nativeKey(chain))?.price ?? null;

  // Pass 2 — value, filter, label.
  const transfers: Transfer[] = [];
  for (const l of legs) {
    let usd: number | null;
    if (l.assetAddress) {
      const p = prices.get(tokenKey(chain, l.assetAddress));
      usd = p ? +(l.amount * p.price).toFixed(2) : null;
      if (usd == null || usd < MIN_TOKEN_USD) continue; // drop unpriced/spam tokens
    } else {
      usd = nativePrice != null ? +(l.amount * nativePrice).toFixed(2) : null;
    }
    const meta: Label | null = entityLabel("evm", l.counterparty.toLowerCase());
    transfers.push({
      direction: l.direction,
      counterparty: l.counterparty,
      amount: l.amount,
      asset: l.asset,
      assetAddress: l.assetAddress,
      usd,
      unixTime: l.unixTime,
      signature: l.signature,
      counterpartyLabel: meta?.label ?? null,
      labelType: meta?.type ?? null,
      labelConfident: meta != null,
      isExchange: isExchangeType(meta?.type ?? null),
    });
  }

  if (transfers.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    return { wallet, chain, firstSeenUnix: now, lastSeenUnix: now, transfers: [] };
  }
  transfers.sort((a, b) => a.unixTime - b.unixTime);
  return {
    wallet, chain,
    firstSeenUnix: transfers[0].unixTime,
    lastSeenUnix: transfers[transfers.length - 1].unixTime,
    transfers,
  };
}

async function evmHoldings(wallet: string, chain: ChainInfo, key: string): Promise<WalletHoldings> {
  const chainId = EVM_CHAIN_IDS[chain.id];
  if (!chainId) throw new Error(`no Etherscan chainid for ${chain.id}`);
  const url = `${ETHERSCAN_V2}?chainid=${chainId}&module=account&action=balance&address=${wallet}&tag=latest&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Etherscan API error ${res.status}`);
  const j = (await res.json()) as { result: string };
  const nativeBalance = +(Number(j.result) / WEI_PER_ETH).toFixed(6);
  const price = (await fetchPrices([nativeKey(chain)])).get(nativeKey(chain))?.price ?? null;
  // ERC-20 token holdings need a token-balance list (Etherscan Pro) — not on free
  // tier, so we report native balance (valued in USD) only for now.
  return {
    nativeBalance,
    nativeAsset: chain.nativeAsset,
    nativeUsd: price != null ? +(nativeBalance * price).toFixed(2) : null,
    tokenCount: 0, nftCount: 0, tokens: [],
  };
}

// ---- dispatch ----

export async function liveWalletTransfers(wallet: string, chain: ChainInfo): Promise<WalletTransfers> {
  if (chain.family === "solana") {
    const key = process.env.HELIUS_API_KEY;
    if (!key) throw new Error("HELIUS_API_KEY is not set");
    return heliusSolanaTransfers(wallet, chain, key);
  }
  if (chain.family === "evm") {
    const key = process.env.ETHERSCAN_API_KEY;
    if (!key) throw new Error("ETHERSCAN_API_KEY is not set");
    return evmWalletTransfers(wallet, chain, key);
  }
  throw new Error(`live data not implemented for ${chain.family} — see live.ts`);
}

export async function liveWalletHoldings(wallet: string, chain: ChainInfo): Promise<WalletHoldings> {
  if (chain.family === "solana") {
    const key = process.env.HELIUS_API_KEY;
    if (!key) throw new Error("HELIUS_API_KEY is not set");
    return heliusSolanaHoldings(wallet, key);
  }
  if (chain.family === "evm") {
    const key = process.env.ETHERSCAN_API_KEY;
    if (!key) throw new Error("ETHERSCAN_API_KEY is not set");
    return evmHoldings(wallet, chain, key);
  }
  throw new Error(`live holdings not implemented for ${chain.family} — see live.ts`);
}
