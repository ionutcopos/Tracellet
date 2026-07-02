import type { ChainInfo, WalletTransfers, Transfer, WalletHoldings, TokenHolding } from "../types.ts";
import { entityLabel, sourceLabel, isExchangeType, type Label } from "../labels.ts";

// Live on-chain data. The job of this file is: raw provider JSON -> WalletTransfers.
// Nothing else in the app sees a raw provider response. Chain is already detected
// upstream, so this dispatches on chain.family. Solana is wired (Helius); the
// other families are stubbed with their provider plan.

const HELIUS_BASE = "https://api.helius.xyz/v0";
const LAMPORTS_PER_SOL = 1_000_000_000;

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
interface HeliusTx {
  timestamp: number;
  signature: string;
  source?: string; // PUMP_FUN, JUPITER, RAYDIUM, SYSTEM_PROGRAM…
  nativeTransfers?: HeliusNativeTransfer[];
}

async function heliusSolanaTransfers(wallet: string, chain: ChainInfo, key: string): Promise<WalletTransfers> {
  const transfers: Transfer[] = [];
  let before: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${HELIUS_BASE}/addresses/${wallet}/transactions?api-key=${key}&limit=100` +
      (before ? `&before=${before}` : "");
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Helius API error ${res.status}`);
    }
    const txs = (await res.json()) as HeliusTx[];
    if (!Array.isArray(txs) || txs.length === 0) break;

    for (const tx of txs) {
      for (const nt of tx.nativeTransfers ?? []) {
        const out = nt.fromUserAccount === wallet;
        const inbound = nt.toUserAccount === wallet;
        if (out === inbound) continue; // skip self-transfers and unrelated legs
        const counterparty = out ? nt.toUserAccount : nt.fromUserAccount;
        if (!counterparty) continue;
        const sol = nt.amount / LAMPORTS_PER_SOL;
        if (sol < DUST_SOL) continue; // drop rent/fee noise
        // Tier 1: curated entity label. Tier 2: protocol the transfer flowed through.
        const meta: Label | null = entityLabel("solana", counterparty) ?? sourceLabel(tx.source);
        transfers.push({
          direction: out ? "out" : "in",
          counterparty,
          amount: +sol.toFixed(4),
          asset: "SOL",
          unixTime: tx.timestamp,
          signature: tx.signature,
          counterpartyLabel: meta?.label ?? null,
          labelType: meta?.type ?? null,
          isExchange: isExchangeType(meta?.type ?? null),
        });
      }
    }

    before = txs[txs.length - 1].signature;
    if (txs.length < 100) break; // last page
  }

  if (transfers.length === 0) {
    const now = Math.floor(Date.now() / 1000);
    return { wallet, chain, firstSeenUnix: now, lastSeenUnix: now, transfers: [] };
  }

  transfers.sort((a, b) => a.unixTime - b.unixTime);
  return {
    wallet,
    chain,
    firstSeenUnix: transfers[0].unixTime,
    lastSeenUnix: transfers[transfers.length - 1].unixTime,
    transfers,
  };
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

// Per-family plan for the chains not yet wired:
//   evm     -> Etherscan-family `txlist`+`tokentx`, or Alchemy/Covalent multichain
//   bitcoin -> mempool.space / Blockstream (filter change outputs back to sender)
//   tron    -> TronGrid /v1/accounts/{addr}/transactions
export async function liveWalletTransfers(wallet: string, chain: ChainInfo): Promise<WalletTransfers> {
  if (chain.family === "solana") {
    const key = process.env.HELIUS_API_KEY;
    if (!key) throw new Error("HELIUS_API_KEY is not set");
    return heliusSolanaTransfers(wallet, chain, key);
  }
  throw new Error(`live data not implemented for ${chain.family} — see live.ts`);
}

export async function liveWalletHoldings(wallet: string, chain: ChainInfo): Promise<WalletHoldings> {
  if (chain.family === "solana") {
    const key = process.env.HELIUS_API_KEY;
    if (!key) throw new Error("HELIUS_API_KEY is not set");
    return heliusSolanaHoldings(wallet, key);
  }
  throw new Error(`live holdings not implemented for ${chain.family} — see live.ts`);
}
