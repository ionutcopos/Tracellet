import type { ChainInfo, WalletOutflows, Transfer } from "../types.ts";

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

// High-confidence entity labels only. A WRONG "Binance" label is worse than no
// label, so this map is intentionally tiny — proper entity labeling needs a labels
// dataset (Helius/Arkham/a maintained list), tracked as future work. Recipients
// without a label render as their address, which is honest.
const SOLANA_LABELS: Record<string, { label: string; isExchange: boolean }> = {
  // e.g. "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": { label: "Binance", isExchange: true },
};

interface HeliusNativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number; // lamports
}
interface HeliusTx {
  timestamp: number;
  signature: string;
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
        const meta = SOLANA_LABELS[nt.toUserAccount];
        transfers.push({
          to: nt.toUserAccount,
          amount: +sol.toFixed(4),
          asset: "SOL",
          unixTime: tx.timestamp,
          toLabel: meta?.label ?? null,
          isExchange: meta?.isExchange ?? false,
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
