import type { ChainInfo, WalletOutflows, Transfer, WalletHoldings, TokenHolding } from "../types.ts";
import { entityLabel, sourceLabel } from "../labels.ts";

// Live on-chain data. The job of this file is: raw provider JSON -> WalletOutflows.
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

async function heliusSolanaOutflows(wallet: string, chain: ChainInfo, key: string): Promise<WalletOutflows> {
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
        if (nt.fromUserAccount !== wallet) continue; // outbound only
        if (!nt.toUserAccount || nt.toUserAccount === wallet) continue; // skip self
        const sol = nt.amount / LAMPORTS_PER_SOL;
        if (sol < DUST_SOL) continue; // drop rent/fee noise
        // Tier 1: curated entity label. Tier 2: protocol the transfer flowed through.
        const entity = entityLabel("solana", nt.toUserAccount);
        transfers.push({
          to: nt.toUserAccount,
          amount: +sol.toFixed(4),
          asset: "SOL",
          unixTime: tx.timestamp,
          signature: tx.signature,
          toLabel: entity?.label ?? sourceLabel(tx.source),
          isExchange: entity?.isExchange ?? false,
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
      const dec = ti.decimals ?? 0;
      return {
        mint: i.id,
        symbol: ti.symbol && ti.symbol.trim() ? ti.symbol : null,
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
export async function liveWalletOutflows(wallet: string, chain: ChainInfo): Promise<WalletOutflows> {
  if (chain.family === "solana") {
    const key = process.env.HELIUS_API_KEY;
    if (!key) throw new Error("HELIUS_API_KEY is not set");
    return heliusSolanaOutflows(wallet, chain, key);
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
